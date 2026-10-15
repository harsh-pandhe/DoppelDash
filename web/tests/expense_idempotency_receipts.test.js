/**
 * Expense submit idempotency WITH receipts (found via the Android live suite, Phase 1I).
 * A retried or double-tapped submit that carries the same clientRequestId must return the SAME expense — also when it carries a
 * receipt. Before the fix the receipt-attachment check ran first, so the retry was refused with 409 `attachment_in_use` even though the
 * claim existed (while the same retry without receipts correctly returned 200).
 * Uses the LOCAL fake storage provider; disposable DB.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const kit = require('./helpers/authTestKit')
const fake = require('./helpers/fakeProviders')

let db, providers, org, emp, other
test.before(async () => {
  db = await kit.connect()
  providers = await fake.ensureFakeProviders()
  org = await kit.createOrg({ name: 'Idempotency Org', plan: 'premium' })
  emp = await kit.login(org.employee.email)
  other = await kit.login(org.manager.email)
})
test.after(async () => {
  await providers.stop()
  await kit.cleanupAll(db)
  await kit.disconnect()
})

const JPEG = n => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(300, n)])
async function upload(token, bytes) {
  const t = await kit.api('/api/uploads/sign', { method: 'POST', token, body: { kind: 'receipt', mimeType: 'image/jpeg', sizeBytes: bytes.length } })
  assert.equal(t.status, 200, t.text)
  const fd = new FormData()
  for (const [k, v] of Object.entries(t.json.fields)) fd.append(k, v)
  fd.append('file', new Blob([bytes]), 'r.jpg')
  const r = await fetch(t.json.uploadUrl, { method: 'POST', body: fd })
  assert.equal(r.status, 200)
  return (await r.json()).secure_url
}
const body = (key, receipts, title = `Idem ${key}`) => ({ title, reason: 'client visit', amount: 450.5, startDate: new Date().toISOString(), receipts, clientRequestId: key })
const submit = (token, b) => kit.api('/api/rms', { method: 'POST', token, body: b })
const count = key => db.collection('expenses').countDocuments({ orgId: org.orgId, clientRequestId: key })

test('I1 a retry with the same clientRequestId and the same receipt returns the original expense (200), not attachment_in_use', async () => {
  const url = await upload(emp.accessToken, JPEG(1))
  const first = await submit(emp.accessToken, body('idem-1', [url]))
  assert.equal(first.status, 201, first.text)
  const retry = await submit(emp.accessToken, body('idem-1', [url]))
  assert.equal(retry.status, 200, `retry must be idempotent, got ${retry.status} ${retry.text}`)
  assert.equal(retry.json._id, first.json._id)
  assert.equal(await count('idem-1'), 1)
})

test('I2 simultaneous double taps with a receipt: one claim, every response is that claim', async () => {
  const url = await upload(emp.accessToken, JPEG(2))
  const rs = await Promise.all(Array.from({ length: 6 }, () => submit(emp.accessToken, body('idem-2', [url]))))
  assert.ok(rs.every(r => r.status === 200 || r.status === 201), rs.map(r => r.status).join())
  assert.equal(new Set(rs.map(r => r.json?._id)).size, 1)
  assert.equal(await count('idem-2'), 1)
})

test('I3 the same key with a DIFFERENT fresh receipt still returns the original (the key identifies the claim, not the payload)', async () => {
  const a = await upload(emp.accessToken, JPEG(3))
  const first = await submit(emp.accessToken, body('idem-3', [a]))
  const b = await upload(emp.accessToken, JPEG(4))
  const retry = await submit(emp.accessToken, body('idem-3', [b]))
  assert.equal(retry.status, 200, retry.text)
  assert.equal(retry.json._id, first.json._id)
})

test('I4 the idempotency key is scoped to the caller; a receipt already attached to someone else’s claim is still refused', async () => {
  const url = await upload(emp.accessToken, JPEG(5))
  const mine = await submit(emp.accessToken, body('idem-4', [url]))
  assert.equal(mine.status, 201)
  const theirs = await submit(other.accessToken, body('idem-4', [url], 'someone else'))
  assert.equal(theirs.status, 409, 'a different user cannot reuse the receipt, even with the same key')
  assert.equal(theirs.json.code, 'attachment_in_use')
  assert.equal(await count('idem-4'), 1)
})

test('I5 a different key with an already-attached receipt is still refused (single-holder rule intact)', async () => {
  const url = await upload(emp.accessToken, JPEG(6))
  assert.equal((await submit(emp.accessToken, body('idem-5a', [url]))).status, 201)
  const again = await submit(emp.accessToken, body('idem-5b', [url]))
  assert.equal(again.status, 409)
  assert.equal(again.json.code, 'attachment_in_use')
})
