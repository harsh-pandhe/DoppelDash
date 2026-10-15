/**
 * Feature vertical 3 — RECEIPTS / OCR / CARD SCANNING.
 * Storage security (server-signed, tenant-folder uploads; attachment URL authorisation), the OCR provider chain and
 * its failure modes, output sanitising, plan quota (atomic under concurrency), role/tenant matrix, Web ↔ Android.
 *
 * Providers are LOCAL protocol-faithful fakes (tests/helpers/fakeProviders.js): they verify what WE sign/send/accept,
 * not real Cloudinary preset settings or real model accuracy. Requires a dev server on TEST_URL started with the fake
 * provider env (see tests/helpers/fakeProviders.js ENV), OCR_DEADLINE_MS=6000 (test O4) and the same throwaway DB.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { load } = require('./helpers/domKit')
const kit = require('./helpers/authTestKit')
const fake = require('./helpers/fakeProviders')

let db, smtp, providers, A, B, F, tok
test.before(async () => {
  providers = await fake.ensureFakeProviders()
  db = await kit.connect()
  smtp = await kit.startFakeSmtp(2525)
  A = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true }) // Doppelmayr-style
  B = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  F = await kit.createOrg({ plan: 'free', webEnabled: false })
  tok = {}
  for (const [k, org] of [['A', A], ['B', B], ['F', F]]) for (const r of ['admin', 'manager', 'employee']) {
    const s = await kit.login(org[r].email)
    tok[`${k}${r}`] = { token: s.accessToken, cookie: s.cookie }
  }
})
test.after(async () => { await kit.cleanupAll(db); await smtp.stop(); await providers.stop(); await kit.disconnect() })
test.beforeEach(async () => { await fake.control.reset(); await db.collection('ratelimits').deleteMany({ key: /^(rms-ocr|ocr|upload-sign):/ }) })

const who = (k, via = 'token') => ({ [via]: tok[k][via] })
const DEL = fake.ENV.CLOUDINARY_DELIVERY_BASE
const day = n => new Date(Date.now() + n * 864e5).toISOString()

/* ── fixtures: bytes the validators/fake sniff by magic number ── */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(600, 7)])
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 1)])
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF')
const TXT = Buffer.from('MZ this is not an image <script>alert(1)</script>')
const b64 = b => b.toString('base64')

