/**
 * Travel Slice 3 — PATCH validation, optimistic concurrency (database-enforced revision) and the itinerary-document lifecycle.
 * Real HTTP routes, the dev server's throwaway DB (dd_gate_*_test) and the LOCAL FAKE storage provider (proves OUR enforcement, not Cloudinary's).
 * Requires the dev-server env described in receipt_ocr_vertical.test.js.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const mongoose = require('mongoose')
const kit = require('./helpers/authTestKit')
const fake = require('./helpers/fakeProviders')

let db, smtp, providers, A, B, F, tok
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 1)])
const oid = s => new mongoose.Types.ObjectId(s)
const sleep = ms => new Promise(r => setTimeout(r, ms))

test.before(async () => {
  providers = await fake.ensureFakeProviders(); db = await kit.connect(); smtp = await kit.startFakeSmtp(2525)
  A = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  B = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  F = await kit.createOrg({ plan: 'free', webEnabled: false })
  tok = {}; for (const [k, org] of [['A', A], ['B', B], ['F', F]]) for (const r of ['admin', 'manager', 'employee']) { const s = await kit.login(org[r].email); tok[`${k}${r}`] = { token: s.accessToken, cookie: s.cookie } }
})
test.after(async () => {
  const orgs = [A.orgId, B.orgId, F.orgId]
  for (const c of ['travelrequests', 'receiptuploads', 'auditlogs', 'expenses']) await db.collection(c).deleteMany({ orgId: { $in: orgs } })
  await kit.cleanupAll(db); await smtp.stop(); await providers.stop(); await kit.disconnect()
})
test.beforeEach(async () => { await fake.control.reset(); await db.collection('ratelimits').deleteMany({ key: /^(upload-sign|travel-doc):/ }) })

const who = (k, via = 'token') => ({ [via]: tok[k][via] })
const D = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)
const trip = (o = {}) => ({ purpose: 'Patch test ' + crypto.randomBytes(3).toString('hex'), destination: 'Pune', departureDate: D(5), returnDate: D(8), ...o })
const post = (k, body, via = 'token') => kit.api('/api/travel', { method: 'POST', ...who(k, via), body })
const patch = (k, id, body, via = 'token', raw) => kit.api(`/api/travel/${id}`, { method: 'PATCH', ...who(k, via), ...(raw !== undefined ? { raw, headers: { 'Content-Type': 'application/json' } } : { body }) })
const get = (k, id) => kit.api(`/api/travel/${id}`, who(k))
const sign = (k, o = {}) => kit.api('/api/uploads/sign', { method: 'POST', ...who(k), body: { kind: 'receipt', mimeType: 'image/png', sizeBytes: 100, purpose: 'travel_itinerary', ...o } })
async function doc(k, { purpose = 'travel_itinerary' } = {}) {
  const t = await sign(k, { purpose: purpose === null ? undefined : purpose }); assert.equal(t.status, 200, t.text)
  const fd = new FormData(); for (const [f, v] of Object.entries(t.json.fields)) fd.append(f, v); fd.append('file', new Blob([PNG]), 'f.png')
  const up = await (await fetch(t.json.uploadUrl, { method: 'POST', body: fd })).json(); return { url: up.secure_url, pid: up.public_id, ref: `cld:${up.public_id}.png` }
}
const mk = async (k, docs = [], extra = {}) => { const r = await post(k, trip({ itineraryDocs: docs.map(d => d.url), ...extra })); assert.equal(r.status, 201, r.text); return r.json }
const rawTrip = id => db.collection('travelrequests').findOne({ _id: oid(id) })
const audits = (id, action) => db.collection('auditlogs').find({ targetId: String(id), ...(action ? { action } : {}) }).sort({ createdAt: 1 }).toArray()
const row = pid => db.collection('receiptuploads').findOne({ publicId: pid })
const stored = async pid => (await fake.control.state()).files.some(f => f.startsWith(pid + '.'))
const path = (id, i, ext = 'png') => `/api/travel/${id}/itinerary/${i}.${ext}`
const NO_INTERNALS = /cld:|doppeldash\/|testcloud|127\.0\.0\.1|signature|api_key|authenticated\/|stack|mongoose|E11000|MongoServer/i
/** Everything a rejected request must leave untouched. */
async function snapshot(id) { const t = await rawTrip(id); const aud = await audits(id); const ids = (t.itineraryDocs || []).map(r => r.replace(/^cld:/, '').replace(/\.[a-z]+$/, '')); const rows = await db.collection('receiptuploads').find({ claimedBy: String(id) }).project({ publicId: 1, state: 1 }).sort({ publicId: 1 }).toArray(); return JSON.stringify({ t: { ...t, updatedAt: 0 }, aud: aud.map(a => a._id), rows, ids }) }
const claimedSet = async id => new Set((await db.collection('receiptuploads').find({ claimedBy: String(id) }).toArray()).map(r => r.publicId))
// only VALID private references of the trip's own organisation can ever be claimed (legacy/malformed `cld:`-looking strings are preserved but are not claimable files)
const referencedSet = async id => { const t = await rawTrip(id); const re = new RegExp(`^cld:(doppeldash/${t.orgId}/receipts/[A-Za-z0-9_-]{8,64})\\.(jpg|jpeg|png|webp|heic|pdf)$`, 'i'); return new Set((t.itineraryDocs || []).map(d => re.exec(d)?.[1]).filter(Boolean)) }
async function assertClaimsMatchRefs(id, label) { const c = await claimedSet(id), r = await referencedSet(id); assert.deepEqual([...c].sort(), [...r].sort(), `${label}: claimed files must equal referenced files`) }
const rejected = async (res, status, code, label) => { assert.equal(res.status, status, `${label}: ${res.text}`); if (code) assert.equal(res.json.code, code, label); assert.doesNotMatch(res.text, NO_INTERNALS, label + ' leaks internals') }

