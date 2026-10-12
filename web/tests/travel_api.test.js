/**
 * Travel Slice 5 — keyset pagination (stable, bounded, tenant-bound cursors) and the public response contract (explicit allowlist presenter,
 * one error envelope). Real HTTP routes, the dev server's throwaway DB and the LOCAL FAKE provider.
 * Requires the dev-server env of receipt_ocr_vertical.test.js plus TRAVEL_FAILPOINTS=1 and TRAVEL_CONVERSION_WAIT_MS=3000.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const mongoose = require('mongoose')
const kit = require('./helpers/authTestKit')
const fake = require('./helpers/fakeProviders')

let db, smtp, providers, A, B, C, tok
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 1)])
const oid = s => new mongoose.Types.ObjectId(s)
const D = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)

test.before(async () => {
  providers = await fake.ensureFakeProviders(); db = await kit.connect(); smtp = await kit.startFakeSmtp(2525)
  A = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true }); B = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true }); C = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  tok = {}; for (const [k, org] of [['A', A], ['B', B], ['C', C]]) for (const r of ['admin', 'manager', 'employee']) { const s = await kit.login(org[r].email); tok[`${k}${r}`] = { token: s.accessToken, cookie: s.cookie } }
  await kit.load('models/TravelRequest.ts').default.init()
})
test.after(async () => {
  const orgs = [A.orgId, B.orgId, C.orgId]
  for (const c of ['travelrequests', 'receiptuploads', 'auditlogs', 'expenses']) await db.collection(c).deleteMany({ orgId: { $in: orgs } })
  await kit.cleanupAll(db); await smtp.stop(); await providers.stop(); await kit.disconnect()
})
test.beforeEach(async () => { await fake.control.reset(); await db.collection('ratelimits').deleteMany({ key: /^(upload-sign|travel-doc|rms-receipt):/ }) })

const who = k => ({ token: tok[k].token })
const list = (k, qs = '') => kit.api('/api/travel' + qs, who(k))
const NO_INTERNALS = /cld:|doppeldash\/|testcloud|127\.0\.0\.1|signature|api_key|authenticated\/|stack|mongoose|E11000|MongoServer|requestHash|clientRequestId|"conversion"|leaseUntil|dedupeKey|__v/i
const ALLOWED = new Set(['_id', 'orgId', 'userId', 'userName', 'employeeId', 'purpose', 'destination', 'departureDate', 'returnDate', 'legs', 'itineraryDocs', 'estimatedTotal', 'advanceRequested', 'accommodation', 'status', 'revision', 'createdAt', 'updatedAt', 'managerNote', 'adminNote', 'approvedBy', 'approvedAt', 'rejectedBy', 'rejectedAt', 'expenseId'])
const REQUIRED = ['_id', 'userId', 'userName', 'purpose', 'destination', 'departureDate', 'returnDate', 'legs', 'itineraryDocs', 'estimatedTotal', 'advanceRequested', 'status', 'revision', 'createdAt']
function assertPublicTrip(t, label) {
  for (const k of REQUIRED) assert.ok(k in t, `${label}: missing ${k}`)
  for (const k of Object.keys(t)) assert.ok(ALLOWED.has(k), `${label}: unexpected field ${k}`)
  assert.equal(typeof t.revision, 'number'); assert.equal(typeof t._id, 'string'); for (const l of t.legs) assert.ok(Object.keys(l).every(k => ['_id', 'from', 'to', 'date', 'mode', 'estimatedCost', 'notes'].includes(k)), label + ' leg fields')
  assert.doesNotMatch(JSON.stringify(t), NO_INTERNALS, label)
}
/** Raw trips with controlled timestamps (the API always uses "now"). */
async function seed(org, userId, n, { at, tie = 1, status = 'pending_manager', userName = 'Seed', startMs = Date.parse('2026-01-01T00:00:00Z') } = {}) {
  const docs = Array.from({ length: n }, (_, i) => {
    const created = new Date(at ?? startMs + Math.floor(i / tie) * 1000)
    return { _id: new mongoose.Types.ObjectId(), orgId: org.orgId, userId, userName, purpose: 'seed ' + i, destination: 'D', departureDate: created, returnDate: created, estimatedTotal: 1, advanceRequested: 0, legs: [], itineraryDocs: [], status, revision: 0, createdAt: created, updatedAt: created, requestHash: 'h' + i, clientRequestId: 'k' + crypto.randomBytes(4).toString('hex'), __v: 0 }
  })
  if (docs.length) await db.collection('travelrequests').insertMany(docs); return docs.map(d => String(d._id))
}
const expectedOrder = async (filter) => (await db.collection('travelrequests').find(filter).sort({ createdAt: -1, _id: -1 }).project({ _id: 1 }).toArray()).map(d => String(d._id))
async function walk(k, qs, limit) {
  const ids = []; let cursor, pages = 0
  for (;;) {
    const r = await list(k, `?limit=${limit}${qs}${cursor ? '&cursor=' + encodeURIComponent(cursor) : ''}`); assert.equal(r.status, 200, r.text)
    ids.push(...r.json.items.map(x => x._id)); pages++; assert.ok(r.json.items.length <= limit)
    if (!r.json.hasMore) { assert.ok(!('nextCursor' in r.json)); return { ids, pages } }
    assert.equal(typeof r.json.nextCursor, 'string'); assert.equal(r.json.items.length, limit, 'a page that has more is full'); cursor = r.json.nextCursor; assert.ok(pages < 500)
  }
}

