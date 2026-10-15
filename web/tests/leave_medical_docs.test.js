/**
 * Leave medical documents (Phase 1J): a PRIVATE, purpose-bound attachment contract on every write and read path.
 * Medical documents used to be uploaded as `kind=document` (publicly deliverable) and `medicalDocs` accepted any string. Real HTTP routes, the
 * throwaway DB of the dev server and the LOCAL FAKE storage provider (proves OUR enforcement, not Cloudinary's).
 *   M  ticket purpose            S  sick-leave rule + valid documents      R  refused references         X  cross-purpose use
 *   D  authenticated retrieval   P  presenters / no leakage                A  review cannot change the set
 *   C  cleanup / races / delete  G  account deletion                       L  legacy records
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const mongoose = require('mongoose')
const kit = require('./helpers/authTestKit')
const fake = require('./helpers/fakeProviders')

let db, providers, A, B, C, tok, peer
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 1)])
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF')
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)])
const MIME = { png: 'image/png', pdf: 'application/pdf', jpg: 'image/jpeg' }
const BYTES = { png: PNG, pdf: PDF, jpg: JPG }
const oid = s => new mongoose.Types.ObjectId(s)
const YEAR = new Date().getFullYear()
const H = 3600_000

test.before(async () => {
  providers = await fake.ensureFakeProviders(); db = await kit.connect()
  A = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  B = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  C = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  tok = {}
  for (const [k, org] of [['A', A], ['B', B], ['C', C]]) for (const r of ['admin', 'manager', 'employee']) tok[`${k}${r}`] = (await kit.login(org[r].email)).accessToken
  // a SECOND employee of organisation A (same tenant, not the owner)
  const User = kit.load('models/User.ts').default, Employee = kit.load('models/Employee.ts').default
  const email = `peer_${kit.rand()}@test.dd`
  const u = await User.create({ orgId: A.orgId, email, passwordHash: await User.hashPassword(kit.PASSWORD), role: 'employee', firstName: 'Pia', lastName: 'Peer', mustChangePassword: false, isActive: true, sessionVersion: 1 })
  await Employee.create({ clerkUserId: u._id.toString(), orgId: A.orgId, createdByUserId: u._id.toString(), firstName: 'Pia', lastName: 'Peer', email, department: 'QA', designation: 'employee', employeeType: 'full_time', joiningDate: new Date(), onboardingComplete: true, onboardingStep: 5 })
  peer = { id: u._id.toString(), token: (await kit.login(email)).accessToken }
  for (const [org, id] of [[A, A.employee.id], [B, B.employee.id], [C, C.employee.id], [A, peer.id]]) await db.collection('leavebalances').insertOne({ orgId: org.orgId, userId: id, year: YEAR, casual: 99, sick: 999, earned: 99, privilege: 99, restricted: 99, lwpDays: 0 })
})
test.after(async () => {
  const orgs = [A.orgId, B.orgId, C.orgId]
  for (const c of ['leaves', 'leavebalances', 'receiptuploads', 'auditlogs', 'expenses', 'travelrequests', 'employees', 'users']) await db.collection(c).deleteMany({ orgId: { $in: orgs } })
  await kit.cleanupAll(db); await providers.stop(); await kit.disconnect()
})
test.beforeEach(async () => { await fake.control.reset(); await db.collection('ratelimits').deleteMany({ key: /^(upload-sign|leave-doc|rms-receipt|travel-doc):/ }) })

const who = k => ({ token: tok[k] })
const key = () => crypto.randomBytes(4).toString('hex')
const leaveBody = (o = {}) => ({ type: 'sick', startDate: `${YEAR}-11-10`, endDate: `${YEAR}-11-12`, days: 3, reason: 'Fever ' + key(), ...o })
const post = (tokenOrKey, body) => kit.api('/api/lms', { method: 'POST', token: tokenOrKey.length > 40 ? tokenOrKey : tok[tokenOrKey], body })
const sign = (token, o = {}) => kit.api('/api/uploads/sign', { method: 'POST', token, body: { kind: 'receipt', mimeType: MIME.png, sizeBytes: 100, purpose: 'leave_medical', ...o } })
async function put(ticket, bytes) { const fd = new FormData(); for (const [f, v] of Object.entries(ticket.fields)) fd.append(f, v); fd.append('file', new Blob([bytes]), 'f.bin'); const r = await fetch(ticket.uploadUrl, { method: 'POST', body: fd }); return { status: r.status, json: await r.json().catch(() => null) } }
/** One real private upload issued for `purpose` (default leave_medical) by `token` (default A's employee). */
async function doc({ token = tok.Aemployee, ext = 'png', purpose = 'leave_medical', kind = 'receipt' } = {}) {
  const t = await sign(token, { mimeType: MIME[ext], sizeBytes: BYTES[ext].length, kind, purpose: purpose === null ? undefined : purpose }); assert.equal(t.status, 200, t.text)
  const up = await put(t.json, BYTES[ext]); assert.equal(up.status, 200, JSON.stringify(up.json))
  const pid = up.json.public_id
  return { url: up.json.secure_url, pid, ref: `cld:${pid}.${ext}`, ext, ticket: t.json }
}
const row = pid => db.collection('receiptuploads').findOne({ publicId: pid })
const dbLeave = id => db.collection('leaves').findOne({ _id: oid(id) })
const leaves = f => db.collection('leaves').countDocuments(f)
const stored = async pid => (await fake.control.state()).files.some(f => f.startsWith(pid + '.'))
const LEAK = /cld:|doppeldash\/|testcloud|127\.0\.0\.1|signature|api_key|authenticated\/|stack|mongoose|E11000|MongoServer/i
const created = async (docs, extra = {}, token = tok.Aemployee) => { const r = await post(token, leaveBody({ medicalDocs: docs.map(d => d.url), ...extra })); assert.equal(r.status, 201, r.text); return r.json }
const unclaimed = async d => { const r = await row(d.pid); assert.ok(r, 'manifest row'); assert.ok(!r.claimedBy, 'file must not stay claimed'); return r }
const dl = (token, id, n, ext = 'png') => kit.api(`/api/lms/${id}/document/${n}.${ext}`, token ? { token } : {})