/* ═════════ 1. revision token ═════════ */
test('R1. every mutable response carries the revision (0 on create, +1 per change); records that predate the field read as 0 and work deterministically', async () => {
  const t = await mk('Aemployee'); assert.equal(t.revision, 0)
  for (const k of ['Aemployee', 'Amanager']) { assert.equal((await get(k, t._id)).json.revision, 0); assert.equal((await kit.api('/api/travel', who(k))).json.find(x => x._id === t._id).revision, 0) }
  const p = await patch('Amanager', t._id, { revision: 0, status: 'pending_admin' }); assert.equal(p.status, 200, p.text); assert.equal(p.json.revision, 1); assert.equal((await get('Aemployee', t._id)).json.revision, 1)
  // legacy record: no revision field at all
  const ins = await db.collection('travelrequests').insertOne({ orgId: A.orgId, userId: A.employee.id, userName: 'x', purpose: 'legacy ' + crypto.randomBytes(3).toString('hex'), destination: 'd', departureDate: new Date(), returnDate: new Date(), estimatedTotal: 0, status: 'pending_manager', itineraryDocs: [] })
  const id = String(ins.insertedId); assert.ok(!('revision' in (await rawTrip(id)))); assert.equal((await get('Amanager', id)).json.revision, 0)
  await rejected(await patch('Amanager', id, { revision: 1, status: 'pending_admin' }), 409, 'revision_conflict', 'legacy with the wrong token')
  const ok = await patch('Amanager', id, { revision: 0, status: 'pending_admin' }); assert.equal(ok.status, 200, ok.text); assert.equal(ok.json.revision, 1); assert.equal((await rawTrip(id)).revision, 1)
  assert.equal((await patch('Aadmin', id, { revision: 1, status: 'approved' })).json.revision, 2)
})

test('R2. missing revision → 428 revision_required; malformed → 400 invalid_revision; stale or future → 409 with the current revision; none of them change anything', async () => {
  const t = await mk('Aemployee'); const before = await snapshot(t._id)
  await rejected(await patch('Amanager', t._id, { status: 'approved' }), 428, 'revision_required', 'missing'); await rejected(await patch('Amanager', t._id, { status: 'approved', revision: null }), 428, 'revision_required', 'null')
  for (const v of ['0', '3', 0.5, 1.5, -1, true, false, {}, [], [0], 1e10, 2 ** 53, 'abc', '']) { const r = await patch('Amanager', t._id, { status: 'approved', revision: v }); await rejected(r, 400, 'invalid_revision', JSON.stringify(v)); assert.deepEqual(r.json.fields, ['revision']) }
  const first = await patch('Amanager', t._id, { revision: 0, status: 'pending_admin' }); assert.equal(first.status, 200)
  const mid = await snapshot(t._id)
  for (const stale of [0, 2, 99]) { const r = await patch('Aadmin', t._id, { status: 'approved', revision: stale, adminNote: 'must not land' }); await rejected(r, 409, 'revision_conflict', 'rev ' + stale); assert.equal(r.json.currentRevision, 1) }
  assert.equal(await snapshot(t._id), mid, 'stale requests changed nothing'); assert.notEqual(before, mid)
})

/* ═════════ 2. strict validation ═════════ */
test('V1. malformed JSON and wrong structures are clean 400s; oversized bodies 413', async () => {
  const t = await mk('Aemployee'); const before = await snapshot(t._id)
  for (const raw of ['not json', '{bad', '', '[]', 'null', '"x"', '123', 'true', '[{"revision":0}]']) { const r = await patch('Amanager', t._id, null, 'token', raw); assert.equal(r.status, 400, JSON.stringify(raw) + r.text); assert.ok(['invalid_json', 'invalid_travel_request'].includes(r.json.code)); assert.doesNotMatch(r.text, /SyntaxError|JSON\.parse|stack/i) }
  const huge = await patch('Amanager', t._id, null, 'token', JSON.stringify({ revision: 0, status: 'approved', managerNote: 'x'.repeat(70_000) })); assert.equal(huge.status, 413)
  assert.equal(await snapshot(t._id), before)
})

test('V2. unsupported fields — every protected/server-owned property included — are rejected and nothing changes (even with a valid status and revision)', async () => {
  const t = await mk('Aemployee'); const before = await snapshot(t._id)
  const prot = { orgId: B.orgId, userId: 'someone', userName: 'Eve', employeeId: 'E1', expenseId: 'abc', approvedBy: 'x', approvedAt: new Date().toISOString(), rejectedBy: 'x', rejectedAt: new Date().toISOString(), requestHash: 'dead', clientRequestId: 'k', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), _id: '5f0000000000000000000000', __v: 9, purpose: 'hijack', destination: 'x', estimatedTotal: 1, advanceRequested: 1, legs: [], accommodation: {}, claimedBy: 'x', state: 'rejected', attachmentState: 'x', isAdmin: true }
  for (const [k, v] of Object.entries(prot)) { const r = await patch('Amanager', t._id, { revision: 0, status: 'pending_admin', [k]: v }); await rejected(r, 400, 'invalid_travel_request', k); assert.ok(r.json.fields.includes(k), k) }
  const proto = await patch('Amanager', t._id, null, 'token', '{"revision":0,"status":"pending_admin","__proto__":{"status":"approved"}}'); assert.equal(proto.status, 400)
  assert.equal(await snapshot(t._id), before)
})