/* ═════════ pagination ═════════ */
test('P1. empty lists: envelope with no items and no cursor; legacy form is an empty array', async () => {
  const r = await list('Cemployee', '?limit=10'); assert.equal(r.status, 200); assert.deepEqual(r.json, { items: [], limit: 10, hasMore: false })
  assert.deepEqual((await list('Cemployee')).json, []); assert.deepEqual((await list('Cmanager', '?cursor=')).status, 400)
  const d = await list('Cemployee', '?cursor=' + 'x'.repeat(10)); assert.equal(d.status, 400)
})

test('P2. multi-page walk: exact newest-first order, no duplicates, no gaps — including rows whose timestamps TIE (groups of 7 share one createdAt)', async () => {
  await db.collection('travelrequests').deleteMany({ orgId: A.orgId })
  const ids = await seed(A, A.employee.id, 53, { tie: 7 }); await seed(A, A.manager.id, 9, { tie: 3, startMs: Date.parse('2026-01-01T00:00:04Z') })      // interleaved timestamps, other user
  const want = await expectedOrder({ orgId: A.orgId, userId: A.employee.id }); assert.equal(want.length, 53)
  for (const limit of [1, 5, 10, 53, 100]) { const { ids: got, pages } = await walk('Aemployee', '', limit); assert.deepEqual(got, want, `employee limit ${limit}`); assert.equal(pages, Math.ceil(53 / limit)) }
  const mgrWant = await expectedOrder({ orgId: A.orgId }); assert.equal(mgrWant.length, 62); assert.deepEqual((await walk('Amanager', '', 8)).ids, mgrWant); assert.deepEqual((await walk('Aadmin', '', 25)).ids, mgrWant)
  assert.equal(new Set(mgrWant).size, 62); assert.ok(ids.every(i => mgrWant.includes(i)))
  const dflt = await list('Aemployee', '?limit=' + 100); assert.equal(dflt.json.limit, 100); const noLimit = await list('Aemployee', '?cursor=' + (await list('Aemployee', '?limit=3')).json.nextCursor); assert.equal(noLimit.json.limit, 50, 'default page size is 50')
})

test('P3. limits: 1–100 accepted; 0, 101, negative, fractional, text, empty, padded, exponent and repeated values are a clean 400 invalid_limit', async () => {
  for (const v of ['0', '101', '-1', '1.5', 'abc', '', '10 ', '1e2', '0x10', '1000', '+5']) { const r = await list('Aemployee', `?limit=${encodeURIComponent(v)}`); assert.equal(r.status, 400, v); assert.equal(r.json.code, 'invalid_limit'); assert.deepEqual(r.json.fields, ['limit']); assert.equal(typeof r.json.error, 'string') }
  assert.equal((await list('Aemployee', '?limit=5&limit=6')).status, 400)
  assert.equal((await list('Amanager', '?limit=100')).json.items.length, 62 > 100 ? 100 : 62); assert.equal((await list('Amanager', '?limit=1')).json.items.length, 1)
})

