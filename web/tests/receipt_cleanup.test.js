/**
 * Feature 3.1.2 — abandoned-receipt cleanup.
 * Requires: dev server on TEST_URL started with the fake-provider env, CRON_SECRET and RECEIPT_CLEANUP_APPLY=1, and the same
 * throwaway DB (see tests/helpers/fakeProviders.js ENV). Logic tests call the job in-process against the SAME throwaway DB;
 * route tests go through HTTP. Providers are local fakes: they prove OUR behaviour, not the real Cloudinary.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const kit = require('./helpers/authTestKit')
const fake = require('./helpers/fakeProviders')

Object.assign(process.env, fake.ENV)             // the in-process job talks to the same fake provider as the server
const CRON = process.env.CRON_SECRET
const H = 3600_000

let db, smtp, providers, A, B, tokA, tokB, cleanup, Expense, Upload
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(600, 7)])
const day = n => new Date(Date.now() + n * 864e5).toISOString()

test.before(async () => {
  assert.ok(CRON, 'CRON_SECRET must be exported for the dev server and this test')
  providers = await fake.ensureFakeProviders()
  db = await kit.connect()
  smtp = await kit.startFakeSmtp(2525)
  cleanup = kit.load('lib/uploads/receiptCleanup.ts')
  Expense = kit.load('models/Expense.ts').default
  Upload = kit.load('models/ReceiptUpload.ts').default
  A = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  B = await kit.createOrg({ plan: 'free', webEnabled: false })
  tokA = (await kit.login(A.employee.email)).accessToken
  tokB = (await kit.login(B.employee.email)).accessToken
})
test.after(async () => { await db.collection('receiptuploads').deleteMany({ orgId: { $in: [A.orgId, B.orgId] } }); await kit.cleanupAll(db); await smtp.stop(); await providers.stop(); await kit.disconnect() })
test.beforeEach(async () => { await fake.control.reset(); await db.collection('ratelimits').deleteMany({ key: /^upload-sign:/ }) })

const api = (path, token, body, method = 'POST') => kit.api(path, { method, token, body })
/** Real client flow: ticket (records the manifest row) → upload to the fake provider. Returns { pid, ref, url }. */
async function newUpload(token = tokA, kind = 'receipt', bytes = JPEG) {
  const t = await api('/api/uploads/sign', token, { kind, mimeType: 'image/jpeg', sizeBytes: bytes.length })
  assert.equal(t.status, 200, t.text)
  const fd = new FormData()
  for (const [k, v] of Object.entries(t.json.fields)) fd.append(k, v)
  fd.append('file', new Blob([bytes]), 'r.jpg')
  const r = await fetch(t.json.uploadUrl, { method: 'POST', body: fd }); const j = await r.json()
  assert.equal(r.status, 200, JSON.stringify(j))
  const pid = j.public_id
  return { pid, ref: `cld:${pid}.jpg`, url: j.secure_url }
}
const age = (pid, hours) => db.collection('receiptuploads').updateOne({ publicId: pid }, { $set: { issuedAt: new Date(Date.now() - hours * H), nextCheckAt: new Date(Date.now() - (hours - 24) * H) } })
const row = pid => db.collection('receiptuploads').findOne({ publicId: pid })
const inStorage = async pid => (await fake.control.state()).files.some(f => f.startsWith(pid + '.'))
const run = (o = {}) => cleanup.runReceiptCleanup({ apply: true, ...o })
const attach = (token, ref, extra = {}) => api('/api/rms', token, { title: 'Taxi ' + crypto.randomBytes(3).toString('hex'), reason: 'client', amount: 450, startDate: day(-1), receipts: [ref], ...extra })
const clearOld = () => db.collection('receiptuploads').deleteMany({}) // only this DB's manifest (throwaway)

/* ── manifest ── */
test('M1. a receipt ticket records a manifest row (issued, due in 24 h); other kinds are never tracked', async () => {
  await clearOld()
  const u = await newUpload()
  const r = await row(u.pid)
  assert.equal(r.orgId, A.orgId); assert.equal(r.state, 'issued')
  assert.ok(Math.abs(r.nextCheckAt - r.issuedAt - 24 * H) < 2000)
  const d = await newUpload(tokA, 'document')
  assert.equal(await row(d.pid), null, 'documents/cards/images are outside the receipt cleanup')
  assert.equal(await db.collection('receiptuploads').countDocuments(), 1)
})