test('V3. status: only the five supported values parse; valid values that the transition table does not allow are 409 invalid_transition', async () => {
  const t = await mk('Aemployee'); const before = await snapshot(t._id)
  for (const v of ['APPROVED', 'paid', 'returned', '', ' approved', null, 5, true, [], {}, ['approved']]) { const r = await patch('Amanager', t._id, { revision: 0, status: v }); await rejected(r, v === null ? 400 : 400, null, JSON.stringify(v)); if (v !== null) assert.ok(r.json.fields.includes('status')) }
  for (const s of ['pending_manager', 'cancelled']) await rejected(await patch('Amanager', t._id, { revision: 0, status: s }), 409, 'invalid_transition', s)
  assert.equal(await snapshot(t._id), before)
  const a = await patch('Amanager', t._id, { revision: 0, status: 'approved' }); assert.equal(a.status, 200)
  for (const s of ['pending_manager', 'pending_admin', 'rejected', 'cancelled', 'approved']) await rejected(await patch('Aadmin', t._id, { revision: 1, status: s }), 409, 'invalid_transition', 'from approved to ' + s)
})

test('V4. notes: ≤2000 chars, plain text, trimmed; null/empty clears; role rules; a notes-only or empty or mixed update is not an operation', async () => {
  const t = await mk('Aemployee')
  for (const v of ['x'.repeat(2001), 'bad\u0000char', 'bell\u0007', 5, true, {}, []]) await rejected(await patch('Amanager', t._id, { revision: 0, status: 'pending_admin', managerNote: v }), 400, 'invalid_travel_request', JSON.stringify(v).slice(0, 20))
  await rejected(await patch('Amanager', t._id, { revision: 0, managerNote: 'only a note' }), 400, 'invalid_travel_request', 'notes only'); await rejected(await patch('Amanager', t._id, { revision: 0 }), 400, 'invalid_travel_request', 'empty')
  await rejected(await patch('Amanager', t._id, { revision: 0, status: 'pending_admin', itineraryDocs: [] }), 400, 'invalid_travel_request', 'status + docs')
  await rejected(await patch('Amanager', t._id, { revision: 0, status: 'pending_admin', adminNote: 'boss only' }), 403, 'note_not_permitted', 'manager writing the admin note')
  const ok = await patch('Amanager', t._id, { revision: 0, status: 'pending_admin', managerNote: `  ${'y'.repeat(2000)}\nsecond line\twith tab  `.slice(0, 2010) }); assert.equal(ok.status, 400, 'over the limit after trimming is rejected')
  const good = await patch('Amanager', t._id, { revision: 0, status: 'pending_admin', managerNote: '  line one\nline two\ttab  ' }); assert.equal(good.status, 200, good.text); assert.equal(good.json.managerNote, 'line one\nline two\ttab')
  const edge = await patch('Aadmin', t._id, { revision: 1, status: 'approved', managerNote: 'z'.repeat(2000), adminNote: 'ok' }); assert.equal(edge.status, 200); assert.equal(edge.json.managerNote.length, 2000); assert.equal(edge.json.adminNote, 'ok')
  const t2 = await mk('Aemployee'); await patch('Amanager', t2._id, { revision: 0, status: 'pending_admin', managerNote: 'first' })
  const cleared = await patch('Aadmin', t2._id, { revision: 1, status: 'rejected', managerNote: null, adminNote: '   ' }); assert.equal(cleared.status, 200); const raw = await rawTrip(t2._id); assert.ok(!('managerNote' in raw) && !('adminNote' in raw), 'null / blank clears the note')
})

/* ═════════ 3. roles, tenants, existing transition rules ═════════ */
test('A1. authorization precedence and matrix: 401, employee 403, other organisation 404 (whatever the body), invalid ids 404', async () => {
  const t = await mk('Aemployee'); const before = await snapshot(t._id); const body = { revision: 0, status: 'approved' }
  assert.equal((await kit.api(`/api/travel/${t._id}`, { method: 'PATCH', body })).status, 401); assert.equal((await kit.api(`/api/travel/${t._id}`, { method: 'PATCH', token: 'abc.def.ghi', body })).status, 401)
  assert.equal((await patch('Aemployee', t._id, body)).status, 403); assert.equal((await patch('Aemployee', t._id, { garbage: 1 })).status, 403, 'employees are refused before any validation')
  assert.equal((await patch('Bemployee', t._id, body)).status, 403)
  for (const k of ['Bmanager', 'Badmin']) for (const b of [body, { garbage: 1 }, { revision: 'x' }, { revision: 0, itineraryDocs: [] }]) assert.equal((await patch(k, t._id, b)).status, 404, k + JSON.stringify(b))
  for (const id of ['zzzz', '5f0000000000000000000000', '123']) assert.equal((await patch('Amanager', id, body)).status, id === '5f0000000000000000000000' ? 404 : 404, id)
  assert.equal(await snapshot(t._id), before)
})

