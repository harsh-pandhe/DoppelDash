/**
 * Travel Slice 2 — itinerary attachments: a verifiable private-attachment contract on every write path, and a safe trip → expense conversion.
 * Real HTTP routes, the throwaway DB of the dev server (dd_gate_*_test) and the LOCAL FAKE storage provider (proves OUR enforcement, not Cloudinary's).
 * Requires the dev-server env described in receipt_ocr_vertical.test.js (fake provider, CRON_SECRET, RECEIPT_CLEANUP_APPLY=1).
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const mongoose = require('mongoose')
const kit = require('./helpers/authTestKit')
const fake = require('./helpers/fakeProviders')

let db, smtp, providers, A, B, F, tok
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 1)])
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF')
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)])
const MIME = { png: 'image/png', pdf: 'application/pdf', jpg: 'image/jpeg' }
const BYTES = { png: PNG, pdf: PDF, jpg: JPG }
const oid = s => new mongoose.Types.ObjectId(s)

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
test.beforeEach(async () => { await fake.control.reset(); await db.collection('ratelimits').deleteMany({ key: /^(upload-sign|travel-doc|rms-receipt):/ }) })

const who = (k, via = 'token') => ({ [via]: tok[k][via] })
const D = n => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10)
const key = () => 'k-' + crypto.randomBytes(8).toString('hex')
const trip = (o = {}) => ({ purpose: 'Itinerary test ' + crypto.randomBytes(3).toString('hex'), destination: 'Pune', departureDate: D(5), returnDate: D(8), ...o })
const post = (k, body, via = 'token') => kit.api('/api/travel', { method: 'POST', ...who(k, via), body })
const sign = (k, o = {}, via = 'token') => kit.api('/api/uploads/sign', { method: 'POST', ...who(k, via), body: { kind: 'receipt', mimeType: MIME.png, sizeBytes: 100, purpose: 'travel_itinerary', ...o } })
async function put(ticket, bytes) { const fd = new FormData(); for (const [f, v] of Object.entries(ticket.fields)) fd.append(f, v); fd.append('file', new Blob([bytes]), 'f.bin'); const r = await fetch(ticket.uploadUrl, { method: 'POST', body: fd }); return { status: r.status, json: await r.json().catch(() => null) } }
/** One real private upload issued for `purpose` (default: travel_itinerary). */
async function doc(k, { ext = 'png', purpose = 'travel_itinerary', via = 'token' } = {}) {   // purpose: null → omit it (server default: expense_receipt)
  const t = await sign(k, { mimeType: MIME[ext], sizeBytes: BYTES[ext].length, purpose: purpose === null ? undefined : purpose }, via); assert.equal(t.status, 200, t.text)
  const up = await put(t.json, BYTES[ext]); assert.equal(up.status, 200, JSON.stringify(up.json))
  const pid = up.json.public_id; return { url: up.json.secure_url, pid, ref: `cld:${pid}.${ext}`, ext, ticket: t.json }
}
const created = async (k, docs, extra = {}, via) => { const r = await post(k, trip({ itineraryDocs: docs.map(d => d.url), ...extra }), via); assert.equal(r.status, 201, r.text); return r.json }
const row = pid => db.collection('receiptuploads').findOne({ publicId: pid })
const dbTrip = id => db.collection('travelrequests').findOne({ _id: oid(id) })
const trips = f => db.collection('travelrequests').countDocuments(f)
// Audit rows are written fire-and-forget after the response (CI failure on 3069026d: the row had not landed yet). Wait for the first row, then settle briefly so a DUPLICATE would also show.
const audits = async (id, action) => {
  const find = () => db.collection('auditlogs').find({ targetId: String(id), action }).toArray()
  for (let i = 0; i < 60 && !(await find()).length; i++) await new Promise(r => setTimeout(r, 50))
  await new Promise(r => setTimeout(r, 150))
  return find()
}
const stored = async pid => (await fake.control.state()).files.some(f => f.startsWith(pid + '.'))
const NO_INTERNALS = /cld:|doppeldash\/|testcloud|127\.0\.0\.1|signature|api_key|authenticated\/|stack|mongoose|E11000|MongoServer/i
const bad = async (k, docs, field, label, status = 400) => { const before = await trips({}); const r = await post(k, trip({ itineraryDocs: docs })); assert.equal(r.status, status, `${label}: ${r.text}`); if (field) assert.ok((r.json.fields || []).includes(field), `${label}: ${JSON.stringify(r.json)}`); assert.doesNotMatch(r.text, NO_INTERNALS, label + ' leaks internals'); assert.equal(await trips({}), before, label + ': nothing created'); return r }
const unclaimed = async d => { const r = await row(d.pid); assert.ok(r); assert.ok(!r.claimedBy, 'file must not stay claimed'); return r }
const past = (o = {}) => trip({ departureDate: D(-10), returnDate: D(-8), ...o })
async function approved(k, docs, extra = {}) { const t = await post(k, past({ itineraryDocs: docs.map(d => d.url), ...extra })); assert.equal(t.status, 201, t.text); const a = await kit.api(`/api/travel/${t.json._id}`, { method: 'PATCH', ...who('Amanager'), body: { status: 'approved', revision: t.json.revision } }); assert.equal(a.status, 200, a.text); return t.json }

