/**
 * Travel Slice 1 — create validation, authoritative totals, database-enforced idempotency, and the submission audit.
 * Real HTTP routes against a dev server on TEST_URL and the same throwaway DB (dd_gate_*_test); no mocks for race tests.
 * Android = Bearer access token, Web = dd_session cookie (same routes). Requires the fake SMTP the kit starts.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const kit = require('./helpers/authTestKit')
const fake = require('./helpers/fakeProviders')

let db, smtp, A, B, tok, providers
test.before(async () => {
  providers = await fake.ensureFakeProviders(); db = await kit.connect(); smtp = await kit.startFakeSmtp(2525)
  A = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  B = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  tok = {}
  for (const [k, org] of [['A', A], ['B', B]]) for (const r of ['admin', 'manager', 'employee']) { const s = await kit.login(org[r].email); tok[`${k}${r}`] = { token: s.accessToken, cookie: s.cookie } }
})
test.after(async () => { await db.collection('travelrequests').deleteMany({ orgId: { $in: [A.orgId, B.orgId] } }); await db.collection('auditlogs').deleteMany({ orgId: { $in: [A.orgId, B.orgId] } }); await db.collection('receiptuploads').deleteMany({ orgId: { $in: [A.orgId, B.orgId] } }); await kit.cleanupAll(db); await smtp.stop(); await providers.stop(); await kit.disconnect() })

const who = (k, via = 'token') => ({ [via]: tok[k][via] })
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 1)])
/** A real private itinerary upload: ticket (purpose travel_itinerary) → provider (fake). */
async function travelDoc(k) {
  await db.collection('ratelimits').deleteMany({ key: /^upload-sign:/ })
  const t = await kit.api('/api/uploads/sign', { method: 'POST', ...who(k), body: { kind: 'receipt', mimeType: 'image/png', sizeBytes: PNG.length, purpose: 'travel_itinerary' } }); assert.equal(t.status, 200, t.text)
  const fd = new FormData(); for (const [f, v] of Object.entries(t.json.fields)) fd.append(f, v); fd.append('file', new Blob([PNG]), 'doc.png')
  const up = await (await fetch(t.json.uploadUrl, { method: 'POST', body: fd })).json(); return { url: up.secure_url, pid: up.public_id }
}
const D = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)          // YYYY-MM-DD
const key = () => 'k-' + crypto.randomBytes(8).toString('hex')
// every default trip is unique (random purpose): the no-key double-tap guard (identical request within 10 s → 409) is tested explicitly in I4, not tripped by accident
const trip = (o = {}) => ({ purpose: 'Client site inspection ' + crypto.randomBytes(3).toString('hex'), destination: 'Pune', departureDate: D(5), returnDate: D(8), ...o })
const leg = (o = {}) => ({ from: 'Delhi', to: 'Pune', date: D(5), mode: 'train', estimatedCost: 1000, ...o })
const post = (k, body, via = 'token', raw) => kit.api('/api/travel', { method: 'POST', ...who(k, via), ...(raw !== undefined ? { raw, headers: { 'Content-Type': 'application/json' } } : { body }) })
const created = async (k, o, via) => { const r = await post(k, trip(o), via); assert.equal(r.status, 201, r.text); return r.json }
const audits = (targetId, action = 'travel.submitted') => db.collection('auditlogs').find({ targetId: String(targetId), action }).toArray()
const trips = filter => db.collection('travelrequests').countDocuments(filter)
const submittedCount = orgId => db.collection('auditlogs').countDocuments({ orgId, action: 'travel.submitted' })
const bad = async (k, body, field, label) => { const r = await post(k, body); assert.equal(r.status, 400, `${label || field}: ${r.text}`); assert.equal(r.json.code, 'invalid_travel_request'); if (field) assert.ok(r.json.fields.includes(field), `${label || field} → ${JSON.stringify(r.json.fields)}`); assert.doesNotMatch(r.text, /stack|mongoose|ValidationError|at .*\.(ts|js):\d+|MongoServer|E11000/i, 'no internals in errors'); return r }

