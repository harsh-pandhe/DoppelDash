/**
 * Travel Slice 4 — concurrency-safe, idempotent, audited trip → expense conversion.
 * Real HTTP routes against the dev server's throwaway DB (dd_gate_*_test, a STANDALONE mongod: no transactions) and the LOCAL FAKE provider.
 * Crash tests use the route's own failpoints (server started with TRAVEL_FAILPOINTS=1; header x-test-failpoint) — the recovery under test is the
 * real route logic, never a database edit that "repairs" state. Time passing (lease expiry) is simulated by moving `conversion.leaseUntil`.
 * Requires the dev-server env of receipt_ocr_vertical.test.js plus TRAVEL_FAILPOINTS=1 and TRAVEL_CONVERSION_WAIT_MS=3000.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const mongoose = require('mongoose')
const kit = require('./helpers/authTestKit')
const fake = require('./helpers/fakeProviders')

let db, smtp, providers, A, B, tok
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 1)])
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(300, 2)])
const MIME = { png: 'image/png', pdf: 'application/pdf' }; const BYTES = { png: PNG, pdf: PDF }
const oid = s => new mongoose.Types.ObjectId(s)

test.before(async () => {
  assert.equal(process.env.TRAVEL_FAILPOINTS, '1', 'the dev server and this test need TRAVEL_FAILPOINTS=1')
  providers = await fake.ensureFakeProviders(); db = await kit.connect(); smtp = await kit.startFakeSmtp(2525)
  A = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  B = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  tok = {}; for (const [k, org] of [['A', A], ['B', B]]) for (const r of ['admin', 'manager', 'employee']) { const s = await kit.login(org[r].email); tok[`${k}${r}`] = { token: s.accessToken, cookie: s.cookie } }
})
test.after(async () => {
  const orgs = [A.orgId, B.orgId]
  for (const c of ['travelrequests', 'receiptuploads', 'auditlogs', 'expenses']) await db.collection(c).deleteMany({ orgId: { $in: orgs } })
  await kit.cleanupAll(db); await smtp.stop(); await providers.stop(); await kit.disconnect()
})
test.beforeEach(async () => { await fake.control.reset(); await db.collection('ratelimits').deleteMany({ key: /^(upload-sign|travel-doc|rms-receipt):/ }) })

const who = (k, via = 'token') => ({ [via]: tok[k][via] })
const D = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)
const NO_INTERNALS = /cld:|doppeldash\/|testcloud|127\.0\.0\.1|signature|api_key|authenticated\/|stack|mongoose|E11000|MongoServer|failpoint|"token"|leaseUntil/i
const post = (k, body) => kit.api('/api/travel', { method: 'POST', ...who(k), body })
const sign = (k, o = {}) => kit.api('/api/uploads/sign', { method: 'POST', ...who(k), body: { kind: 'receipt', mimeType: MIME.png, sizeBytes: 100, purpose: 'travel_itinerary', ...o } })
async function doc(k, { ext = 'png', purpose = 'travel_itinerary' } = {}) {
  const t = await sign(k, { mimeType: MIME[ext], sizeBytes: BYTES[ext].length, purpose: purpose === null ? undefined : purpose }); assert.equal(t.status, 200, t.text)
  const fd = new FormData(); for (const [f, v] of Object.entries(t.json.fields)) fd.append(f, v); fd.append('file', new Blob([BYTES[ext]]), 'f.bin')
  const up = await (await fetch(t.json.uploadUrl, { method: 'POST', body: fd })).json(); return { url: up.secure_url, pid: up.public_id, ref: `cld:${up.public_id}.${ext}`, ext }
}
/** An APPROVED, finished trip (optionally with documents / extra fields). */
async function approved(docs = [], extra = {}, k = 'Aemployee') {
  const t = await post(k, { purpose: 'Conv ' + crypto.randomBytes(3).toString('hex'), destination: 'Pune', departureDate: D(-10), returnDate: D(-8), itineraryDocs: docs.map(d => d.url), legs: [{ from: 'a', to: 'b', date: D(-9), mode: 'train', estimatedCost: 50 }], ...extra })
  assert.equal(t.status, 201, t.text)
  const a = await kit.api(`/api/travel/${t.json._id}`, { method: 'PATCH', ...who('Amanager'), body: { status: 'approved', revision: t.json.revision } }); assert.equal(a.status, 200, a.text); return a.json
}
const conv = (id, k = 'Aemployee', failpoint, extra = {}) => kit.api(`/api/travel/${id}/expense`, { method: 'POST', ...who(k), ...(failpoint ? { headers: { 'x-test-failpoint': failpoint } } : {}), ...extra })
const rawTrip = id => db.collection('travelrequests').findOne({ _id: oid(id) })
const expensesOf = id => db.collection('expenses').find({ $or: [{ travelRequestId: String(id) }, { travelConversionOf: String(id) }] }).toArray()
const audits = (id, action) => db.collection('auditlogs').find({ targetId: String(id), ...(action ? { action } : {}) }).toArray()
const row = pid => db.collection('receiptuploads').findOne({ publicId: pid })
const expireLease = id => db.collection('travelrequests').updateOne({ _id: oid(id) }, { $set: { 'conversion.leaseUntil': new Date(Date.now() - 1000) } })
const expenseId = (orgId, tripId) => kit.load('lib/travel/conversion.ts').expenseIdFor(orgId, String(tripId)).toString()
/** The invariants that must hold after ANY sequence of conversion calls on one trip. */
async function assertConverted(tripId, { revisionBefore, docs = 0, label = '' } = {}) {
  const t = await rawTrip(tripId), ex = await expensesOf(tripId)
  assert.equal(ex.length, 1, `${label}: exactly one expense`); assert.equal(String(ex[0]._id), expenseId(A.orgId, tripId)); assert.equal(t.expenseId, String(ex[0]._id), `${label}: link`)
  assert.equal(t.conversion.state, 'complete', `${label}: complete`); assert.equal(t.revision, revisionBefore + 1, `${label}: revision advanced exactly once`)
  assert.equal((await audits(tripId, 'travel.expense_created')).length, 1, `${label}: one travel.expense_created`)
  assert.equal((await audits(tripId, 'travel.attachments_converted')).length, docs ? 1 : 0, `${label}: attachments audit`)
  assert.equal(new Set(ex[0].receipts).size, ex[0].receipts.length, `${label}: no duplicate receipts`)
  return { t, ex: ex[0] }
}