/* ═════════ 1. ticket purpose ═════════ */
test('P1. tickets record WHAT they are for and WHO they were issued to; the purpose is validated; default is expense_receipt', async () => {
  const t = await sign('Aemployee'); const r = await row(`${t.json.fields.folder}/${t.json.fields.public_id}`)
  assert.deepEqual([r.purpose, r.userId, r.orgId, r.state], ['travel_itinerary', A.employee.id, A.orgId, 'issued'])
  const d = await sign('Aemployee', { purpose: undefined }); assert.equal((await row(`${d.json.fields.folder}/${d.json.fields.public_id}`)).purpose, 'expense_receipt')
  for (const p of ['other', '', null, 5, ['travel_itinerary'], {}]) { const x = await sign('Aemployee', { purpose: p }); assert.equal(x.status, 400, JSON.stringify(p)); assert.equal(x.json.code, 'invalid_purpose') }
  for (const kind of ['card', 'document', 'image']) assert.equal((await sign('Aemployee', { kind })).status, 400, kind + ' + purpose')
})

/* ═════════ 2. valid attachments ═════════ */
test('V1. valid PNG, PDF and JPEG itinerary documents: accepted, stored as private refs, claimed exclusively, audited once, shown only as authenticated paths', async () => {
  const ds = [await doc('Aemployee', { ext: 'png' }), await doc('Aemployee', { ext: 'pdf' }), await doc('Aemployee', { ext: 'jpg' })]
  const t = await created('Aemployee', ds)
  assert.deepEqual(t.itineraryDocs, [`/api/travel/${t._id}/itinerary/0.png`, `/api/travel/${t._id}/itinerary/1.pdf`, `/api/travel/${t._id}/itinerary/2.jpg`])
  assert.doesNotMatch(JSON.stringify(t), NO_INTERNALS)
  const s = await dbTrip(t._id); assert.deepEqual(s.itineraryDocs, ds.map(d => d.ref))
  for (const d of ds) { const r = await row(d.pid); assert.deepEqual([r.state, r.claimedBy, r.purpose, r.userId], ['attached', t._id, 'travel_itinerary', A.employee.id]) }
  assert.equal((await audits(t._id, 'travel.submitted')).length, 1); const aa = await audits(t._id, 'travel.attachments_added'); assert.equal(aa.length, 1); assert.deepEqual(aa[0].metadata, { count: 3 })
  assert.doesNotMatch(JSON.stringify(aa[0]), NO_INTERNALS)
  for (const via of ['token', 'cookie']) { const l = await kit.api('/api/travel', who('Aemployee', via)); const g = l.json.find(x => x._id === t._id); assert.deepEqual(g.itineraryDocs, t.itineraryDocs); assert.doesNotMatch(l.text, /cld:|doppeldash\/|testcloud|127\.0\.0\.1/) }
  const one = await kit.api(`/api/travel/${t._id}`, who('Amanager')); assert.deepEqual(one.json.itineraryDocs, t.itineraryDocs)
})

test('V2. the authenticated retrieval route serves the stored file with the verified type, never the URL suffix; PDFs download; responses are no-store', async () => {
  const png = await doc('Aemployee', { ext: 'png' }), pdf = await doc('Aemployee', { ext: 'pdf' }); const t = await created('Aemployee', [png, pdf])
  const get = async (n, k = 'Aemployee', via = 'token') => { const r = await fetch(`${kit.BASE_URL}/api/travel/${t._id}/itinerary/${n}`, { headers: { ...(via === 'token' ? { Authorization: `Bearer ${tok[k].token}` } : { Cookie: tok[k].cookie }), 'x-forwarded-for': kit.freshIp() } }); return { status: r.status, ct: r.headers.get('content-type'), cd: r.headers.get('content-disposition'), cc: r.headers.get('cache-control'), buf: Buffer.from(await r.arrayBuffer()), text: null } }
  const a = await get('0.png'); assert.equal(a.status, 200); assert.equal(a.ct, 'image/png'); assert.deepEqual(a.buf, PNG); assert.match(a.cc, /no-store/)
  for (const sfx of ['0', '0.pdf', '0.html', '0.exe']) assert.equal((await get(sfx)).ct, 'image/png', 'suffix ' + sfx)
  const p = await get('1.pdf', 'Aemployee', 'cookie'); assert.equal(p.ct, 'application/pdf'); assert.match(p.cd, /^attachment/); assert.deepEqual(p.buf, PDF)
  for (const k of ['Amanager', 'Aadmin']) assert.equal((await get('0.png', k)).status, 200, k)
})