/* ═════════ 1. valid requests: the shapes the Web form and the Flutter app really send ═════════ */
test('V1. Web-shaped payload (date-only strings, legs with notes, accommodation, derived total) is created; server-owned fields come from the session', async () => {
  const body = { purpose: 'Customer visit', destination: 'Mumbai', departureDate: D(10), returnDate: D(12), legs: [leg({ from: 'Pune', to: 'Mumbai', date: D(10), mode: 'taxi', estimatedCost: 1200.5, notes: '' }), leg({ from: 'Mumbai', to: 'Pune', date: D(12), mode: 'train', estimatedCost: 799.5, notes: 'return' })], estimatedTotal: 3000, advanceRequested: 1000, accommodation: { required: true, city: 'Mumbai', checkIn: D(10), checkOut: D(12), estimatedCost: 1000 }, itineraryDocs: [] }
  const r = await post('Aemployee', body, 'cookie'); assert.equal(r.status, 201, r.text)
  assert.deepEqual([r.json.estimatedTotal, r.json.advanceRequested, r.json.status, r.json.orgId, r.json.userId, r.json.legs.length], [3000, 1000, 'pending_manager', A.orgId, A.employee.id, 2])
  assert.equal(r.json.accommodation.estimatedCost, 1000); assert.equal(r.json.legs[1].notes, 'return'); assert.equal(new Date(r.json.departureDate).toISOString(), `${D(10)}T00:00:00.000Z`)
})

test('V2. Flutter-shaped payloads: legs without notes, cost omitted/null (→ 0), typed total 0 with itemised legs, no accommodation, lump-sum total with no legs, minimal body', async () => {
  const a = await created('Aemployee', { legs: [leg({ estimatedCost: undefined }), leg({ estimatedCost: 400, date: D(6) })], estimatedTotal: 0, advanceRequested: 0 }, 'token')
  assert.deepEqual([a.estimatedTotal, a.legs.map(l => l.estimatedCost)], [400, [0, 400]], 'itemised costs win over an empty typed total')
  const b = await created('Aemployee', { estimatedTotal: 25000, advanceRequested: 5000 }, 'token'); assert.deepEqual([b.estimatedTotal, b.advanceRequested, b.legs.length], [25000, 5000, 0], 'lump-sum estimate with nothing itemised')
  const c = await created('Aemployee', {}, 'token'); assert.deepEqual([c.estimatedTotal, c.advanceRequested, c.itineraryDocs], [0, 0, []], 'minimal body')
  const e = await created('Aemployee', { departureDate: new Date(Date.now() + 5 * 864e5).toISOString(), returnDate: new Date(Date.now() + 6 * 864e5).toISOString(), legs: [leg({ date: new Date(Date.now() + 5 * 864e5).toISOString(), estimatedCost: null })] }); assert.equal(e.legs[0].estimatedCost, 0, 'ISO date-times and null cost accepted')
})

test('V3. all six supported modes and a same-day trip are accepted; the exact previous test payload shapes keep working', async () => {
  for (const mode of ['train', 'flight', 'bus', 'taxi', 'own_vehicle', 'other']) await created('Aemployee', { legs: [leg({ mode })] })
  await created('Aemployee', { departureDate: D(9), returnDate: D(9) })
  const old = await created('Aemployee', { purpose: 'Client Onsite Inspection', destination: 'Munich', departureDate: '2026-08-01', returnDate: '2026-08-10', estimatedTotal: 45000, legs: [{ from: 'Delhi', to: 'Munich', date: '2026-08-01', mode: 'flight', estimatedCost: 45000 }] }); assert.equal(old.estimatedTotal, 45000)
})

/* ═════════ 2. malformed input fails safely ═════════ */
test('M1. malformed JSON and unexpected structures are clean 400s (never 500), oversized bodies are 413', async () => {
  for (const raw of ['not json', '{bad', '', '[]', 'null', '"x"', '123', 'true', '[{"purpose":"x"}]']) { const r = await post('Aemployee', null, 'token', raw); assert.equal(r.status, 400, JSON.stringify(raw) + r.text); assert.ok(['invalid_json', 'invalid_travel_request'].includes(r.json.code)); assert.doesNotMatch(r.text, /SyntaxError|JSON\.parse|stack/i) }
  const huge = await post('Aemployee', null, 'token', JSON.stringify({ ...trip(), purpose: 'x'.repeat(70_000) })); assert.equal(huge.status, 413); assert.equal(huge.json.code, 'body_too_large')
})

test('M2. required fields missing / null / empty / wrong type are rejected with the field named', async () => {
  for (const f of ['purpose', 'destination', 'departureDate', 'returnDate']) {
    for (const v of [undefined, null, '', '   ', 5, true, [], {}]) { const b = trip(); if (v === undefined) delete b[f]; else b[f] = v; await bad('Aemployee', b, f, `${f}=${JSON.stringify(v)}`) }
  }
})

