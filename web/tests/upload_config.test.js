/**
 * Production fail-closed behaviour of receipt storage, as pure functions (no server, no database, no network).
 * The same guarantees are re-proved end to end against a real `next start` production server in
 * tests/upload_production_server.test.js.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const { load } = require('./helpers/domKit')
const st = load('lib/uploads/attachmentStorage.ts')
const { geminiBase } = load('lib/gemini.ts')

const ORG = 'org_test_a'
const ticket = (env, kind = 'receipt') => st.issueUploadTicket({ orgId: ORG, kind, maxBytes: 1000 }, st.storageConfig(env))
const FULL = { NODE_ENV: 'production', CLOUDINARY_CLOUD_NAME: 'acme', CLOUDINARY_API_KEY: 'k', CLOUDINARY_API_SECRET: 's3cr3t' }
const PRESET = { NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET: 'public_unsigned_preset', ALLOW_UNSIGNED_UPLOADS: '1' }

test('F1. production with NOTHING configured: no upload ticket, problem is reported', () => {
  const env = { NODE_ENV: 'production' }
  assert.equal(ticket(env), null)
  assert.equal(st.storageConfig(env).problem, 'missing_cloud_name')
})

test('F2. production with missing or INCOMPLETE signing config: still no ticket — never a silent unsigned fallback', () => {
  const cases = [
    [{ NODE_ENV: 'production', CLOUDINARY_CLOUD_NAME: 'acme' }, 'unsigned_not_enabled'],
    [{ NODE_ENV: 'production', CLOUDINARY_CLOUD_NAME: 'acme', CLOUDINARY_API_KEY: 'k' }, 'incomplete_signing'],
    [{ NODE_ENV: 'production', CLOUDINARY_CLOUD_NAME: 'acme', CLOUDINARY_API_SECRET: 's' }, 'incomplete_signing'],
    [{ NODE_ENV: 'production', CLOUDINARY_API_KEY: 'k', CLOUDINARY_API_SECRET: 's' }, 'missing_cloud_name'],
    [{ NODE_ENV: 'production', CLOUDINARY_CLOUD_NAME: 'acme', CLOUDINARY_API_KEY: ' ', CLOUDINARY_API_SECRET: '' }, 'unsigned_not_enabled'],
  ]
  for (const [env, problem] of cases) {
    assert.equal(ticket(env), null, JSON.stringify(env))
    assert.equal(st.storageConfig(env).problem, problem, JSON.stringify(env))
    assert.equal(st.storageConfig(env).signed, false)
  }
})

test('F3. production: the legacy unsigned preset is NEVER used, even if present and even if ALLOW_UNSIGNED_UPLOADS=1', () => {
  for (const extra of [PRESET, { NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET: 'p' }, { CLOUDINARY_UPLOAD_PRESET: 'p', ALLOW_UNSIGNED_UPLOADS: '1' }]) {
    const env = { NODE_ENV: 'production', CLOUDINARY_CLOUD_NAME: 'acme', ...extra }
    assert.equal(ticket(env), null, JSON.stringify(extra))
    assert.equal(st.storageConfig(env).unsignedAllowed, false)
  }
  // …and incomplete signing + the flag does not fall back to unsigned either
  assert.equal(ticket({ ...FULL, CLOUDINARY_API_SECRET: '', ...PRESET }), null)
})

test('F4. production with full config issues a SIGNED, private, tenant-bound ticket and exposes no secret', () => {
  const t = ticket(FULL)
  assert.equal(t.mode, 'signed')
  assert.equal(t.uploadUrl, 'https://api.cloudinary.com/v1_1/acme/auto/upload')
  assert.equal(t.fields.folder, `doppeldash/${ORG}/receipts`); assert.equal(t.fields.type, 'authenticated'); assert.equal(t.fields.overwrite, 'false')
  assert.match(t.fields.public_id, /^[0-9a-f]{32}$/)
  const expected = st.cloudinarySignature({ allowed_formats: t.fields.allowed_formats, folder: t.fields.folder, overwrite: 'false', public_id: t.fields.public_id, timestamp: t.fields.timestamp, type: 'authenticated' }, 's3cr3t')
  assert.equal(t.fields.signature, expected)
  assert.ok(!JSON.stringify(t).includes('s3cr3t'), 'the API secret must never appear in a ticket')
  assert.equal(ticket(FULL, 'document').fields.type, undefined)
  assert.equal(ticket({ ...FULL, CLOUDINARY_SIGNED_PRESET: 'signed_receipts' }).fields.upload_preset, 'signed_receipts', 'optional signed preset → provider-side enforcement')
})

test('F5. production ignores every test-fake override (storage can never be redirected by a stray env var)', () => {
  const env = { ...FULL, CLOUDINARY_UPLOAD_BASE: 'http://127.0.0.1:3912/cloud', CLOUDINARY_DELIVERY_BASE: 'http://127.0.0.1:3912/cloud' }
  const cfg = st.storageConfig(env)
  assert.equal(cfg.uploadBase, 'https://api.cloudinary.com'); assert.equal(cfg.deliveryBase, 'https://res.cloudinary.com')
  assert.equal(ticket(env).uploadUrl, 'https://api.cloudinary.com/v1_1/acme/auto/upload')
  // outside production the same override IS honoured (that is how local fakes work)
  assert.equal(st.storageConfig({ ...env, NODE_ENV: 'development' }).uploadBase, 'http://127.0.0.1:3912/cloud')
  // Gemini: same rule
  const prev = { n: process.env.NODE_ENV, b: process.env.GEMINI_API_BASE }
  try {
    process.env.GEMINI_API_BASE = 'http://127.0.0.1:3912/gemini'
    process.env.NODE_ENV = 'production'; assert.match(geminiBase(), /^https:\/\/generativelanguage\.googleapis\.com\//)
    process.env.NODE_ENV = 'development'; assert.match(geminiBase(), /^http:\/\/127\.0\.0\.1:3912\/gemini\//)
  } finally { process.env.NODE_ENV = prev.n; if (prev.b === undefined) delete process.env.GEMINI_API_BASE; else process.env.GEMINI_API_BASE = prev.b }
})

test('F6. development: unsigned mode needs an EXPLICIT opt-in AND a preset; otherwise it is also closed', () => {
  const dev = { NODE_ENV: 'development', CLOUDINARY_CLOUD_NAME: 'acme', NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET: 'dev_preset' }
  assert.equal(ticket(dev), null, 'a preset alone is not enough')
  assert.equal(ticket({ ...dev, ALLOW_UNSIGNED_UPLOADS: 'true' }), null, 'only the literal "1" enables it')
  assert.equal(ticket({ NODE_ENV: 'development', CLOUDINARY_CLOUD_NAME: 'acme', ALLOW_UNSIGNED_UPLOADS: '1' }), null, 'opt-in without a preset')
  const u = ticket({ ...dev, ALLOW_UNSIGNED_UPLOADS: '1' })
  assert.equal(u.mode, 'unsigned'); assert.deepEqual(u.fields, { upload_preset: 'dev_preset' })
  // signed always wins over unsigned when both are possible
  assert.equal(ticket({ ...dev, ...PRESET, CLOUDINARY_API_KEY: 'k', CLOUDINARY_API_SECRET: 's' }).mode, 'signed')
})

test('F7. when storage is not usable nothing downstream works either: attachments cannot be referenced, verified, fetched or deleted', async () => {
  const closed = st.storageConfig({ NODE_ENV: 'production', CLOUDINARY_CLOUD_NAME: 'acme' })
  const open = st.storageConfig(FULL)
  const url = `https://res.cloudinary.com/acme/image/authenticated/s--AAAAAAAA--/v1/doppeldash/${ORG}/receipts/${'a'.repeat(32)}.jpg`
  assert.match(st.receiptRefFromUploadUrl(url, ORG, open), /^cld:doppeldash\/org_test_a\/receipts\/a{32}\.jpg$/)
  assert.equal(st.receiptRefFromUploadUrl(url, ORG, closed), null)
  const ref = st.receiptRefFromUploadUrl(url, ORG, open)
  assert.equal(st.privateDownloadUrl(ref, ORG, closed), null)
  assert.ok(st.privateDownloadUrl(ref, ORG, open).startsWith('https://api.cloudinary.com/v1_1/acme/image/download?'))
  assert.ok(!st.privateDownloadUrl(ref, ORG, open).includes('s3cr3t'), 'the signed download request carries a signature, never the secret')
  assert.deepEqual(await st.verifyStoredReceipt(ref, ORG, 1e6, closed, async () => { throw new Error('must not be called') }), { ok: false, reason: 'not_found' })
  assert.equal(await st.destroyAttachments([ref], ORG, closed, async () => { throw new Error('must not be called') }), 0)
  // a public (type=upload) URL is not a receipt, a foreign tenant is not ours
  assert.equal(st.receiptRefFromUploadUrl(url.replace('/authenticated/', '/upload/'), ORG, open), null)
  assert.equal(st.receiptRefFromUploadUrl(url, 'org_other', open), null)
  assert.equal(st.parseReceiptRef(ref, 'org_other'), null)
})