test('T1. the existing transition rules and audit events are intact (manager forwards, boss decides, boss-only approve at pending_admin, return, self-approval, reject), one event per change', async () => {
  const t = await mk('Aemployee')
  let r = await patch('Amanager', t._id, { revision: 0, status: 'pending_admin', managerNote: 'forwarding' }); assert.equal(r.status, 200); assert.equal(r.json.status, 'pending_admin')
  await rejected(await patch('Amanager', t._id, { revision: 1, status: 'approved' }), 403, null, 'manager cannot approve at pending_admin')
  r = await patch('Amanager', t._id, { revision: 1, status: 'pending_manager' }); assert.equal(r.status, 200, 'a manager may send it back'); assert.equal(r.json.revision, 2)
  r = await patch('Amanager', t._id, { revision: 2, status: 'approved', managerNote: 'fine' }); assert.equal(r.status, 200); assert.equal(r.json.approvedBy, A.manager.id); assert.ok(r.json.approvedAt); assert.equal(r.json.revision, 3)
  const ev = (await audits(t._id)).map(a => a.action); assert.deepEqual(ev.filter(a => a !== 'travel.submitted'), ['travel.pending_admin', 'travel.pending_manager', 'travel.approved'])
  const ap = (await audits(t._id, 'travel.approved'))[0]; assert.deepEqual([ap.orgId, ap.performedBy, ap.targetType], [A.orgId, A.manager.id, 'travel_request']); assert.deepEqual(Object.keys(ap.metadata).sort(), ['amount', 'destination', 'employeeName', 'note'])
  // self-approval: a manager cannot action their own trip; the boss can (recorded as such)
  const own = await mk('Amanager'); await rejected(await patch('Amanager', own._id, { revision: 0, status: 'approved' }), 403, null, 'manager self-approval')
  const ownA = await mk('Aadmin'); const sa = await patch('Aadmin', ownA._id, { revision: 0, status: 'approved' }); assert.equal(sa.status, 200); assert.equal((await audits(ownA._id, 'travel.approved.self_approved')).length, 1)
  const rj = await mk('Aemployee'); assert.equal((await patch('Aadmin', rj._id, { revision: 0, status: 'rejected', adminNote: 'no' })).json.rejectedBy, A.admin.id)
})

test('T2. cancelling is atomic and bumps the revision; it cannot both win with a review', async () => {
  const t = await mk('Aemployee'); const c = await kit.api(`/api/travel/${t._id}`, { method: 'DELETE', ...who('Aemployee') }); assert.equal(c.status, 200)
  assert.equal((await rawTrip(t._id)).status, 'cancelled'); assert.equal((await rawTrip(t._id)).revision, 1); assert.equal((await audits(t._id, 'travel.cancelled')).length, 1)
  await rejected(await patch('Amanager', t._id, { revision: 1, status: 'approved' }), 409, 'invalid_transition', 'review after cancel')
  for (let round = 0; round < 4; round++) {
    const x = await mk('Aemployee'); const rs = await Promise.all([patch('Amanager', x._id, { revision: 0, status: 'approved' }), kit.api(`/api/travel/${x._id}`, { method: 'DELETE', ...who('Aemployee') })])
    const raw = await rawTrip(x._id); assert.equal(raw.revision, 1, 'exactly one change applied'); assert.ok(['approved', 'cancelled'].includes(raw.status)); assert.equal(rs.filter(r => r.status === 200).length, 1, rs.map(r => r.status).join(','))
    assert.equal((await audits(x._id, 'travel.approved')).length + (await audits(x._id, 'travel.cancelled')).length, 1)
  }
})

/* ═════════ 4. optimistic concurrency ═════════ */
test('C1. CONCURRENCY (real database): N parallel decisions on one revision → exactly one succeeds, the rest 409; one revision bump, one audit event, none of the losers’ notes applied', async () => {
  for (let round = 0; round < 5; round++) {
    const t = await mk('Aemployee'); const N = 14
    const reqs = Array.from({ length: N }, (_, i) => i % 3 === 0 ? patch('Amanager', t._id, { revision: 0, status: 'approved', managerNote: `m${i}` }, i % 2 ? 'token' : 'cookie') : i % 3 === 1 ? patch('Aadmin', t._id, { revision: 0, status: 'rejected', adminNote: `a${i}` }) : patch('Amanager', t._id, { revision: 0, status: 'pending_admin', managerNote: `f${i}` }))
    const rs = await Promise.all(reqs); const ok = rs.filter(r => r.status === 200), lost = rs.filter(r => r.status === 409)
    assert.equal(ok.length, 1, `round ${round}: ${rs.map(r => r.status)}`); assert.equal(lost.length, N - 1); lost.forEach(r => assert.equal(r.json.code, 'revision_conflict'))
    const raw = await rawTrip(t._id); assert.equal(raw.revision, 1); assert.equal(raw.status, ok[0].json.status)
    const ev = (await audits(t._id)).filter(a => a.action !== 'travel.submitted'); assert.equal(ev.length, 1, ev.map(e => e.action).join()); assert.equal(ev[0].action, 'travel.' + ok[0].json.status)
    const notes = [raw.managerNote, raw.adminNote].filter(Boolean); assert.ok(notes.length <= 1, 'only the winner’s note exists: ' + notes)
    assert.deepEqual(notes.length ? notes[0] : null, ok[0].json.managerNote || ok[0].json.adminNote || null)
  }
})