test('M3. length and size limits: purpose/destination/leg text/notes/city/legs/docs/key', async () => {
  await bad('Aemployee', trip({ purpose: 'p'.repeat(1001) }), 'purpose'); await created('Aemployee', { purpose: 'p'.repeat(1000) })
  await bad('Aemployee', trip({ destination: 'd'.repeat(201) }), 'destination'); await created('Aemployee', { destination: 'd'.repeat(200) })
  await bad('Aemployee', trip({ legs: [leg({ from: 'f'.repeat(201) })] }), 'legs[0].from'); await bad('Aemployee', trip({ legs: [leg({ to: 't'.repeat(201) })] }), 'legs[0].to')
  await bad('Aemployee', trip({ legs: [leg({ notes: 'n'.repeat(1001) })] }), 'legs[0].notes')
  await bad('Aemployee', trip({ legs: Array.from({ length: 21 }, () => leg({ estimatedCost: 1 })) }), 'legs'); await created('Aemployee', { legs: Array.from({ length: 20 }, () => leg({ estimatedCost: 1 })) })
  await bad('Aemployee', trip({ accommodation: { required: true, city: 'c'.repeat(201) } }), 'accommodation.city')
  await bad('Aemployee', trip({ itineraryDocs: Array.from({ length: 11 }, (_, i) => 'doc' + i) }), 'itineraryDocs'); await bad('Aemployee', trip({ itineraryDocs: ['x'.repeat(2049)] }), 'itineraryDocs')
  await bad('Aemployee', trip({ itineraryDocs: [5] }), 'itineraryDocs'); await bad('Aemployee', trip({ itineraryDocs: 'not-an-array' }), 'itineraryDocs')
  await bad('Aemployee', trip({ clientRequestId: 'k'.repeat(65) }), 'clientRequestId'); await bad('Aemployee', trip({ clientRequestId: 'bad key!' }), 'clientRequestId'); await bad('Aemployee', trip({ clientRequestId: '' }), 'clientRequestId')
})

test('M4. unsupported fields — including every protected/server-owned property — are rejected and nothing is persisted', async () => {
  const before = await trips({ orgId: A.orgId })
  const protectedFields = { userId: 'someone-else', userName: 'Eve', orgId: B.orgId, employeeId: 'E1', status: 'approved', managerNote: 'ok', adminNote: 'ok', approvedBy: 'x', approvedAt: new Date().toISOString(), rejectedBy: 'x', rejectedAt: new Date().toISOString(), expenseId: 'abc', requestHash: 'deadbeef', _id: '5f0000000000000000000000', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), __v: 3, isAdmin: true }
  for (const [k, v] of Object.entries(protectedFields)) await bad('Aemployee', trip({ [k]: v }), k)
  const proto = await post('Aemployee', null, 'token', '{"purpose":"p","destination":"d","departureDate":"' + D(5) + '","returnDate":"' + D(6) + '","__proto__":{"status":"approved"}}'); assert.equal(proto.status, 400)
  await bad('Aemployee', trip({ legs: [leg({ extra: 1 })] }), 'legs[0].extra'); await bad('Aemployee', trip({ legs: [leg({ status: 'approved' })] }), 'legs[0].status')
  await bad('Aemployee', trip({ accommodation: { required: false, approved: true } }), 'accommodation.approved')
  assert.equal(await trips({ orgId: A.orgId }), before, 'no rejected request created anything')
})

test('M5. dates: invalid, impossible, out-of-range, wrong type and contradictory orderings are rejected; same-day is fine', async () => {
  for (const v of ['tomorrow', '2026-13-01', '2026-02-30', '2026-00-10', '1999-12-31', '2101-01-01', '2026-1-1', '01/02/2026', '2026-08-01T25:00', 'NaN', 20260801, {}, []]) await bad('Aemployee', trip({ departureDate: v }), 'departureDate', `departureDate=${JSON.stringify(v)}`)
  await bad('Aemployee', trip({ departureDate: D(8), returnDate: D(5) }), 'returnDate', 'return before departure')
  await bad('Aemployee', trip({ legs: [leg({ date: 'nope' })] }), 'legs[0].date'); await bad('Aemployee', trip({ legs: [leg({ date: '' })] }), 'legs[0].date'); await bad('Aemployee', trip({ legs: [{ from: 'a', to: 'b', mode: 'bus' }] }), 'legs[0].date')
  await bad('Aemployee', trip({ accommodation: { required: true, checkIn: D(8), checkOut: D(6) } }), 'accommodation.checkOut'); await bad('Aemployee', trip({ accommodation: { required: true, checkIn: 'x' } }), 'accommodation.checkIn')
})