test('V3. retrieval authorization: anonymous 401, another employee 403, another organisation 404, bad ids/indexes/legacy values 404', async () => {
  const d = await doc('Aemployee'); const t = await created('Aemployee', [d])
  const raw = (id, file, headers) => fetch(`${kit.BASE_URL}/api/travel/${id}/itinerary/${file}`, { headers: { 'x-forwarded-for': kit.freshIp(), ...headers } })
  const h = k => ({ Authorization: `Bearer ${tok[k].token}` })
  assert.equal((await raw(t._id, '0.png', {})).status, 401); assert.equal((await raw(t._id, '0.png', { Authorization: 'Bearer abc.def.ghi' })).status, 401)
  // a second employee of org A has no access to someone else's trip: use the manager's own trip
  const mine = await created('Amanager', [await doc('Amanager')]); assert.equal((await raw(mine._id, '0.png', h('Aemployee'))).status, 403)
  for (const k of ['Bemployee', 'Bmanager', 'Badmin']) assert.equal((await raw(t._id, '0.png', h(k))).status, 404, k)
  for (const [id, f] of [['zzzz', '0.png'], [t._id, '1.png'], [t._id, '999'], [t._id, '-1'], [t._id, 'abc'], [t._id, '0.png/../x'], ['5f0000000000000000000000', '0.png']]) assert.equal((await raw(id, encodeURIComponent(f), h('Aemployee'))).status, 404, `${id}/${f}`)
  const legacy = await db.collection('travelrequests').insertOne({ orgId: A.orgId, userId: A.employee.id, userName: 'x', purpose: 'legacy', destination: 'd', departureDate: new Date(), returnDate: new Date(), estimatedTotal: 0, itineraryDocs: ['https://legacy.example.test/a.pdf'] })
  const lr = await raw(String(legacy.insertedId), '0', h('Aemployee')); assert.equal(lr.status, 404); assert.equal((await lr.json()).code, 'legacy_attachment')
})

/* ═════════ 3. rejected values ═════════ */
test('R1. arbitrary strings, URLs, paths, raw references and wrong shapes are rejected — nothing is created or claimed', async () => {
  const d = await doc('Aemployee'); const pubUrl = `${fake.ENV.CLOUDINARY_DELIVERY_BASE}/testcloud/image/upload/v1/doppeldash/${A.orgId}/documents/${crypto.randomBytes(16).toString('hex')}.png`
  const cases = [
    ['plain text', 'hello world'], ['raw https URL', 'https://evil.example.test/doc.pdf'], ['http URL', 'http://example.test/a.png'], ['public provider URL (tenant-foldered)', pubUrl],
    ['public provider URL (legacy shape)', `${fake.ENV.CLOUDINARY_DELIVERY_BASE}/testcloud/image/upload/v1/sample.png`], ['absolute path', '/etc/passwd'], ['relative traversal', '../../etc/passwd'], ['api path', `/api/rms/5f0000000000000000000000/receipt/0.png`],
    ['data URI', 'data:image/png;base64,AAAA'], ['javascript URI', 'javascript:alert(1)'], ['raw cld ref of a REAL upload', d.ref], ['raw cld ref, forged', `cld:doppeldash/${A.orgId}/receipts/${crypto.randomBytes(16).toString('hex')}.png`],
    ['cld ref, other tenant', `cld:doppeldash/${B.orgId}/receipts/${crypto.randomBytes(16).toString('hex')}.png`], ['real URL + query', d.url + '?x=1'], ['real URL + fragment', d.url + '#f'], ['real URL, extension swapped', d.url.replace(/\.png$/, '.pdf')],
    ['real URL, traversal', d.url.replace('/v1/', '/v1/../')], ['whitespace', '   '], ['unicode confusable', d.url.replace('http', 'ｈttp')],
  ]
  for (const [label, v] of cases) await bad('Aemployee', [v], 'itineraryDocs[0]', label)
  for (const [label, v] of [['null', null], ['number', 5], ['object', { url: d.url }], ['array', [d.url]], ['boolean', true]]) await bad('Aemployee', [v], 'itineraryDocs', label)
  await unclaimed(d)
})