test('P4. visibility is applied in the query: employees see only their own rows, managers/admins the whole organisation, nobody sees another tenant — in rows, hasMore and cursors', async () => {
  const bIds = await seed(B, B.employee.id, 12, {}); const aEmp = (await walk('Aemployee', '', 10)).ids; const aMgr = (await walk('Amanager', '', 10)).ids
  assert.ok(aEmp.every(i => !bIds.includes(i)) && aMgr.every(i => !bIds.includes(i)))
  const emp = await db.collection('travelrequests').find({ _id: { $in: aEmp.map(oid) } }).toArray(); assert.ok(emp.every(t => t.userId === A.employee.id && t.orgId === A.orgId))
  assert.ok((await db.collection('travelrequests').find({ _id: { $in: aMgr.map(oid) } }).toArray()).every(t => t.orgId === A.orgId))
  const bMgr = (await walk('Bmanager', '', 5)).ids; assert.deepEqual([...bMgr].sort(), [...bIds].sort()); assert.deepEqual((await walk('Bemployee', '', 5)).ids, await expectedOrder({ orgId: B.orgId, userId: B.employee.id }))
  const r = await list('Bemployee', '?limit=5'); assert.deepEqual(Object.keys(r.json).sort(), ['hasMore', 'items', 'limit', 'nextCursor'], 'no totals/counts or other metadata'); assert.doesNotMatch(r.text, new RegExp(A.orgId))
})

test('P5. filters and sort: status filter is applied before paging; unknown/invalid status or sort → 400; unknown parameters are ignored', async () => {
  await db.collection('travelrequests').deleteMany({ orgId: C.orgId }); await seed(C, C.employee.id, 11, { status: 'approved' }); await seed(C, C.employee.id, 7, { status: 'rejected', startMs: Date.parse('2026-02-01T00:00:00Z') }); await seed(C, C.manager.id, 5, { status: 'approved', startMs: Date.parse('2026-03-01T00:00:00Z') })
  assert.deepEqual((await walk('Cmanager', '&status=approved', 4)).ids, await expectedOrder({ orgId: C.orgId, status: 'approved' })); assert.deepEqual((await walk('Cemployee', '&status=approved', 4)).ids, await expectedOrder({ orgId: C.orgId, userId: C.employee.id, status: 'approved' }))
  assert.equal((await list('Cemployee', '?limit=50&status=all')).json.items.length, 18); assert.equal((await list('Cemployee', '?limit=50&status=cancelled')).json.items.length, 0)
  for (const q of ['status=bogus', 'status=%24ne', 'status=approved&status=rejected', 'sort=oldest', 'sort=createdAt', 'sort=newest&sort=newest']) { const r = await list('Cemployee', '?limit=5&' + q); assert.equal(r.status, 400, q); assert.ok(['invalid_status', 'invalid_sort'].includes(r.json.code)) }
  assert.equal((await list('Cemployee', '?limit=5&sort=newest&utm=zzz')).status, 200)
})

test('P6. CONSISTENCY between page reads: new rows never duplicate or reorder what was already read; deleted rows vanish; updates (status/revision) do not move a row', async () => {
  await db.collection('travelrequests').deleteMany({ orgId: C.orgId }); const ids = await seed(C, C.manager.id, 40, { tie: 4 }); const order = await expectedOrder({ orgId: C.orgId })
  const p1 = await list('Cmanager', '?limit=10'); const seen = p1.json.items.map(x => x._id); assert.deepEqual(seen, order.slice(0, 10))
  await seed(C, C.manager.id, 6, { startMs: Date.now() })                                     // 6 newer rows appear at the head
  await db.collection('travelrequests').deleteOne({ _id: oid(order[3]) })                     // a row already read is deleted
  await db.collection('travelrequests').deleteOne({ _id: oid(order[15]) })                    // a row not yet read is deleted
  await db.collection('travelrequests').updateOne({ _id: oid(order[20]) }, { $set: { status: 'approved', updatedAt: new Date() }, $inc: { revision: 1 } })   // an unread row is updated
  let cursor = p1.json.nextCursor; const rest = []
  while (cursor) { const r = await list('Cmanager', `?limit=10&cursor=${encodeURIComponent(cursor)}`); assert.equal(r.status, 200, r.text); rest.push(...r.json.items.map(x => x._id)); cursor = r.json.nextCursor }
  assert.deepEqual(rest, order.slice(10).filter(i => i !== order[15]), 'exactly the not-yet-read, still-existing rows, in the original order'); assert.equal(new Set([...seen, ...rest]).size, seen.length + rest.length, 'no duplicates')
  assert.ok(ids.length === 40)
})