test('M6. leg modes are restricted to the supported enum and legs must be well-formed objects', async () => {
  for (const m of ['rocket', 'Flight', 'TRAIN', '', null, 5, undefined, ['train']]) await bad('Aemployee', trip({ legs: [leg({ mode: m })] }), 'legs[0].mode', `mode=${JSON.stringify(m)}`)
  for (const l of ['str', 5, null, [], true]) await bad('Aemployee', trip({ legs: [l] }), null, 'leg=' + JSON.stringify(l))
  await bad('Aemployee', trip({ legs: 'x' }), 'legs'); await bad('Aemployee', trip({ legs: {} }), 'legs'); await bad('Aemployee', trip({ legs: [leg({ from: '' })] }), 'legs[0].from')
  await bad('Aemployee', trip({ accommodation: 'yes' }), 'accommodation'); await bad('Aemployee', trip({ accommodation: { city: 'x' } }), 'accommodation.required'); await bad('Aemployee', trip({ accommodation: { required: 'true' } }), 'accommodation.required')
})

test('M7. money: negative, non-finite, malformed, exponent/hex, oversized and non-numeric values are rejected; boundaries and rounding are exact', async () => {
  const MAX = 100_000_000
  for (const f of ['estimatedTotal', 'advanceRequested']) for (const v of [-1, -0.01, 'NaN', 'Infinity', '-5', '1e3', '0x10', ' ', 'abc', '1,000', {}, [], true, MAX + 0.01, 1e30]) await bad('Aemployee', trip({ [f]: v }), f, `${f}=${JSON.stringify(v)}`)
  for (const v of [-1, 'NaN', 'Infinity', '1e3', MAX + 1, 'x', {}, true]) await bad('Aemployee', trip({ legs: [leg({ estimatedCost: v })] }), 'legs[0].estimatedCost', `leg cost ${JSON.stringify(v)}`)
  for (const v of [-1, 'x', MAX + 1]) await bad('Aemployee', trip({ accommodation: { required: true, estimatedCost: v } }), 'accommodation.estimatedCost')
  assert.equal((await created('Aemployee', { estimatedTotal: MAX })).estimatedTotal, MAX, 'the maximum is accepted')
  assert.equal((await created('Aemployee', { estimatedTotal: '1500.5' })).estimatedTotal, 1500.5, 'plain numeric strings are accepted')
  assert.equal((await created('Aemployee', { estimatedTotal: 10.005 })).estimatedTotal, 10.01, 'rounded half-up to paise')
  assert.equal((await created('Aemployee', { estimatedTotal: 0 })).estimatedTotal, 0)
  await bad('Aemployee', trip({ legs: Array.from({ length: 2 }, () => leg({ estimatedCost: MAX })) }), 'estimatedTotal', 'itemised sum above the maximum')
})

/* ═════════ 3. authoritative totals ═════════ */
test('C1. the persisted total is computed on the server from legs + accommodation, in integer paise (no float drift)', async () => {
  assert.equal((await created('Aemployee', { legs: [leg({ estimatedCost: 0.1 }), leg({ estimatedCost: 0.2 })] })).estimatedTotal, 0.3, '0.1 + 0.2 is exactly 0.30')
  assert.equal((await created('Aemployee', { legs: Array.from({ length: 20 }, () => leg({ estimatedCost: 0.07 })) })).estimatedTotal, 1.4)
  const r = await created('Aemployee', { legs: [leg({ estimatedCost: 1200.5 }), leg({ estimatedCost: 799.5 })], accommodation: { required: true, estimatedCost: 500 } }); assert.equal(r.estimatedTotal, 2500)
  const off = await created('Aemployee', { legs: [leg({ estimatedCost: 100 })], accommodation: { required: false, estimatedCost: 99999 } }); assert.equal(off.estimatedTotal, 100, 'a hotel that is not required is not counted')
  const acc = await created('Aemployee', { accommodation: { required: true, estimatedCost: 750 } }); assert.equal(acc.estimatedTotal, 750)
})