/* ═════════ 1. success, idempotency, shape ═════════ */
test('X1. successful conversion: 201, deterministic expense, link + revision + conversion state, exactly-once audit, claims stay with the trip, nothing internal is returned', async () => {
  const ds = [await doc('Aemployee'), await doc('Aemployee', { ext: 'pdf' })]; const t = await approved(ds)
  const r = await conv(t._id); assert.equal(r.status, 201, r.text); assert.doesNotMatch(r.text, NO_INTERNALS)
  assert.equal(r.json._id, expenseId(A.orgId, t._id)); assert.equal(r.json.travelRequestId, t._id); assert.equal(r.json.status, 'pending_manager'); assert.equal(r.json.amount, 50); assert.equal(r.json.receipts.length, 2)
  const { t: db1, ex } = await assertConverted(t._id, { revisionBefore: t.revision, docs: 2, label: 'X1' })
  assert.deepEqual(ex.receipts, ds.map(d => d.ref)); assert.deepEqual(db1.itineraryDocs, ds.map(d => d.ref)); assert.equal(ex.travelConversionOf, t._id)
  for (const d of ds) { const m = await row(d.pid); assert.equal(m.claimedBy, t._id, 'the trip keeps its claim'); assert.equal(m.transferredTo, r.json._id, 'the manifest records the second reference'); assert.equal(m.purpose, 'travel_itinerary'); assert.equal(m.state, 'attached') }
  const au = (await audits(t._id, 'travel.expense_created'))[0]; assert.equal(au.performedBy, A.employee.id); assert.equal(au.orgId, A.orgId); assert.equal(au.targetType, 'travel_request'); assert.deepEqual(au.metadata, { expenseId: r.json._id, transferred: 2, excluded: 0 }); assert.doesNotMatch(JSON.stringify(au), /cld:|doppeldash\/|https?:/)
  // the trip API shows the new revision and never the protocol state
  for (const k of ['Aemployee', 'Amanager']) { const g = await kit.api(`/api/travel/${t._id}`, who(k)); assert.equal(g.json.revision, t.revision + 1); assert.ok(!('conversion' in g.json)); assert.equal(g.json.expenseId, r.json._id); assert.doesNotMatch(g.text, NO_INTERNALS) }
  const list = (await kit.api('/api/travel', who('Aemployee'))).json.find(x => x._id === t._id); assert.ok(!('conversion' in list))
  // the admin audit feed does not expose the internal dedupe key
  const feed = await kit.api('/api/admin/audit?limit=50', who('Aadmin')); assert.ok(!/dedupeKey/.test(feed.text))
})

test('X2. repeated conversion (sequential, and with a client-supplied expense id) returns the SAME expense with 200; revision and audits do not move', async () => {
  const t = await approved([await doc('Aemployee')]); const first = await conv(t._id); assert.equal(first.status, 201)
  for (let i = 0; i < 4; i++) { const again = await conv(t._id); assert.equal(again.status, 200, again.text); assert.equal(again.json._id, first.json._id); assert.deepEqual(again.json.receipts, first.json.receipts) }
  const other = await approved(); const forged = await conv(t._id, 'Aemployee', undefined, { body: { expenseId: expenseId(A.orgId, other._id), _id: other._id } }); assert.equal(forged.json._id, first.json._id, 'a caller-supplied expense id is never authoritative')
  await assertConverted(t._id, { revisionBefore: t.revision, docs: 1, label: 'X2' }); assert.equal((await expensesOf(other._id)).length, 0)
})