/* ── age ── */
test('C1. a recent orphan is preserved; one older than 24 h is deleted (asset and row)', async () => {
  await clearOld()
  const young = await newUpload(); const old = await newUpload()
  await age(young.pid, 23); await age(old.pid, 25)
  const rep = await run()
  assert.deepEqual([rep.examined, rep.eligible, rep.deleted, rep.failed], [1, 1, 1, 0])
  assert.equal(await inStorage(young.pid), true); assert.ok(await row(young.pid))
  assert.equal(await inStorage(old.pid), false); assert.equal(await row(old.pid), null)
})

test('C2. a tampered nextCheckAt can never make a young upload eligible (issuedAt floor)', async () => {
  await clearOld()
  const u = await newUpload()
  await db.collection('receiptuploads').updateOne({ publicId: u.pid }, { $set: { nextCheckAt: new Date(Date.now() - 99 * H) } })
  const rep = await run()
  assert.equal(rep.examined, 0); assert.equal(await inStorage(u.pid), true)
})

/* ── references ── */
test('R1. an expense-referenced asset is never deleted (receipts[] and line-item receipts), even when old', async () => {
  await clearOld()
  const a = await newUpload(); const b = await newUpload()
  assert.equal((await attach(tokA, a.url)).status, 201)
  const li = await api('/api/rms', tokA, { title: 'Hotel', reason: 'client', amount: 100, startDate: day(-1), lineItems: [{ description: 'Room', amount: 100, date: day(-1), receiptUrl: b.url }] })
  assert.equal(li.status, 201, li.text)
  await age(a.pid, 100); await age(b.pid, 100)
  await db.collection('receiptuploads').updateMany({}, { $set: { state: 'issued', nextCheckAt: new Date(Date.now() - H) } }) // as if never marked
  const rep = await run()
  assert.deepEqual([rep.examined, rep.skippedReferenced, rep.deleted], [2, 2, 0])
  assert.equal(await inStorage(a.pid), true); assert.equal(await inStorage(b.pid), true)
  const after = await row(a.pid); assert.equal(after.state, 'attached'); assert.ok(after.nextCheckAt - Date.now() > 6 * 24 * H, 'referenced rows are re-checked only weekly')
  const again = await run(); assert.equal(again.examined, 0, 'rerun does not touch them')
})

test('R2. attaching marks the manifest row; a later removal of the reference makes it eligible after the next window', async () => {
  await clearOld()
  const u = await newUpload()
  const e = await attach(tokA, u.url); assert.equal(e.status, 201)
  assert.equal((await row(u.pid)).state, 'attached')
  await db.collection('expenses').deleteMany({ _id: new (require('mongoose').Types.ObjectId)(e.json._id || e.json.id) }) // reference disappears without a destroy
  await age(u.pid, 30)
  const rep = await run(); assert.equal(rep.deleted, 1); assert.equal(await inStorage(u.pid), false)
})

/* ── attach-vs-cleanup races ── */
test('X1. attach wins: an upload attached just before cleanup is not eligible any more', async () => {
  await clearOld()
  const u = await newUpload(); await age(u.pid, 26)
  assert.equal((await attach(tokA, u.url)).status, 201)
  const rep = await run(); assert.equal(rep.deleted, 0); assert.equal(await inStorage(u.pid), true)
})

test('X2. cleanup wins: once cleanup has claimed a file, a later attach is refused (400) and nothing dangling is stored', async () => {
  await clearOld()
  const u = await newUpload(); await age(u.pid, 26)
  await db.collection('receiptuploads').updateOne({ publicId: u.pid }, { $set: { state: 'deleting', leaseUntil: new Date(Date.now() + H) } })
  const r = await attach(tokA, u.url)
  assert.equal(r.status, 400, r.text); assert.equal(r.json.code, 'attachment_rejected')
  assert.equal(await Expense.countDocuments({ orgId: A.orgId, receipts: u.ref }), 0)
})