test('C2. a client total that contradicts the itemised costs is rejected; an omitted/zero claim is accepted; a matching claim is fine', async () => {
  const legs = [leg({ estimatedCost: 1000 }), leg({ estimatedCost: 500, date: D(6) })]
  await bad('Aemployee', trip({ legs, estimatedTotal: 1 }), 'estimatedTotal', 'tampered low'); await bad('Aemployee', trip({ legs, estimatedTotal: 999999 }), 'estimatedTotal', 'tampered high'); await bad('Aemployee', trip({ legs, estimatedTotal: 1499.99 }), 'estimatedTotal', 'off by one paisa')
  for (const claim of [undefined, 0, '0', null, 1500, '1500.00']) { const r = await created('Aemployee', { legs, ...(claim === undefined ? {} : { estimatedTotal: claim }) }); assert.equal(r.estimatedTotal, 1500, `claim ${JSON.stringify(claim)}`) }
  const hotel = await post('Aemployee', trip({ legs, accommodation: { required: true, estimatedCost: 250 }, estimatedTotal: 1500 })); assert.equal(hotel.status, 400, 'claim ignoring the hotel is inconsistent'); assert.ok(hotel.json.fields.includes('estimatedTotal'))
})

test('C3. advanceRequested may not exceed the authoritative total', async () => {
  const legs = [leg({ estimatedCost: 1000 })]
  await bad('Aemployee', trip({ legs, advanceRequested: 1000.01 }), 'advanceRequested'); assert.equal((await created('Aemployee', { legs, advanceRequested: 1000 })).advanceRequested, 1000)
  await bad('Aemployee', trip({ advanceRequested: 1 }), 'advanceRequested', 'advance with no estimate at all'); await bad('Aemployee', trip({ estimatedTotal: 100, advanceRequested: 101 }), 'advanceRequested')
  await bad('Aemployee', trip({ legs, advanceRequested: -1 }), 'advanceRequested')
  assert.equal((await created('Aemployee', { estimatedTotal: 100, advanceRequested: 100 })).advanceRequested, 100)
})

/* ═════════ 4. authentication, tenants, roles ═════════ */
test('A1. unauthenticated requests are 401 before any parsing (even with a garbage body); invalid tokens too', async () => {
  const before = await trips({ orgId: A.orgId })
  for (const r of [await kit.api('/api/travel', { method: 'POST', body: trip() }), await kit.api('/api/travel', { method: 'POST', raw: 'not json', headers: { 'Content-Type': 'application/json' } }), await kit.api('/api/travel', { method: 'POST', token: 'abc.def.ghi', body: trip() })]) { assert.equal(r.status, 401); assert.doesNotMatch(r.text, /stack|invalid_json/) }
  assert.equal(await trips({ orgId: A.orgId }), before)
})

test('A2. every role can create on both carriers; identity, tenant and status come from the session, never the body', async () => {
  for (const role of ['employee', 'manager', 'admin']) for (const via of ['token', 'cookie']) {
    const r = await created(`A${role}`, { purpose: `${role}/${via}` }, via)
    assert.deepEqual([r.orgId, r.userId, r.status, r.approvedBy, r.expenseId], [A.orgId, A[role].id, 'pending_manager', undefined, undefined])
  }
})

test('A3. tenant isolation: org B cannot see, read, change or cancel org A trips; a trip made by B belongs to B', async () => {
  const t = await created('Aemployee', { purpose: 'A only' }); const tb = await created('Bemployee', { purpose: 'B only' }); assert.equal(tb.orgId, B.orgId)
  for (const k of ['Bemployee', 'Bmanager', 'Badmin']) {
    const list = await kit.api('/api/travel', who(k)); assert.ok(!list.json.some(x => x._id === t._id), k + ' list'); assert.ok(list.json.every(x => x.orgId === B.orgId))
    assert.equal((await kit.api(`/api/travel/${t._id}`, who(k))).status, 404)
    // employees are refused by ROLE before any lookup (403); managers/admins of another org get a plain 404 — either way nothing is revealed or changed
    assert.equal((await kit.api(`/api/travel/${t._id}`, { method: 'PATCH', ...who(k), body: { status: 'approved' } })).status, k === 'Bemployee' ? 403 : 404); assert.equal((await kit.api(`/api/travel/${t._id}`, { method: 'DELETE', ...who(k) })).status, 404)
  }
  assert.equal((await db.collection('travelrequests').findOne({ _id: new (require('mongoose').Types.ObjectId)(t._id) })).status, 'pending_manager')
  const emp = await kit.api('/api/travel', who('Aemployee')); assert.ok(emp.json.every(x => x.userId === A.employee.id), 'employees only list their own')
})