test('X3. CONCURRENCY: 14 parallel conversions → one 201, the rest 200, all the SAME expense; one expense, one audit, revision +1 (3 rounds, with and without documents)', async () => {
  for (let round = 0; round < 3; round++) {
    const ds = round === 0 ? [] : [await doc('Aemployee'), await doc('Aemployee')]; const t = await approved(ds)
    const rs = await Promise.all(Array.from({ length: 14 }, () => conv(t._id))); const codes = rs.map(r => r.status).sort().join(',')
    assert.equal(rs.filter(r => r.status === 201).length, 1, `round ${round}: ${codes}`); assert.equal(rs.filter(r => r.status === 200).length, 13, codes)
    assert.equal(new Set(rs.map(r => r.json._id)).size, 1); rs.forEach(r => assert.doesNotMatch(r.text, NO_INTERNALS))
    await assertConverted(t._id, { revisionBefore: t.revision, docs: ds.length, label: `X3 round ${round}` })
  }
})

test('X4. the DATABASE enforces uniqueness: direct parallel inserts / audit writes bypassing the route still yield exactly one row', async () => {
  const t = await approved(); const Expense = kit.load('models/Expense.ts').default; const AuditLog = kit.load('models/AuditLog.ts').default
  await Expense.init(); await AuditLog.init()
  const idx = await db.collection('expenses').indexes(); assert.ok(idx.some(i => i.unique && i.key.orgId === 1 && i.key.travelConversionOf === 1), 'unique (orgId, travelConversionOf) index exists')
  const idxA = await db.collection('auditlogs').indexes(); assert.ok(idxA.some(i => i.unique && i.key.orgId === 1 && i.key.dedupeKey === 1), 'unique (orgId, dedupeKey) index exists')
  const mkExpense = (extra = {}) => ({ userId: t.userId, userName: 'x', orgId: A.orgId, title: 't', reason: 'r', amount: 1, startDate: new Date(), travelRequestId: t._id, travelConversionOf: t._id, ...extra })
  const res = await Promise.allSettled(Array.from({ length: 12 }, () => Expense.create(mkExpense())))   // random _ids: only the unique index can stop them
  assert.equal(res.filter(r => r.status === 'fulfilled').length, 1, 'only one insert survives'); assert.ok(res.filter(r => r.status === 'rejected').every(r => r.reason.code === 11000))
  assert.equal((await expensesOf(t._id)).length, 1)
  // manual expenses linked to a trip WITHOUT the conversion key stay unrestricted (existing behaviour)
  await Expense.create(mkExpense({ travelConversionOf: undefined })); await Expense.create(mkExpense({ travelConversionOf: undefined }))
  const entry = () => AuditLog.create({ orgId: A.orgId, action: 'travel.expense_created', performedBy: 'u', performedByName: 'n', targetId: t._id, targetType: 'travel_request', dedupeKey: `travel.expense_created|${t._id}` })
  const au = await Promise.allSettled(Array.from({ length: 12 }, entry)); assert.equal(au.filter(r => r.status === 'fulfilled').length, 1); assert.equal((await audits(t._id, 'travel.expense_created')).length, 1)
  await db.collection('expenses').deleteMany({ travelRequestId: t._id })
})

/* ═════════ 2. crash points and recovery ═════════ */
test('F1. crash AFTER RESERVATION, before the expense: nothing created; a live lease blocks others (409, non-sensitive); after expiry a retry takes over and completes', async () => {
  const t = await approved([await doc('Aemployee')]); const c = await conv(t._id, 'Aemployee', 'after_reserve'); assert.equal(c.status, 500); assert.equal(c.json.code, 'conversion_interrupted'); assert.doesNotMatch(c.text, /after_reserve|failpoint|stack/)
  let s = await rawTrip(t._id); assert.equal(s.conversion.state, 'reserved'); assert.ok(!s.expenseId); assert.equal((await expensesOf(t._id)).length, 0); assert.equal(s.revision, t.revision)
  const t0 = Date.now(); const busy = await conv(t._id); assert.equal(busy.status, 409, busy.text); assert.equal(busy.json.code, 'conversion_in_progress'); assert.equal(busy.headers.get('retry-after'), '2'); assert.ok(Date.now() - t0 >= 2500, 'waited for the bounded window'); assert.doesNotMatch(busy.text, NO_INTERNALS)
  assert.equal((await expensesOf(t._id)).length, 0)
  await expireLease(t._id); const r = await conv(t._id); assert.equal(r.status, 201, r.text)
  await assertConverted(t._id, { revisionBefore: t.revision, docs: 1, label: 'F1' })
})

