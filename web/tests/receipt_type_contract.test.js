/**
 * Feature 3.1.5 — receipt FILE-TYPE CONTRACT: the type a file is declared as (the MIME the client states when it asks for an upload
 * ticket — derived from the picked file's name/extension by both apps) must be the file's REAL, content-detected type.
 *
 * Why this exists: direct-to-provider uploads never show the server the filename, and the stored reference's extension comes from
 * the provider's own detection, so "ref extension == provider format" was a tautology for an honest upload and a renamed file
 * (lying.pdf containing a PNG) was accepted and stored as a PNG. The declared MIME is now (1) bound into the SIGNED ticket
 * (`allowed_formats`) so the provider refuses other contents, and (2) recorded in the server-side manifest and re-checked at attach.
 *
 * Fake providers only (tests/helpers/fakeProviders.js): they prove OUR enforcement. Whether real Cloudinary honours
 * `allowed_formats` against content-detected formats is provider-dependent and NOT verified here (the server-side check at attach
 * is the independent guarantee). Requires the dev server env described in receipt_ocr_vertical.test.js.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const kit = require('./helpers/authTestKit')
const fake = require('./helpers/fakeProviders')

let db, smtp, providers, A, B, F, tok, Expense
const day = n => new Date(Date.now() + n * 864e5).toISOString()
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(300, 1)])
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, 7)])
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF')
const TXT = Buffer.from('MZ not an image <script>alert(1)</script>')
const MIME = { png: 'image/png', jpg: 'image/jpeg', pdf: 'application/pdf' }

test.before(async () => {
  providers = await fake.ensureFakeProviders(); db = await kit.connect(); smtp = await kit.startFakeSmtp(2525)
  A = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  B = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  F = await kit.createOrg({ plan: 'free', webEnabled: false })
  tok = {}; for (const [k, o] of [['A', A], ['B', B], ['F', F]]) tok[k] = (await kit.login(o.employee.email)).accessToken
  Expense = kit.load('models/Expense.ts').default
})
test.after(async () => { await db.collection('receiptuploads').deleteMany({ orgId: { $in: [A.orgId, B.orgId, F.orgId] } }); await kit.cleanupAll(db); await smtp.stop(); await providers.stop(); await kit.disconnect() })
test.beforeEach(async () => { await fake.control.reset(); await db.collection('ratelimits').deleteMany({ key: /^upload-sign:/ }) })

const api = (path, t, body, method = 'POST') => kit.api(path, { method, token: tok[t], body })
const sign = (t, mime, size = 100, kind = 'receipt') => api('/api/uploads/sign', t, { kind, mimeType: mime, sizeBytes: size })
async function put(ticket, bytes, over = {}) {
  const fd = new FormData(); for (const [k, v] of Object.entries({ ...ticket.fields, ...over })) fd.append(k, v); fd.append('file', new Blob([bytes]), 'whatever.bin')
  const r = await fetch(ticket.uploadUrl, { method: 'POST', body: fd }); return { status: r.status, json: await r.json().catch(() => null) }
}
/** What a real client does: declare `mime`, upload `bytes`. Returns the ticket row, upload result and (if stored) the ref. */
async function flow(t, mime, bytes) {
  const tk = await sign(t, mime, bytes.length); assert.equal(tk.status, 200, tk.text)
  const up = await put(tk.json, bytes)
  return { tk: tk.json, up, pid: `${tk.json.fields.folder}/${tk.json.fields.public_id}`, url: up.json && up.json.secure_url }
}
const attach = (t, url, extra = {}) => api('/api/rms', t, { title: 'T ' + crypto.randomBytes(3).toString('hex'), reason: 'client', amount: 10, startDate: day(-1), receipts: [url], ...extra })
const row = pid => db.collection('receiptuploads').findOne({ publicId: pid })
const inStorage = async pid => (await fake.control.state()).files.some(f => f.startsWith(pid + '.'))
const refsWith = pid => db.collection('expenses').countDocuments({ $or: [{ receipts: { $regex: pid.replace(/[/]/g, '\\/') } }, { 'lineItems.receiptUrl': { $regex: pid.replace(/[/]/g, '\\/') } }] })
const inject = (pid, ext, bytes = 400) => fetch(`${fake.BASE}/__inject`, { method: 'POST', body: JSON.stringify({ path: pid, ext, bytes, type: 'authenticated' }) })
const proxy = async (t, id, name) => { const r = await fetch(`${kit.BASE_URL}/api/rms/${id}/receipt/${name}`, { headers: { Authorization: `Bearer ${tok[t]}`, 'x-forwarded-for': kit.freshIp() } }); return { status: r.status, ct: r.headers.get('content-type'), cd: r.headers.get('content-disposition'), buf: Buffer.from(await r.arrayBuffer()) } }