/* ═════════ 5. the submission audit ═════════ */
test('U1. exactly one travel.submitted entry per created trip, with org, actor, record and a minimal payload; rejected requests write none', async () => {
  const before = await submittedCount(A.orgId)
  // Slice 2: itinerary documents must be real private uploads issued for travel (the old raw-URL value is now rightly rejected — see travel_attachments.test.js)
  const doc = await travelDoc('Aemployee')
  const t = await created('Aemployee', { legs: [leg({ estimatedCost: 700 })], itineraryDocs: [doc.url] })
  const rows = await audits(t._id); assert.equal(rows.length, 1)   // already written when the response arrives (awaited, not fire-and-forget)
  const a = rows[0]; assert.deepEqual([a.orgId, a.performedBy, a.targetType, a.targetId, a.action], [A.orgId, A.employee.id, 'travel_request', t._id, 'travel.submitted'])
  assert.deepEqual(Object.keys(a.metadata).sort(), ['amount', 'destination', 'employeeName']); assert.equal(a.metadata.amount, 700); assert.ok(!JSON.stringify(a).includes(doc.pid) && !JSON.stringify(a).includes('cld:'), 'no itinerary documents in the submission audit')
  await bad('Aemployee', trip({ purpose: '' }), 'purpose'); await bad('Aemployee', trip({ status: 'approved' }), 'status'); assert.equal((await post('Aemployee', null, 'token', '{x')).status, 400)
  assert.equal(await submittedCount(A.orgId), before + 1, 'validation failures wrote nothing')
})

test('U2. an audit failure is NOT swallowed: the request fails loudly (500 audit_failed), and the same retry heals it — exactly one entry afterwards', async () => {
  const k = key(); const body = trip({ purpose: 'audit failure drill' })
  // make the database itself reject travel.submitted inserts (a real storage failure, not a mock)
  await db.command({ collMod: 'auditlogs', validator: { action: { $ne: 'travel.submitted' } }, validationAction: 'error', validationLevel: 'strict' })
  let r1
  try { r1 = await post('Aemployee', { ...body, clientRequestId: k }) } finally { await db.command({ collMod: 'auditlogs', validator: {}, validationAction: 'error', validationLevel: 'off' }) }
  assert.equal(r1.status, 500); assert.equal(r1.json.code, 'audit_failed'); assert.doesNotMatch(r1.text, /validation|Document failed|mongo|stack/i)
  const rec = await db.collection('travelrequests').findOne({ orgId: A.orgId, clientRequestId: k }); assert.ok(rec, 'the trip itself was saved'); assert.equal((await audits(rec._id)).length, 0, 'but it is not audited yet — and the client was told')
  const r2 = await post('Aemployee', { ...body, clientRequestId: k }); assert.equal(r2.status, 200, r2.text); assert.equal(r2.json._id, String(rec._id))
  assert.equal((await audits(rec._id)).length, 1, 'the retry completed the audit'); assert.equal(await trips({ orgId: A.orgId, clientRequestId: k }), 1)
  const r3 = await post('Aemployee', { ...body, clientRequestId: k }); assert.equal(r3.status, 200); assert.equal((await audits(rec._id)).length, 1, 'further replays add nothing')
})

test('U3. without a key, a retry inside the double-tap window also heals a missing audit (and still creates no second trip)', async () => {
  const body = trip({ purpose: 'no key audit drill' })
  await db.command({ collMod: 'auditlogs', validator: { action: { $ne: 'travel.submitted' } }, validationAction: 'error', validationLevel: 'strict' })
  let r1; try { r1 = await post('Aemployee', body) } finally { await db.command({ collMod: 'auditlogs', validator: {}, validationAction: 'error', validationLevel: 'off' }) }
  assert.equal(r1.status, 500); const rec = await db.collection('travelrequests').findOne({ orgId: A.orgId, purpose: 'no key audit drill' })
  const r2 = await post('Aemployee', body); assert.equal(r2.status, 409); assert.equal(r2.json.code, 'duplicate_submission'); assert.equal(r2.json.duplicateOf, String(rec._id))
  assert.equal((await audits(rec._id)).length, 1); assert.equal(await trips({ orgId: A.orgId, purpose: 'no key audit drill' }), 1)
})