test('X3. a reference that appears AFTER the claim but before the check still protects the asset', async () => {
  await clearOld()
  const u = await newUpload(); await age(u.pid, 26)
  const real = Expense.exists.bind(Expense)
  Expense.exists = async (q) => { Expense.exists = real; await Expense.collection.insertOne({ orgId: A.orgId, userId: 'x', userName: 'x', title: 't', reason: 'r', amount: 1, startDate: new Date(), lineItems: [], hasLineItems: false, receipts: [u.ref], status: 'pending_manager', createdAt: new Date(), updatedAt: new Date() }); return real(q) }
  try {
    const rep = await run()
    assert.deepEqual([rep.skippedReferenced, rep.deleted], [1, 0]); assert.equal(await inStorage(u.pid), true)
    assert.equal((await row(u.pid)).state, 'attached', 'row released, not left in deleting')
  } finally { Expense.exists = real; await db.collection('expenses').deleteMany({ receipts: u.ref }) }
})

test('X4. concurrent attach and cleanup: exactly one side wins and the end state is always consistent', async () => {
  await clearOld()
  for (let i = 0; i < 6; i++) {
    const u = await newUpload(); await age(u.pid, 26)
    const [att] = await Promise.all([attach(tokA, u.url), run()])
    const exists = await inStorage(u.pid); const referenced = await Expense.countDocuments({ orgId: A.orgId, receipts: u.ref }) > 0
    if (att.status === 201) { assert.ok(exists && referenced, 'attached ⇒ asset and reference both exist') }
    else { assert.ok(!referenced, 'refused ⇒ no dangling reference'); }
    assert.ok(!(referenced && !exists), 'never a reference to a deleted asset')
  }
})

/* ── failures fail safe ── */
test('F1. a failed database read never deletes; the row is released and retried later', async () => {
  await clearOld()
  const u = await newUpload(); await age(u.pid, 26)
  const real = Expense.exists.bind(Expense); Expense.exists = () => { throw new Error('db down') }
  try { const rep = await run(); assert.deepEqual([rep.failed, rep.deleted], [1, 0]) } finally { Expense.exists = real }
  assert.equal(await inStorage(u.pid), true)
  const r = await row(u.pid); assert.notEqual(r.state, 'deleting'); assert.equal(r.failures, 1); assert.ok(r.nextCheckAt > new Date())
  await db.collection('receiptuploads').updateOne({ publicId: u.pid }, { $set: { nextCheckAt: new Date(Date.now() - H) } })
  assert.equal((await run()).deleted, 1, 'recovers on the next run')
})

test('F2. provider deletion failures (HTTP 500 / malformed answer) keep the asset and the row; nothing is lost', async () => {
  await clearOld()
  const u = await newUpload(); await age(u.pid, 26)
  await fake.control.mode({ storage: { destroy: 'error500' } })
  const rep = await run(); assert.deepEqual([rep.failed, rep.deleted], [1, 0])
  assert.equal(await inStorage(u.pid), true); const r = await row(u.pid); assert.equal(r.failures, 1); assert.notEqual(r.state, 'deleting')
  await fake.control.mode({ storage: { destroy: 'ok' } })
  await db.collection('receiptuploads').updateOne({ publicId: u.pid }, { $set: { nextCheckAt: new Date(Date.now() - H) } })
  assert.equal((await run()).deleted, 1); assert.equal(await inStorage(u.pid), false)
})

test('F3. an unreachable provider (nothing listening) fails safe too; an asset that is already gone is cleared from the manifest', async () => {
  await clearOld()
  const u = await newUpload(); await age(u.pid, 26)
  const savedBase = process.env.CLOUDINARY_UPLOAD_BASE; process.env.CLOUDINARY_UPLOAD_BASE = 'http://127.0.0.1:9/cloud'
  try { const rep = await run(); assert.deepEqual([rep.failed, rep.deleted], [1, 0]) } finally { process.env.CLOUDINARY_UPLOAD_BASE = savedBase }
  assert.equal(await inStorage(u.pid), true); assert.ok(await row(u.pid))
  await fake.control.reset()  // storage is now empty: the asset is "already gone"
  await db.collection('receiptuploads').updateOne({ publicId: u.pid }, { $set: { nextCheckAt: new Date(Date.now() - H) } })
  const rep2 = await run(); assert.deepEqual([rep2.alreadyGone, rep2.deleted, rep2.failed], [1, 0, 0]); assert.equal(await row(u.pid), null)
})