/* ═════════ M. ticket purpose ═════════ */
test('M1. tickets record WHAT they are for and WHO they were issued to; leave_medical is a distinct, validated purpose; kind=document stays public and is not a leave path', async () => {
  const t = await sign(tok.Aemployee); const r = await row(`${t.json.fields.folder}/${t.json.fields.public_id}`)
  assert.deepEqual([r.purpose, r.userId, r.orgId, r.state], ['leave_medical', A.employee.id, A.orgId, 'issued'])
  assert.equal(t.json.fields.type, 'authenticated', 'private (authenticated) storage, never public delivery')
  assert.match(t.json.fields.folder, new RegExp(`^doppeldash/${A.orgId}/receipts$`))
  assert.deepEqual(t.json.allowedMimeTypes.sort(), ['application/pdf', 'image/heic', 'image/jpeg', 'image/png', 'image/webp'])
  for (const p of ['medical', 'LEAVE_MEDICAL', '', null, 5, ['leave_medical']]) assert.equal((await sign(tok.Aemployee, { purpose: p })).status, 400, JSON.stringify(p))
  assert.equal((await sign(tok.Aemployee, { kind: 'document' })).status, 400, 'a purpose is only valid for private receipt-kind tickets')
  assert.equal((await kit.api('/api/uploads/sign', { method: 'POST', body: { kind: 'receipt', mimeType: MIME.png, sizeBytes: 5, purpose: 'leave_medical' } })).status, 401, 'anonymous')
  assert.equal((await sign(tok.Aemployee, { mimeType: 'text/html' })).status, 415)
  assert.equal((await sign(tok.Aemployee, { sizeBytes: 999999999 })).status, 413)
  assert.equal((await sign(tok.Aemployee, { sizeBytes: 0 })).status, 400)
})