const sign = (k, body, via = 'token') => kit.api('/api/uploads/sign', { method: 'POST', ...who(k, via), body })
async function uploadTo(ticket, bytes, over = {}) {
  const fd = new FormData()
  for (const [k, v] of Object.entries({ ...ticket.fields, ...over })) fd.append(k, v)
  fd.append('file', new Blob([bytes]), 'receipt.bin')
  const r = await fetch(ticket.uploadUrl, { method: 'POST', body: fd })
  return { status: r.status, json: await r.json().catch(() => null) }
}
/** The full client flow: ask the server for a ticket, upload to the (fake) storage, return the stored URL. */
async function uploadFile(k, bytes, mimeType = 'image/jpeg', via = 'token', kind = 'receipt') {
  const t = await sign(k, { kind, mimeType, sizeBytes: bytes.length }, via)
  assert.equal(t.status, 200, t.text)
  const u = await uploadTo(t.json, bytes)
  assert.equal(u.status, 200, JSON.stringify(u.json))
  return u.json.secure_url
}
const ocr = (k, imageBase64, extra = {}, via = 'token') => kit.api('/api/rms/ocr', { method: 'POST', ...who(k, via), body: { imageBase64, mimeType: 'image/jpeg', ...extra } })
const period = () => { const d = new Date(); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` }
const setUsed = (orgId, count) => db.collection('usagecounters').updateOne({ orgId, key: 'receiptScans', period: period() }, { $set: { count } }, { upsert: true })
const used = async orgId => (await db.collection('usagecounters').findOne({ orgId, key: 'receiptScans', period: period() }))?.count ?? 0
const pidOf = url => new URL(url).pathname.replace(/^.*\/authenticated\/(?:s--[^/]+--\/)?(?:v\d+\/)?/, '').replace(/\.\w+$/, '')
const getReceipt = async (k, path, via = 'token') => {
  const r = await fetch(`${kit.BASE_URL}${path}`, { headers: { ...(via === 'token' ? { Authorization: `Bearer ${tok[k].token}` } : { Cookie: tok[k].cookie }), 'x-forwarded-for': kit.freshIp() } })
  return { status: r.status, buf: Buffer.from(await r.arrayBuffer()), headers: r.headers }
}
const waitDestroyed = async pid => { for (let i = 0; i < 40 && !(await fake.control.state()).destroyed.includes(pid); i++) await new Promise(r => setTimeout(r, 50)); return (await fake.control.state()).destroyed.includes(pid) }
const expense = (k, o, via = 'token') => kit.api('/api/rms', { method: 'POST', ...who(k, via), body: { title: 'Taxi ' + crypto.randomBytes(3).toString('hex'), reason: 'client', amount: 450, startDate: day(-1), ...o } })

/* ═════════════ 1. STORAGE: authenticated, server-constrained upload tickets ═════════════ */
test('U1. signing needs a session; input is validated; secret never leaves the server', async () => {
  assert.equal((await kit.api('/api/uploads/sign', { method: 'POST', body: { kind: 'receipt', mimeType: 'image/jpeg', sizeBytes: 10 } })).status, 401)
  const bad = [[{ kind: 'evil' }, 400, 'kind'], [{ kind: 'receipt', mimeType: 'text/html', sizeBytes: 10 }, 415, 'mimeType'], [{ kind: 'receipt', mimeType: 'image/svg+xml', sizeBytes: 10 }, 415, 'mimeType'],
    [{ kind: 'receipt', mimeType: 'image/jpeg', sizeBytes: 0 }, 400, 'sizeBytes'], [{ kind: 'receipt', mimeType: 'image/jpeg', sizeBytes: 'big' }, 400, 'sizeBytes'], [{ kind: 'receipt', mimeType: 'image/jpeg', sizeBytes: -5 }, 400, 'sizeBytes'], [{}, 400, 'kind']]
  for (const [body, status, field] of bad) { const r = await sign('Aemployee', body); assert.equal(r.status, status, JSON.stringify(body)); assert.ok(r.json.fields?.includes(field), JSON.stringify(r.json)) }
  for (const raw of ['not json', '[]', 'null']) assert.equal((await kit.api('/api/uploads/sign', { method: 'POST', ...who('Aemployee'), raw, headers: { 'Content-Type': 'application/json' } })).status, 400)
  const ok = await sign('Aemployee', { kind: 'receipt', mimeType: 'image/jpeg', sizeBytes: 1000 })
  assert.equal(ok.status, 200); assert.equal(ok.json.mode, 'signed')
  assert.ok(!ok.text.includes(fake.ENV.CLOUDINARY_API_SECRET), 'API secret must never be sent to a client')
  assert.equal(ok.headers.get('cache-control'), 'no-store')
})

test('U2. the ticket binds the upload to the caller’s tenant folder, a random public id and the allowed formats', async () => {
  const t1 = (await sign('Aemployee', { kind: 'receipt', mimeType: 'image/png', sizeBytes: 100 })).json
  const t2 = (await sign('Aemployee', { kind: 'receipt', mimeType: 'image/png', sizeBytes: 100 })).json
  assert.equal(t1.fields.folder, `doppeldash/${A.orgId}/receipts`)
  assert.match(t1.fields.public_id, /^[0-9a-f]{32}$/); assert.notEqual(t1.fields.public_id, t2.fields.public_id)
  // 3.1.5: the ticket is pinned to the DECLARED type (it used to allow every format), so the provider itself refuses other contents.
  assert.equal(t1.fields.allowed_formats, 'png'); assert.equal(t1.fields.overwrite, 'false')
  for (const [mime, formats] of [['image/jpeg', 'jpg,jpeg'], ['image/png', 'png'], ['image/webp', 'webp'], ['image/heic', 'heic'], ['application/pdf', 'pdf']]) assert.equal((await sign('Aemployee', { kind: 'receipt', mimeType: mime, sizeBytes: 100 })).json.fields.allowed_formats, formats, mime)
  assert.equal(t1.fields.type, 'authenticated', 'receipts are stored privately (no public delivery)')
  assert.equal((await sign('Aemployee', { kind: 'document', mimeType: 'application/pdf', sizeBytes: 5 })).json.fields.type, undefined, 'only receipts are private for now')
  assert.ok(Math.abs(Number(t1.fields.timestamp) - Date.now() / 1000) < 30)
  const b = (await sign('Bemployee', { kind: 'receipt', mimeType: 'image/png', sizeBytes: 100 })).json
  assert.equal(b.fields.folder, `doppeldash/${B.orgId}/receipts`, 'each tenant gets its own folder')
  for (const [kind, folder] of [['card', 'cards'], ['document', 'documents'], ['image', 'images']]) assert.equal((await sign('Amanager', { kind, mimeType: 'image/jpeg', sizeBytes: 1 })).json.fields.folder, `doppeldash/${A.orgId}/${folder}`)
})

test('U3. storage enforces the signature: tampering with folder / formats / id, missing signature, replay, are all refused', async () => {
  const t = (await sign('Aemployee', { kind: 'receipt', mimeType: 'image/jpeg', sizeBytes: JPEG.length })).json
  assert.equal((await uploadTo(t, JPEG, { folder: `doppeldash/${B.orgId}/receipts` })).status, 401, 'cannot redirect into another tenant’s folder')
  assert.equal((await uploadTo(t, JPEG, { folder: 'anywhere' })).status, 401)
  assert.equal((await uploadTo(t, JPEG, { allowed_formats: 'exe,html' })).status, 401, 'cannot widen the allowed formats')
  assert.equal((await uploadTo(t, JPEG, { public_id: 'overwrite-existing' })).status, 401, 'cannot choose the public id')
  assert.equal((await uploadTo(t, JPEG, { signature: 'f'.repeat(40) })).status, 401)
  assert.equal((await uploadTo(t, JPEG, { type: 'upload' })).status, 401, 'cannot downgrade a receipt to a public asset')
  const noSig = { ...t, fields: Object.fromEntries(Object.entries(t.fields).filter(([k]) => k !== 'signature')) }
  assert.equal((await uploadTo(noSig, JPEG)).status, 401, 'anonymous/unsigned upload is refused')
  assert.equal((await uploadTo(t, TXT)).status, 400, 'non-image bytes rejected by the allowed_formats constraint')
  const good = await uploadTo(t, JPEG); assert.equal(good.status, 200)
  assert.ok(good.json.secure_url.includes(`/doppeldash/${A.orgId}/receipts/${t.fields.public_id}.jpg`))
  assert.equal((await uploadTo(t, JPEG)).status, 400, 'overwrite=false: replaying a ticket cannot replace the stored file')
  assert.equal((await uploadTo(t, PDF)).status, 400)
})

test('U4. PDFs: a PDF ticket works end to end (attachable), and the file is served back byte for byte', async () => {
  const url = await uploadFile('Aemployee', PDF, 'application/pdf')
  assert.match(url, /\.pdf$/)
  const r = await fetch(url); assert.equal(r.status, 200); assert.deepEqual(Buffer.from(await r.arrayBuffer()), PDF)
})

test('U5. plan size limits come from the entitlement resolver: Free 5 MB, Premium/Doppelmayr 25 MB', async () => {
  const six = 6 * 1024 * 1024
  const f = await sign('Femployee', { kind: 'receipt', mimeType: 'image/jpeg', sizeBytes: six }); assert.equal(f.status, 413); assert.equal(f.json.maxBytes, 5 * 1024 * 1024); assert.equal(f.json.code, 'file_too_large')
  assert.equal((await sign('Femployee', { kind: 'receipt', mimeType: 'image/jpeg', sizeBytes: 4 * 1024 * 1024 })).status, 200)
  for (const k of ['Aemployee', 'Amanager', 'Aadmin']) assert.equal((await sign(k, { kind: 'receipt', mimeType: 'image/jpeg', sizeBytes: six })).status, 200, `${k} premium`)
  assert.equal((await sign('Aadmin', { kind: 'receipt', mimeType: 'image/jpeg', sizeBytes: 26 * 1024 * 1024 })).status, 413)
  // never decided by name/slug: a FREE org named like Doppelmayr is still capped at 5 MB
  const fake2 = await kit.createOrg({ name: 'Doppelmayr India', plan: 'free', webEnabled: false })
  await db.collection('organizations').updateOne({ orgId: fake2.orgId }, { $set: { slug: 'doppelmayr-' + crypto.randomBytes(3).toString('hex') } })
  const s = await kit.login(fake2.admin.email)
  assert.equal((await kit.api('/api/uploads/sign', { method: 'POST', token: s.accessToken, body: { kind: 'receipt', mimeType: 'image/jpeg', sizeBytes: six } })).status, 413)
})

test('U6. signing is rate-limited per user', async () => {
  const codes = []
  for (let i = 0; i < 64; i++) codes.push((await sign('Bmanager', { kind: 'receipt', mimeType: 'image/jpeg', sizeBytes: 5 })).status)
  assert.ok(codes.includes(429), 'excess signing requests are throttled'); assert.equal(codes[0], 200)
})

/* ═════════════ 2. ATTACHMENT AUTHORISATION on expenses ═════════════ */
test('A1. an expense can only reference files from the caller’s own tenant folder (own upload accepted)', async () => {
  const mine = await uploadFile('Aemployee', JPEG)
  const ok = await expense('Aemployee', { receipts: [mine] }); assert.equal(ok.status, 201, ok.text); assert.deepEqual(ok.json.receipts, [`/api/rms/${ok.json._id}/receipt/0.jpg`], 'clients get an authenticated path, never a provider URL')
  assert.match((await db.collection('expenses').findOne({ _id: new (require('mongoose').Types.ObjectId)(ok.json._id) })).receipts[0], /^cld:doppeldash\/org_/, 'MongoDB keeps a provider-neutral reference')
  const theirs = await uploadFile('Bemployee', JPEG)
  const hash = () => crypto.randomBytes(16).toString('hex')
  const o = A.orgId, c = fake.ENV.CLOUDINARY_CLOUD_NAME
  const bad = {
    'other tenant’s file': theirs,
    'public (non-authenticated) delivery URL': `${DEL}/${c}/image/upload/v1/doppeldash/${o}/receipts/${hash()}.jpg`,
    'other tenant path (crafted)': `${DEL}/${c}/image/upload/v1/doppeldash/${B.orgId}/receipts/${hash()}.jpg`,
    'external host': `https://evil.example/${c}/image/upload/v1/doppeldash/${o}/receipts/${hash()}.jpg`,
    'tracking pixel': 'https://tracker.example/p.gif',
    'javascript:': 'javascript:alert(1)', 'data URI': 'data:text/html,<script>alert(1)</script>', 'file://': 'file:///etc/passwd',
    'wrong cloud': `${DEL}/othercloud/image/upload/v1/doppeldash/${o}/receipts/${hash()}.jpg`,
    'query string': `${mine}?x=1`, 'fragment': `${mine}#frag`, 'credentials': mine.replace('://', '://user:pw@'),
    'traversal': `${DEL}/${c}/image/upload/v1/doppeldash/${o}/receipts/../../${B.orgId}/receipts/${hash()}.jpg`,
    'encoded traversal': `${DEL}/${c}/image/upload/v1/doppeldash/${o}/receipts/%2e%2e/${hash()}.jpg`,
    'folder prefix trick': `${DEL}/${c}/image/upload/v1/doppeldash/${o}x/receipts/${hash()}.jpg`,
    'bad extension': `${DEL}/${c}/image/upload/v1/doppeldash/${o}/receipts/${hash()}.exe`, 'no extension': `${DEL}/${c}/image/upload/v1/doppeldash/${o}/receipts/${hash()}`,
    'overlong': mine + 'a'.repeat(2100),
  }
  for (const [name, url] of Object.entries(bad)) {
    const r = await expense('Aemployee', { receipts: [url] }); assert.equal(r.status, 400, `${name} → ${r.status} ${r.text.slice(0, 100)}`); assert.ok(r.json.fields.includes('receipts'), name)
  }
  assert.equal((await expense('Aemployee', { receipts: Array.from({ length: 11 }, () => mine) })).status, 400, 'attachment count capped at 10')
  const li = (url) => ({ hasLineItems: true, amount: 10, lineItems: [{ description: 'a', amount: 10, date: day(-1), receiptUrl: url }] })
  const lineUp = await uploadFile('Aemployee', JPEG)
  const lineRes = await expense('Aemployee', li(lineUp)); assert.equal(lineRes.status, 201, lineRes.text)
  assert.equal(lineRes.json.lineItems[0].receiptUrl, `/api/rms/${lineRes.json._id}/receipt/l0.jpg`)
  assert.equal((await expense('Aemployee', li(theirs))).status, 400, 'line-item receipts follow the same rule')
  assert.equal((await expense('Aemployee', li('https://tracker.example/x.png'))).status, 400)
})