test('P7. cursors are tamper-proof and tenant-bound: every bad cursor gets the SAME 400 invalid_cursor body; nothing about other scopes is revealed', async () => {
  const mk = async k => (await list(k, '?limit=2')).json.nextCursor
  const ac = await mk('Amanager'); const bc = await mk('Bmanager'); const ec = await mk('Aemployee'); assert.ok(ac && bc && ec)
  const flip = (s, i) => s.slice(0, i) + (s[i] === 'A' ? 'B' : 'A') + s.slice(i + 1); const [pl, sig] = ac.split('.')
  const forgedPayload = Buffer.from(JSON.stringify({ c: 0, i: '5f0000000000000000000000' })).toString('base64url')
  const cases = { tamperedPayload: flip(pl, 3) + '.' + sig, tamperedSig: pl + '.' + flip(sig, 2), truncated: ac.slice(0, -5), noDot: pl, forgedPayloadSameSig: forgedPayload + '.' + sig, giant: 'A'.repeat(5000) + '.' + sig, nonBase64: '%%%.###', emptySig: pl + '.', foreignTenant: bc, otherVisibilityScope: ec, injection: encodeURIComponent('{"$ne":null}') }
  let body; for (const [name, cur] of Object.entries(cases)) {
    const r = await list('Amanager', `?limit=2&cursor=${encodeURIComponent(cur)}`); assert.equal(r.status, 400, name); assert.equal(r.json.code, 'invalid_cursor', name); assert.deepEqual(r.json.fields, ['cursor'])
    body = body ?? r.text; assert.equal(r.text, body, `${name}: identical response for every failure`)
  }
  assert.equal((await list('Amanager', `?limit=2&cursor=${encodeURIComponent(bc)}`)).status, 400, 'org B cursor in org A'); assert.equal((await list('Bmanager', `?limit=2&cursor=${encodeURIComponent(ac)}`)).status, 400, 'org A cursor in org B')
  assert.equal((await list('Amanager', `?limit=2&status=approved&cursor=${encodeURIComponent(ac)}`)).status, 400, 'cursor bound to the status filter'); assert.equal((await list('Aemployee', `?limit=2&cursor=${encodeURIComponent(ac)}`)).status, 400, 'manager cursor used by an employee')
  assert.equal((await list('Amanager', `?limit=2&cursor=${encodeURIComponent(ac)}`)).status, 200, 'the genuine cursor still works'); assert.equal((await list('Aadmin', `?limit=2&cursor=${encodeURIComponent(ac)}`)).status, 200, 'same scope (org-wide) is shared by manager and admin')
})

test('P8. legacy form (no limit/cursor) keeps the bare array, is bounded at 200 and says so in headers; the header cursor continues in paged mode with no gap', async () => {
  await db.collection('travelrequests').deleteMany({ orgId: C.orgId }); await seed(C, C.manager.id, 230, { tie: 5 })
  const r = await list('Cmanager'); assert.ok(Array.isArray(r.json)); assert.equal(r.json.length, 200); assert.equal(r.headers.get('x-has-more'), 'true'); const cur = r.headers.get('x-next-cursor'); assert.ok(cur)
  const rest = await list('Cmanager', `?limit=100&cursor=${encodeURIComponent(cur)}`); assert.equal(rest.json.items.length, 30); assert.equal(rest.json.hasMore, false)
  assert.deepEqual([...r.json.map(x => x._id), ...rest.json.items.map(x => x._id)], await expectedOrder({ orgId: C.orgId }))
  const small = await list('Cemployee'); assert.ok(Array.isArray(small.json)); assert.equal(small.headers.get('x-has-more'), null)
  r.json.forEach((t, i) => i < 5 && assertPublicTrip(t, 'legacy list item'))
})