test('R2. array rules: >10 entries, duplicates, empty/oversized strings, non-arrays; a valid doc beside an invalid one is NOT consumed', async () => {
  const d = await doc('Aemployee'), e = await doc('Aemployee')
  await bad('Aemployee', Array.from({ length: 11 }, (_, i) => 'x' + i), 'itineraryDocs', '11 entries'); await bad('Aemployee', [d.url, d.url], 'itineraryDocs', 'duplicate'); await bad('Aemployee', [''], 'itineraryDocs', 'empty'); await bad('Aemployee', ['x'.repeat(2049)], 'itineraryDocs', 'oversized')
  for (const v of ['not-an-array', {}, 5, true]) { const r = await post('Aemployee', trip({ itineraryDocs: v })); assert.equal(r.status, 400, JSON.stringify(v)); assert.ok(r.json.fields.includes('itineraryDocs')) }
  await bad('Aemployee', [d.url, 'garbage', e.url], 'itineraryDocs[1]', 'valid + invalid + valid'); await bad('Aemployee', [e.url, 'https://x.example.test/a.png'], 'itineraryDocs[1]', 'valid then URL')
  await unclaimed(d); await unclaimed(e)
  const t = await created('Aemployee', [d, e]); assert.equal(t.itineraryDocs.length, 2, 'the files are still usable after the rejected attempts')
  const bzDocs = [await doc('Aemployee')]; const bz = await post('Aemployee', trip({ itineraryDocs: [bzDocs[0].url], estimatedTotal: -5 })); assert.equal(bz.status, 400)   // other validation failure: no claim either
  assert.equal(await db.collection('receiptuploads').countDocuments({ orgId: A.orgId, claimedBy: { $exists: true }, publicId: { $in: [...bzDocs.map(x => x.pid)] } }), 0, 'a request that fails other validation claims nothing')
})

test('R3. tenant, user and purpose binding: other organisation, other user, receipt-purpose uploads are rejected; the owner still can use them', async () => {
  const d = await doc('Aemployee')
  await bad('Bemployee', [d.url], 'itineraryDocs[0]', 'other organisation'); await bad('Badmin', [d.url], 'itineraryDocs[0]', 'other organisation admin')
  await bad('Amanager', [d.url], 'itineraryDocs[0]', 'another user of the SAME organisation'); await bad('Aadmin', [d.url], 'itineraryDocs[0]', 'same-org admin')
  const rec = await doc('Aemployee', { purpose: null }); assert.equal((await row(rec.pid)).purpose, 'expense_receipt')
  await bad('Aemployee', [rec.url], 'itineraryDocs[0]', 'a receipt-purpose upload'); const rec2 = await doc('Aemployee', { purpose: 'expense_receipt' }); await bad('Aemployee', [rec2.url], 'itineraryDocs[0]', 'explicit expense_receipt')
  await unclaimed(d); await unclaimed(rec)
  assert.equal((await created('Aemployee', [d])).itineraryDocs.length, 1)
  const viaCookie = await doc('Amanager', { via: 'cookie' }); assert.equal((await created('Amanager', [viaCookie], {}, 'cookie')).itineraryDocs.length, 1)
})

test('R4. the reverse boundary: a travel file cannot be attached to an expense through the normal expense flow, and normal expense receipts still work', async () => {
  const d = await doc('Aemployee'); const body = { title: 'Taxi ' + key(), reason: 'client', amount: 100, startDate: new Date().toISOString() }
  const ex = await kit.api('/api/rms', { method: 'POST', ...who('Aemployee'), body: { ...body, receipts: [d.url] } }); assert.equal(ex.status, 400, ex.text); assert.equal(ex.json.code, 'attachment_rejected')
  assert.equal(await db.collection('expenses').countDocuments({ orgId: A.orgId, receipts: d.ref }), 0); await unclaimed(d)
  const ok = await doc('Aemployee', { purpose: null }); const e2 = await kit.api('/api/rms', { method: 'POST', ...who('Aemployee'), body: { ...body, title: body.title + 'b', receipts: [ok.url] } }); assert.equal(e2.status, 201, e2.text)
})