/* ── 1. the provider enforces the declared type (signed allowed_formats) ── */
test('T1. PNG content declared as PDF is refused by the provider at upload; nothing is stored, nothing is attachable', async () => {
  const r = await flow('A', MIME.pdf, PNG)
  assert.equal(r.up.status, 400); assert.match(r.up.json.error.message, /not allowed/i)
  assert.equal(await inStorage(r.pid), false); assert.equal((await fake.control.state()).uploads.length, 0)
  for (const ref of [`cld:${r.pid}.png`, `cld:${r.pid}.pdf`]) { const a = await attach('A', `${fake.ENV.CLOUDINARY_DELIVERY_BASE}/testcloud/image/authenticated/v1/${r.pid}.${ref.slice(-3)}`); assert.equal(a.status, 400) }
  assert.equal(await refsWith(r.pid), 0)
})

test('T2. PDF content declared as PNG (and as JPEG) is refused the same way', async () => {
  for (const mime of [MIME.png, MIME.jpg]) { const r = await flow('A', mime, PDF); assert.equal(r.up.status, 400, mime); assert.equal(await inStorage(r.pid), false) }
})

test('T3. every cross-combination of {png, jpeg, pdf, text} that is not "declared == real" is refused; the matching ones are stored', async () => {
  const content = { png: PNG, jpg: JPEG, pdf: PDF }
  for (const [d, mime] of Object.entries(MIME)) for (const [real, bytes] of Object.entries(content)) {
    const r = await flow('A', mime, bytes)
    if (d === real) { assert.equal(r.up.status, 200, `${d}/${real}`); assert.equal(await inStorage(r.pid), true) }
    else { assert.equal(r.up.status, 400, `${d} declared, ${real} real`); assert.equal(await inStorage(r.pid), false) }
  }
  for (const mime of Object.values(MIME)) assert.equal((await flow('A', mime, TXT)).up.status, 400, 'unsupported content under ' + mime)
})

test('T4. the ticket cannot be widened or re-declared: altered allowed_formats / swapped MIME at the sign step / forged fields are refused', async () => {
  const tk = (await sign('A', MIME.pdf)).json
  assert.equal(tk.fields.allowed_formats, 'pdf')
  assert.equal((await put(tk, PNG, { allowed_formats: 'png' })).status, 401, 'widening the signed allowed_formats invalidates the signature')
  assert.equal((await put(tk, PNG, { allowed_formats: 'jpg,jpeg,png,webp,heic,pdf' })).status, 401)
  const noFormats = { ...tk, fields: { ...tk.fields } }; delete noFormats.fields.allowed_formats
  assert.equal((await put(noFormats, PNG)).status, 401, 'dropping the field invalidates the signature')
  // unsupported / malformed declarations never get a ticket
  for (const mime of ['image/svg+xml', 'text/html', 'application/x-msdownload', '', null, 5, ['application/pdf']]) assert.notEqual((await sign('A', mime)).status, 200, JSON.stringify(mime))
})

/* ── 2. valid flows keep working; the proxy uses the verified type ── */
test('V1. valid PNG and valid PDF: declared == real → uploaded, attached, stored under their real type, served with that type', async () => {
  const png = await flow('A', MIME.png, PNG); const pdf = await flow('A', MIME.pdf, PDF); const jpg = await flow('A', MIME.jpg, JPEG)
  for (const r of [png, pdf, jpg]) assert.equal(r.up.status, 200)
  const e = await attach('A', png.url, { lineItems: undefined }); assert.equal(e.status, 201, e.text)
  const e2 = await attach('A', pdf.url); assert.equal(e2.status, 201, e2.text)
  const e3 = await attach('A', jpg.url); assert.equal(e3.status, 201, e3.text)
  const p1 = await proxy('A', e.json._id || e.json.id, '0.png'); assert.equal(p1.status, 200); assert.equal(p1.ct, 'image/png'); assert.deepEqual(p1.buf, PNG)
  const p2 = await proxy('A', e2.json._id || e2.json.id, '0.pdf'); assert.equal(p2.ct, 'application/pdf'); assert.match(p2.cd, /^attachment/); assert.deepEqual(p2.buf, PDF)
  const p3 = await proxy('A', e3.json._id || e3.json.id, '0.jpg'); assert.equal(p3.ct, 'image/jpeg')
  for (const r of [png, pdf, jpg]) assert.equal((await row(r.pid)).state, 'attached')
})