test('P9. queries are bounded and index-backed: no in-memory sort, an index range scan, and only ~limit documents examined (explain on the real filter)', async () => {
  const { buildFilter, decodeCursor, SORT } = kit.load('lib/travel/pagination.ts'); const col = db.collection('travelrequests')
  const plan = async (scope, pos, limit = 11) => { const ex = await col.find(buildFilter(scope, pos)).sort(SORT).limit(limit).explain('executionStats'); return { s: JSON.stringify(ex.queryPlanner.winningPlan), examined: ex.executionStats.totalDocsExamined, keys: ex.executionStats.totalKeysExamined } }
  const mid = (await col.find({ orgId: C.orgId }).sort(SORT).skip(100).limit(1).toArray())[0]; const pos = { c: mid.createdAt.getTime(), i: String(mid._id) }
  const mgr = { orgId: C.orgId, userId: C.manager.id, manager: true }
  for (const [label, scope, p] of [['manager first page', mgr, null], ['manager deep page', mgr, pos], ['manager+status', { ...mgr, status: 'approved' }, null], ['employee', { orgId: A.orgId, userId: A.employee.id, manager: false }, null]]) {
    const r = await plan(scope, p); assert.ok(r.s.includes('IXSCAN'), `${label}: index scan\n${r.s}`); assert.ok(!r.s.includes('"stage":"SORT"') && !r.s.includes('COLLSCAN'), `${label}: no in-memory sort / collection scan\n${r.s}`)
    assert.ok(r.examined <= 40, `${label}: examined ${r.examined} docs for a page of 10`)
  }
  const idx = (await col.indexes()).map(i => i.name); for (const n of ['orgId_1_createdAt_-1__id_-1', 'orgId_1_status_1_createdAt_-1__id_-1', 'orgId_1_userId_1_createdAt_-1__id_-1']) assert.ok(idx.includes(n), 'index ' + n)
  assert.equal(decodeCursor('a.b', mgr), null)
})

test('P10. hand-inserted legacy rows with NO createdAt form a final tier (after all dated rows, by _id): paging is still complete, ordered and duplicate-free', async () => {
  await db.collection('travelrequests').deleteMany({ orgId: C.orgId }); await seed(C, C.manager.id, 7, { tie: 2 })
  const undated = Array.from({ length: 5 }, () => ({ _id: new mongoose.Types.ObjectId(), orgId: C.orgId, userId: C.manager.id, userName: 'U', purpose: 'undated', destination: 'd', departureDate: new Date(), returnDate: new Date(), estimatedTotal: 0, status: 'pending_manager', itineraryDocs: [], legs: [] }))
  await db.collection('travelrequests').insertMany(undated)
  const dated = await expectedOrder({ orgId: C.orgId, createdAt: { $exists: true } }); const tail = undated.map(d => String(d._id)).sort().reverse()
  for (const limit of [1, 3, 4, 12, 100]) { const { ids } = await walk('Cmanager', '', limit); assert.deepEqual(ids, [...dated, ...tail], `limit ${limit}`) }
  assert.ok((await list('Cmanager', '?limit=100')).json.items.slice(-5).every(t => t.purpose === 'undated' && t.revision === 0))
})

/* ═════════ presenters ═════════ */
const sign = (k, o = {}) => kit.api('/api/uploads/sign', { method: 'POST', ...who(k), body: { kind: 'receipt', mimeType: 'image/png', sizeBytes: 100, purpose: 'travel_itinerary', ...o } })
async function doc(k) { const t = await sign(k); assert.equal(t.status, 200, t.text); const fd = new FormData(); for (const [f, v] of Object.entries(t.json.fields)) fd.append(f, v); fd.append('file', new Blob([PNG]), 'f.png'); const up = await (await fetch(t.json.uploadUrl, { method: 'POST', body: fd })).json(); return { url: up.secure_url, pid: up.public_id, ref: `cld:${up.public_id}.png` } }
const body = (o = {}) => ({ purpose: 'Present ' + crypto.randomBytes(3).toString('hex'), destination: 'Pune', departureDate: D(-10), returnDate: D(-8), legs: [{ from: 'a', to: 'b', date: D(-9), mode: 'train', estimatedCost: 50, notes: 'n' }], ...o })