/* ═════════ 4. stored-state checks ═════════ */
test('S1. ineligible stored state is refused: rejected/deleting rows, deleted assets, missing or tampered manifest, wrong purpose or owner', async () => {
  const mk = async () => doc('Aemployee')
  const a = await mk(); await db.collection('receiptuploads').updateOne({ publicId: a.pid }, { $set: { state: 'rejected' } }); await bad('Aemployee', [a.url], 'itineraryDocs[0]', 'rejected row')
  const b = await mk(); await db.collection('receiptuploads').updateOne({ publicId: b.pid }, { $set: { state: 'deleting', leaseUntil: new Date(Date.now() + 3600e3) } }); await bad('Aemployee', [b.url], 'itineraryDocs[0]', 'deleting row')
  const c = await mk(); await db.collection('receiptuploads').deleteOne({ publicId: c.pid }); await bad('Aemployee', [c.url], 'itineraryDocs[0]', 'missing manifest row')
  const d = await mk(); await db.collection('receiptuploads').updateOne({ publicId: d.pid }, { $set: { purpose: 'expense_receipt' } }); await bad('Aemployee', [d.url], 'itineraryDocs[0]', 'purpose tampered')
  const e = await mk(); await db.collection('receiptuploads').updateOne({ publicId: e.pid }, { $set: { userId: A.manager.id } }); await bad('Aemployee', [e.url], 'itineraryDocs[0]', 'owner tampered')
  const f = await mk(); await db.collection('receiptuploads').updateOne({ publicId: f.pid }, { $set: { orgId: B.orgId } }); await bad('Aemployee', [f.url], 'itineraryDocs[0]', 'org tampered')
  const g = await mk(); await db.collection('receiptuploads').updateOne({ publicId: g.pid }, { $unset: { purpose: 1 } }); await bad('Aemployee', [g.url], 'itineraryDocs[0]', 'purpose removed')
  const h = await mk(); await fetch(`${fake.BASE}/__reset`); await bad('Aemployee', [h.url], 'itineraryDocs[0]', 'asset deleted at the provider')
})

test('S2. provider verification: oversize (Free plan), type mismatch and outage — refused, the bad file is rejected + deleted, nothing is claimed or created', async () => {
  // Free organisation, 6 MB asset injected under a valid ticket (a provider that does not enforce size)
  const t = await sign('Femployee', { sizeBytes: 100 }); const pid = `${t.json.fields.folder}/${t.json.fields.public_id}`
  await fetch(`${fake.BASE}/__inject`, { method: 'POST', body: JSON.stringify({ path: pid, ext: 'png', bytes: 6 * 1024 * 1024, type: 'authenticated' }) })
  const url = `${fake.ENV.CLOUDINARY_DELIVERY_BASE}/testcloud/image/authenticated/v1/${pid}.png`
  let r = await post('Femployee', trip({ itineraryDocs: [url] })); assert.equal(r.status, 413); assert.equal(r.json.code, 'attachment_too_large'); assert.equal((await row(pid)).state, 'rejected')
  assert.equal((await post('Femployee', trip({ itineraryDocs: [url] }))).status, 400, 'a rejected file never becomes usable'); assert.equal(await trips({ orgId: F.orgId }), 0)
  // type mismatch: PNG content under a PDF-declared ticket (provider not enforcing allowed_formats)
  const t2 = await sign('Aemployee', { mimeType: MIME.pdf }); const pid2 = `${t2.json.fields.folder}/${t2.json.fields.public_id}`
  await fetch(`${fake.BASE}/__inject`, { method: 'POST', body: JSON.stringify({ path: pid2, ext: 'png', bytes: 400, type: 'authenticated' }) })
  r = await post('Aemployee', trip({ itineraryDocs: [`${fake.ENV.CLOUDINARY_DELIVERY_BASE}/testcloud/image/authenticated/v1/${pid2}.png`] })); assert.equal(r.status, 400); assert.equal(r.json.code, 'attachment_type_mismatch'); assert.equal((await row(pid2)).state, 'rejected')
  for (let i = 0; i < 40 && await stored(pid2); i++) await new Promise(x => setTimeout(x, 50)); assert.equal(await stored(pid2), false, 'best-effort deletion ran')
  // outage: 503, nothing claimed, then it works again
  const d = await doc('Aemployee'); await fake.control.mode({ storage: { admin: 'error500' } })
  r = await post('Aemployee', trip({ itineraryDocs: [d.url] })); assert.equal(r.status, 503); assert.equal(r.json.code, 'attachment_verification_unavailable'); await unclaimed(d)
  await fake.control.mode({ storage: { admin: 'ok' } }); assert.equal((await created('Aemployee', [d])).itineraryDocs.length, 1)
})