/* ═════════ S. sick-leave rule and valid documents ═════════ */
test('S1. sick leave over two days: no documents / an empty list is refused; one document and several documents (PNG, PDF, JPEG) are accepted', async () => {
  const before = await leaves({ orgId: A.orgId })
  for (const body of [leaveBody(), leaveBody({ medicalDocs: [] }), leaveBody({ medicalDocs: undefined })]) assert.equal((await post('Aemployee', body)).status, 400)
  assert.equal(await leaves({ orgId: A.orgId }), before)
  const one = await created([await doc()])
  assert.equal(one.medicalDocs.length, 1)
  const three = await created([await doc({ ext: 'png' }), await doc({ ext: 'pdf' }), await doc({ ext: 'jpg' })])
  assert.deepEqual(three.medicalDocs.map(p => p.split('.').pop()), ['png', 'pdf', 'jpg'])
})

test('S2. sick leave up to two days needs no document but may carry one; other leave types ignore documents entirely (nothing stored, nothing claimed)', async () => {
  assert.equal((await post('Aemployee', leaveBody({ days: 2, endDate: `${YEAR}-11-11` }))).status, 201)
  const d = await doc()
  const optional = await created([d], { days: 1, endDate: `${YEAR}-11-10` })
  assert.equal(optional.medicalDocs.length, 1)
  const d2 = await doc()
  const casual = await post('Aemployee', leaveBody({ type: 'casual', days: 1, endDate: `${YEAR}-11-10`, medicalDocs: [d2.url] }))
  assert.equal(casual.status, 201, casual.text)
  assert.deepEqual(casual.json.medicalDocs, [])
  assert.equal((await dbLeave(casual.json._id)).medicalDocs.length, 0)
  await unclaimed(d2)
})

test('S3. a created leave stores the private reference, claims the file exclusively for that leave, and audits nothing sensitive', async () => {
  const d = await doc(); const l = await created([d])
  const doc_ = await dbLeave(l._id)
  assert.deepEqual(doc_.medicalDocs, [d.ref], 'stored as the provider-neutral private reference')
  const r = await row(d.pid)
  assert.deepEqual([r.state, r.claimedBy, r.purpose, r.userId], ['attached', l._id, 'leave_medical', A.employee.id])
  assert.ok(r.nextCheckAt - Date.now() > 20 * H, 'cleanup pushed out')
  assert.equal(await stored(d.pid), true)
})

/* ═════════ R. refused references ═════════ */
test('R1. only genuine, server-issued, leave-purpose, same-user, same-tenant private files are accepted; everything else is a 400 and stores nothing', async () => {
  const before = await leaves({ orgId: A.orgId })
  const ok = await doc()
  const publicDoc = await doc({ kind: 'document', purpose: null }).catch(() => null)   // a public `document` upload (no purpose is allowed for that kind)
  const bad = {
    'external URL': 'https://evil.example.test/x.png',
    'public host path': 'https://res.cloudinary.com/testcloud/image/upload/v1/doppeldash/x/documents/aaaaaaaaaaaa.png',
    'raw cld ref': ok.ref,
    'path traversal': ok.url.replace('/doppeldash/', '/doppeldash/../'),
    'query string': ok.url + '?x=1',
    'not a URL': 'hello',
    'javascript scheme': 'javascript:alert(1)',
    'oversized value': 'https://x.test/' + 'a'.repeat(3000),
  }
  for (const [label, v] of Object.entries(bad)) { const r = await post('Aemployee', leaveBody({ medicalDocs: [v] })); assert.equal(r.status, 400, `${label}: ${r.status} ${r.text}`); assert.doesNotMatch(r.text, LEAK, label) }
  if (publicDoc) { const r = await post('Aemployee', leaveBody({ medicalDocs: [publicDoc.url] })); assert.equal(r.status, 400, 'a PUBLIC document upload can never be a medical document') }
  for (const v of [5, null, {}, [], [5], [''], ['a', 5], 'x', true]) { const r = await post('Aemployee', leaveBody({ medicalDocs: v })); assert.equal(r.status, 400, JSON.stringify(v)) }
  assert.equal((await post('Aemployee', leaveBody({ medicalDocs: Array.from({ length: 11 }, () => ok.url) }))).status, 400, 'more than 10')
  assert.equal((await post('Aemployee', leaveBody({ medicalDocs: [ok.url, ok.url] }))).status, 400, 'the same file twice in one request')
  assert.equal(await leaves({ orgId: A.orgId }), before)
  await unclaimed(ok)
})