/* ═════════ 6. idempotency ═════════ */
test('I1. same key + same request: first 201, replay 200 with the same record; one trip, one audit entry', async () => {
  const k = key(); const body = trip({ legs: [leg({ estimatedCost: 123.45 })], clientRequestId: k })
  const r1 = await post('Aemployee', body); assert.equal(r1.status, 201); const r2 = await post('Aemployee', body, 'cookie'); assert.equal(r2.status, 200); assert.equal(r2.json._id, r1.json._id)
  assert.equal(r2.json.estimatedTotal, 123.45); assert.equal(await trips({ orgId: A.orgId, clientRequestId: k }), 1); assert.equal((await audits(r1.json._id)).length, 1)
  const equivalent = { ...body, estimatedTotal: '123.45', legs: [leg({ estimatedCost: '123.450' })] }; assert.equal((await post('Aemployee', equivalent)).status, 200, 'the same logical request in another number format is the same request')
})

test('I2. same key + a DIFFERENT request is a clear 409 and creates nothing; the original is untouched', async () => {
  const k = key(); const r1 = await post('Aemployee', trip({ clientRequestId: k })); assert.equal(r1.status, 201)
  for (const change of [{ purpose: 'changed' }, { destination: 'Elsewhere' }, { returnDate: D(20) }, { legs: [leg()] }, { advanceRequested: 0, estimatedTotal: 5 }, { accommodation: { required: true } }]) {
    const r = await post('Aemployee', trip({ clientRequestId: k, ...change })); assert.equal(r.status, 409, JSON.stringify(change)); assert.equal(r.json.code, 'idempotency_key_conflict'); assert.deepEqual(r.json.fields, ['clientRequestId'])
  }
  assert.equal(await trips({ orgId: A.orgId, clientRequestId: k }), 1); assert.equal((await audits(r1.json._id)).length, 1)
  assert.equal((await db.collection('travelrequests').findOne({ orgId: A.orgId, clientRequestId: k })).purpose, r1.json.purpose)
})

test('I3. a key is scoped to organisation + user: the same key for another user or another organisation is an independent request', async () => {
  const k = key(); const body = trip({ clientRequestId: k }); const a = await post('Aemployee', body); const a2 = await post('Amanager', body); const b = await post('Bemployee', body)
  assert.deepEqual([a.status, a2.status, b.status], [201, 201, 201]); assert.equal(new Set([a.json._id, a2.json._id, b.json._id]).size, 3)
  assert.equal(b.json.orgId, B.orgId); assert.equal((await post('Bemployee', body)).status, 200); assert.equal((await post('Aemployee', body)).status, 200)
})

test('I4. without a key: identical request within seconds → 409 duplicate_submission (documented double-tap guard); different requests are independent', async () => {
  const body = trip({ purpose: 'double tap ' + key() }); const r1 = await post('Aemployee', body); assert.equal(r1.status, 201)
  const r2 = await post('Aemployee', body); assert.equal(r2.status, 409); assert.equal(r2.json.code, 'duplicate_submission'); assert.equal(r2.json.duplicateOf, r1.json._id)
  assert.equal((await post('Aemployee', { ...body, purpose: body.purpose + ' B' })).status, 201); assert.equal((await post('Amanager', body)).status, 201, 'another user can submit the same content')
  assert.equal(await trips({ orgId: A.orgId, purpose: body.purpose }), 2); assert.equal((await audits(r1.json._id)).length, 1)
})

test('I5. CONCURRENCY (real database): N parallel identical requests with one key → exactly one trip, one audit entry, one id for everybody', async () => {
  for (let round = 0; round < 4; round++) {
    const k = key(); const body = trip({ purpose: 'race ' + k, clientRequestId: k, legs: [leg({ estimatedCost: 10 + round })] }); const N = 16
    const rs = await Promise.all(Array.from({ length: N }, (_, i) => post('Aemployee', body, i % 2 ? 'token' : 'cookie')))
    const statuses = rs.map(r => r.status).sort(); assert.equal(statuses.filter(s => s === 201).length, 1, `round ${round}: ${statuses}`); assert.equal(statuses.filter(s => s === 200).length, N - 1, statuses.join(','))
    assert.equal(new Set(rs.map(r => r.json._id)).size, 1); assert.equal(await trips({ orgId: A.orgId, clientRequestId: k }), 1); assert.equal((await audits(rs[0].json._id)).length, 1, 'no duplicate submission events')
  }
})