test('A2. replacing a receipt on a returned expense is validated and deletes the dropped file from storage; withdrawal deletes all', async () => {
  const [u1, u2] = [await uploadFile('Aemployee', JPEG), await uploadFile('Aemployee', PNG, 'image/png')]
  const e = (await expense('Aemployee', { receipts: [u1] })).json
  assert.equal((await kit.api(`/api/rms/${e._id}`, { method: 'PATCH', ...who('Amanager'), body: { status: 'returned', managerNote: 'wrong receipt' } })).status, 200)
  const theirs = await uploadFile('Bemployee', JPEG)
  assert.equal((await kit.api(`/api/rms/${e._id}`, { method: 'PATCH', ...who('Aemployee'), body: { receipts: [theirs] } })).status, 400, 'cannot swap in another tenant’s file')
  const rep = await kit.api(`/api/rms/${e._id}`, { method: 'PATCH', ...who('Aemployee', 'cookie'), body: { receipts: [u2], amount: 450 } })
  assert.equal(rep.status, 200); assert.deepEqual(rep.json.receipts, [`/api/rms/${e._id}/receipt/0.png`])
  const pid1 = pidOf(u1)
  assert.ok(await waitDestroyed(pid1), 'the replaced file was removed from storage')
  const st = await fake.control.state()
  assert.ok(!st.destroyed.some(p => p.includes(B.orgId)), 'another tenant’s files are never touched')
  assert.equal((await kit.api(`/api/rms/${e._id}`, { method: 'DELETE', ...who('Aemployee') })).status, 200)
  assert.ok(await waitDestroyed(pidOf(u2)), 'withdrawing the claim removes its receipts')
})

/* ═════════════ 3. OCR pipeline ═════════════ */
test('O1. OCR success: Gemini answer is validated and returned; the review fields are exactly the five we accept', async () => {
  const r = await ocr('Aemployee', b64(JPEG)); assert.equal(r.status, 200, r.text)
  assert.deepEqual(r.json.parsed, { title: 'Taxi to client site', vendor: 'City Cabs', amount: 1250.5, date: '2026-10-03', description: 'Taxi fare' })
  assert.equal(r.json.source, 'gemma'); assert.equal(r.json.provider, 'gemini')
  assert.equal(r.json.quota.used, 1); assert.ok(r.json.quota.remaining >= 0 && r.json.quota.resetsAt)
  assert.equal((await fake.control.state()).calls.gemini, 1)
  // nothing was created by scanning: OCR only proposes values, the user reviews and submits
  assert.equal(await db.collection('expenses').countDocuments({ orgId: A.orgId, title: 'Taxi to client site' }), 0)
})

test('O2. tolerant parsing: fenced / prose-wrapped JSON is accepted; garbage, broken JSON and empty answers fall back (quota refunded)', async () => {
  await fake.control.mode({ gemini: 'fenced' })
  const f = await ocr('Aadmin', b64(JPEG)); assert.equal(f.json.provider, 'gemini'); assert.equal(f.json.parsed.amount, 1250.5)
  for (const mode of ['garbage', 'badjson', 'empty']) {
    await fake.control.mode({ gemini: mode, ollama: 'garbage' })
    const before = await used(A.orgId)
    const r = await ocr('Aadmin', b64(JPEG)); assert.equal(r.status, 200, `${mode} must never be a 5xx`)
    assert.equal(r.json.source, 'fallback'); assert.equal(r.json.provider, 'fallback'); assert.deepEqual(Object.values(r.json.parsed), [null, null, null, null, null])
    assert.equal(await used(A.orgId), before, `${mode}: a scan that read nothing costs no quota`)
  }
})

test('O3. provider failure chain: Gemini 5xx → Ollama answers; both fail → graceful fallback (200), not an error', async () => {
  await fake.control.mode({ gemini: 'error500', ollama: 'ok' })
  const a = await ocr('Aadmin', b64(JPEG)); assert.equal(a.status, 200); assert.equal(a.json.provider, 'ollama'); assert.equal(a.json.parsed.vendor, 'City Cabs')
  await fake.control.mode({ gemini: 'error500', ollama: 'error500' })
  const b = await ocr('Aadmin', b64(JPEG)); assert.equal(b.status, 200); assert.equal(b.json.source, 'fallback')
  assert.ok(!b.text.includes('secret-detail'), 'provider error bodies are never relayed to the client')
})

test('O4. a hung provider cannot hang the request: the deadline ends it with a graceful fallback', async () => {
  await fake.control.mode({ gemini: 'timeout', ollama: 'timeout' })
  const t0 = Date.now()
  const r = await ocr('Amanager', b64(JPEG)); const took = Date.now() - t0
  assert.equal(r.status, 200); assert.equal(r.json.source, 'fallback')
  assert.ok(took < 12_000, `returned in ${took} ms (server OCR deadline is 6 s in the test config)`)
})

test('O5. hostile model output is sanitised field by field; server-owned / approval fields can never ride along', async () => {
  await fake.control.mode({ gemini: 'evil' })
  const r = await ocr('Aadmin', b64(JPEG)); assert.equal(r.status, 200)
  assert.deepEqual(Object.keys(r.json.parsed).sort(), ['amount', 'date', 'description', 'title', 'vendor'])
  const p = r.json.parsed
  assert.ok(!/[\u0000-\u001f]/.test(p.title) && p.title.length <= 200 && p.title.startsWith('Dinner at Trident'))
  assert.equal(p.vendor, null, 'non-string vendor dropped'); assert.equal(p.amount, 4500.5, '₹4,500.50 parsed to a number')
  assert.equal(p.date, null, 'impossible date 2026-02-31 rejected'); assert.ok(p.description.length <= 500)
  for (const k of ['status', 'paidBy', 'userId', 'orgId', 'managerNote', 'paymentMethod']) assert.ok(!(k in p) && !r.text.includes(`"${k}"`), `${k} must not pass through`)
  await fake.control.mode({ gemini: 'badamount' }); const b = await ocr('Aadmin', b64(JPEG)); assert.equal(b.json.parsed.amount, null); assert.equal(b.json.parsed.date, null)
  await fake.control.mode({ gemini: 'futuredate' }); assert.equal((await ocr('Aadmin', b64(JPEG))).json.parsed.date, null)
})