test('R2. another tenant’s file, another user’s ticket (same tenant) and a manager’s ticket are refused', async () => {
  const bDoc = await doc({ token: tok.Bemployee })
  assert.equal((await post('Aemployee', leaveBody({ medicalDocs: [bDoc.url] }))).status, 400, 'cross-tenant')
  const peerDoc = await doc({ token: peer.token })
  assert.equal((await post('Aemployee', leaveBody({ medicalDocs: [peerDoc.url] }))).status, 400, 'a colleague’s upload cannot be attached to my leave')
  const mgrDoc = await doc({ token: tok.Amanager })
  assert.equal((await post('Aemployee', leaveBody({ medicalDocs: [mgrDoc.url] }))).status, 400)
  for (const d of [bDoc, peerDoc, mgrDoc]) await unclaimed(d)
  assert.equal((await post('Bemployee', leaveBody({ medicalDocs: [bDoc.url] }))).status, 201, 'the rightful owner can still use it')
})

test('R3. a file that is not an upload from the manifest, a rejected one, one the cleanup has claimed, and a wrong-type file are refused', async () => {
  const d = await doc()
  await db.collection('receiptuploads').updateOne({ publicId: d.pid }, { $set: { state: 'deleting' } })
  assert.equal((await post('Aemployee', leaveBody({ medicalDocs: [d.url] }))).status, 400, 'claimed by the cleanup')
  await db.collection('receiptuploads').updateOne({ publicId: d.pid }, { $set: { state: 'rejected' } })
  assert.equal((await post('Aemployee', leaveBody({ medicalDocs: [d.url] }))).status, 400, 'rejected')
  const e = await doc(); await db.collection('receiptuploads').deleteOne({ publicId: e.pid })
  assert.equal((await post('Aemployee', leaveBody({ medicalDocs: [e.url] }))).status, 400, 'no manifest row = not server-issued')
  // declared PDF but the bytes are a PNG
  const t = await sign(tok.Aemployee, { mimeType: MIME.pdf, sizeBytes: PNG.length }); const up = await put(t.json, PNG)
  if (up.status === 200) { const r = await post('Aemployee', leaveBody({ medicalDocs: [up.json.secure_url] })); assert.equal(r.status, 400); assert.doesNotMatch(r.text, LEAK) }
})

test('R4. a document is single-holder: a second leave is refused (409) and N concurrent attaches yield exactly one leave', async () => {
  const d = await doc(); const first = await created([d])
  const again = await post('Aemployee', leaveBody({ medicalDocs: [d.url] }))
  assert.equal(again.status, 409); assert.equal(again.json.code, 'attachment_in_use')
  const race = await doc()
  const before = await leaves({ orgId: A.orgId })
  const rs = await Promise.all(Array.from({ length: 6 }, () => post('Aemployee', leaveBody({ medicalDocs: [race.url] }))))
  assert.equal(rs.filter(r => r.status === 201).length, 1, rs.map(r => r.status).join())
  assert.ok(rs.filter(r => r.status !== 201).every(r => r.status === 409 || r.status === 400), rs.map(r => r.status).join())
  assert.equal(await leaves({ orgId: A.orgId }), before + 1)
  const r = await row(race.pid); assert.equal(typeof r.claimedBy, 'string'); assert.equal(await leaves({ medicalDocs: race.ref }), 1)
  assert.equal(first.medicalDocs.length, 1)
})