test('C2. a stale update after success changes NOTHING: fields, notes, approval metadata, claims and audit history are identical afterwards', async () => {
  const d = await doc('Aemployee'); const t = await mk('Aemployee', [d]); const ok = await patch('Amanager', t._id, { revision: 0, status: 'pending_admin', managerNote: 'one' }); assert.equal(ok.status, 200)
  const before = await snapshot(t._id)
  for (const body of [{ revision: 0, status: 'rejected', managerNote: 'two' }, { revision: 0, itineraryDocs: [] }, { revision: 0, status: 'pending_admin', managerNote: 'retry of the same call' }]) {
    const who2 = body.itineraryDocs ? 'Aemployee' : 'Amanager'; await rejected(await patch(who2, t._id, body), 409, 'revision_conflict', JSON.stringify(body))
  }
  assert.equal(await snapshot(t._id), before); assert.equal((await audits(t._id, 'travel.pending_admin')).length, 1, 'a retried call produces no duplicate success event')
  assert.equal((await row(d.pid)).claimedBy, t._id)
})

/* ═════════ 5. document lifecycle ═════════ */
test('D1. add: the owner adds documents to a pending trip — claimed exclusively, revision +1, one attachments_added event, references never shown', async () => {
  const t = await mk('Aemployee'); const d = await doc('Aemployee'); const r = await patch('Aemployee', t._id, { revision: 0, itineraryDocs: [d.url] })
  assert.equal(r.status, 200, r.text); assert.equal(r.json.revision, 1); assert.deepEqual(r.json.itineraryDocs, [path(t._id, 0)]); assert.doesNotMatch(r.text, NO_INTERNALS)
  assert.deepEqual((await rawTrip(t._id)).itineraryDocs, [d.ref]); const m = await row(d.pid); assert.deepEqual([m.state, m.claimedBy, m.purpose, m.userId], ['attached', t._id, 'travel_itinerary', A.employee.id])
  const a = await audits(t._id, 'travel.attachments_added'); assert.equal(a.length, 1); assert.deepEqual(a[0].metadata, { count: 1 }); assert.doesNotMatch(JSON.stringify(a[0]), NO_INTERNALS)
  assert.equal((await audits(t._id, 'travel.attachments_removed')).length, 0)
})

test('D2. keep + add preserves order and keeps the existing claim; only the NEW file is claimed and audited', async () => {
  const d0 = await doc('Aemployee'); const t = await mk('Aemployee', [d0]); const d1 = await doc('Aemployee')
  const r = await patch('Aemployee', t._id, { revision: 0, itineraryDocs: [path(t._id, 0), d1.url] }); assert.equal(r.status, 200, r.text)
  assert.deepEqual((await rawTrip(t._id)).itineraryDocs, [d0.ref, d1.ref]); await assertClaimsMatchRefs(t._id, 'keep+add')
  const flip = await patch('Aemployee', t._id, { revision: 1, itineraryDocs: [path(t._id, 1), path(t._id, 0)] }); assert.equal(flip.status, 200); assert.deepEqual((await rawTrip(t._id)).itineraryDocs, [d1.ref, d0.ref], 'reordering keeps both')
  const adds = await audits(t._id, 'travel.attachments_added'); assert.deepEqual(adds.map(a => a.metadata.count), [1, 1].slice(0, adds.length)); await assertClaimsMatchRefs(t._id, 'after reorder')
})

test('D3. replace: the new file is claimed first, the old claim is released only after the write; the old file is NOT deleted by this request (cleanup lifecycle), events record counts only', async () => {
  const old = await doc('Aemployee'); const t = await mk('Aemployee', [old]); const nw = await doc('Aemployee')
  const r = await patch('Aemployee', t._id, { revision: 0, itineraryDocs: [nw.url] }); assert.equal(r.status, 200, r.text)
  assert.deepEqual((await rawTrip(t._id)).itineraryDocs, [nw.ref]); assert.equal((await row(nw.pid)).claimedBy, t._id); const o = await row(old.pid); assert.ok(!o.claimedBy, 'old claim released'); assert.equal(o.state, 'attached')
  assert.equal(await stored(old.pid), true, 'no deletion happens here: the released file follows the abandoned-upload lifecycle'); await assertClaimsMatchRefs(t._id, 'replace')
  assert.deepEqual([(await audits(t._id, 'travel.attachments_added'))[0].metadata, (await audits(t._id, 'travel.attachments_removed'))[0].metadata], [{ count: 1 }, { count: 1 }])
  assert.equal((await rawTrip(t._id)).revision, 1)
})