test('R1. every Travel response uses the same allowlisted shape: create, list, detail, PATCH (status and documents), cancel, conversion — with revision, and nothing internal', async () => {
  const d1 = await doc('Aemployee'); const key = 'k-' + crypto.randomBytes(6).toString('hex')
  const c = await kit.api('/api/travel', { method: 'POST', ...who('Aemployee'), body: body({ clientRequestId: key, itineraryDocs: [d1.url], accommodation: { required: true, city: 'Pune', checkIn: D(-10), checkOut: D(-8), estimatedCost: 10 } }) }); assert.equal(c.status, 201, c.text); assertPublicTrip(c.json, 'create'); assert.equal(c.json.revision, 0)
  const replay = await kit.api('/api/travel', { method: 'POST', ...who('Aemployee'), body: body({ clientRequestId: key, itineraryDocs: [d1.url], accommodation: { required: true, city: 'Pune', checkIn: D(-10), checkOut: D(-8), estimatedCost: 10 }, purpose: c.json.purpose }) })
  if (replay.status === 200) { assertPublicTrip(replay.json, 'idempotent replay'); assert.equal(replay.json._id, c.json._id) }
  assert.deepEqual(c.json.itineraryDocs, [`/api/travel/${c.json._id}/itinerary/0.png`])
  const g = await kit.api(`/api/travel/${c.json._id}`, who('Amanager')); assert.equal(g.status, 200); assertPublicTrip(g.json, 'detail')
  const d2 = await doc('Aemployee'); const pd = await kit.api(`/api/travel/${c.json._id}`, { method: 'PATCH', ...who('Aemployee'), body: { revision: 0, itineraryDocs: [`/api/travel/${c.json._id}/itinerary/0.png`, d2.url] } }); assert.equal(pd.status, 200, pd.text); assertPublicTrip(pd.json, 'PATCH documents'); assert.equal(pd.json.revision, 1); assert.equal(pd.json.itineraryDocs.length, 2)
  const ps = await kit.api(`/api/travel/${c.json._id}`, { method: 'PATCH', ...who('Amanager'), body: { revision: 1, status: 'approved', managerNote: 'ok' } }); assert.equal(ps.status, 200, ps.text); assertPublicTrip(ps.json, 'PATCH status'); assert.equal(ps.json.revision, 2); assert.equal(ps.json.managerNote, 'ok'); assert.ok(ps.json.approvedBy)
  const cv = await kit.api(`/api/travel/${c.json._id}/expense`, { method: 'POST', ...who('Aemployee') }); assert.equal(cv.status, 201, cv.text)
  assert.doesNotMatch(cv.text, NO_INTERNALS); assert.ok(!('travelConversionOf' in cv.json)); assert.equal(cv.json.travelRequestId, c.json._id); assert.equal(cv.json.receipts.length, 2); assert.ok(cv.json.receipts.every(r => /^\/api\/rms\/[a-f0-9]{24}\/receipt\/\d+\.png$/.test(r)))
  const raw = await db.collection('travelrequests').findOne({ _id: oid(c.json._id) }); assert.ok(raw.conversion && raw.requestHash && raw.clientRequestId, 'the internals do exist in storage')
  for (const [label, r] of [['detail after conversion', await kit.api(`/api/travel/${c.json._id}`, who('Aemployee'))], ['detail as admin', await kit.api(`/api/travel/${c.json._id}`, who('Aadmin'))]]) { assert.equal(r.status, 200); assertPublicTrip(r.json, label); assert.equal(r.json.revision, 3); assert.equal(r.json.expenseId, cv.json._id) }
  const li = (await walk('Aemployee', '', 5)).ids; assert.ok(li.includes(c.json._id)); const listed = (await list('Aemployee', '?limit=100')).json.items.find(t => t._id === c.json._id); assertPublicTrip(listed, 'list item after conversion'); assert.equal(listed.revision, 3)
  const again = await kit.api(`/api/travel/${c.json._id}/expense`, { method: 'POST', ...who('Aemployee') }); assert.equal(again.status, 200); assert.equal(again.json._id, cv.json._id); assert.doesNotMatch(again.text, NO_INTERNALS)
  const rms = await kit.api(`/api/rms/${cv.json._id}`, who('Aemployee')); assert.equal(rms.status, 200); assert.ok(!('travelConversionOf' in rms.json)); assert.doesNotMatch(JSON.stringify(rms.json.receipts), /cld:/)
  // cancel
  const t2 = (await kit.api('/api/travel', { method: 'POST', ...who('Aemployee'), body: body() })).json; const del = await kit.api(`/api/travel/${t2._id}`, { method: 'DELETE', ...who('Aemployee') })
  assert.equal(del.status, 200); assert.deepEqual(del.json, { success: true, _id: t2._id, status: 'cancelled', revision: 1 })
})