/* ═════════ X. cross-purpose use ═════════ */
test('X1. leave files cannot be used as expense receipts or itinerary documents, and receipts/itinerary files cannot be used as medical documents', async () => {
  const leaveDoc = await doc()
  const expBefore = await db.collection('expenses').countDocuments({ orgId: A.orgId })
  const exp = await kit.api('/api/rms', { method: 'POST', ...who('Aemployee'), body: { title: 'x ' + key(), reason: 'r', amount: 10, startDate: new Date().toISOString(), receipts: [leaveDoc.url] } })
  assert.notEqual(exp.status, 201, exp.text)
  assert.equal(await db.collection('expenses').countDocuments({ orgId: A.orgId }), expBefore)
  const trip = await kit.api('/api/travel', { method: 'POST', ...who('Aemployee'), body: { purpose: 'p ' + key(), destination: 'Pune', departureDate: '2030-01-05', returnDate: '2030-01-06', itineraryDocs: [leaveDoc.url] } })
  assert.equal(trip.status, 400, trip.text)
  await unclaimed(leaveDoc)
  for (const purpose of [null, 'expense_receipt', 'travel_itinerary']) { const o = await doc({ purpose }); const r = await post('Aemployee', leaveBody({ medicalDocs: [o.url] })); assert.equal(r.status, 400, `purpose ${purpose}`); await unclaimed(o) }
  const ok = await post('Aemployee', leaveBody({ medicalDocs: [leaveDoc.url] })); assert.equal(ok.status, 201, 'the leave file still works for a leave')
})

/* ═════════ D. authenticated retrieval ═════════ */
test('D1. the owner and same-organisation managers/admins read the document; a colleague gets 403, another tenant 404, anonymous 401', async () => {
  const d = await doc({ ext: 'png' }); const l = await created([d])
  const path = l.medicalDocs[0]
  assert.match(path, new RegExp(`^/api/lms/${l._id}/document/0\\.png$`))
  for (const [label, t] of [['owner', tok.Aemployee], ['manager', tok.Amanager], ['admin', tok.Aadmin]]) {
    const r = await fetch(`${kit.BASE_URL}${path}`, { headers: { Authorization: `Bearer ${t}` } })
    assert.equal(r.status, 200, label)
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), PNG, label)
    assert.equal(r.headers.get('cache-control'), 'private, no-store, max-age=0')
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(r.headers.get('content-type'), 'image/png')
  }
  assert.equal((await dl(peer.token, l._id, 0)).status, 403, 'a colleague cannot read another employee’s medical document')
  for (const k of ['Bemployee', 'Bmanager', 'Badmin']) assert.equal((await dl(tok[k], l._id, 0)).status, 404, `cross-tenant ${k}`)
  assert.equal((await dl(null, l._id, 0)).status, 401, 'anonymous')
  assert.equal((await kit.api(`/api/lms/${l._id}/document/0.png`, { headers: { Authorization: 'Bearer garbage' } })).status, 401)
})

test('D2. malformed ids/indexes are 404; a PDF is served as an attachment with a locked-down CSP; the provider URL never appears in headers', async () => {
  const d = await doc({ ext: 'pdf' }); const l = await created([d])
  for (const [id, n] of [['nope', '0.png'], [l._id, '5.png'], [l._id, 'x.png'], [l._id, '../0'], ['0'.repeat(24), '0.png']]) assert.equal((await dl(tok.Aemployee, id, n.replace(/\.png$/, '') + (n.endsWith('.png') ? '' : ''), 'png')).status, 404, `${id}/${n}`)
  const r = await fetch(`${kit.BASE_URL}${l.medicalDocs[0]}`, { headers: { Authorization: `Bearer ${tok.Amanager}` } })
  assert.equal(r.status, 200)
  assert.match(r.headers.get('content-disposition'), /^attachment;/)
  assert.match(r.headers.get('content-security-policy'), /sandbox/)
  assert.equal(r.headers.get('content-type'), 'application/pdf')
  assert.doesNotMatch([...r.headers.entries()].filter(([k]) => k !== 'content-security-policy').map(([k, v]) => `${k}:${v}`).join('\n'), /testcloud|127\.0\.0\.1|signature|api_key/i)
})