test('F4. dry-run, or no signing credentials, deletes nothing', async () => {
  await clearOld()
  const u = await newUpload(); await age(u.pid, 26)
  const dry = await run({ apply: false }); assert.deepEqual([dry.mode, dry.eligible, dry.deleted], ['dry-run', 1, 0])
  assert.equal(await inStorage(u.pid), true); assert.equal((await row(u.pid)).state, 'issued', 'dry-run does not even claim rows')
  const k = process.env.CLOUDINARY_API_SECRET; process.env.CLOUDINARY_API_SECRET = ''
  try { assert.equal((await run()).deleted, 0) } finally { process.env.CLOUDINARY_API_SECRET = k }
  assert.equal(await inStorage(u.pid), true)
})

/* ── batches / idempotency ── */
test('B1. batches are bounded, reruns converge, and a finished state is a no-op (apply and dry-run cursor)', async () => {
  await clearOld()
  const ups = []; for (let i = 0; i < 7; i++) { const u = await newUpload(); await age(u.pid, 30 + i); ups.push(u) }
  const dry1 = await run({ apply: false, limit: 3 }); assert.deepEqual([dry1.examined, dry1.more], [3, true]); assert.ok(dry1.nextCursor)
  const dry2 = await run({ apply: false, limit: 3, cursor: dry1.nextCursor }); assert.equal(dry2.examined, 3)
  const dry3 = await run({ apply: false, limit: 3, cursor: dry2.nextCursor }); assert.deepEqual([dry3.examined, dry3.more], [1, false])
  assert.equal((await fake.control.state()).files.length, 7, 'dry-run deleted nothing')
  const r1 = await run({ limit: 3 }); assert.deepEqual([r1.deleted, r1.more], [3, true])
  const r2 = await run({ limit: 3 }); assert.deepEqual([r2.deleted, r2.more], [3, true])
  const r3 = await run({ limit: 3 }); assert.deepEqual([r3.deleted, r3.more], [1, false])
  const r4 = await run({ limit: 3 }); assert.deepEqual([r4.examined, r4.deleted, r4.failed], [0, 0, 0], 'idempotent')
  assert.equal((await fake.control.state()).files.length, 0)
  assert.equal((await run({ limit: 100000 })).examined, 0)
  assert.equal(cleanup.MAX_LIMIT, 500)
})

test('B2. a crashed run (expired lease) is recovered; a live lease is respected', async () => {
  await clearOld()
  const u = await newUpload(); await age(u.pid, 26)
  await db.collection('receiptuploads').updateOne({ publicId: u.pid }, { $set: { state: 'deleting', leaseUntil: new Date(Date.now() + H) } })
  assert.equal((await run()).examined, 0)
  await db.collection('receiptuploads').updateOne({ publicId: u.pid }, { $set: { leaseUntil: new Date(Date.now() - 1000) } })
  assert.equal((await run()).deleted, 1)
})