test('D4. remove: only the requested document leaves the trip; the claim is released after the write; a released file can be used again by its owner', async () => {
  const a = await doc('Aemployee'), b = await doc('Aemployee'); const t = await mk('Aemployee', [a, b])
  const r = await patch('Aemployee', t._id, { revision: 0, itineraryDocs: [path(t._id, 1)] }); assert.equal(r.status, 200, r.text); assert.deepEqual((await rawTrip(t._id)).itineraryDocs, [b.ref])
  assert.ok(!(await row(a.pid)).claimedBy); assert.equal((await row(b.pid)).claimedBy, t._id); await assertClaimsMatchRefs(t._id, 'remove'); assert.equal((await audits(t._id, 'travel.attachments_removed'))[0].metadata.count, 1)
  const other = await mk('Aemployee'); const re = await patch('Aemployee', other._id, { revision: 0, itineraryDocs: [a.url] }); assert.equal(re.status, 200, 'the released file is usable again'); assert.equal((await row(a.pid)).claimedBy, other._id)
  const all = await patch('Aemployee', t._id, { revision: 1, itineraryDocs: [] }); assert.equal(all.status, 200); assert.deepEqual(all.json.itineraryDocs, []); await assertClaimsMatchRefs(t._id, 'remove all')
})

test('D5. legacy values are preserved unless explicitly omitted; they can be kept exactly as shown and never become trusted', async () => {
  const good = await doc('Aemployee'); const t = await mk('Aemployee', [good]); const legacy = ['https://legacy.example.test/a.pdf', 'plain legacy note', 'cld:doppeldash/odd/shape']
  await db.collection('travelrequests').updateOne({ _id: oid(t._id) }, { $set: { itineraryDocs: [legacy[0], good.ref, legacy[1], legacy[2]] } })
  const shown = (await get('Aemployee', t._id)).json; assert.equal(shown.itineraryDocs[0], legacy[0]); assert.equal(shown.itineraryDocs[1], path(t._id, 1)); assert.equal(shown.itineraryDocs[3], path(t._id, 3, '').replace(/\.$/, ''), 'a malformed cld: string is never echoed')
  const keep = await patch('Aemployee', t._id, { revision: 0, itineraryDocs: [shown.itineraryDocs[0], shown.itineraryDocs[1], shown.itineraryDocs[3]] }); assert.equal(keep.status, 200, keep.text)
  assert.deepEqual((await rawTrip(t._id)).itineraryDocs, [legacy[0], good.ref, legacy[2]], 'kept values unchanged, the omitted legacy note is gone, nothing else rewritten')
  await rejected(await patch('Aemployee', t._id, { revision: 1, itineraryDocs: ['https://legacy.example.test/not-stored.pdf'] }), 400, 'invalid_travel_request', 'unknown legacy value'); await assertClaimsMatchRefs(t._id, 'legacy')
})

test('D6. every invalid reference is refused with its index; the trip, its revision, the claims and the audit history stay exactly as they were', async () => {
  const keep = await doc('Aemployee'); const t = await mk('Aemployee', [keep]); const other = await mk('Aemployee'); const before = await snapshot(t._id)
  const mine = await doc('Aemployee'), foreign = await doc('Bemployee'), recpt = await doc('Aemployee', { purpose: null }), mgr = await doc('Amanager')
  const rej = await doc('Aemployee'); await db.collection('receiptuploads').updateOne({ publicId: rej.pid }, { $set: { state: 'rejected' } })
  // ONE file is deleted at the provider; every other fixture must stay alive so each rejection below is caused by the rule it names, not by a missing asset
  const gone = await doc('Aemployee'); Object.assign(process.env, fake.ENV); assert.equal(await kit.load('lib/uploads/attachmentStorage.ts').destroyReceiptAsset(gone.pid, A.orgId), 'deleted'); const alive = await doc('Aemployee')
  for (const f of [mine, foreign, recpt, mgr, rej, keep]) assert.equal(await stored(f.pid), true, 'fixture must exist at the provider')
  const taken = await doc('Aemployee'); await patch('Aemployee', other._id, { revision: 0, itineraryDocs: [taken.url] })
  const cases = [
    ['raw cld ref', [keep.ref], 'itineraryDocs[0]', 400], ['raw url', ['https://evil.example.test/x.pdf'], 'itineraryDocs[0]', 400], ['api path of ANOTHER trip', [path(other._id, 0)], 'itineraryDocs[0]', 400],
    ['index out of range', [path(t._id, 7)], 'itineraryDocs[0]', 400], ['same kept path twice', [path(t._id, 0), path(t._id, 0)], 'itineraryDocs', 400],
    ['wrong organisation', [foreign.url], 'itineraryDocs[0]', 400], ['wrong purpose', [recpt.url], 'itineraryDocs[0]', 400], ['another user of the same org', [mgr.url], 'itineraryDocs[0]', 400],
    ['rejected state', [rej.url], 'itineraryDocs[0]', 400], ['deleted at the provider', [gone.url], 'itineraryDocs[0]', 400], ['claimed by another trip', [taken.url], 'itineraryDocs[0]', 409],
    ['already on this trip, given as a URL', [keep.url], 'itineraryDocs[0]', 400], ['valid + invalid (index mapping)', [path(t._id, 0), alive.url, 'garbage'], 'itineraryDocs[2]', 400],
  ]
  for (const [label, docs, field, status] of cases) {
    const r = await patch('Aemployee', t._id, { revision: 0, itineraryDocs: docs }); await rejected(r, status, null, label); assert.ok((r.json.fields || []).includes(field), `${label}: ${JSON.stringify(r.json)}`)
  }
  assert.equal(await snapshot(t._id), before, 'nothing changed'); assert.ok(!(await row(alive.pid)).claimedBy, 'the valid file beside an invalid one was not consumed'); assert.ok(!(await row(mine.pid)).claimedBy)
  await rejected(await patch('Aemployee', t._id, { revision: 0, itineraryDocs: Array.from({ length: 11 }, (_, i) => 'x' + i) }), 400, 'invalid_travel_request', '>10'); await rejected(await patch('Aemployee', t._id, { revision: 0, itineraryDocs: [alive.url, alive.url] }), 400, 'invalid_travel_request', 'duplicate')
})