test('F2. crash AFTER THE EXPENSE INSERT, before linking: the retry adopts the existing row (200), never inserts a second, links once, audits once', async () => {
  const t = await approved([await doc('Aemployee')]); const c = await conv(t._id, 'Aemployee', 'after_expense'); assert.equal(c.status, 500)
  let s = await rawTrip(t._id); assert.ok(!s.expenseId, 'not linked'); assert.equal(s.revision, t.revision); const ex0 = await expensesOf(t._id); assert.equal(ex0.length, 1); assert.equal((await audits(t._id)).filter(a => a.action.startsWith('travel.expense') || a.action === 'travel.attachments_converted').length, 0)
  await expireLease(t._id); const r = await conv(t._id); assert.equal(r.status, 200, r.text); assert.equal(r.json._id, String(ex0[0]._id))
  await assertConverted(t._id, { revisionBefore: t.revision, docs: 1, label: 'F2' })
})

test('F3. crash AFTER LINKING, before any audit: a plain retry (no lease wait) returns the same expense and writes the missing audits once', async () => {
  const t = await approved([await doc('Aemployee')]); const c = await conv(t._id, 'Aemployee', 'after_link'); assert.equal(c.status, 500)
  const s = await rawTrip(t._id); assert.ok(s.expenseId); assert.equal(s.conversion.state, 'linked'); assert.equal(s.revision, t.revision + 1); assert.equal((await audits(t._id, 'travel.expense_created')).length, 0)
  const r = await conv(t._id); assert.equal(r.status, 200, r.text); assert.equal(r.json._id, s.expenseId)
  await assertConverted(t._id, { revisionBefore: t.revision, docs: 1, label: 'F3' })
})

test('F4. crash between the attachment marking and the audits / after the first audit / after both audits: every state heals to exactly one of each', async () => {
  for (const fp of ['after_mark', 'after_audit_attachments', 'after_audit']) {
    const t = await approved([await doc('Aemployee')]); const c = await conv(t._id, 'Aemployee', fp); assert.equal(c.status, 500, fp)
    const mid = await rawTrip(t._id); assert.equal(mid.conversion.state, 'linked', fp)
    const nAtt = (await audits(t._id, 'travel.attachments_converted')).length, nExp = (await audits(t._id, 'travel.expense_created')).length
    assert.deepEqual([nAtt, nExp], fp === 'after_mark' ? [0, 0] : fp === 'after_audit_attachments' ? [1, 0] : [1, 1], fp)
    const r = await conv(t._id); assert.equal(r.status, 200, `${fp}: ${r.text}`); await assertConverted(t._id, { revisionBefore: t.revision, docs: 1, label: fp })
    assert.equal((await row((await rawTrip(t._id)).itineraryDocs[0].replace(/^cld:/, '').replace(/\.png$/, ''))).transferredTo, r.json._id)
  }
})

test('F5. HANDLED failures: an expense-insert error releases the reservation at once (retry succeeds immediately); an audit failure returns 503 conversion_incomplete and the retry finishes it', async () => {
  const t = await approved([await doc('Aemployee')]); const e = await conv(t._id, 'Aemployee', 'expense_insert_error'); assert.equal(e.status, 500); assert.equal(e.json.code, 'conversion_failed'); assert.doesNotMatch(e.text, NO_INTERNALS)
  const s = await rawTrip(t._id); assert.ok(!s.conversion, 'reservation released'); assert.ok(!s.expenseId); assert.equal((await expensesOf(t._id)).length, 0)
  const ok = await conv(t._id); assert.equal(ok.status, 201, ok.text); await assertConverted(t._id, { revisionBefore: t.revision, docs: 1, label: 'F5a' })

  const u = await approved([await doc('Aemployee')]); const a = await conv(u._id, 'Aemployee', 'audit_error'); assert.equal(a.status, 503); assert.equal(a.json.code, 'conversion_incomplete'); assert.doesNotMatch(a.text, NO_INTERNALS)
  const m = await rawTrip(u._id); assert.equal(m.conversion.state, 'linked'); assert.equal((await expensesOf(u._id)).length, 1); assert.equal((await audits(u._id, 'travel.expense_created')).length, 0)
  const again = await conv(u._id); assert.equal(again.status, 200); await assertConverted(u._id, { revisionBefore: u.revision, docs: 1, label: 'F5b' })
})