/* ── namespace ── */
test('N1. only receipt-namespace ids of the row’s own tenant are ever sent to the provider', async () => {
  await clearOld()
  const doc = await newUpload(tokA, 'document'); const card = await newUpload(tokA, 'card')
  const rcp = await newUpload(tokB)
  await db.collection('receiptuploads').deleteOne({ publicId: rcp.pid, orgId: B.orgId }) // re-filed below under the WRONG tenant
  const bad = [
    ['doc', doc.pid, A.orgId], ['card', card.pid, A.orgId],                       // other folders of the SAME tenant
    ['cross', rcp.pid, A.orgId],                                                  // a real receipt id filed under the wrong tenant
    ['trav', `doppeldash/${A.orgId}/receipts/../documents/x1234567`, A.orgId],    // traversal
    ['logo', 'branding/logo123456', A.orgId], ['empty', '', A.orgId], ['star', `doppeldash/${A.orgId}/receipts/*`, A.orgId],
  ]
  for (const [, pid, org] of bad) await db.collection('receiptuploads').insertOne({ orgId: org, publicId: pid || 'x', state: 'issued', issuedAt: new Date(Date.now() - 99 * H), nextCheckAt: new Date(Date.now() - 98 * H), failures: 0 })
  const before = (await fake.control.state()).files.length
  const rep = await run(); assert.equal(rep.deleted, 0); assert.equal(rep.failed, bad.length)
  assert.equal((await fake.control.state()).files.length, before, 'no asset anywhere was touched')
  assert.deepEqual((await fake.control.state()).destroyed, [], 'the provider never even received a delete request')
  assert.equal(cleanup.isReceiptNamespaceId(A.orgId, `doppeldash/${A.orgId}/receipts/abcdef12`), true)
  assert.equal(cleanup.isReceiptNamespaceId(B.orgId, `doppeldash/${A.orgId}/receipts/abcdef12`), false)
})

/* ── cron route: method contract + authorization boundary (dev server, fake provider, RECEIPT_CLEANUP_APPLY=1) ── */
const URL_ = `${kit.BASE_URL}/api/cron/receipts-cleanup`
async function cron({ method = 'POST', qs = '', headers = {}, body, raw } = {}) {
  const r = await fetch(URL_ + qs, { method, headers: { 'x-forwarded-for': kit.freshIp(), ...(body !== undefined || raw !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers }, body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined })
  const text = await r.text(); let json = null; try { json = JSON.parse(text) } catch { /* not json */ }
  return { status: r.status, text, json, headers: r.headers }
}
const BEARER = () => ({ Authorization: `Bearer ${CRON}` })
const filesNow = async () => (await fake.control.state()).files.length
async function oneOldOrphan() { await clearOld(); const u = await newUpload(); await age(u.pid, 26); return u }

test('H1. GET (and every other non-POST method) answers 405 + Allow: POST and NEVER deletes — even authorised, even with legacy ?apply=1', async () => {
  const u = await oneOldOrphan()
  for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
    for (const [qs, headers] of [['', {}], ['?apply=1', {}], ['?apply=1', BEARER()], ['?apply=1&limit=500&mode=apply', BEARER()]]) {
      const r = await cron({ method, qs, headers })
      assert.equal(r.status, 405, `${method} ${qs}`); assert.equal(r.headers.get('allow'), 'POST'); assert.match(r.headers.get('cache-control'), /no-store/)
    }
  }
  assert.equal(await inStorage(u.pid), true); assert.ok(await row(u.pid)); assert.equal((await row(u.pid)).state, 'issued', 'not even claimed')
  assert.deepEqual((await fake.control.state()).destroyed, [])
})

test('H2. unauthenticated / wrongly authenticated POSTs are rejected 401 and delete nothing (any body, any query)', async () => {
  const u = await oneOldOrphan()
  const decoy = 'decoy-' + crypto.randomBytes(8).toString('hex') // a query string/body is logged or inspected by proxies: it is never a credential
  const attempts = [
    { body: { mode: 'apply' } },
    { headers: { Authorization: 'Bearer wrong' }, body: { mode: 'apply' } },
    { headers: { Authorization: 'Bearer ' }, body: { mode: 'apply' } },
    { headers: { Authorization: `Basic ${CRON}` }, body: { mode: 'apply' } },
    { headers: { Authorization: CRON }, body: { mode: 'apply' } },
    { headers: { 'x-cron-secret': CRON }, body: { mode: 'apply' } },
    { headers: { Cookie: 'dd_session=x' }, body: { mode: 'apply' } },
    { qs: `?secret=${decoy}&apply=1`, body: { mode: 'apply' } },
    { body: { mode: 'apply', secret: decoy, cronSecret: decoy, authorization: `Bearer ${decoy}` } },
    { raw: 'not json' }, { raw: '' },
  ]
  for (const a of attempts) { const r = await cron(a); assert.equal(r.status, 401, JSON.stringify(a).slice(0, 80)); assert.equal(r.json.code, 'unauthorized'); assert.ok(!r.text.includes(CRON)) }
  assert.equal(await inStorage(u.pid), true); assert.ok(await row(u.pid))
})