test('O6. input validation: bad input is a 4xx with a code, nothing is charged, nothing reaches a provider', async () => {
  const before = await used(A.orgId)
  const png = b64(PNG)
  const cases = [
    [{}, 400, 'image_required'], [{ imageBase64: '' }, 400, 'image_required'], [{ imageBase64: 12345 }, 400, 'image_required'], [{ imageBase64: '%%%not-base64%%%' }, 400, 'invalid_base64'],
    [{ imageBase64: b64(PDF), mimeType: 'application/pdf' }, 415, 'pdf_not_scannable'], [{ imageBase64: b64(TXT) }, 415, 'unsupported_type'],
    [{ imageBase64: png, mimeType: 'image/jpeg' }, 415, 'type_mismatch'], [{ imageBase64: b64(Buffer.alloc(5_000_000, 0xff)) }, 413, 'image_too_large'],
  ]
  for (const [body, status, code] of cases) { const r = await kit.api('/api/rms/ocr', { method: 'POST', ...who('Aadmin'), body }); assert.equal(r.status, status, JSON.stringify(body).slice(0, 80) + ' → ' + r.text.slice(0, 120)); assert.equal(r.json.code, code) }
  for (const raw of ['not json', '[]', 'null']) assert.equal((await kit.api('/api/rms/ocr', { method: 'POST', ...who('Aadmin'), raw, headers: { 'Content-Type': 'application/json' } })).status, 400)
  assert.equal((await kit.api('/api/rms/ocr', { method: 'POST', body: { imageBase64: png } })).status, 401)
  assert.equal((await ocr('Aadmin', `data:image/png;base64,${png}`, { mimeType: undefined })).status, 200, 'data-URI prefix tolerated, type taken from the bytes')
  assert.equal((await fake.control.state()).calls.gemini, 1, 'only the one valid request reached a provider')
  assert.equal(await used(A.orgId), before + 1)
})

/* ═════════════ 4. QUOTA / ENTITLEMENT ═════════════ */
test('Q1. Free: the configured 20 scans/month is enforced, then a clear upgrade message; GET reports the state', async () => {
  await setUsed(F.orgId, 17)
  const ok = []
  for (let i = 0; i < 3; i++) ok.push(await ocr('Femployee', b64(JPEG)))
  assert.deepEqual(ok.map(r => r.status), [200, 200, 200]); assert.equal(ok[2].json.quota.remaining, 0)
  const blocked = await ocr('Femployee', b64(JPEG))
  assert.equal(blocked.status, 403); assert.equal(blocked.json.code, 'quota_exceeded'); assert.match(blocked.json.error, /Premium/); assert.equal(blocked.json.quota.limit, 20)
  assert.equal((await fake.control.state()).calls.gemini, 3, 'an exhausted org never reaches the provider')
  const g = await kit.api('/api/rms/ocr', who('Femployee')); assert.equal(g.status, 200); assert.deepEqual([g.json.enabled, g.json.quota.used, g.json.quota.limit, g.json.quota.remaining], [true, 20, 20, 0])
  // other roles of the same org share the pool
  assert.equal((await ocr('Fmanager', b64(JPEG))).status, 403)
  // and other tenants are unaffected
  assert.equal((await ocr('Bemployee', b64(JPEG))).status, 200)
})

test('Q2. concurrent scans at the boundary: exactly the remaining units succeed, the counter never exceeds the limit', async () => {
  await setUsed(F.orgId, 17)
  const rs = await Promise.all(Array.from({ length: 12 }, () => ocr('Fadmin', b64(JPEG))))
  const ok = rs.filter(r => r.status === 200).length, denied = rs.filter(r => r.status === 403).length
  assert.equal(ok, 3, rs.map(r => r.status).join()); assert.equal(denied, 9)
  assert.equal(await used(F.orgId), 20)
  assert.equal((await fake.control.state()).calls.gemini, 3)
})

test('Q3. first-ever scans racing on a brand-new counter all succeed under a generous limit and are all counted', async () => {
  const org = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  const s = await kit.login(org.admin.email)
  const rs = await Promise.all(Array.from({ length: 8 }, () => kit.api('/api/rms/ocr', { method: 'POST', token: s.accessToken, body: { imageBase64: b64(JPEG) } })))
  assert.ok(rs.every(r => r.status === 200), rs.map(r => r.status).join()); assert.equal(await used(org.orgId), 8)
})

test('Q4. Premium and Doppelmayr-style (lifetime) orgs get the Premium limit for every role; name/slug never matter', async () => {
  for (const k of ['Aadmin', 'Amanager', 'Aemployee']) {
    const g = await kit.api('/api/rms/ocr', who(k)); assert.equal(g.json.quota.limit, 5000, k); assert.equal(g.json.enabled, true)
  }
  assert.equal((await kit.api('/api/rms/ocr', who('Fadmin'))).json.quota.limit, 20)
  const fake2 = await kit.createOrg({ name: 'Doppelmayr India', plan: 'free', webEnabled: false })
  await db.collection('organizations').updateOne({ orgId: fake2.orgId }, { $set: { slug: 'doppelmayr-' + crypto.randomBytes(3).toString('hex') } })
  const s = await kit.login(fake2.employee.email)
  assert.equal((await kit.api('/api/rms/ocr', { token: s.accessToken })).json.quota.limit, 20)
})

/* ═════════════ 5. ROLES / TENANTS / SHARED STATE ═════════════ */
test('R1. every role can scan; both carriers hit the same counter; unauthenticated is 401', async () => {
  const start = await used(A.orgId), startB = await used(B.orgId)
  for (const [k, via] of [['Aemployee', 'token'], ['Amanager', 'cookie'], ['Aadmin', 'token'], ['Aemployee', 'cookie']]) assert.equal((await ocr(k, b64(JPEG), {}, via)).status, 200, `${k} ${via}`)
  assert.equal(await used(A.orgId), start + 4)
  assert.equal(await used(B.orgId), startB, 'org B’s counter is untouched by org A’s scans')
})

test('R2. Android upload → Web sees the receipt → Web (returned claim) corrects it → Android sees the new state', async () => {
  const urlA = await uploadFile('Aemployee', JPEG, 'image/jpeg', 'token')
  const e = (await expense('Aemployee', { receipts: [urlA], title: 'Android receipt' }, 'token')).json
  const onWeb = await kit.api(`/api/rms/${e._id}`, who('Amanager', 'cookie')); assert.deepEqual(onWeb.json.receipts, [`/api/rms/${e._id}/receipt/0.jpg`])
  const viaWeb = await getReceipt('Amanager', onWeb.json.receipts[0], 'cookie'); assert.equal(viaWeb.status, 200, 'the Web manager can read what Android uploaded'); assert.deepEqual(viaWeb.buf, JPEG)
  assert.equal((await kit.api(`/api/rms/${e._id}`, { method: 'PATCH', ...who('Amanager', 'cookie'), body: { status: 'returned', managerNote: 'blurry' } })).status, 200)
  const urlW = await uploadFile('Aemployee', PNG, 'image/png', 'cookie')
  assert.equal((await kit.api(`/api/rms/${e._id}`, { method: 'PATCH', ...who('Aemployee', 'cookie'), body: { receipts: [urlW] } })).status, 200)
  const back = await kit.api(`/api/rms/${e._id}`, who('Aemployee', 'token')); assert.deepEqual(back.json.receipts, [`/api/rms/${e._id}/receipt/0.png`]); assert.equal(back.json.status, 'pending_manager')
  assert.deepEqual((await getReceipt('Aemployee', back.json.receipts[0], 'token')).buf, PNG, 'Android reads the receipt Web corrected')
  assert.equal(await db.collection('expenses').countDocuments({ title: 'Android receipt' }), 1, 'one document, no duplicate storage model')
})