test('D7. provider-verified: oversize (Free plan), type mismatch and outage refuse the change, mark/clean the bad file, and change nothing', async () => {
  const ft = await mk('Femployee'); const t0 = await sign('Femployee'); const pid = `${t0.json.fields.folder}/${t0.json.fields.public_id}`
  await fetch(`${fake.BASE}/__inject`, { method: 'POST', body: JSON.stringify({ path: pid, ext: 'png', bytes: 6 * 1024 * 1024, type: 'authenticated' }) })
  const big = await patch('Femployee', ft._id, { revision: 0, itineraryDocs: [`${fake.ENV.CLOUDINARY_DELIVERY_BASE}/testcloud/image/authenticated/v1/${pid}.png`] }); await rejected(big, 413, 'attachment_too_large', 'oversize'); assert.equal((await row(pid)).state, 'rejected')
  const t = await mk('Aemployee'); const mm = await sign('Aemployee', { mimeType: 'application/pdf' }); const pid2 = `${mm.json.fields.folder}/${mm.json.fields.public_id}`
  await fetch(`${fake.BASE}/__inject`, { method: 'POST', body: JSON.stringify({ path: pid2, ext: 'png', bytes: 400, type: 'authenticated' }) })
  await rejected(await patch('Aemployee', t._id, { revision: 0, itineraryDocs: [`${fake.ENV.CLOUDINARY_DELIVERY_BASE}/testcloud/image/authenticated/v1/${pid2}.png`] }), 400, 'attachment_type_mismatch', 'type mismatch')
  const d = await doc('Aemployee'); await fake.control.mode({ storage: { admin: 'error500' } }); await rejected(await patch('Aemployee', t._id, { revision: 0, itineraryDocs: [d.url] }), 503, 'attachment_verification_unavailable', 'outage')
  assert.ok(!(await row(d.pid)).claimedBy); assert.deepEqual((await rawTrip(t._id)).itineraryDocs, []); assert.equal((await rawTrip(t._id)).revision, 0)
  await fake.control.mode({ storage: { admin: 'ok' } }); assert.equal((await patch('Aemployee', t._id, { revision: 0, itineraryDocs: [d.url] })).status, 200)
})

test('D8. who and when: only the owner, only while pending_manager; managers/admins/other users cannot touch documents; other organisations get 404', async () => {
  const d = await doc('Aemployee'); const t = await mk('Aemployee'); const body = { revision: 0, itineraryDocs: [d.url] }; const before = await snapshot(t._id)
  for (const k of ['Amanager', 'Aadmin']) await rejected(await patch(k, t._id, body), 403, null, k + ' on someone else’s trip')
  // Document PATCHes from employees DO reach the tenant lookup (only status changes are refused by role first), so another organisation is a plain 404 for every role
  for (const k of ['Bemployee', 'Bmanager', 'Badmin']) assert.equal((await patch(k, t._id, body)).status, 404, k)
  const ownMgr = await mk('Amanager'); const md = await doc('Amanager'); assert.equal((await patch('Amanager', ownMgr._id, { revision: 0, itineraryDocs: [md.url] })).status, 200, 'a manager may edit documents of their OWN pending trip')
  assert.equal(await snapshot(t._id), before)
  await patch('Amanager', t._id, { revision: 0, status: 'pending_admin' }); await rejected(await patch('Aemployee', t._id, { revision: 1, itineraryDocs: [d.url] }), 409, 'not_editable', 'after review started'); assert.ok(!(await row(d.pid)).claimedBy)
  const c = await mk('Aemployee'); await kit.api(`/api/travel/${c._id}`, { method: 'DELETE', ...who('Aemployee') }); await rejected(await patch('Aemployee', c._id, { revision: 1, itineraryDocs: [] }), 409, 'not_editable', 'cancelled')
})

test('D9. a retried successful document change is stale (409) and adds no duplicate audit event or claim', async () => {
  const t = await mk('Aemployee'); const d = await doc('Aemployee'); const body = { revision: 0, itineraryDocs: [d.url] }
  assert.equal((await patch('Aemployee', t._id, body)).status, 200); const after = await snapshot(t._id)
  await rejected(await patch('Aemployee', t._id, body, 'cookie'), 409, 'revision_conflict', 'retry'); assert.equal(await snapshot(t._id), after); assert.equal((await audits(t._id, 'travel.attachments_added')).length, 1)
})