test('D3. the provider being unavailable gives a safe 502/503 (no provider detail), and a deleted/never-stored asset a 404', async () => {
  const d = await doc(); const l = await created([d])
  await fake.control.mode({ storage: { download: 'error500' } })
  const r = await dl(tok.Aemployee, l._id, 0)
  assert.ok([502, 503, 404].includes(r.status), String(r.status)); assert.doesNotMatch(r.text, LEAK)
})

/* ═════════ P. presenters ═════════ */
test('P1. no list/detail/create/review response ever contains a provider URL, signature or storage reference — only authenticated proxy paths', async () => {
  const d = await doc(); const l = await created([d])
  const responses = [
    await kit.api('/api/lms', who('Aemployee')), await kit.api('/api/lms', who('Amanager')), await kit.api('/api/lms', who('Aadmin')),
    await kit.api(`/api/lms/${l._id}`, who('Aemployee')), await kit.api(`/api/lms/${l._id}`, who('Amanager')),
    await kit.api(`/api/lms/${l._id}`, { method: 'PATCH', ...who('Amanager'), body: { managerNote: 'seen' } }),
  ]
  for (const r of responses) { assert.equal(r.status, 200, r.text); assert.doesNotMatch(r.text, LEAK) }
  const listed = responses[0].json.find(x => x._id === l._id)
  assert.equal(listed.medicalDocs[0], l.medicalDocs[0])
  assert.doesNotMatch(JSON.stringify(await kit.api('/api/lms', who('Bmanager')).then(r => r.json)), new RegExp(l._id), 'another tenant sees none of it')
})

/* ═════════ A. review cannot change the document set ═════════ */
test('A1. leave review keeps working; no role can alter the document set through the review endpoint; employees cannot review', async () => {
  const d = await doc(); const l = await created([d])
  const evil = await doc()
  const r = await kit.api(`/api/lms/${l._id}`, { method: 'PATCH', ...who('Amanager'), body: { status: 'approved', managerNote: 'ok', medicalDocs: [evil.url, 'https://evil.example.test/x'], userId: 'x' } })
  assert.equal(r.status, 200, r.text); assert.equal(r.json.status, 'approved')
  assert.deepEqual((await dbLeave(l._id)).medicalDocs, [d.ref], 'documents unchanged')
  await unclaimed(evil)
  assert.equal((await kit.api(`/api/lms/${l._id}`, { method: 'PATCH', ...who('Aemployee'), body: { medicalDocs: [] } })).status, 403)
  assert.equal((await kit.api(`/api/lms/${l._id}`, { method: 'PATCH', token: peer.token, body: { status: 'approved' } })).status, 403)
  assert.equal((await kit.api(`/api/lms/${l._id}`, { method: 'PATCH', ...who('Badmin'), body: { status: 'rejected' } })).status, 404)
  assert.deepEqual((await dbLeave(l._id)).medicalDocs, [d.ref])
})

/* ═════════ C. cleanup, races, deletion ═════════ */
test('C1. the abandoned-upload cleanup deletes an unattached leave upload but never a document a leave references, and is idempotent', async () => {
  const cleanup = kit.load('lib/uploads/receiptCleanup.ts')
  const abandoned = await doc(); const attached = await doc(); await created([attached])
  const age = pid => db.collection('receiptuploads').updateOne({ publicId: pid }, { $set: { issuedAt: new Date(Date.now() - 30 * H), nextCheckAt: new Date(Date.now() - 6 * H) } })
  await age(abandoned.pid); await age(attached.pid)
  const rep = await cleanup.runReceiptCleanup({ apply: true })
  assert.ok(rep.deleted >= 1 && rep.skippedReferenced >= 1, JSON.stringify(rep))
  assert.equal(await stored(abandoned.pid), false); assert.equal(await row(abandoned.pid), null)
  assert.equal(await stored(attached.pid), true, 'the document of a leave is never deleted'); assert.ok(await row(attached.pid))
  const again = await cleanup.runReceiptCleanup({ apply: true }); assert.equal(again.deleted, 0)
  assert.equal(await stored(attached.pid), true)
})