test('R3. tenant isolation: org B cannot read A’s expense receipts list or attach/replace/delete them; OCR never exposes data across tenants', async () => {
  const url = await uploadFile('Aemployee', JPEG)
  const e = (await expense('Aemployee', { receipts: [url], title: 'TENANT-RECEIPT-A' })).json
  for (const via of ['token', 'cookie']) {
    assert.ok(!JSON.stringify((await kit.api('/api/rms', who('Badmin', via))).json).includes('TENANT-RECEIPT-A'))
    assert.ok([403, 404].includes((await kit.api(`/api/rms/${e._id}`, who('Badmin', via))).status))
    assert.ok([403, 404].includes((await kit.api(`/api/rms/${e._id}`, { method: 'PATCH', ...who('Badmin', via), body: { receipts: [] } })).status))
    assert.ok([403, 404].includes((await kit.api(`/api/rms/${e._id}`, { method: 'DELETE', ...who('Badmin', via) })).status))
  }
  assert.deepEqual((await db.collection('expenses').findOne({ title: 'TENANT-RECEIPT-A' })).receipts, [`cld:${pidOf(url)}.jpg`])
  assert.ok(!(await fake.control.state()).destroyed.length, 'nothing was destroyed by cross-tenant attempts')
})

/* ═════════════ 6. BUSINESS-CARD OCR + SCANNED CARDS ═════════════ */
const card = (k, body, via = 'token') => kit.api('/api/crm/ocr', { method: 'POST', ...who(k, via), body })
test('C1. card OCR: fields validated (bad email/phone/URLs become null), same fallback behaviour, input validated', async () => {
  await fake.control.mode({ gemini: 'ok', receipt: { name: 'Priya Nair', email: 'not-an-email', phone: 'call me maybe', company: 'Kerala Ropeways', designation: 'Director', address: 'x'.repeat(900), website: 'javascript:alert(1)', linkedin: 'linkedin.com/in/priya', extra: 'dropped' } })
  const r = await card('Amanager', { imageBase64: b64(JPEG), mimeType: 'image/jpeg' }); assert.equal(r.status, 200, r.text)
  const p = r.json.parsed
  assert.equal(p.name, 'Priya Nair'); assert.equal(p.email, null); assert.equal(p.phone, null); assert.equal(p.website, null)
  assert.equal(p.linkedin, 'https://linkedin.com/in/priya'); assert.ok(p.address.length <= 500); assert.ok(!('extra' in p)); assert.equal(r.json.source, 'gemini')
  await fake.control.mode({ gemini: 'garbage', ollama: 'error500' })
  const f = await card('Amanager', { imageBase64: b64(JPEG) }); assert.equal(f.status, 200); assert.equal(f.json.source, 'fallback')
  assert.equal((await card('Amanager', { imageBase64: b64(PDF) })).status, 415)
  assert.equal((await card('Amanager', { imageBase64: b64(TXT) })).status, 415)
  assert.equal((await card('Amanager', {})).status, 400)
  assert.equal((await kit.api('/api/crm/ocr', { method: 'POST', body: { imageBase64: b64(JPEG) } })).status, 401)
})

test('C2. legacy imageUrl branch: no path traversal (incl. sibling-directory prefix trick); only images under /public', async () => {
  const root = path.resolve(__dirname, '..')
  const pub = path.join(root, 'public'), sib = path.join(root, 'public-secrets')
  fs.mkdirSync(sib, { recursive: true })
  fs.writeFileSync(path.join(sib, 'leak.png'), PNG); fs.writeFileSync(path.join(pub, 'ddqa-ocr-test.png'), PNG)
  try {
    for (const imageUrl of ['../public-secrets/leak.png', '/../public-secrets/leak.png', '../.env.local', '../package.json', '/etc/passwd', 'a/../../package.json', '..%2fpackage.json', 'ddqa-ocr-test.png.txt']) {
      const r = await card('Aadmin', { imageUrl }); assert.ok([400].includes(r.status), `${imageUrl} → ${r.status} ${r.text.slice(0, 80)}`)
    }
    const ok = await card('Aadmin', { imageUrl: 'ddqa-ocr-test.png' }); assert.equal(ok.status, 200)
  } finally { fs.rmSync(sib, { recursive: true, force: true }); fs.rmSync(path.join(pub, 'ddqa-ocr-test.png'), { force: true }) }
})

test('C3. scanned-card storage validates everything it keeps; ownership and tenant enforced; bad JSON is a 400', async () => {
  const uri = (b, m = 'image/jpeg') => `data:${m};base64,${b64(b)}`
  const post = (k, body, via = 'token') => kit.api('/api/crm/scanned-cards', { method: 'POST', ...who(k, via), body })
  const good = await post('Aemployee', { imageData: uri(JPEG), ocrSource: 'gemini', parsedFields: { name: 'Priya', email: 'p@x.com', website: 'https://x.com' } })
  assert.equal(good.status, 201, good.text); assert.equal(good.json.parsedFields.email, 'p@x.com')
  const bad = [
    [{}, 400], [{ imageData: 'plain text' }, 415], [{ imageData: uri(TXT) }, 415], [{ imageData: uri(PNG, 'image/jpeg') }, 415], [{ imageData: `data:image/svg+xml;base64,${b64(Buffer.from('<svg/>'))}` }, 415],
    [{ imageData: 'data:image/jpeg;base64,' + 'A'.repeat(1_600_000) }, 400], [{ imageData: uri(JPEG), ocrSource: 'skynet' }, 400],
    [{ imageData: uri(JPEG), parsedFields: { name: 'x', admin: 'true' } }, 400], [{ imageData: uri(JPEG), parsedFields: { email: 'nope' } }, 400], [{ imageData: uri(JPEG), parsedFields: { website: 'javascript:alert(1)' } }, 400],
    [{ imageData: uri(JPEG), parsedFields: 'x' }, 400], [{ imageData: uri(JPEG), rawText: 'r'.repeat(5001) }, 400], [{ imageData: uri(JPEG), contactId: 'zzz' }, 400],
  ]
  for (const [body, status] of bad) { const r = await post('Aemployee', body); assert.equal(r.status, status, JSON.stringify(body).slice(0, 90) + ' → ' + r.text.slice(0, 90)) }
  for (const raw of ['not json', '[]', 'null']) assert.equal((await kit.api('/api/crm/scanned-cards', { method: 'POST', ...who('Aemployee'), raw, headers: { 'Content-Type': 'application/json' } })).status, 400)
  const id = good.json._id, patch = (k, body) => kit.api(`/api/crm/scanned-cards/${id}`, { method: 'PATCH', ...who(k), body })
  assert.equal((await patch('Aemployee', { parsedFields: { name: 'Priya N', email: 'priya@x.com' } })).status, 200)
  assert.equal((await patch('Aemployee', { parsedFields: { email: 'bad' } })).status, 400)
  assert.equal((await patch('Aemployee', { imageData: uri(PNG, 'image/png') })).status, 400, 'the stored image cannot be swapped')
  assert.equal((await patch('Amanager', { parsedFields: { name: 'hijack' } })).status, 403, 'another user in the same org')
  assert.equal((await patch('Badmin', { parsedFields: { name: 'hijack' } })).status, 404, 'another tenant')
  assert.equal((await kit.api(`/api/crm/scanned-cards/${id}`, { method: 'DELETE', ...who('Badmin') })).status, 404)
  assert.ok(!JSON.stringify((await kit.api('/api/crm/scanned-cards', who('Badmin'))).json).includes(id))
  assert.equal((await kit.api(`/api/crm/scanned-cards/${id}`, { method: 'DELETE', ...who('Aemployee') })).status, 200)
})

/* ═════════════ 6b. PRIVATE RECEIPTS: retrieval, privacy, verification ═════════════ */
const ObjectId = require('mongoose').Types.ObjectId
const withReceipt = async (k = 'Aemployee', bytes = JPEG, mime = 'image/jpeg') => {
  const url = await uploadFile(k, bytes, mime)
  const r = await expense(k, { receipts: [url] }); assert.equal(r.status, 201, r.text)
  return { url, e: r.json }
}

