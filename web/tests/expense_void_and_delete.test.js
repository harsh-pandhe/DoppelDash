/**
 * Owner decisions D-03.1 / D-03.2 (approved 2026-10-25). Real routes, throwaway DB.
 *   D-03.1  A claim that is in payout review (pending_admin), paid, rejected or void is NEVER hard-deleted, by any role (409 claim_settled).
 *           Only pending_manager and returned claims may be deleted (owner withdraws; manager/admin may delete).
 *   D-03.2  A PAID claim can be corrected only by an admin voiding it, with a mandatory reason. The claim, amount, line items and receipts are
 *           kept; the void is audited (expense.void) and voided claims drop out of reports/analytics totals.
 * A refusal changes nothing: the document is byte-identical afterwards and no audit row is written.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const mongoose = require('mongoose')
const kit = require('./helpers/authTestKit')

let db, A, B, tok
test.before(async () => {
  db = await kit.connect()
  A = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true }); B = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  tok = {}
  for (const [k, org] of [['A', A], ['B', B]]) for (const r of ['admin', 'manager', 'employee']) tok[`${k}${r}`] = (await kit.login(org[r].email)).accessToken
})
test.after(async () => { await kit.cleanupAll(db); await kit.disconnect() })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const oid = s => new mongoose.Types.ObjectId(s)
const call = (k, id, method, body) => kit.api(`/api/rms/${id}`, { method, token: tok[k], body })
const newExpense = async (status, extra = {}) => {
  const r = await kit.api('/api/rms', { method: 'POST', token: tok.Aemployee, body: { title: 'Void ' + kit.rand(), reason: 'QA', amount: 100, startDate: new Date(Date.now() - 864e5).toISOString(), ...extra } })
  assert.equal(r.status, 201, r.text)
  for (let i = 0; i < 60 && !(await db.collection('auditlogs').findOne({ targetId: r.json._id })); i++) await sleep(50)   // the 'submitted' audit row is written after the response
  await sleep(100)
  if (status !== 'pending_manager') await db.collection('expenses').updateOne({ _id: oid(r.json._id) }, { $set: { status, ...(status === 'paid' ? { paidAt: new Date() } : {}) } })
  return r.json._id
}
const snap = async id => JSON.stringify(await db.collection('expenses').findOne({ _id: oid(id) }))
const audits = id => db.collection('auditlogs').countDocuments({ targetId: id })
const exists = async id => !!(await db.collection('expenses').findOne({ _id: oid(id) }))

// ───────────── D-03.1 delete guard ─────────────
// [actor, from state, expected status]
const DELETE_CASES = [
  ['Aadmin', 'paid', 409], ['Amanager', 'paid', 409], ['Aemployee', 'paid', 403],
  ['Aadmin', 'pending_admin', 409], ['Amanager', 'pending_admin', 409], ['Aemployee', 'pending_admin', 403],
  ['Aadmin', 'rejected', 409], ['Amanager', 'rejected', 409], ['Aemployee', 'rejected', 403],
  ['Aadmin', 'void', 409], ['Amanager', 'void', 409],
  ['Aadmin', 'pending_manager', 200], ['Amanager', 'pending_manager', 200], ['Aemployee', 'pending_manager', 200],
  ['Aadmin', 'returned', 200], ['Amanager', 'returned', 200], ['Aemployee', 'returned', 200],
  ['Badmin', 'paid', 404], ['Badmin', 'pending_manager', 404],
]
for (const [actor, from, expected] of DELETE_CASES) {
  test(`D1. ${actor} DELETE on ${from} → ${expected}`, async () => {
    const id = await newExpense(from)
    const before = await snap(id); const auditBefore = await audits(id)
    const r = await call(actor, id, 'DELETE')
    assert.equal(r.status, expected, r.text)
    if (expected === 409) assert.equal(r.json.code, 'claim_settled')
    if (expected === 200) { assert.equal(await exists(id), false); return }
    assert.equal(await exists(id), true, 'a refused delete must keep the claim')
    await sleep(150)
    assert.equal(await snap(id), before, 'a refused request must not mutate the record'); assert.equal(await audits(id), auditBefore, 'and writes no audit row')
  })
}

// ───────────── D-03.2 void ─────────────
const REASON = { adminNote: 'paid twice by mistake — duplicate bank transfer' }
const VOID_CASES = [
  ['Aadmin', 'paid', { status: 'void', ...REASON }, 200],
  ['Aadmin', 'paid', { status: 'void' }, 400], ['Aadmin', 'paid', { status: 'void', adminNote: '   ' }, 400],
  ['Amanager', 'paid', { status: 'void', ...REASON }, 403], ['Amanager', 'paid', { status: 'void', managerNote: 'x' }, 403],
  ['Aemployee', 'paid', { status: 'void', ...REASON }, 403],
  ['Aadmin', 'pending_admin', { status: 'void', ...REASON }, 409], ['Aadmin', 'pending_manager', { status: 'void', ...REASON }, 409],
  ['Aadmin', 'rejected', { status: 'void', ...REASON }, 409], ['Aadmin', 'returned', { status: 'void', ...REASON }, 409],
  ['Aadmin', 'void', { status: 'void', ...REASON }, 409], ['Aadmin', 'void', { status: 'paid' }, 409], ['Aadmin', 'void', { status: 'pending_manager', ...REASON }, 409],
  ['Badmin', 'paid', { status: 'void', ...REASON }, 404],
]
for (const [actor, from, body, expected] of VOID_CASES) {
  test(`V1. ${actor} on ${from} ${JSON.stringify(body)} → ${expected}`, async () => {
    const id = await newExpense(from)
    const before = await snap(id); const auditBefore = await audits(id)
    const r = await call(actor, id, 'PATCH', body)
    assert.equal(r.status, expected, r.text)
    if (expected === 200) { for (let i = 0; i < 60 && (await audits(id)) < auditBefore + 1; i++) await sleep(50) }
    await sleep(150)
    if (expected !== 200) { assert.equal(await snap(id), before, 'a refused request must not mutate the record'); assert.equal(await audits(id), auditBefore, 'and writes no audit row') }
    else assert.equal(await audits(id), auditBefore + 1, 'one audit row per applied transition')
  })
}

test('V2. voiding keeps the record: amount, line items, receipts and the reason are retained; voidedAt/voidedBy are set; audited as expense.void', async () => {
  const id = await newExpense('pending_manager', { amount: 777 })
  await db.collection('expenses').updateOne({ _id: oid(id) }, { $set: { status: 'paid', paidAt: new Date(), receipts: ['legacy-receipt-ref'] } })
  const before = await db.collection('expenses').findOne({ _id: oid(id) })
  const r = await call('Aadmin', id, 'PATCH', { status: 'void', ...REASON }); assert.equal(r.status, 200, r.text)
  assert.equal(r.json.status, 'void')
  const after = await db.collection('expenses').findOne({ _id: oid(id) })
  assert.equal(after.status, 'void'); assert.equal(after.amount, before.amount); assert.deepEqual(after.receipts, before.receipts); assert.equal(after.lineItems.length, before.lineItems.length)
  assert.equal(after.adminNote, REASON.adminNote); assert.ok(after.voidedAt instanceof Date); assert.equal(after.voidedBy, String(A.admin.id || A.admin._id || after.voidedBy))
  for (let i = 0; i < 40 && !(await db.collection('auditlogs').findOne({ targetId: id, action: 'expense.void' })); i++) await sleep(50)
  const a = await db.collection('auditlogs').findOne({ targetId: id, action: 'expense.void' })
  assert.ok(a, 'audited'); assert.equal(a.metadata.note, REASON.adminNote); assert.equal(a.metadata.from, 'paid'); assert.equal(a.metadata.amount, 777)
})

test('V3. a voided claim is still readable by its owner and admin, and cannot be edited or deleted afterwards', async () => {
  const id = await newExpense('paid')
  assert.equal((await call('Aadmin', id, 'PATCH', { status: 'void', ...REASON })).status, 200)
  assert.equal((await call('Aemployee', id, 'GET')).json.status, 'void')
  assert.equal((await call('Aadmin', id, 'GET')).json.status, 'void')
  assert.equal((await call('Aemployee', id, 'PATCH', { title: 'sneaky edit' })).status, 403)
  assert.equal((await call('Aadmin', id, 'DELETE')).status, 409)
})

test('V4. voided claims drop out of report totals (D-03.2) while staying on record', async () => {
  const keep = await newExpense('paid', { amount: 400 }); const gone = await newExpense('paid', { amount: 250 })
  const total = async () => {
    const r = await kit.api('/api/reports', { token: tok.Aadmin }); assert.equal(r.status, 200, r.text)
    return { all: (r.json.expenseByStatus || []).reduce((s, x) => s + (x.amount || 0), 0), byStatus: Object.fromEntries((r.json.expenseByStatus || []).map(x => [x._id, x.amount])) }
  }
  const before = await total()
  assert.equal((await call('Aadmin', gone, 'PATCH', { status: 'void', ...REASON })).status, 200)
  const after = await total()
  assert.equal(after.all, before.all - 250, 'the voided amount leaves the totals')
  assert.equal(after.byStatus.void, undefined, 'void is not reported as a spend bucket')
  assert.equal(await exists(gone), true, 'but the record is retained'); assert.ok(keep)
})