/* ═════════ 5. exclusivity, idempotency, concurrency ═════════ */
test('E1. one file ↔ one trip: a second trip cannot take it (409), the first keeps it; a stale claim (holder never created) is released', async () => {
  const d = await doc('Aemployee'); const t1 = await created('Aemployee', [d])
  const r = await post('Aemployee', trip({ itineraryDocs: [d.url] })); assert.equal(r.status, 409); assert.equal(r.json.code, 'attachment_in_use'); assert.deepEqual(r.json.fields, ['itineraryDocs[0]'])
  assert.equal((await row(d.pid)).claimedBy, t1._id); assert.equal((await dbTrip(t1._id)).itineraryDocs[0], d.ref)
  const s = await doc('Aemployee'); await db.collection('receiptuploads').updateOne({ publicId: s.pid }, { $set: { claimedBy: '5f00000000000000000000aa', state: 'attached' } })
  assert.equal((await created('Aemployee', [s])).itineraryDocs.length, 1, 'a claim whose trip does not exist is stale and is taken over')
})

test('E2. idempotent replay with documents: 201 then 200, one trip, one submitted + one attachments_added audit, claims unchanged; conflicting reuse releases the loser’s files', async () => {
  const d = await doc('Aemployee'), e = await doc('Aemployee'); const k = key(); const body = trip({ itineraryDocs: [d.url], clientRequestId: k })
  const r1 = await post('Aemployee', body); assert.equal(r1.status, 201, r1.text); const r2 = await post('Aemployee', body, 'cookie'); assert.equal(r2.status, 200); assert.equal(r2.json._id, r1.json._id)
  assert.equal(await trips({ orgId: A.orgId, clientRequestId: k }), 1); assert.equal((await audits(r1.json._id, 'travel.submitted')).length, 1); assert.equal((await audits(r1.json._id, 'travel.attachments_added')).length, 1)
  const c = await post('Aemployee', { ...body, itineraryDocs: [e.url] }); assert.equal(c.status, 409); assert.equal(c.json.code, 'idempotency_key_conflict'); await unclaimed(e)
  assert.equal((await row(d.pid)).claimedBy, r1.json._id)
})

test('E3. CONCURRENCY: parallel trips racing for ONE file → exactly one wins, everyone else gets 409, one claim holder, one reference', async () => {
  for (let round = 0; round < 3; round++) {
    const d = await doc('Aemployee'); const rs = await Promise.all(Array.from({ length: 10 }, () => post('Aemployee', trip({ itineraryDocs: [d.url] }))))
    const s = rs.map(r => r.status).sort(); assert.equal(s.filter(x => x === 201).length, 1, `round ${round}: ${s}`); assert.equal(s.filter(x => x === 409).length, 9, s.join(','))
    const win = rs.find(r => r.status === 201).json; assert.equal((await row(d.pid)).claimedBy, win._id); assert.equal(await trips({ itineraryDocs: d.ref }), 1)
    assert.equal((await audits(win._id, 'travel.attachments_added')).length, 1)
  }
})

test('E4. CONCURRENCY with one key and documents: one trip, one claim, replays for identical requests; losers with different documents get 409 and release theirs', async () => {
  const k = key(); const d = await doc('Aemployee'), e = await doc('Aemployee'); const base = trip({ clientRequestId: k })
  const bodies = Array.from({ length: 12 }, (_, i) => ({ ...base, itineraryDocs: [(i % 3 === 0 ? e : d).url] })); const rs = await Promise.all(bodies.map(b => post('Aemployee', b)))
  const win = rs.filter(r => r.status === 201); assert.equal(win.length, 1, rs.map(r => r.status).join(',')); const w = win[0].json; const winnerDoc = w.itineraryDocs.length ? (await dbTrip(w._id)).itineraryDocs[0] : null
  const winD = winnerDoc === d.ref ? d : e, loseD = winD === d ? e : d
  rs.forEach((r, i) => { const same = bodies[i].itineraryDocs[0] === winD.url; assert.equal(r.status, r === win[0] ? 201 : same ? 200 : 409, `req ${i}`) })
  assert.equal(await trips({ orgId: A.orgId, clientRequestId: k }), 1); assert.equal((await row(winD.pid)).claimedBy, w._id); await unclaimed(loseD)
  assert.equal((await audits(w._id, 'travel.submitted')).length, 1); assert.equal((await audits(w._id, 'travel.attachments_added')).length, 1)
})