test('F6. CONCURRENT recovery: many retries racing to repair the same crashed state still give one expense, one audit each, one revision bump', async () => {
  for (const [fp, needsExpiry] of [['after_link', false], ['after_expense', true], ['after_audit_attachments', false]]) {
    const t = await approved([await doc('Aemployee')]); assert.equal((await conv(t._id, 'Aemployee', fp)).status, 500)
    if (needsExpiry) await expireLease(t._id)
    const rs = await Promise.all(Array.from({ length: 12 }, () => conv(t._id))); assert.ok(rs.every(r => r.status === 200 || r.status === 201), `${fp}: ${rs.map(r => r.status)}`)
    assert.equal(new Set(rs.map(r => r.json._id)).size, 1); await assertConverted(t._id, { revisionBefore: t.revision, docs: 1, label: `F6 ${fp}` })
  }
})

test('F7. a taken-over LEASE is safe: the first holder resuming late cannot create a second expense or a second link', async () => {
  const t = await approved([await doc('Aemployee')])
  // holder 1 stalls after reserving; its lease expires; holder 2 completes; then holder 1's late steps (insert + link + finish) are replayed through the real route
  assert.equal((await conv(t._id, 'Aemployee', 'after_reserve')).status, 500); await expireLease(t._id)
  assert.equal((await conv(t._id)).status, 201)
  // the stale reservation state is gone/complete: simulate the zombie by re-opening a reservation on the converted trip — it must not be possible
  const zombie = await db.collection('travelrequests').updateOne({ _id: oid(t._id), expenseId: { $in: [null, ''] } }, { $set: { conversion: { state: 'reserved' } } }); assert.equal(zombie.matchedCount, 0, 'the reserve predicate (no expenseId) cannot match a converted trip')
  for (let i = 0; i < 3; i++) assert.equal((await conv(t._id)).status, 200)
  await assertConverted(t._id, { revisionBefore: t.revision, docs: 1, label: 'F7' })
})

test('F8. a STALLED holder (alive, lease expired, takeover happened) resuming late cannot double-link: one expense, revision +1, one audit; it still resolves to the same expense', async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  for (const withDocs of [false, true]) {
    const t = await approved(withDocs ? [await doc('Aemployee')] : [])
    const slow = conv(t._id, 'Aemployee', 'stall_after_expense'); await sleep(700)               // holder 1: expense inserted, now stalled before linking
    assert.equal((await expensesOf(t._id)).length, 1); assert.ok(!(await rawTrip(t._id)).expenseId); await expireLease(t._id)
    const fast = await conv(t._id); assert.equal(fast.status, 200, fast.text)                      // holder 2: takes over, adopts the row, links, completes
    const late = await slow; assert.ok([200, 201].includes(late.status), late.text); assert.equal(late.json._id, fast.json._id)
    await assertConverted(t._id, { revisionBefore: t.revision, docs: withDocs ? 1 : 0, label: 'F8' })
  }
})

/* ═════════ 3. revision ═════════ */
test('V1. revision: conversion bumps it exactly once (replays never do); an approved trip stays terminal for PATCH — a stale OR fresh revision cannot change it, and nothing moves', async () => {
  const t = await approved(); assert.equal((await conv(t._id)).status, 201); const snap = async () => JSON.stringify({ ...(await rawTrip(t._id)), updatedAt: 0 })
  const before = await snap(); assert.equal((await rawTrip(t._id)).revision, t.revision + 1)
  for (const rev of [t.revision, t.revision + 1, t.revision + 7]) for (const k of ['Aadmin', 'Amanager', 'Aemployee']) {
    const r = await kit.api(`/api/travel/${t._id}`, { method: 'PATCH', ...who(k), body: { revision: rev, status: 'rejected', adminNote: 'late' } }); assert.ok([400, 403, 409].includes(r.status), `${k}@${rev}: ${r.status} ${r.text}`); assert.doesNotMatch(r.text, NO_INTERNALS)
  }
  const docs = await kit.api(`/api/travel/${t._id}`, { method: 'PATCH', ...who('Aemployee'), body: { revision: t.revision + 1, itineraryDocs: [] } }); assert.ok(docs.status >= 400, 'documents are locked once approved/converted')
  assert.equal(await snap(), before, 'no PATCH changed the converted trip'); for (let i = 0; i < 3; i++) assert.equal((await conv(t._id)).status, 200)
  assert.equal((await rawTrip(t._id)).revision, t.revision + 1, 'replays never touch the revision'); const g = await kit.api(`/api/travel/${t._id}`, who('Aemployee')); assert.equal(g.json.revision, t.revision + 1); assert.ok(!('conversion' in g.json))
})