test('P1. a receipt is readable ONLY through the authorised endpoint: owner, same-org manager/admin yes; other employee 403; other tenant 404; anonymous 401', async () => {
  const { e } = await withReceipt()
  const path = e.receipts[0]
  for (const [k, via] of [['Aemployee', 'token'], ['Aemployee', 'cookie'], ['Amanager', 'cookie'], ['Aadmin', 'token']]) {
    const r = await getReceipt(k, path, via); assert.equal(r.status, 200, `${k} ${via}`); assert.deepEqual(r.buf, JPEG)
    assert.match(r.headers.get('cache-control'), /no-store/); assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.equal(r.headers.get('content-type'), 'image/jpeg')
    assert.match(r.headers.get('content-disposition'), /inline; filename="receipt\.jpg"/); assert.match(r.headers.get('content-security-policy'), /sandbox/)
  }
  // PDFs are delivered as a download (never rendered inline in our origin)
  const pdfClaim = await withReceipt('Aemployee', PDF, 'application/pdf')
  const pdfRes = await getReceipt('Aemployee', pdfClaim.e.receipts[0]); assert.equal(pdfRes.status, 200); assert.deepEqual(pdfRes.buf, PDF)
  assert.equal(pdfRes.headers.get('content-type'), 'application/pdf'); assert.match(pdfRes.headers.get('content-disposition'), /^attachment; filename="receipt\.pdf"$/)
  // another employee of the SAME org (can't see the expense either)
  const other = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  await db.collection('users').updateOne({ email: other.employee.email }, { $set: { orgId: A.orgId } })
  const peer = await kit.login(other.employee.email)
  assert.equal((await fetch(`${kit.BASE_URL}${path}`, { headers: { Authorization: `Bearer ${peer.accessToken}`, 'x-forwarded-for': kit.freshIp() } })).status, 403, 'same org, not the owner, not a reviewer')
  for (const via of ['token', 'cookie']) for (const k of ['Bemployee', 'Bmanager', 'Badmin']) assert.equal((await getReceipt(k, path, via)).status, 404, `${k} ${via}: other tenant sees nothing`)
  assert.equal((await fetch(`${kit.BASE_URL}${path}`)).status, 401)
  for (const bad of [`/api/rms/${e._id}/receipt/9.jpg`, `/api/rms/${e._id}/receipt/x.jpg`, `/api/rms/${e._id}/receipt/../0.jpg`, `/api/rms/zzz/receipt/0.jpg`, `/api/rms/${e._id}/receipt/l0.jpg`, `/api/rms/${new ObjectId()}/receipt/0.jpg`]) assert.equal((await getReceipt('Aadmin', bad)).status, 404, bad)
  // after the claim is withdrawn the file is gone
  assert.equal((await kit.api(`/api/rms/${e._id}`, { method: 'DELETE', ...who('Aemployee') })).status, 200)
  assert.equal((await getReceipt('Aadmin', path)).status, 404)
})

test('P2. privacy: no API response or database row ever contains a provider URL; authenticated assets have no public delivery URL', async () => {
  const { url, e } = await withReceipt()
  const raw = await db.collection('expenses').findOne({ _id: new ObjectId(e._id) })
  const everything = JSON.stringify([e, (await kit.api('/api/rms', who('Aadmin'))).json, (await kit.api(`/api/rms/${e._id}`, who('Amanager', 'cookie'))).json, raw])
  for (const needle of ['/cloud/', 'authenticated/', 's--', 'testcloud', 'api_key', fake.ENV.CLOUDINARY_API_SECRET]) assert.ok(!everything.includes(needle), `leaked "${needle}"`)
  // the provider's own secure_url is a BEARER URL (anyone holding it can read) — which is exactly why we never store or return it
  assert.equal((await fetch(url)).status, 200, 'the upload response URL works for whoever holds it (provider-side bearer)')
  const pid = pidOf(url)
  assert.equal((await fetch(`${DEL}/${fake.ENV.CLOUDINARY_CLOUD_NAME}/image/upload/v1/${pid}.jpg`)).status, 404, 'there is NO public (type=upload) URL for a receipt')
  assert.equal((await fetch(url.replace(/s--[^/]+--/, 's--AAAAAAAA--'))).status, 401, 'a guessed/forged signature does not work')
})

test('P3. the server checks what was REALLY stored: lying about size is caught at attach time and the file is deleted', async () => {
  const big = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(6 * 1024 * 1024, 9)]) // Free plan limit is 5 MB
  const t = (await sign('Femployee', { kind: 'receipt', mimeType: 'image/jpeg', sizeBytes: 1000 })).json // declares 1000 bytes…
  const up = await uploadTo(t, big); assert.equal(up.status, 200, 'the provider fake (like an unconfigured provider) accepts it — only OUR check can stop it')
  const r = await kit.api('/api/rms', { method: 'POST', ...who('Femployee'), body: { title: 'Lied about size', reason: 'x', amount: 5, startDate: day(-1), receipts: [up.json.secure_url] } })
  assert.equal(r.status, 413, r.text); assert.equal(r.json.code, 'attachment_too_large'); assert.equal(r.json.maxBytes, 5 * 1024 * 1024)
  assert.equal(await db.collection('expenses').countDocuments({ title: 'Lied about size' }), 0)
  assert.ok(await waitDestroyed(up.json.public_id), 'the oversized asset was deleted from storage')
  // a never-uploaded reference, and re-using a file already attached to another claim
  const ghost = `${DEL}/${fake.ENV.CLOUDINARY_CLOUD_NAME}/image/authenticated/s--AAAAAAAA--/v1/doppeldash/${A.orgId}/receipts/${crypto.randomBytes(16).toString('hex')}.jpg`
  assert.equal((await expense('Aemployee', { receipts: [ghost] })).status, 400)
  const { url } = await withReceipt()
  const twice = await expense('Aemployee', { receipts: [url] }); assert.equal(twice.status, 409); assert.equal(twice.json.code, 'attachment_in_use')
  const stolen = await expense('Aadmin', { receipts: [url] }); assert.equal(stolen.status, 409, 'another user cannot attach a file that belongs to someone else’s claim')
})

test('P4. provider trouble fails closed and is explained: verification outage → 503 (nothing saved); delivery outage → 502; asset removed → 404', async () => {
  const url = await uploadFile('Aemployee', JPEG)
  await fake.control.mode({ storage: { admin: 'error500' } })
  const down = await expense('Aemployee', { receipts: [url], title: 'Provider down' }); assert.equal(down.status, 503); assert.equal(down.json.code, 'attachment_verification_unavailable')
  assert.equal(await db.collection('expenses').countDocuments({ title: 'Provider down' }), 0, 'never accept an attachment we could not verify')
  await fake.control.mode({ storage: { admin: 'ok' } })
  const ok = await expense('Aemployee', { receipts: [url], title: 'Provider back' }); assert.equal(ok.status, 201)
  await fake.control.mode({ storage: { download: 'error500' } })
  const r502 = await getReceipt('Aemployee', ok.json.receipts[0]); assert.equal(r502.status, 502)
  assert.ok(!r502.buf.toString().includes('boom'), 'provider error text is not relayed')
  await fake.control.mode({ storage: { download: 'ok' } })
  assert.equal((await getReceipt('Aemployee', ok.json.receipts[0])).status, 200)
  await fetch(`${fake.BASE}/__reset`); // drops stored files → asset gone at the provider
  assert.equal((await getReceipt('Aemployee', ok.json.receipts[0])).status, 404)
})