test('V2. the proxy picks the content type from the VERIFIED stored reference, never from the URL suffix the caller asks for', async () => {
  const png = await flow('A', MIME.png, PNG); const pdf = await flow('A', MIME.pdf, PDF)
  const e = (await attach('A', png.url)).json; const e2 = (await attach('A', pdf.url)).json
  for (const name of ['0.png', '0.pdf', '0.jpg', '0.html', '0.svg', '0.exe']) {
    const p = await proxy('A', e._id || e.id, name); assert.equal(p.ct, 'image/png', name); assert.doesNotMatch(p.cd || '', /attachment/)
    const q = await proxy('A', e2._id || e2.id, name); assert.equal(q.ct, 'application/pdf', name); assert.match(q.cd, /^attachment/)
  }
})

/* ── 3. the trusted attach boundary (server-side), independent of the provider ── */
test('S1. a provider that does NOT enforce allowed_formats (asset injected under a PDF-declared ticket) is still refused at attach: type_mismatch, no expense, asset deleted, row rejected', async () => {
  const tk = (await sign('A', MIME.pdf, 500)).json; const pid = `${tk.fields.folder}/${tk.fields.public_id}`
  await inject(pid, 'png')                                           // PNG content now sits in storage under a ticket declared as PDF
  const url = `${fake.ENV.CLOUDINARY_DELIVERY_BASE}/testcloud/image/authenticated/v1/${pid}.png`
  const r = await attach('A', url); assert.equal(r.status, 400, r.text); assert.equal(r.json.code, 'attachment_type_mismatch'); assert.deepEqual(r.json.fields, ['receipts'])
  assert.doesNotMatch(r.text, /cld:|https?:|doppeldash\/|testcloud|signature/i, 'the error is non-sensitive')
  assert.equal(await refsWith(pid), 0)
  for (let i = 0; i < 40 && await inStorage(pid); i++) await new Promise(r => setTimeout(r, 50))
  assert.equal(await inStorage(pid), false, 'best-effort deletion ran')
  assert.equal((await row(pid)).state, 'rejected')
  // …and it can never be attached later, even if the deletion had failed (re-inject to simulate a failed delete)
  await inject(pid, 'png')
  assert.equal((await attach('A', url)).status, 400); assert.equal(await refsWith(pid), 0)
})

test('S2. forged references: wrong extension for the stored type, wrong tenant, malformed, other kinds, injected junk — none attach', async () => {
  const ok = await flow('A', MIME.png, PNG)
  const base = `${fake.ENV.CLOUDINARY_DELIVERY_BASE}/testcloud/image/authenticated/v1`
  const bad = [`${base}/${ok.pid}.pdf`, `${base}/${ok.pid}.jpg`, `${base}/${ok.pid}.html`, `${base}/${ok.pid}`, `${base}/${ok.pid}.png?x=1`, `${base}/${ok.pid}.png#f`, `${base}/doppeldash/${B.orgId}/receipts/${ok.pid.split('/').pop()}.png`, `${base}/${ok.pid.replace('/receipts/', '/documents/')}.png`, 'cld:' + ok.pid + '.png', `${base}/${ok.pid}/../x.png`]
  for (const u of bad) assert.equal((await attach('A', u)).status, 400, u.slice(-60))
  assert.equal(await refsWith(ok.pid), 0)
  assert.equal((await attach('B', ok.url)).status, 400, 'another tenant cannot use it'); assert.equal(await refsWith(ok.pid), 0)
  const junk = `doppeldash/${A.orgId}/receipts/${crypto.randomBytes(16).toString('hex')}`; await inject(junk, 'pdf')
  assert.equal((await attach('A', `${base}/${junk}.pdf`)).status, 201, 'an untracked legacy asset of the right type still attaches (documented: no declaration to compare)')
  assert.equal((await attach('A', `${base}/${junk}.png`)).status, 400, '…but never under a different extension')
})