test('V2. a legacy trip with NO revision field converts to revision 1; a crashed reservation does not move the revision, the single link does', async () => {
  const ins = await db.collection('travelrequests').insertOne({ orgId: A.orgId, userId: A.employee.id, userName: 'L', purpose: 'legacy ' + crypto.randomBytes(3).toString('hex'), destination: 'd', departureDate: new Date(Date.now() - 10 * 864e5), returnDate: new Date(Date.now() - 8 * 864e5), estimatedTotal: 0, status: 'approved', itineraryDocs: [], legs: [] })
  const id = String(ins.insertedId); assert.ok(!('revision' in (await rawTrip(id)))); const r = await conv(id); assert.equal(r.status, 201, r.text); assert.equal((await rawTrip(id)).revision, 1); assert.equal(r.json.amount, 0)
  const t = await approved(); assert.equal((await conv(t._id, 'Aemployee', 'after_reserve')).status, 500); assert.equal((await rawTrip(t._id)).revision, t.revision, 'reservation is not a logical change')
  await expireLease(t._id); assert.equal((await conv(t._id, 'Aemployee', 'after_expense')).status, 500); assert.equal((await rawTrip(t._id)).revision, t.revision, 'an unlinked expense is not a logical change')
  await expireLease(t._id); assert.equal((await conv(t._id)).status, 200); assert.equal((await rawTrip(t._id)).revision, t.revision + 1)
})

/* ═════════ 4. permissions / eligibility / conflicts ═════════ */
test('P1. only the owner of an approved, finished trip may convert; refusals have no side effects (no reservation, expense, audit, claim change)', async () => {
  const t = await approved([await doc('Aemployee')])
  for (const [k, s] of [['Amanager', 403], ['Aadmin', 403], ['Bemployee', 404], ['Badmin', 404]]) assert.equal((await conv(t._id, k)).status, s, k)
  assert.equal((await kit.api(`/api/travel/${t._id}/expense`, { method: 'POST' })).status, 401)
  assert.equal((await conv('5f0000000000000000000000')).status, 404); assert.equal((await conv('not-an-id')).status, 404)
  let s = await rawTrip(t._id); assert.ok(!s.conversion && !s.expenseId); assert.equal(s.revision, t.revision); assert.equal((await expensesOf(t._id)).length, 0); assert.equal((await audits(t._id, 'travel.expense_created')).length, 0)
  // ineligible states
  const mk = async (patch) => { const r = await post('Aemployee', { purpose: 'inel ' + crypto.randomBytes(3).toString('hex'), destination: 'X', departureDate: D(-10), returnDate: D(-8) }); assert.equal(r.status, 201); let rev = r.json.revision; for (const p of patch) { const x = await kit.api(`/api/travel/${r.json._id}`, { method: 'PATCH', ...who(p.by), body: { revision: rev, status: p.status } }); assert.equal(x.status, 200, x.text); rev = x.json.revision } return r.json }
  for (const [label, patch] of [['pending_manager', []], ['pending_admin', [{ by: 'Amanager', status: 'pending_admin' }]], ['rejected', [{ by: 'Amanager', status: 'rejected' }]]]) {
    const x = await mk(patch); const r = await conv(x._id); assert.equal(r.status, 409, label); assert.equal(r.json.code, 'travel_not_approved'); const st = await rawTrip(x._id); assert.ok(!st.conversion && !st.expenseId); assert.equal((await expensesOf(x._id)).length, 0)
  }
  const cancelled = await mk([]); assert.equal((await kit.api(`/api/travel/${cancelled._id}`, { method: 'DELETE', ...who('Aemployee') })).status, 200); assert.equal((await conv(cancelled._id)).status, 409)
  const fut = await approved([], { departureDate: D(5), returnDate: D(8) }); const f = await conv(fut._id); assert.equal(f.status, 409); assert.equal(f.json.code, 'trip_not_finished'); assert.ok(!(await rawTrip(fut._id)).conversion)
})

test('P2. incompatible associations are a clear, non-sensitive 409: link to a missing expense, to another trip’s expense, to another organisation’s expense — nothing is overwritten or duplicated', async () => {
  const Expense = kit.load('models/Expense.ts').default
  const base = (orgId, userId, extra = {}) => ({ userId, userName: 'u', orgId, title: 't', reason: 'r', amount: 1, startDate: new Date(), ...extra })
  const t1 = await approved(); await db.collection('travelrequests').updateOne({ _id: oid(t1._id) }, { $set: { expenseId: String(new mongoose.Types.ObjectId()) } })
  const t2 = await approved(); const otherTrip = await approved(); const foreign = await Expense.create(base(A.orgId, A.employee.id, { travelRequestId: otherTrip._id })); await db.collection('travelrequests').updateOne({ _id: oid(t2._id) }, { $set: { expenseId: String(foreign._id) } })
  const t3 = await approved(); const otherOrg = await Expense.create(base(B.orgId, B.employee.id, { travelRequestId: t3._id })); await db.collection('travelrequests').updateOne({ _id: oid(t3._id) }, { $set: { expenseId: String(otherOrg._id) } })
  const t4 = await approved(); const wrongUser = await Expense.create(base(A.orgId, A.manager.id, { travelRequestId: t4._id })); await db.collection('travelrequests').updateOne({ _id: oid(t4._id) }, { $set: { expenseId: String(wrongUser._id) } })
  for (const [label, t] of [['missing', t1], ['other trip’s', t2], ['other org’s', t3], ['other user’s', t4]]) {
    const r = await conv(t._id); assert.equal(r.status, 409, `${label}: ${r.text}`); assert.equal(r.json.code, 'conversion_conflict'); assert.doesNotMatch(r.text, NO_INTERNALS); assert.doesNotMatch(r.text, new RegExp(String(foreign._id) + '|' + String(otherOrg._id)))
    assert.equal(await db.collection('expenses').countDocuments({ travelConversionOf: t._id }), 0, label)
  }
  assert.equal((await db.collection('expenses').findOne({ _id: foreign._id })).travelRequestId, otherTrip._id, 'foreign expense untouched')
})