/* ═════════ 6. trip → expense conversion ═════════ */
test('C1. conversion transfers verified travel documents as private references: the expense serves them through the receipt proxy; the trip keeps its own copy; audit has counts only', async () => {
  const ds = [await doc('Aemployee', { ext: 'png' }), await doc('Aemployee', { ext: 'pdf' })]; const t = await approved('Aemployee', ds, { legs: [{ from: 'a', to: 'b', date: D(-9), mode: 'train', estimatedCost: 50 }] })
  const r = await kit.api(`/api/travel/${t._id}/expense`, { method: 'POST', ...who('Aemployee') }); assert.equal(r.status, 201, r.text)
  assert.ok(!('attachmentsExcluded' in r.json)); assert.deepEqual(r.json.receipts, [`/api/rms/${r.json._id}/receipt/0.png`, `/api/rms/${r.json._id}/receipt/1.pdf`]); assert.doesNotMatch(r.text, /cld:|doppeldash\/|testcloud/)
  const ex = await db.collection('expenses').findOne({ _id: oid(r.json._id) }); assert.deepEqual(ex.receipts, ds.map(d => d.ref)); assert.deepEqual((await dbTrip(t._id)).itineraryDocs, ds.map(d => d.ref))
  const img = await fetch(`${kit.BASE_URL}/api/rms/${r.json._id}/receipt/0.png`, { headers: { Authorization: `Bearer ${tok.Aemployee.token}`, 'x-forwarded-for': kit.freshIp() } }); assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png')
  const au = await audits(t._id, 'travel.attachments_converted'); assert.equal(au.length, 1); assert.deepEqual(au[0].metadata, { transferred: 2, excluded: 0, expenseId: r.json._id }); assert.doesNotMatch(JSON.stringify(au[0]), NO_INTERNALS)
  const again = await kit.api(`/api/travel/${t._id}/expense`, { method: 'POST', ...who('Aemployee') }); assert.equal(again.status, 200); assert.equal(again.json._id, r.json._id); assert.equal((await audits(t._id, 'travel.attachments_converted')).length, 1)
})

test('C2. MIXED legacy/forged data: only the verified document enters the expense; every other stored string stays on the trip, byte for byte; the exclusion is reported', async () => {
  const good = await doc('Aemployee'); const t = await approved('Aemployee', [good])
  const hex = () => crypto.randomBytes(16).toString('hex'); const other = await doc('Bemployee')                                       // a real file of ANOTHER tenant
  const rcpt = await doc('Aemployee', { purpose: null }); const heldElsewhere = await doc('Amanager'); await created('Amanager', [heldElsewhere])
  const weird = ['https://legacy.example.test/itinerary.pdf', 'javascript:alert(1)', other.ref, `cld:doppeldash/${A.orgId}/receipts/${hex()}.png`, rcpt.ref, heldElsewhere.ref, 'cld:doppeldash/x', '../../etc/passwd']
  await db.collection('travelrequests').updateOne({ _id: oid(t._id) }, { $set: { itineraryDocs: [good.ref, ...weird] } })
  const before = (await dbTrip(t._id)).itineraryDocs
  const r = await kit.api(`/api/travel/${t._id}/expense`, { method: 'POST', ...who('Aemployee') }); assert.equal(r.status, 201, r.text)
  assert.equal(r.json.attachmentsExcluded, weird.length); assert.equal(r.json.receipts.length, 1); assert.doesNotMatch(r.text, /legacy\.example|javascript|etc\/passwd|cld:/)
  const ex = await db.collection('expenses').findOne({ _id: oid(r.json._id) }); assert.deepEqual(ex.receipts, [good.ref], 'only the verified reference was transferred')
  assert.deepEqual((await dbTrip(t._id)).itineraryDocs, before, 'the trip still holds every original value — nothing rewritten or deleted')
  const au = (await audits(t._id, 'travel.attachments_converted'))[0]; assert.deepEqual([au.metadata.transferred, au.metadata.excluded], [1, weird.length])
  assert.equal((await row(other.pid)).orgId, B.orgId); assert.ok(!(await row(other.pid)).claimedBy, 'the other tenant’s file was not touched')
})

test('C3. LEGACY-ONLY trips still convert: no receipts on the expense, the strings stay on the trip, the count is reported', async () => {
  const t = await approved('Aemployee', []); const legacy = ['https://legacy.example.test/a.pdf', 'plain legacy text']
  await db.collection('travelrequests').updateOne({ _id: oid(t._id) }, { $set: { itineraryDocs: legacy } })
  const r = await kit.api(`/api/travel/${t._id}/expense`, { method: 'POST', ...who('Aemployee') }); assert.equal(r.status, 201, r.text); assert.deepEqual(r.json.receipts, []); assert.equal(r.json.attachmentsExcluded, 2)
  assert.deepEqual((await dbTrip(t._id)).itineraryDocs, legacy); assert.deepEqual((await db.collection('expenses').findOne({ _id: oid(r.json._id) })).receipts, [])
})