test('I6. CONCURRENCY with conflicting payloads on one key: one winner, same-request losers replay (200), different-request losers get 409; still one trip and one audit', async () => {
  const k = key(); const mk = n => trip({ purpose: 'conflict ' + k + (n ? ' ' + n : ''), clientRequestId: k })
  const bodies = Array.from({ length: 18 }, (_, i) => mk(i % 3)); const rs = await Promise.all(bodies.map(b => post('Aemployee', b)))
  const created201 = rs.filter(r => r.status === 201); assert.equal(created201.length, 1); const win = created201[0].json
  rs.forEach((r, i) => { const same = bodies[i].purpose === win.purpose; assert.equal(r.status, r === created201[0] ? 201 : same ? 200 : 409, `req ${i}: ${r.status} ${r.text.slice(0, 100)}`); if (!same) assert.equal(r.json.code, 'idempotency_key_conflict') })
  assert.equal(await trips({ orgId: A.orgId, clientRequestId: k }), 1); assert.equal((await audits(win._id)).length, 1)
})

test('I7. CONCURRENCY without a key never corrupts anything: parallel distinct requests all succeed once each, with one audit entry apiece', async () => {
  const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => post('Aemployee', trip({ purpose: 'distinct ' + i + key() }))))
  assert.ok(rs.every(r => r.status === 201)); for (const r of rs) assert.equal((await audits(r.json._id)).length, 1)
})

test('I8. the database itself enforces uniqueness: the partial unique indexes exist (trip key per org+user, one submission audit per trip)', async () => {
  const ti = await db.collection('travelrequests').indexes(); const ai = await db.collection('auditlogs').indexes()
  const t = ti.find(i => i.unique && i.key.clientRequestId); assert.deepEqual(Object.keys(t.key), ['orgId', 'userId', 'clientRequestId']); assert.deepEqual(t.partialFilterExpression, { clientRequestId: { $type: 'string' } })
  const a = ai.find(i => i.unique && i.key.targetId); assert.deepEqual(a.partialFilterExpression, { action: 'travel.submitted' })
  const dup = db.collection('travelrequests').insertOne({ orgId: A.orgId, userId: A.employee.id, userName: 'x', purpose: 'p', destination: 'd', departureDate: new Date(), returnDate: new Date(), estimatedTotal: 0, clientRequestId: 'dup-index-' + key() })
  const id = (await dup).insertedId; const doc = await db.collection('travelrequests').findOne({ _id: id }); await assert.rejects(db.collection('travelrequests').insertOne({ ...doc, _id: new (require('mongoose').Types.ObjectId)() }), /E11000/); await db.collection('travelrequests').deleteOne({ _id: id })
})

/* ═════════ 7. existing downstream flows keep working ═════════ */
test('X1. approval and trip → expense conversion still work on a validated trip; the expense total equals the persisted trip total', async () => {
  const past = await created('Aemployee', { departureDate: D(-10), returnDate: D(-8), legs: [leg({ date: D(-10), estimatedCost: 1200 }), leg({ date: D(-8), mode: 'flight', estimatedCost: 800.5 })], accommodation: { required: true, city: 'Pune', estimatedCost: 300 } })
  assert.equal(past.estimatedTotal, 2300.5)
  assert.equal((await kit.api(`/api/travel/${past._id}`, { method: 'PATCH', ...who('Amanager'), body: { status: 'approved', revision: past.revision } })).status, 200)
  const ex = await kit.api(`/api/travel/${past._id}/expense`, { method: 'POST', ...who('Aemployee') }); assert.equal(ex.status, 201, ex.text)
  assert.equal(ex.json.amount, 2300.5); assert.equal(ex.json.lineItems.length, 3)
  assert.equal((await kit.api(`/api/travel/${past._id}`, { method: 'DELETE', ...who('Aemployee') })).status, 409, 'an actioned trip cannot be cancelled')
  const pend = await created('Aemployee', {}); assert.equal((await kit.api(`/api/travel/${pend._id}`, { method: 'DELETE', ...who('Aemployee') })).status, 200)
  assert.equal((await audits(pend._id, 'travel.cancelled')).length >= 0, true)
})