test('P5. revising a claim: kept receipts travel back as the paths the API gave; forged / foreign / raw refs and foreign paths are refused; legacy values survive unchanged', async () => {
  const { e } = await withReceipt()
  assert.equal((await kit.api(`/api/rms/${e._id}`, { method: 'PATCH', ...who('Amanager'), body: { status: 'returned', managerNote: 'add one' } })).status, 200)
  const second = await uploadFile('Aemployee', PNG, 'image/png')
  const kept = e.receipts[0]
  const ok = await kit.api(`/api/rms/${e._id}`, { method: 'PATCH', ...who('Aemployee'), body: { receipts: [kept, second] } })
  assert.equal(ok.status, 200, ok.text); assert.deepEqual(ok.json.receipts, [`/api/rms/${e._id}/receipt/0.jpg`, `/api/rms/${e._id}/receipt/1.png`])
  assert.equal((await getReceipt('Aemployee', ok.json.receipts[0])).status, 200, 'the kept receipt was not deleted')
  const refStored = (await db.collection('expenses').findOne({ _id: new ObjectId(e._id) })).receipts
  await kit.api(`/api/rms/${e._id}`, { method: 'PATCH', ...who('Amanager'), body: { status: 'returned', managerNote: 'again' } })
  const patch = body => kit.api(`/api/rms/${e._id}`, { method: 'PATCH', ...who('Aemployee'), body })
  const foreign = (await withReceipt()).e
  assert.equal((await patch({ receipts: [foreign.receipts[0]] })).status, 400, 'another expense’s path is not mine to reuse')
  assert.equal((await patch({ receipts: [refStored[0]] })).status, 400, 'a raw reference from a client is not accepted')
  assert.equal((await patch({ receipts: [`/api/rms/${e._id}/receipt/5.jpg`] })).status, 400, 'index out of range')
  assert.equal((await patch({ receipts: ['https://evil.example/x.jpg'] })).status, 400)
  // legacy: a pre-existing public URL already stored on the claim is passed through and may be sent back unchanged, nothing else
  const legacy = 'https://res.cloudinary.example/legacy/old-receipt.jpg'
  const le = await db.collection('expenses').insertOne({ orgId: A.orgId, userId: A.employee.id, userName: 'Eve', title: 'Legacy claim', reason: 'r', amount: 10, startDate: new Date(), status: 'returned', receipts: [legacy], lineItems: [], hasLineItems: false })
  const lid = String(le.insertedId)
  const shown = (await kit.api(`/api/rms/${lid}`, who('Aemployee'))).json; assert.deepEqual(shown.receipts, [legacy], 'legacy public URLs are passed through as they are (and are NOT private)')
  assert.equal((await getReceipt('Aemployee', `/api/rms/${lid}/receipt/0.jpg`)).status, 404, 'the private endpoint does not serve legacy public files')
  assert.equal((await kit.api(`/api/rms/${lid}`, { method: 'PATCH', ...who('Aemployee'), body: { receipts: [legacy], reason: 'resubmit' } })).status, 200)
  assert.equal((await kit.api(`/api/rms/${lid}`, { method: 'PATCH', ...who('Amanager'), body: { status: 'returned' } })).status, 200)
  assert.equal((await kit.api(`/api/rms/${lid}`, { method: 'PATCH', ...who('Aemployee'), body: { receipts: [legacy, 'https://res.cloudinary.example/legacy/other.jpg'] } })).status, 400)
})

/* ═════════════ 6c. COHERENT SIZE LIMITS (sign = verify = read) ═════════════ */
const MB = 1024 * 1024
const big = n => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(n - 4, 5)])
const attach = (k, url, extra = {}) => kit.api('/api/rms', { method: 'POST', ...who(k), body: { title: 'Size ' + crypto.randomBytes(3).toString('hex'), reason: 'size test', amount: 10, startDate: day(-1), receipts: [url], ...extra } })
/** upload through a valid ticket while DECLARING a small size (the realistic bypass: the backend cannot see direct-upload bytes) */
async function uploadLying(k, bytes) {
  const t = (await sign(k, { kind: 'receipt', mimeType: 'image/jpeg', sizeBytes: 1000 })).json
  const u = await uploadTo(t, bytes); assert.equal(u.status, 200, JSON.stringify(u.json)); return u.json
}

test('S1. ONE canonical limit everywhere: the ceiling is derived from the plan config and equals the largest plan limit', async () => {
  const plans = load('lib/entitlements/plans.ts')
  const st = load('lib/uploads/attachmentStorage.ts')
  const largest = Math.max(plans.PLAN_CONFIGS.free.limits.maxUploadSizeBytes, plans.PLAN_CONFIGS.premium.limits.maxUploadSizeBytes)
  assert.equal(largest, 25 * MB); assert.equal(plans.maxUploadCeilingBytes(), largest); assert.equal(st.receiptSizeCeiling(), largest)
  assert.equal(plans.PLAN_CONFIGS.free.limits.maxUploadSizeBytes, 5 * MB)
  const src = fs.readFileSync(path.resolve(__dirname, '../app/api/rms/[id]/receipt/[file]/route.ts'), 'utf8')
  assert.ok(!/12\s*\*\s*1024/.test(src) && !/MAX_PROXY_BYTES/.test(src), 'no separate magic proxy limit remains')
})

test('S2. FREE boundary: exactly 5 MB passes sign → attach → read (streamed back byte for byte); 5 MB + 1 is refused at sign AND (if the client lied) at attach, and the file is deleted', async () => {
  assert.equal((await sign('Femployee', { kind: 'receipt', mimeType: 'image/jpeg', sizeBytes: 5 * MB })).status, 200)
  const over = await sign('Femployee', { kind: 'receipt', mimeType: 'image/jpeg', sizeBytes: 5 * MB + 1 }); assert.equal(over.status, 413); assert.equal(over.json.maxBytes, 5 * MB)
  const exact = big(5 * MB)
  const ok = await uploadLying('Femployee', exact)
  const r = await attach('Femployee', ok.secure_url); assert.equal(r.status, 201, r.text)
  const back = await getReceipt('Femployee', r.json.receipts[0]); assert.equal(back.status, 200); assert.equal(back.buf.length, 5 * MB); assert.ok(back.buf.equals(exact))
  const lie = await uploadLying('Femployee', big(5 * MB + 1))
  const bad = await attach('Femployee', lie.secure_url); assert.equal(bad.status, 413, bad.text); assert.equal(bad.json.code, 'attachment_too_large')
  assert.ok(await waitDestroyed(lie.public_id), 'the rejected asset was deleted')
})

test('S3. PREMIUM / Doppelmayr boundary: exactly 25 MB passes sign → attach → read (the old 12 MB proxy cap is gone); 25 MB + 1 is refused', async () => {
  for (const k of ['Aemployee', 'Amanager', 'Aadmin']) assert.equal((await sign(k, { kind: 'receipt', mimeType: 'image/jpeg', sizeBytes: 25 * MB })).status, 200, k)
  const over = await sign('Aemployee', { kind: 'receipt', mimeType: 'image/jpeg', sizeBytes: 25 * MB + 1 }); assert.equal(over.status, 413); assert.equal(over.json.maxBytes, 25 * MB)
  const exact = big(25 * MB)
  const up = await uploadLying('Aemployee', exact)
  const r = await attach('Aemployee', up.secure_url); assert.equal(r.status, 201, r.text)
  for (const [k, via] of [['Aemployee', 'token'], ['Amanager', 'cookie']]) {
    const back = await getReceipt(k, r.json.receipts[0], via); assert.equal(back.status, 200, `${k}`); assert.equal(back.buf.length, 25 * MB); assert.ok(back.buf.equals(exact))
  }
  const lie = await uploadLying('Aemployee', big(25 * MB + 1))
  const bad = await attach('Aemployee', lie.secure_url); assert.equal(bad.status, 413); assert.ok(await waitDestroyed(lie.public_id))
})