test('P3. trips converted BEFORE this slice (expenseId, no protocol state) replay as 200 without inventing audits or touching the revision', async () => {
  const t = await approved(); const Expense = kit.load('models/Expense.ts').default
  const old = await Expense.create({ userId: t.userId, userName: 'u', orgId: A.orgId, title: 'Travel — old', reason: 'r', amount: 5, startDate: new Date(), travelRequestId: t._id, receipts: [] })
  await db.collection('travelrequests').updateOne({ _id: oid(t._id) }, { $set: { expenseId: String(old._id) } })
  const r = await conv(t._id); assert.equal(r.status, 200, r.text); assert.equal(r.json._id, String(old._id))
  assert.equal((await audits(t._id, 'travel.expense_created')).length, 0); assert.equal((await rawTrip(t._id)).revision, t.revision); assert.equal(await db.collection('expenses').countDocuments({ travelRequestId: t._id }), 1)
})

/* ═════════ 5. attachment transfer ═════════ */
test('A1. attachment transfer: only verified private files of THIS trip enter the expense; foreign, deleted, wrong-purpose, forged, legacy values are excluded and counted; the trip keeps every original value', async () => {
  const good = await doc('Aemployee'), goodPdf = await doc('Aemployee', { ext: 'pdf' }), gone = await doc('Aemployee'), wrong = await doc('Aemployee'), other = await doc('Bemployee')
  const t = await approved([good, goodPdf, gone, wrong])
  await db.collection('receiptuploads').updateOne({ publicId: wrong.pid }, { $set: { purpose: 'expense_receipt' } })
  Object.assign(process.env, fake.ENV); assert.equal(await kit.load('lib/uploads/attachmentStorage.ts').destroyReceiptAsset(gone.pid, A.orgId), 'deleted')
  const hex = crypto.randomBytes(16).toString('hex'); const extras = ['https://legacy.example.test/x.pdf', other.ref, `cld:doppeldash/${A.orgId}/receipts/${hex}.png`, 'cld:broken']
  await db.collection('travelrequests').updateOne({ _id: oid(t._id) }, { $push: { itineraryDocs: { $each: extras } } })
  const before = (await rawTrip(t._id)).itineraryDocs
  const r = await conv(t._id); assert.equal(r.status, 201, r.text); assert.equal(r.json.attachmentsExcluded, 2 + extras.length); assert.doesNotMatch(r.text, NO_INTERNALS)
  const { t: after, ex } = await assertConverted(t._id, { revisionBefore: t.revision, docs: 1, label: 'A1' })
  assert.deepEqual(ex.receipts, [good.ref, goodPdf.ref]); assert.deepEqual(after.itineraryDocs, before, 'nothing on the trip was rewritten or removed')
  assert.equal((await row(good.pid)).transferredTo, r.json._id); assert.ok(!(await row(gone.pid)).transferredTo); assert.ok(!(await row(wrong.pid)).transferredTo); assert.ok(!(await row(other.pid)).claimedBy, 'the other tenant’s file is untouched')
  assert.equal((await row(good.pid)).claimedBy, t._id); assert.equal((await row(gone.pid)).claimedBy, t._id, 'claims of excluded files are not released or deleted by conversion')
  assert.deepEqual((await audits(t._id, 'travel.expense_created'))[0].metadata, { expenseId: r.json._id, transferred: 2, excluded: 2 + extras.length })
  const files = (await fake.control.state()).files; assert.ok(files.some(f => f.startsWith(good.pid)) && files.some(f => f.startsWith(wrong.pid)), 'no provider asset was deleted by the conversion')
  const again = await conv(t._id); assert.equal(again.status, 200); assert.equal(again.json.attachmentsExcluded, 2 + extras.length); assert.deepEqual(again.json.receipts, r.json.receipts)
})