test('S3. rejection cannot bypass size / plan limits and cannot be retried into an attachment', async () => {
  await db.collection('organizations').updateOne({ orgId: F.orgId }, { $set: {} })
  const tk = (await sign('F', MIME.png, 100)).json; const pid = `${tk.fields.folder}/${tk.fields.public_id}`
  await inject(pid, 'png', 6 * 1024 * 1024)                          // 6 MB on a Free (5 MB) plan, correct type
  const url = `${fake.ENV.CLOUDINARY_DELIVERY_BASE}/testcloud/image/authenticated/v1/${pid}.png`
  const r1 = await attach('F', url); assert.equal(r1.status, 413); assert.equal(r1.json.code, 'attachment_too_large')
  assert.equal((await row(pid)).state, 'rejected')
  assert.equal(await refsWith(pid), 0)
  const big = await sign('F', MIME.png, 6 * 1024 * 1024); assert.equal(big.status, 413, 'tickets are still plan-limited')
  const ok = await sign('F', MIME.png, 5 * 1024 * 1024); assert.equal(ok.status, 200, 'exactly 5 MB is still allowed')
})

test('S4. rejected rows are retried by the cleanup job (a failed delete does not leave a permanent orphan) and never touched by attach', async () => {
  const cleanup = kit.load('lib/uploads/receiptCleanup.ts')
  Object.assign(process.env, fake.ENV)
  const tk = (await sign('A', MIME.pdf, 500)).json; const pid = `${tk.fields.folder}/${tk.fields.public_id}`
  await inject(pid, 'png'); await fake.control.mode({ storage: { destroy: 'error500' } })
  const url = `${fake.ENV.CLOUDINARY_DELIVERY_BASE}/testcloud/image/authenticated/v1/${pid}.png`
  assert.equal((await attach('A', url)).status, 400); await new Promise(r => setTimeout(r, 400))
  assert.equal(await inStorage(pid), true, 'the delete failed (fake outage)'); assert.equal((await row(pid)).state, 'rejected')
  await fake.control.mode({ storage: { destroy: 'ok' } })
  await db.collection('receiptuploads').updateOne({ publicId: pid }, { $set: { issuedAt: new Date(Date.now() - 30 * 3600e3), nextCheckAt: new Date(Date.now() - 3600e3) } })
  const rep = await cleanup.runReceiptCleanup({ apply: true }); assert.equal(rep.deleted, 1, JSON.stringify(rep))
  assert.equal(await inStorage(pid), false); assert.equal(await row(pid), null)
})

/* ── 4. authorization and limits unchanged ── */
test('A1. tenant isolation and authentication still hold for tickets and the proxy', async () => {
  assert.equal((await kit.api('/api/uploads/sign', { method: 'POST', body: { kind: 'receipt', mimeType: MIME.png, sizeBytes: 10 } })).status, 401)
  const r = await flow('A', MIME.png, PNG); const e = (await attach('A', r.url)).json; const id = e._id || e.id
  assert.equal((await proxy('B', id, '0.png')).status, 404); assert.equal((await proxy('F', id, '0.png')).status, 404)
  const anon = await fetch(`${kit.BASE_URL}/api/rms/${id}/receipt/0.png`, { headers: { 'x-forwarded-for': kit.freshIp() } }); assert.equal(anon.status, 401)
  assert.equal(r.tk.fields.folder, `doppeldash/${A.orgId}/receipts`)
})

test('A2. other upload kinds are pinned to their declared type too (cards/documents/images), without any manifest row', async () => {
  for (const kind of ['card', 'document', 'image']) {
    const tk = (await sign('A', MIME.pdf, 100, kind)).json; assert.equal(tk.fields.allowed_formats, 'pdf', kind)
    assert.equal((await put(tk, PNG)).status, 400, kind + ' PNG as PDF'); assert.equal((await put((await sign('A', MIME.png, 100, kind)).json, PNG)).status, 200, kind + ' PNG as PNG')
  }
  assert.equal(await db.collection('receiptuploads').countDocuments({ orgId: A.orgId, publicId: /\/(cards|documents|images)\// }), 0)
})