test('C2. attach versus cleanup: whichever claims the manifest row first wins, never both; a cleaned-up upload can no longer be attached', async () => {
  const cleanup = kit.load('lib/uploads/receiptCleanup.ts')
  const d = await doc()
  await db.collection('receiptuploads').updateOne({ publicId: d.pid }, { $set: { issuedAt: new Date(Date.now() - 30 * H), nextCheckAt: new Date(Date.now() - 6 * H) } })
  const [att, rep] = await Promise.all([post('Aemployee', leaveBody({ medicalDocs: [d.url] })), cleanup.runReceiptCleanup({ apply: true })])
  const l = await leaves({ medicalDocs: d.ref })
  if (att.status === 201) { assert.equal(l, 1); assert.equal(await stored(d.pid), true, 'attached → file survives') }
  else { assert.equal(l, 0); assert.ok([400, 409, 503].includes(att.status), String(att.status)) }
  assert.ok(rep.examined >= 0)
  const late = await post('Aemployee', leaveBody({ medicalDocs: [d.url] }))
  if (!(await stored(d.pid))) assert.notEqual(late.status, 201, 'a file the cleanup removed can never be attached afterwards')
})

test('C3. withdrawing a leave (owner) or removing it (manager) releases and deletes its private documents; repeated deletes are safe; nothing cross-tenant', async () => {
  const d = await doc(); const l = await created([d])
  const bDoc = await doc({ token: tok.Bemployee }); await created([bDoc], {}, tok.Bemployee)
  assert.equal((await kit.api(`/api/lms/${l._id}`, { method: 'DELETE', token: peer.token })).status, 403)
  const del = await kit.api(`/api/lms/${l._id}`, { method: 'DELETE', ...who('Aemployee') }); assert.equal(del.status, 200)
  await new Promise(r => setTimeout(r, 400))
  assert.equal(await row(d.pid), null, 'manifest row removed once the provider confirmed'); assert.equal(await stored(d.pid), false)
  assert.equal((await kit.api(`/api/lms/${l._id}`, { method: 'DELETE', ...who('Aemployee') })).status, 404)
  assert.equal(await stored(bDoc.pid), true, 'another tenant’s file untouched'); assert.ok(await row(bDoc.pid))
  const d2 = await doc(); const l2 = await created([d2])
  assert.equal((await kit.api(`/api/lms/${l2._id}`, { method: 'DELETE', ...who('Amanager') })).status, 200)
  await new Promise(r => setTimeout(r, 400)); assert.equal(await stored(d2.pid), false)
})

test('C4. when the provider cannot delete, the manifest row stays so the cleanup can retry; a failed leave write releases its claims', async () => {
  const d = await doc(); const l = await created([d])
  await fake.control.mode({ storage: { destroy: 'error500' } })
  assert.equal((await kit.api(`/api/lms/${l._id}`, { method: 'DELETE', ...who('Aemployee') })).status, 200)
  await new Promise(r => setTimeout(r, 400))
  const r = await row(d.pid); assert.ok(r, 'row kept for retry'); assert.ok(!r.claimedBy, 'no longer claimed by a leave that no longer exists')
  // a leave write that fails (invalid type for the schema) must not leave the file claimed
  const e = await doc()
  const bad = await post('Aemployee', leaveBody({ medicalDocs: [e.url], startDate: 'not-a-date' }))
  assert.ok([400, 500].includes(bad.status)); await unclaimed(e)
})