test('D10. CONCURRENCY: parallel add / replace / remove on one revision → exactly one wins; the loser’s newly claimed file is released; claimed files always equal referenced files', async () => {
  for (let round = 0; round < 5; round++) {
    const a = await doc('Aemployee'); const t = await mk('Aemployee', [a]); const x = await doc('Aemployee'), y = await doc('Aemployee'), z = await doc('Aemployee')
    const reqs = [patch('Aemployee', t._id, { revision: 0, itineraryDocs: [path(t._id, 0), x.url] }), patch('Aemployee', t._id, { revision: 0, itineraryDocs: [] }), patch('Aemployee', t._id, { revision: 0, itineraryDocs: [y.url] }), patch('Aemployee', t._id, { revision: 0, itineraryDocs: [path(t._id, 0), z.url] }, 'cookie'), patch('Aemployee', t._id, { revision: 0, itineraryDocs: [x.url, y.url] })]
    const rs = await Promise.all(reqs); const ok = rs.filter(r => r.status === 200); assert.equal(ok.length, 1, `round ${round}: ${rs.map(r => r.status)}`); rs.filter(r => r !== ok[0]).forEach(r => assert.equal(r.status, 409, r.text))
    assert.equal((await rawTrip(t._id)).revision, 1); await assertClaimsMatchRefs(t._id, `round ${round}`)
    const finalRefs = (await rawTrip(t._id)).itineraryDocs; for (const d of [a, x, y, z]) { const used = finalRefs.includes(d.ref); assert.equal(!!(await row(d.pid)).claimedBy, used, `${d.pid.slice(-6)} claimed iff referenced`) }
    const adds = (await audits(t._id, 'travel.attachments_added')).length - 0, rems = (await audits(t._id, 'travel.attachments_removed')).length; assert.ok(adds <= 1 + 0 && rems <= 1, 'at most the winner’s events (plus the creation one)')
  }
})

test('D11. a randomised sequence of parallel batches keeps the invariant after every batch (claims == references, revision +1 per success, no orphaned valid file)', async () => {
  const pool = []; for (let i = 0; i < 6; i++) pool.push(await doc('Aemployee')); const t = await mk('Aemployee', [pool[0]]); let rev = 0
  const rnd = n => Math.floor(Math.random() * n)
  for (let step = 0; step < 14; step++) {
    const cur = (await rawTrip(t._id)).itineraryDocs; const curPaths = cur.map((_, i) => path(t._id, i)); const free = pool.filter(p => !cur.includes(p.ref))
    const op = () => { const kind = rnd(3); if (kind === 0 && free.length && cur.length < 4) return [...curPaths, free[rnd(free.length)].url]; if (kind === 1 && cur.length) return curPaths.filter((_, i) => i !== rnd(cur.length)); if (free.length) return [free[rnd(free.length)].url]; return [] }
    const rs = await Promise.all(Array.from({ length: 4 }, () => patch('Aemployee', t._id, { revision: rev, itineraryDocs: op() })))
    const ok = rs.filter(r => r.status === 200); assert.ok(ok.length <= 1, rs.map(r => r.status).join()); rs.filter(r => r.status !== 200).forEach(r => assert.ok([409, 400].includes(r.status), r.status + r.text))
    rev += ok.length; assert.equal((await rawTrip(t._id)).revision, rev, 'revision +1 per success'); await assertClaimsMatchRefs(t._id, `step ${step}`)
    const refs = (await rawTrip(t._id)).itineraryDocs; for (const p of pool) assert.equal(!!(await row(p.pid)).claimedBy, refs.includes(p.ref), `step ${step}: ${p.pid.slice(-6)}`)
  }
})

/* ═════════ 6. audit observability and hygiene ═════════ */
test('U1. a lost audit entry does not undo a committed change, but it is OBSERVABLE (logged with the action and error class only)', async () => {
  const t = await mk('Aemployee'); await db.command({ collMod: 'auditlogs', validator: { action: { $ne: 'travel.pending_admin' } }, validationAction: 'error', validationLevel: 'strict' })
  let r; try { r = await patch('Amanager', t._id, { revision: 0, status: 'pending_admin' }) } finally { await db.command({ collMod: 'auditlogs', validator: {}, validationAction: 'error', validationLevel: 'off' }) }
  assert.equal(r.status, 200, 'the change is committed'); assert.equal((await rawTrip(t._id)).status, 'pending_admin'); assert.equal((await audits(t._id, 'travel.pending_admin')).length, 0)
  if (process.env.DD_SERVER_LOG) { await sleep(300); const log = fs.readFileSync(process.env.DD_SERVER_LOG, 'utf8'); assert.match(log, /\[audit\] write failed travel\.pending_admin \w+/); assert.doesNotMatch(log.slice(log.lastIndexOf('[audit] write failed')), /Document failed validation.*cld:/) }
})

test('H1. no PATCH/GET response in these flows exposes provider URLs, private references, storage ids, secrets or stack traces', async () => {
  const d = await doc('Aemployee'), e = await doc('Aemployee'); const t = await mk('Aemployee', [d]); const texts = []
  for (const body of [{ revision: 0, itineraryDocs: [e.url] }, { revision: 0, itineraryDocs: ['garbage'] }, { revision: 0, itineraryDocs: [d.ref] }, { revision: 5, itineraryDocs: [] }, { itineraryDocs: [] }]) texts.push((await patch('Aemployee', t._id, body)).text)
  texts.push((await patch('Amanager', t._id, { revision: 9, status: 'approved' })).text, (await get('Amanager', t._id)).text, (await kit.api('/api/travel', who('Aemployee'))).text)
  for (const x of texts) { const m = /cld:|doppeldash\/|testcloud|127\.0\.0\.1:3912|signature|api_key|secret|stack|E11000|Mongo/i.exec(x); assert.equal(m && x.slice(Math.max(0, m.index - 20), m.index + 30), null, 'response contains ' + (m && m[0])) }
})