test('A2. provider OUTAGE: 503, nothing created, reservation released, claims intact, no asset deleted; the retry after recovery converts normally. A recovery after the expense exists never re-reads the provider', async () => {
  const a = await doc('Aemployee'), b = await doc('Aemployee'); const t = await approved([a, b])
  await fake.control.mode({ storage: { admin: 'error500' } })
  const down = await conv(t._id); assert.equal(down.status, 503); assert.equal(down.json.code, 'attachment_verification_unavailable'); assert.doesNotMatch(down.text, NO_INTERNALS)
  const s = await rawTrip(t._id); assert.ok(!s.conversion && !s.expenseId); assert.equal((await expensesOf(t._id)).length, 0); assert.equal(s.revision, t.revision)
  assert.equal((await row(a.pid)).claimedBy, t._id); assert.equal((await row(b.pid)).claimedBy, t._id); assert.equal((await fake.control.state()).files.length, 2)
  await fake.control.mode({ storage: { admin: 'ok' } })
  // crash after the expense exists, then an outage: recovery must NOT depend on the provider
  assert.equal((await conv(t._id, 'Aemployee', 'after_expense')).status, 500); await expireLease(t._id)
  await fake.control.mode({ storage: { admin: 'error500' } })
  const r = await conv(t._id); assert.equal(r.status, 200, r.text); assert.equal(r.json.receipts.length, 2)
  await fake.control.mode({ storage: { admin: 'ok' } }); await assertConverted(t._id, { revisionBefore: t.revision, docs: 2, label: 'A2' })
})

test('A3. the normal expense flow still cannot take a travel file — converted or not — and concurrent retries never duplicate or release the winner’s claims', async () => {
  const d = await doc('Aemployee'), e = await doc('Aemployee'); const t = await approved([d]); const body = (n, receipts) => ({ title: 'N ' + n + crypto.randomBytes(2).toString('hex'), reason: 'x', amount: 10, startDate: new Date().toISOString(), receipts })
  const pre = await kit.api('/api/rms', { method: 'POST', ...who('Aemployee'), body: body('pre', [d.url]) }); assert.equal(pre.status, 400, pre.text)       // unconverted travel file
  const rs = await Promise.all(Array.from({ length: 8 }, () => conv(t._id))); assert.equal(rs.filter(r => r.status === 201).length, 1)
  const post1 = await kit.api('/api/rms', { method: 'POST', ...who('Aemployee'), body: body('post', [d.url]) }); assert.ok([400, 409].includes(post1.status), post1.text)   // converted travel file
  const unconverted = await kit.api('/api/rms', { method: 'POST', ...who('Aemployee'), body: body('unc', [e.url]) }); assert.equal(unconverted.status, 400, unconverted.text)
  const plain = await doc('Aemployee', { purpose: null }); const ok = await kit.api('/api/rms', { method: 'POST', ...who('Aemployee'), body: body('ok', [plain.url]) }); assert.equal(ok.status, 201, ok.text)
  await db.collection('expenses').updateOne({ _id: oid(ok.json._id) }, { $set: { status: 'returned' } })   // employees may edit only a RETURNED expense
  const patch = await kit.api(`/api/rms/${ok.json._id}`, { method: 'PATCH', ...who('Aemployee'), body: { receipts: [plain.url, d.url] } }); assert.ok([400, 409].includes(patch.status), patch.text)
  assert.equal(await db.collection('expenses').countDocuments({ orgId: A.orgId, receipts: d.ref }), 1, 'the file is referenced by exactly the converted expense'); assert.equal((await row(d.pid)).claimedBy, t._id); assert.equal((await row(d.pid)).purpose, 'travel_itinerary')
  await assertConverted(t._id, { revisionBefore: t.revision, docs: 1, label: 'A3' })
})

/* ═════════ 6. failpoint safety ═════════ */
test('G1. failpoints are inert unless explicitly armed AND not in production; the header can never crash a production-mode server', async () => {
  const fp = kit.load('lib/travel/failpoints.ts'); const hdr = v => ({ get: () => v }); const env = { ...process.env }
  try {
    process.env.TRAVEL_FAILPOINTS = '1'; process.env.NODE_ENV = 'development'; assert.equal(fp.requestedFailpoint(hdr('after_link')), 'after_link'); assert.equal(fp.requestedFailpoint(hdr('../x;rm')), undefined)
    process.env.NODE_ENV = 'production'; assert.equal(fp.requestedFailpoint(hdr('after_link')), undefined, 'production ignores the header')
    process.env.NODE_ENV = 'development'; delete process.env.TRAVEL_FAILPOINTS; assert.equal(fp.requestedFailpoint(hdr('after_link')), undefined, 'not armed')
  } finally { Object.assign(process.env, env); if (env.TRAVEL_FAILPOINTS === undefined) delete process.env.TRAVEL_FAILPOINTS }
  const t = await approved(); const r = await conv(t._id, 'Aemployee', 'not_a_real_point'); assert.equal(r.status, 201, 'an unknown failpoint name does nothing')
})