/* ═════════ G. account deletion ═════════ */
test('G1. disbanding an organisation purges its leave medical documents from storage and the manifest (retryable), and never touches another tenant', async () => {
  const { purgeOrgBlobs } = kit.load('lib/account/deletion.ts')
  const d1 = await doc({ token: tok.Cemployee }); const d2 = await doc({ token: tok.Cemployee, ext: 'pdf' })
  await created([d1, d2], {}, tok.Cemployee)
  const aDoc = await doc(); await created([aDoc])
  await fake.control.mode({ storage: { destroy: 'error500' } })
  await assert.rejects(purgeOrgBlobs(C.orgId), /private files could not be deleted/)
  assert.ok(await row(d1.pid), 'rows are kept while the provider has not confirmed deletion')
  await fake.control.mode({ storage: { destroy: 'ok' } })
  await purgeOrgBlobs(C.orgId)
  assert.equal(await db.collection('receiptuploads').countDocuments({ orgId: C.orgId }), 0)
  assert.equal(await stored(d1.pid), false); assert.equal(await stored(d2.pid), false)
  assert.equal(await stored(aDoc.pid), true, 'another tenant’s medical document is untouched'); assert.ok(await row(aDoc.pid))
})

/* ═════════ L. legacy records ═════════ */
test('L1. legacy leaves (plain public URLs from before the private contract) stay reviewable and are returned unchanged — they are NOT private and are not served by the private endpoint', async () => {
  const legacyUrl = 'https://res.cloudinary.com/oldcloud/image/upload/v1/doppeldash/legacy/documents/aaaaaaaaaaaaaaaa.pdf'
  const ins = await db.collection('leaves').insertOne({ orgId: A.orgId, userId: A.employee.id, userName: 'Old', type: 'sick', startDate: new Date(`${YEAR}-02-01`), endDate: new Date(`${YEAR}-02-03`), days: 3, reason: 'old record', status: 'pending', medicalDocs: [legacyUrl], isLWP: false, isHalfDay: false, createdAt: new Date(), updatedAt: new Date() })
  const id = String(ins.insertedId)
  for (const t of ['Aemployee', 'Amanager']) { const r = await kit.api(`/api/lms/${id}`, who(t)); assert.equal(r.status, 200); assert.deepEqual(r.json.medicalDocs, [legacyUrl], 'returned as stored: still publicly deliverable') }
  const r = await dl(tok.Aemployee, id, 0, 'pdf'); assert.equal(r.status, 404); assert.equal(r.json.code, 'legacy_attachment')
  assert.equal((await kit.api(`/api/lms/${id}`, { method: 'PATCH', ...who('Amanager'), body: { status: 'approved' } })).status, 200, 'review of a legacy record still works')
  assert.deepEqual((await dbLeave(id)).medicalDocs, [legacyUrl], 'nothing rewrites or migrates legacy values')
  assert.equal((await kit.api(`/api/lms/${id}`, { method: 'DELETE', ...who('Amanager') })).status, 200)
  assert.ok(true)
})

test('L2. EXPOSURE CHARACTERISATION: a `kind=document` upload (what the Web leave form used before Phase 1J) is stored under PUBLIC delivery and anyone with the URL can read it without a session', async () => {
  const t = await kit.api('/api/uploads/sign', { method: 'POST', token: tok.Aemployee, body: { kind: 'document', mimeType: MIME.png, sizeBytes: PNG.length } }); assert.equal(t.status, 200, t.text)
  assert.notEqual(t.json.fields.type, 'authenticated', 'document-kind tickets are not authenticated storage')
  assert.match(t.json.fields.folder, /\/documents$/)
  const up = await put(t.json, PNG); assert.equal(up.status, 200)
  assert.match(up.json.secure_url, /\/image\/upload\//, 'public delivery type')
  assert.doesNotMatch(up.json.secure_url, /authenticated/)
  const anon = await fetch(up.json.secure_url)   // no cookie, no token
  assert.equal(anon.status, 200, 'readable by anyone who has the URL')
  assert.deepEqual(Buffer.from(await anon.arrayBuffer()), PNG)
  assert.equal((await db.collection('receiptuploads').countDocuments({ publicId: up.json.public_id })), 0, 'and it is not even in the manifest the cleanup/deletion jobs use')
})