test('R2. attachment presentation: only authenticated proxy paths; legacy strings shown as stored; malformed private-looking values never echoed; the proxy needs authentication', async () => {
  const d = await doc('Aemployee'); const t = (await kit.api('/api/travel', { method: 'POST', ...who('Aemployee'), body: body({ itineraryDocs: [d.url] }) })).json
  const legacy = ['https://legacy.example.test/a.pdf', 'cld:doppeldash/odd/shape', `cld:doppeldash/${B.orgId}/receipts/${crypto.randomBytes(12).toString('hex')}.png`]
  await db.collection('travelrequests').updateOne({ _id: oid(t._id) }, { $push: { itineraryDocs: { $each: legacy } } })
  for (const r of [await kit.api(`/api/travel/${t._id}`, who('Aemployee')), (await list('Aemployee', '?limit=100'))]) {
    const tr = r.json.items ? r.json.items.find(x => x._id === t._id) : r.json
    assert.deepEqual(tr.itineraryDocs, [`/api/travel/${t._id}/itinerary/0.png`, legacy[0], `/api/travel/${t._id}/itinerary/2`, `/api/travel/${t._id}/itinerary/3`]); assert.doesNotMatch(JSON.stringify(tr.itineraryDocs), /cld:|testcloud|doppeldash\//)
  }
  const anon = await kit.api(`/api/travel/${t._id}/itinerary/0.png`); assert.equal(anon.status, 401); assert.equal(anon.json.code, 'unauthorized')
  const ok = await fetch(`${kit.BASE_URL}/api/travel/${t._id}/itinerary/0.png`, { headers: { Authorization: `Bearer ${tok.Aemployee.token}`, 'x-forwarded-for': kit.freshIp() } }); assert.equal(ok.status, 200); assert.equal(ok.headers.get('content-type'), 'image/png')
  assert.equal((await kit.api(`/api/travel/${t._id}/itinerary/0.png`, who('Bemployee'))).status, 404)
})

test('R3. records without revision (and with extra stored junk) are presented consistently: revision 0, only allowlisted fields', async () => {
  const ins = await db.collection('travelrequests').insertOne({ orgId: A.orgId, userId: A.employee.id, userName: 'L', purpose: 'legacy ' + crypto.randomBytes(3).toString('hex'), destination: 'd', departureDate: new Date(), returnDate: new Date(), estimatedTotal: 0, status: 'pending_manager', itineraryDocs: [], legs: [{ from: 'a', to: 'b', date: new Date(), mode: 'bus', estimatedCost: 1, internalLegNote: 'x' }], secretThing: 'nope', requestHash: 'abc', clientRequestId: 'zzz', __v: 4, conversion: { state: 'reserved', token: 'tok-secret', leaseUntil: new Date() }, createdAt: new Date(), updatedAt: new Date() })
  const id = String(ins.insertedId); for (const r of [await kit.api(`/api/travel/${id}`, who('Aemployee')), await kit.api(`/api/travel/${id}`, who('Amanager'))]) { assert.equal(r.status, 200); assertPublicTrip(r.json, 'legacy detail'); assert.equal(r.json.revision, 0); assert.doesNotMatch(r.text, /secretThing|tok-secret|internalLegNote/) }
  const l = (await walk('Aemployee', '', 100)).ids; assert.ok(l.includes(id)); const item = (await list('Amanager', '?limit=100')).json.items.find(t => t._id === id); if (item) { assertPublicTrip(item, 'legacy list'); assert.equal(item.revision, 0) }
  const p = await kit.api(`/api/travel/${id}`, { method: 'PATCH', ...who('Amanager'), body: { revision: 0, status: 'pending_admin' } }); assert.equal(p.status, 200); assert.equal(p.json.revision, 1); assertPublicTrip(p.json, 'legacy patch'); assert.doesNotMatch(p.text, /tok-secret/)
})

test('R4. one error envelope { error, code[, fields] } with the established statuses; a hidden record of another tenant is indistinguishable from a missing one', async () => {
  const t = (await kit.api('/api/travel', { method: 'POST', ...who('Aemployee'), body: body() })).json; const missing = '5f0000000000000000000000'
  const envelope = (r, status, code, label) => { assert.equal(r.status, status, `${label}: ${r.text}`); assert.equal(typeof r.json.error, 'string', label); assert.equal(r.json.code, code, label); assert.doesNotMatch(r.text, NO_INTERNALS, label) }
  envelope(await kit.api('/api/travel'), 401, 'unauthorized', 'list anon'); envelope(await kit.api(`/api/travel/${t._id}`), 401, 'unauthorized', 'detail anon')
  envelope(await kit.api(`/api/travel/${t._id}`, { method: 'PATCH', body: {} }), 401, 'unauthorized', 'patch anon'); envelope(await kit.api(`/api/travel/${t._id}`, { method: 'DELETE' }), 401, 'unauthorized', 'delete anon'); envelope(await kit.api(`/api/travel/${t._id}/expense`, { method: 'POST' }), 401, 'unauthorized', 'convert anon')
  for (const [label, call] of [['detail', id => kit.api(`/api/travel/${id}`, who('Bmanager'))], ['patch', id => kit.api(`/api/travel/${id}`, { method: 'PATCH', ...who('Bmanager'), body: { revision: 0, status: 'approved' } })], ['delete', id => kit.api(`/api/travel/${id}`, { method: 'DELETE', ...who('Bemployee') })], ['convert', id => kit.api(`/api/travel/${id}/expense`, { method: 'POST', ...who('Bemployee') })], ['itinerary', id => kit.api(`/api/travel/${id}/itinerary/0.png`, who('Bmanager'))]]) {
    const foreign = await call(t._id), none = await call(missing); envelope(foreign, 404, 'not_found', label + ' foreign'); assert.equal(foreign.text, none.text, `${label}: a foreign record looks exactly like a missing one`)
  }
  const other = (await kit.api('/api/travel', { method: 'POST', ...who('Amanager'), body: body() })).json
  envelope(await kit.api(`/api/travel/${other._id}`, who('Aemployee')), 403, 'forbidden', 'employee reads a colleague’s trip'); envelope(await kit.api(`/api/travel/${other._id}`, { method: 'DELETE', ...who('Aemployee') }), 403, 'forbidden', 'cancel others')
  envelope(await kit.api(`/api/travel/${t._id}`, { method: 'PATCH', ...who('Aemployee'), body: { revision: 0, status: 'approved' } }), 403, 'forbidden', 'employee review')
  envelope(await kit.api(`/api/travel/${t._id}`, { method: 'PATCH', ...who('Amanager'), body: { status: 'approved' } }), 428, 'revision_required', 'missing revision'); envelope(await kit.api(`/api/travel/${t._id}`, { method: 'PATCH', ...who('Amanager'), body: { revision: 5, status: 'approved' } }), 409, 'revision_conflict', 'stale')
  envelope(await kit.api(`/api/travel/${t._id}`, { method: 'PATCH', ...who('Amanager'), raw: '{nope', headers: { 'Content-Type': 'application/json' } }), 400, 'invalid_json', 'bad json'); envelope(await kit.api('/api/travel', { method: 'POST', ...who('Aemployee'), body: { purpose: '' } }), 400, 'invalid_travel_request', 'invalid create')
  assert.equal((await kit.api(`/api/travel/${t._id}`, { method: 'PATCH', ...who('Amanager'), body: { revision: 0, status: 'approved' } })).status, 200)
  envelope(await kit.api(`/api/travel/${t._id}`, { method: 'DELETE', ...who('Aemployee') }), 409, 'not_cancellable', 'cancel after approval'); envelope(await kit.api(`/api/travel/${t._id}/expense`, { method: 'POST', ...who('Amanager') }), 403, 'forbidden', 'convert by manager')
  const pend = (await kit.api('/api/travel', { method: 'POST', ...who('Aemployee'), body: body() })).json; envelope(await kit.api(`/api/travel/${pend._id}/expense`, { method: 'POST', ...who('Aemployee') }), 409, 'travel_not_approved', 'convert pending')
  envelope(await kit.api('/api/travel?limit=0', who('Aemployee')), 400, 'invalid_limit', 'bad limit'); envelope(await kit.api('/api/travel?cursor=zz.zz', who('Aemployee')), 400, 'invalid_cursor', 'bad cursor')
})