test('S4. reading is bounded streaming: an asset over the ceiling is refused up front (declared length) or cut off (undeclared length) — never buffered, never delivered whole', async () => {
  const mk = async (bytes) => {
    const id = crypto.randomBytes(16).toString('hex'); const pid = `doppeldash/${A.orgId}/receipts/${id}`
    await fetch(`${fake.BASE}/__inject`, { method: 'POST', body: JSON.stringify({ path: pid, bytes, ext: 'jpg', type: 'authenticated' }) })
    const ins = await db.collection('expenses').insertOne({ orgId: A.orgId, userId: A.employee.id, userName: 'Eve', title: 'Injected ' + id.slice(0, 6), reason: 'r', amount: 5, startDate: new Date(), status: 'pending_manager', receipts: [`cld:${pid}.jpg`], lineItems: [], hasLineItems: false })
    return `/api/rms/${ins.insertedId}/receipt/0.jpg`
  }
  const tooBig = await mk(25 * MB + 1)
  const declared = await getReceipt('Aemployee', tooBig); assert.equal(declared.status, 413); assert.match(declared.buf.toString(), /too_large/)
  await fake.control.mode({ storage: { download: 'chunked' } })
  let delivered = 0, failed = false
  try { delivered = (await getReceipt('Aemployee', tooBig)).buf.length } catch { failed = true }
  assert.ok(failed || delivered <= 25 * MB, `an over-ceiling stream must not be delivered whole (delivered ${delivered})`)
  const exact = await mk(25 * MB)
  const chunkedOk = await getReceipt('Aemployee', exact); assert.equal(chunkedOk.status, 200); assert.equal(chunkedOk.buf.length, 25 * MB, 'a file exactly at the ceiling streams fully even without a declared length')
})

test('S5. plan changes cannot strand a receipt: a 20 MB Premium receipt stays readable after a downgrade, while a new 20 MB upload is refused on Free', async () => {
  const org = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  const s = await kit.login(org.employee.email)
  const asEmp = (p, o = {}) => kit.api(p, { token: s.accessToken, ...o })
  const t = (await asEmp('/api/uploads/sign', { method: 'POST', body: { kind: 'receipt', mimeType: 'image/jpeg', sizeBytes: 20 * MB } })).json
  const up = await uploadTo(t, big(20 * MB)); assert.equal(up.status, 200)
  const e = await asEmp('/api/rms', { method: 'POST', body: { title: 'Premium 20MB', reason: 'r', amount: 5, startDate: day(-1), receipts: [up.json.secure_url] } }); assert.equal(e.status, 201, e.text)
  await db.collection('organizations').updateOne({ orgId: org.orgId }, { $set: { plan: 'free', lifetimeGrant: false, entitlementSource: 'none', subscriptionStatus: 'none' } })
  const after = await fetch(`${kit.BASE_URL}${e.json.receipts[0]}`, { headers: { Authorization: `Bearer ${s.accessToken}`, 'x-forwarded-for': kit.freshIp() } })
  assert.equal(after.status, 200); assert.equal((await after.arrayBuffer()).byteLength, 20 * MB)
  assert.equal((await asEmp('/api/uploads/sign', { method: 'POST', body: { kind: 'receipt', mimeType: 'image/jpeg', sizeBytes: 20 * MB } })).status, 413, 'the downgraded org is now limited to 5 MB for new uploads')
})

/* ═════════════ 6d. REJECTED / ABANDONED ASSETS ═════════════ */
test('R4. an oversized upload that was rejected can never be attached later — by any route, with any altered request — even if deletion failed', async () => {
  await fake.control.mode({ storage: { destroy: 'error500' } }) // provider refuses to delete: the asset stays stored
  const lie = await uploadLying('Femployee', big(5 * MB + 1))
  const bad = await attach('Femployee', lie.secure_url); assert.equal(bad.status, 413)
  assert.ok(!(await fake.control.state()).destroyed.includes(lie.public_id), 'deletion failed (simulated) — the asset is still in storage')
  assert.equal((await fake.control.state()).files.some(f => f.includes(lie.public_id)), true)
  // retry unchanged, via a returned claim PATCH, via line items, as another user of the same org, with the signature segment altered, with the extension swapped
  assert.equal((await attach('Femployee', lie.secure_url)).status, 413, 'retry is verified again against the real stored size')
  assert.equal((await attach('Fmanager', lie.secure_url)).status, 413)
  const li = await kit.api('/api/rms', { method: 'POST', ...who('Femployee'), body: { title: 'Li ' + crypto.randomBytes(3).toString('hex'), reason: 'r', amount: 10, hasLineItems: true, startDate: day(-1), lineItems: [{ description: 'a', amount: 10, date: day(-1), receiptUrl: lie.secure_url }] } })
  assert.equal(li.status, 413, li.text)
  assert.equal((await attach('Femployee', lie.secure_url.replace(/s--[^/]+--/, 's--AAAAAAAA--'))).status, 413, 'a different signature segment changes nothing: the decision is made on the stored bytes')
  for (const ext of ['png', 'pdf']) assert.equal((await attach('Femployee', lie.secure_url.replace(/\.jpg$/, `.${ext}`))).status, 400, `.${ext} swap`)
  const ok = await expense('Femployee', { receipts: [await uploadFile('Femployee', JPEG)] }); assert.equal(ok.status, 201)
  const rev = await kit.api(`/api/rms/${ok.json._id}`, { method: 'PATCH', ...who('Fmanager'), body: { status: 'returned', managerNote: 'x' } }); assert.equal(rev.status, 200)
  assert.equal((await kit.api(`/api/rms/${ok.json._id}`, { method: 'PATCH', ...who('Femployee'), body: { receipts: [lie.secure_url] } })).status, 413, 'also when swapping it into a returned claim')
  await fake.control.mode({ storage: { destroy: 'ok' } })
})

test('R5. a file cannot be passed off as another type: a JPEG referenced as .pdf/.png (or vice versa) is rejected at attach — and the mislabelled upload is deleted', async () => {
  const jpg = await uploadFile('Aemployee', JPEG)
  assert.equal((await attach('Aemployee', jpg.replace(/\.jpg$/, '.pdf'))).status, 400)
  assert.ok(await waitDestroyed(pidOf(jpg)), 'the spoofed upload was removed')
  assert.equal((await attach('Aemployee', jpg)).status, 400, 'and the original reference no longer resolves')
  const pdf = await uploadFile('Aemployee', PDF, 'application/pdf')
  assert.equal((await attach('Aemployee', pdf.replace(/\.pdf$/, '.png'))).status, 400)
  const honest = await uploadFile('Aemployee', PDF, 'application/pdf')
  const ok = await attach('Aemployee', honest); assert.equal(ok.status, 201, ok.text)
  assert.equal((await getReceipt('Aemployee', ok.json.receipts[0])).headers.get('content-type'), 'application/pdf')
})

test('R6. KNOWN LIMITATION (documented, not hidden): an upload that is never attached stays in storage — a cleanup job is required', async () => {
  const lone = await uploadFile('Aemployee', JPEG)
  await new Promise(r => setTimeout(r, 400))
  assert.equal((await fake.control.state()).files.some(f => f.includes(pidOf(lone))), true, 'abandoned uploads are not auto-deleted today (see docs/RECEIPT_STORAGE_AND_OCR.md §10)')
})

/* ═════════════ 7. LOGGING ═════════════ */
test('L1. the server log never contains provider keys, the storage secret, or image data', { skip: !process.env.DD_SERVER_LOG }, () => {
  const log = fs.readFileSync(process.env.DD_SERVER_LOG, 'utf8')
  for (const secret of [fake.ENV.CLOUDINARY_API_SECRET, fake.ENV.GEMINI_API_KEY, b64(JPEG).slice(0, 40), 'secret-detail']) assert.ok(!log.includes(secret), `log leaks ${secret.slice(0, 12)}…`)
})
