/**
 * Per-line review of itemised expenses (found via the Android live suite, Phase 1I).
 * A reviewer decides one line with `PATCH /api/rms/:id { "lineItems.<i>.status": "approved"|"rejected" }`. Before the fix an index beyond the
 * last line made MongoDB pad the array (`lineItems.99.status` on a 3-line claim produced 100 lines and broke later writes with a 500).
 * Also pins the existing rules the Android client relies on: employees cannot decide or smuggle a status, a manager cannot decide their own
 * claim, other tenants see 404, and every resubmitted line restarts as pending. Fake storage provider not needed (no receipts). Disposable DB.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const kit = require('./helpers/authTestKit')

let db, org, emp, mgr, adm, other
test.before(async () => {
  db = await kit.connect()
  org = await kit.createOrg({ name: 'Line Review Org', plan: 'premium' })
  emp = await kit.login(org.employee.email)
  mgr = await kit.login(org.manager.email)
  adm = await kit.login(org.admin.email)
  const o2 = await kit.createOrg({ name: 'Line Review Other Org', plan: 'premium' })
  other = await kit.login(o2.admin.email)
})
test.after(async () => { await kit.cleanupAll(db); await kit.disconnect() })

const row = (d, a, extra = {}) => ({ description: d, amount: a, date: '2026-09-03', ...extra })
async function claim(token, lines, key) {
  const total = Math.round(lines.reduce((t, l) => t + l.amount, 0) * 100) / 100
  const r = await kit.api('/api/rms', { method: 'POST', token, body: { title: `Lines ${key}`, reason: 'r', startDate: '2026-09-03', hasLineItems: true, amount: total, lineItems: lines, clientRequestId: key } })
  assert.equal(r.status, 201, r.text)
  return r.json
}
const review = (token, id, body) => kit.api(`/api/rms/${id}`, { method: 'PATCH', token, body })
const stored = id => db.collection('expenses').findOne({ _id: new (require('mongodb').ObjectId)(id) })

test('L1 a reviewer decides existing lines; the answer carries the server statuses; amounts are untouched', async () => {
  const c = await claim(emp.accessToken, [row('a', 10), row('b', 20), row('c', 30)], 'lr-1')
  const r1 = await review(mgr.accessToken, c._id, { 'lineItems.2.status': 'rejected' })
  assert.equal(r1.status, 200, r1.text)
  const r2 = await review(mgr.accessToken, c._id, { 'lineItems.0.status': 'approved' })
  assert.deepEqual(r2.json.lineItems.map(l => l.status), ['approved', 'pending', 'rejected'])
  assert.equal(r2.json.amount, 60)
})

test('L2 an index beyond the last line is refused with 400 and the claim is NOT padded or altered', async () => {
  const c = await claim(emp.accessToken, [row('a', 10), row('b', 20), row('c', 30)], 'lr-2')
  for (const idx of [3, 4, 99, 1000000000, 99999999999999999999]) {
    const r = await review(mgr.accessToken, c._id, { [`lineItems.${idx}.status`]: 'approved' })
    assert.equal(r.status, 400, `index ${idx}: ${r.status} ${r.text}`)
    assert.deepEqual(r.json.fields, [`lineItems.${idx}.status`])
  }
  const doc = await stored(c._id)
  assert.equal(doc.lineItems.length, 3, 'no padding')
  assert.ok(doc.lineItems.every(l => l && l.description && l.status === 'pending'))
  assert.equal((await review(mgr.accessToken, c._id, { 'lineItems.1.status': 'approved' })).status, 200, 'later valid decisions still work')
})

test('L3 a valid index on a claim WITHOUT lines is refused too; negative or malformed keys are ignored, never applied', async () => {
  const simple = await kit.api('/api/rms', { method: 'POST', token: emp.accessToken, body: { title: 'plain lr-3', reason: 'r', startDate: '2026-09-03', amount: 10, clientRequestId: 'lr-3', receipts: [] } })
  assert.equal(simple.status, 201, simple.text)
  assert.equal((await review(mgr.accessToken, simple.json._id, { 'lineItems.0.status': 'approved' })).status, 400)
  const c = await claim(emp.accessToken, [row('a', 10)], 'lr-3b')
  for (const key of ['lineItems.-1.status', 'lineItems.0.amount', 'lineItems.0.status ', 'lineItems.x.status']) {
    await review(mgr.accessToken, c._id, { [key]: 'approved' })
  }
  const doc = await stored(c._id)
  assert.equal(doc.lineItems.length, 1)
  assert.equal(doc.lineItems[0].status, 'pending')
  assert.equal(doc.lineItems[0].amount, 10)
})

test('L4 values other than approved/rejected are ignored; an employee can neither decide a line nor smuggle a status', async () => {
  const c = await claim(emp.accessToken, [row('a', 10)], 'lr-4')
  await review(mgr.accessToken, c._id, { 'lineItems.0.status': 'paid' })
  assert.equal((await stored(c._id)).lineItems[0].status, 'pending')
  assert.equal((await review(emp.accessToken, c._id, { 'lineItems.0.status': 'approved' })).status, 403)
  const smuggled = await claim(emp.accessToken, [row('a', 10, { status: 'approved', reviewNote: 'self' })], 'lr-4b')
  assert.equal(smuggled.lineItems[0].status, 'pending')
  assert.equal(smuggled.lineItems[0].reviewNote, undefined)
})

test('L5 a manager cannot decide lines of their own claim; an admin may (audited); another tenant gets 404', async () => {
  const own = await claim(mgr.accessToken, [row('a', 10)], 'lr-5')
  assert.equal((await review(mgr.accessToken, own._id, { 'lineItems.0.status': 'approved' })).status, 403)
  assert.equal((await review(adm.accessToken, own._id, { 'lineItems.0.status': 'approved' })).status, 200)
  const c = await claim(emp.accessToken, [row('a', 10)], 'lr-5b')
  assert.equal((await review(other.accessToken, c._id, { 'lineItems.0.status': 'approved' })).status, 404)
  assert.equal((await stored(c._id)).lineItems[0].status, 'pending')
})

test('L6 a returned claim is revised by its owner and every line restarts as pending, whatever was decided before', async () => {
  const c = await claim(emp.accessToken, [row('a', 10), row('b', 20)], 'lr-6')
  await review(mgr.accessToken, c._id, { 'lineItems.0.status': 'approved' })
  await review(mgr.accessToken, c._id, { 'lineItems.1.status': 'rejected' })
  assert.equal((await review(mgr.accessToken, c._id, { status: 'returned', managerNote: 'fix' })).status, 200)
  const rev = await review(emp.accessToken, c._id, { title: c.title, reason: 'r', amount: 25, hasLineItems: true, lineItems: [row('a', 10, { status: 'approved' }), row('b', 15)] })
  assert.equal(rev.status, 200, rev.text)
  assert.deepEqual(rev.json.lineItems.map(l => l.status), ['pending', 'pending'])
  assert.equal(rev.json.status, 'pending_manager')
})