test('H3. a valid bearer is the ONLY credential: the secret in the query string or body is never accepted', async () => {
  const u = await oneOldOrphan()
  // (the real secret is used here on purpose, but only via a header-less request that must fail — so it never reaches a log as a valid credential)
  assert.equal((await cron({ body: { mode: 'apply', secret: CRON } })).status, 401)
  assert.equal(await inStorage(u.pid), true)
})

test('A1. dry-run is the default: omitted body, empty object and explicit dry-run all count but never delete or claim', async () => {
  const u = await oneOldOrphan()
  for (const call of [{}, { body: {} }, { raw: '' }, { body: { mode: 'dry-run' } }, { body: { mode: 'dry-run', limit: 5 } }]) {
    const r = await cron({ headers: BEARER(), ...call }); assert.equal(r.status, 200, r.text)
    assert.deepEqual([r.json.mode, r.json.eligible, r.json.deleted], ['dry-run', 1, 0]); assert.match(r.headers.get('cache-control'), /no-store/)
  }
  assert.equal(await inStorage(u.pid), true); assert.equal((await row(u.pid)).state, 'issued')
})

test('A2. malformed mode / body / values fail safely with 400 and delete nothing', async () => {
  const u = await oneOldOrphan()
  const bad = [
    { body: { mode: 'APPLY' } }, { body: { mode: 'apply ' } }, { body: { mode: 'delete' } }, { body: { mode: true } }, { body: { mode: 1 } }, { body: { mode: null } }, { body: { mode: ['apply'] } }, { body: { mode: { x: 1 } } }, { body: { mode: '' } },
    { raw: '{bad json' }, { raw: '[]' }, { raw: 'null' }, { raw: '"apply"' }, { raw: '123' },
    { body: { mode: 'apply', apply: true } }, { body: { apply: true } }, { body: { mode: 'apply', public_id: u.pid } }, { body: { mode: 'apply', folder: 'doppeldash' } }, { body: { mode: 'apply', orgId: A.orgId } },
    { body: { mode: 'apply', limit: 0 } }, { body: { mode: 'apply', limit: -1 } }, { body: { mode: 'apply', limit: 501 } }, { body: { mode: 'apply', limit: 1.5 } }, { body: { mode: 'apply', limit: '5' } },
    { body: { mode: 'apply', cursor: '0'.repeat(24) } }, { body: { mode: 'dry-run', cursor: 'zz' } }, { body: { mode: 'dry-run', cursor: { $gt: '' } } },
    { raw: JSON.stringify({ mode: 'apply', pad: 'x'.repeat(5000) }) },
  ]
  for (const b of bad) { const r = await cron({ headers: BEARER(), ...b }); assert.equal(r.status, 400, JSON.stringify(b).slice(0, 90) + ' → ' + r.status + r.text.slice(0, 80)); assert.ok(r.json.code); assert.ok(!r.text.includes(u.pid)) }
  assert.equal(await inStorage(u.pid), true); assert.equal((await row(u.pid)).state, 'issued', 'nothing was even claimed')
})

test('A3. valid bearer + RECEIPT_CLEANUP_APPLY=1 + explicit mode "apply" executes against the fake provider; the query string cannot select it', async () => {
  const u = await oneOldOrphan(); const young = await newUpload()
  const viaQuery = await cron({ qs: '?apply=1&mode=apply', headers: BEARER() })           // legacy-style: stays a dry-run
  assert.deepEqual([viaQuery.status, viaQuery.json.mode, viaQuery.json.deleted], [200, 'dry-run', 0]); assert.equal(await inStorage(u.pid), true)
  const r = await cron({ headers: BEARER(), body: { mode: 'apply', limit: 10 } })
  assert.equal(r.status, 200, r.text); assert.deepEqual([r.json.mode, r.json.examined, r.json.deleted, r.json.failed, r.json.applyEnabled], ['apply', 1, 1, 0, true])
  assert.equal(await inStorage(u.pid), false); assert.equal(await row(u.pid), null)
  assert.equal(await inStorage(young.pid), true, 'a young upload is preserved')
  const again = await cron({ headers: BEARER(), body: { mode: 'apply' } }); assert.deepEqual([again.status, again.json.examined, again.json.deleted], [200, 0, 0], 'idempotent')
})