test('C4. conversion re-verifies right now: a file deleted at the provider is excluded; a provider outage fails the conversion (503) without creating anything', async () => {
  const a = await doc('Aemployee'), b = await doc('Aemployee'); const t = await approved('Aemployee', [a, b])
  await fake.control.mode({ storage: { admin: 'error500' } })
  const down = await kit.api(`/api/travel/${t._id}/expense`, { method: 'POST', ...who('Aemployee') }); assert.equal(down.status, 503); assert.equal(down.json.code, 'attachment_verification_unavailable')
  assert.equal(await db.collection('expenses').countDocuments({ travelRequestId: t._id }), 0); assert.ok(!(await dbTrip(t._id)).expenseId)
  await fake.control.mode({ storage: { admin: 'ok' } })
  const { destroyReceiptAsset } = kit.load('lib/uploads/attachmentStorage.ts'); Object.assign(process.env, fake.ENV); assert.equal(await destroyReceiptAsset(a.pid, A.orgId), 'deleted')
  const r = await kit.api(`/api/travel/${t._id}/expense`, { method: 'POST', ...who('Aemployee') }); assert.equal(r.status, 201, r.text); assert.equal(r.json.attachmentsExcluded, 1); assert.equal((await db.collection('expenses').findOne({ _id: oid(r.json._id) })).receipts.length, 1)
})

test('C5. conversion authorization is unchanged: only the owner of an approved, finished trip; other users/tenants are refused', async () => {
  const t = await approved('Aemployee', [await doc('Aemployee')])
  for (const [k, s] of [['Amanager', 403], ['Aadmin', 403], ['Bemployee', 404], ['Badmin', 404]]) assert.equal((await kit.api(`/api/travel/${t._id}/expense`, { method: 'POST', ...who(k) })).status, s, k)
  assert.equal((await kit.api('/api/travel/5f0000000000000000000000/expense', { method: 'POST', ...who('Aemployee') })).status, 404)
  assert.equal(await db.collection('expenses').countDocuments({ travelRequestId: t._id }), 0)
  const pend = await created('Aemployee', [await doc('Aemployee')], { departureDate: D(-10), returnDate: D(-8) }); assert.equal((await kit.api(`/api/travel/${pend._id}/expense`, { method: 'POST', ...who('Aemployee') })).status, 409, 'not approved')
})

/* ═════════ 7. cleanup interplay ═════════ */
test('K1. the abandoned-receipt cleanup never deletes a file that a trip (or the converted expense) still references, but still removes unclaimed travel uploads', async () => {
  const cleanup = kit.load('lib/uploads/receiptCleanup.ts'); Object.assign(process.env, fake.ENV)
  const used = await doc('Aemployee'), orphan = await doc('Aemployee'); const t = await created('Aemployee', [used])
  for (const d of [used, orphan]) await db.collection('receiptuploads').updateOne({ publicId: d.pid }, { $set: { issuedAt: new Date(Date.now() - 30 * 3600e3), nextCheckAt: new Date(Date.now() - 3600e3) } })
  const dry = await cleanup.runReceiptCleanup({ apply: false, limit: 500 }); assert.ok(dry.skippedReferenced >= 1)
  await cleanup.runReceiptCleanup({ apply: true, limit: 500 })
  assert.equal(await stored(used.pid), true, 'a trip-referenced file survives'); assert.equal(await stored(orphan.pid), false, 'an unclaimed travel upload is removed'); assert.ok(await row(used.pid)); assert.equal(await row(orphan.pid), null)
  void t
})

/* ═════════ 8. hygiene ═════════ */
test('H1. no API response in these flows exposes provider URLs, private references, storage ids, secrets or stack traces', async () => {
  const d = await doc('Aemployee'); const texts = []
  const r = await post('Aemployee', trip({ itineraryDocs: [d.url] })); texts.push(r.text)
  for (const bodyDocs of [['garbage'], [d.url], ['https://x.example.test/a'], [d.ref]]) texts.push((await post('Aemployee', trip({ itineraryDocs: bodyDocs }))).text)
  texts.push((await kit.api('/api/travel', who('Aemployee'))).text, (await kit.api(`/api/travel/${r.json._id}`, who('Amanager'))).text)
  for (const x of texts) { const m = /cld:|doppeldash\/|testcloud|127\.0\.0\.1:3912|signature|api_key|secret|stack|E11000|Mongo/i.exec(x); assert.equal(m && x.slice(Math.max(0, m.index - 30), m.index + 40), null, 'response contains ' + (m && m[0])) }
})