test('A4. requests cannot name assets, folders or tenants; documents/cards are untouched whatever the body says', async () => {
  const u = await oneOldOrphan(); const doc = await newUpload(tokA, 'document'); const card = await newUpload(tokA, 'card')
  for (const extra of [{ public_id: doc.pid }, { folder: `doppeldash/${A.orgId}/documents` }, { prefix: 'doppeldash' }, { assets: [card.pid] }]) {
    assert.equal((await cron({ headers: BEARER(), body: { mode: 'apply', ...extra } })).status, 400)
  }
  assert.equal((await cron({ headers: BEARER(), body: { mode: 'apply' } })).json.deleted, 1)
  assert.equal(await inStorage(doc.pid), true); assert.equal(await inStorage(card.pid), true); assert.equal(await inStorage(u.pid), false)
})

test('A5. successful and failing responses carry counts/codes only — no secret, provider URL, asset id or file content', async () => {
  const u = await oneOldOrphan()
  const out = []
  out.push((await cron({ headers: BEARER(), body: { mode: 'apply' } })).text)                                        // success
  await fake.control.mode({ storage: { destroy: 'error500' } }); const u2 = await newUpload(); await age(u2.pid, 26)
  out.push((await cron({ headers: BEARER(), body: { mode: 'apply' } })).text)                                        // provider failure path
  for (const a of [{ raw: '{bad' }, { body: { mode: 'x' } }, { body: { mode: 'apply', limit: 0 } }]) out.push((await cron({ headers: BEARER(), ...a })).text)
  out.push((await cron({ body: { mode: 'apply' } })).text, (await cron({ method: 'GET' })).text)
  const blob = out.join('\n')
  for (const bad of [CRON, fake.ENV.CLOUDINARY_API_SECRET, fake.ENV.CLOUDINARY_API_KEY, '127.0.0.1', 'http', 'cld:', 'doppeldash/', u.pid, u2.pid, 'signature']) assert.ok(!blob.includes(bad), `response leaked ${bad.slice(0, 8)}`)
  await fake.control.mode({ storage: { destroy: 'ok' } })
})

/* ── hygiene ── */
test('L1. job output never contains credentials, provider URLs, asset ids or receipt bytes (in-process capture + server log)', async () => {
  await clearOld()
  const u = await newUpload(); await age(u.pid, 26)
  const lines = []; const o = { log: console.log, error: console.error, warn: console.warn }
  console.log = console.error = console.warn = (...a) => lines.push(a.map(String).join(' '))
  const real = Expense.exists.bind(Expense)
  try {
    await run({ apply: false }); await fake.control.mode({ storage: { destroy: 'error500' } }); await run()
    Expense.exists = () => { throw new Error('db down ' + u.pid) }; await run()
  } finally { Object.assign(console, o); Expense.exists = real; await fake.control.mode({ storage: { destroy: 'ok' } }) }
  await cron({ headers: BEARER(), body: { mode: 'apply' } })
  const blob = lines.join('\n')
  for (const bad of [fake.ENV.CLOUDINARY_API_SECRET, CRON, '127.0.0.1:3912', u.pid, 'api_key', 'signature']) assert.ok(!blob.includes(bad), `in-process output leaked ${bad.slice(0, 6)}…`)
  if (process.env.DD_SERVER_LOG) {
    await new Promise(r => setTimeout(r, 300))
    const log = fs.readFileSync(process.env.DD_SERVER_LOG, 'utf8')
    for (const bad of [fake.ENV.CLOUDINARY_API_SECRET, CRON, u.pid, u.url]) assert.ok(!log.includes(bad), `server log leaked item ${[fake.ENV.CLOUDINARY_API_SECRET, CRON, u.pid, u.url].indexOf(bad)}`)
    assert.ok(log.includes('[receipt-cleanup]'), 'the job logged its aggregate counts')
  }
})
