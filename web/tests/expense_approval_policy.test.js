/**
 * Expense review policy (Phase 4C). Real routes, throwaway DB. Policy:
 *   pending_manager  manager or admin may approve (→ pending_admin), reject, return to the employee
 *   pending_admin    ONLY an admin may decide: pay, reject, or send back to manager review (reason required, audited as expense.returned_to_manager)
 *   settled states   no transitions except paid → void (admin only, reason required); a manager gets 403 for any review write
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
const patch = (k, id, body) => kit.api(`/api/rms/${id}`, { method: 'PATCH', token: tok[k], body })
const newExpense = async (status) => {
  const r = await kit.api('/api/rms', { method: 'POST', token: tok.Aemployee, body: { title: 'Policy ' + kit.rand(), reason: 'QA', amount: 100, startDate: new Date(Date.now() - 864e5).toISOString() } })
  assert.equal(r.status, 201, r.text)
  for (let i = 0; i < 60 && !(await db.collection('auditlogs').findOne({ targetId: r.json._id })); i++) await sleep(50)   // the 'submitted' audit row is written after the response: let it land first
  await sleep(100)
  if (status !== 'pending_manager') await db.collection('expenses').updateOne({ _id: oid(r.json._id) }, { $set: { status } })
  return r.json._id
}
const snap = async id => JSON.stringify(await db.collection('expenses').findOne({ _id: oid(id) }))
const audits = id => db.collection('auditlogs').countDocuments({ targetId: id })
const NOTE = { adminNote: 'needs the manager to re-check the receipt' }

// [actor, from state, body, expected status]
const CASES = [
  ['Amanager', 'pending_manager', { status: 'pending_admin' }, 200], ['Amanager', 'pending_manager', { status: 'rejected' }, 200], ['Amanager', 'pending_manager', { status: 'returned' }, 200],
  ['Amanager', 'pending_manager', { status: 'paid' }, 409], ['Amanager', 'pending_manager', { status: 'pending_manager', managerNote: 'x' }, 409],
  ['Aadmin', 'pending_manager', { status: 'pending_admin' }, 200], ['Aadmin', 'pending_manager', { status: 'rejected' }, 200], ['Aadmin', 'pending_manager', { status: 'returned' }, 200],
  ['Aadmin', 'pending_manager', { status: 'paid' }, 409],
  // the admin stage
  ['Amanager', 'pending_admin', { status: 'paid' }, 403], ['Amanager', 'pending_admin', { status: 'rejected' }, 403], ['Amanager', 'pending_admin', { status: 'pending_manager', managerNote: 'back' }, 403],
  ['Amanager', 'pending_admin', { status: 'pending_admin' }, 403], ['Amanager', 'pending_admin', { managerNote: 'note only' }, 403], ['Amanager', 'pending_admin', { 'lineItems.0.status': 'approved' }, 403],
  ['Aadmin', 'pending_admin', { status: 'paid' }, 200], ['Aadmin', 'pending_admin', { status: 'rejected' }, 200], ['Aadmin', 'pending_admin', { status: 'pending_manager', ...NOTE }, 200],
  ['Aadmin', 'pending_admin', { status: 'pending_manager' }, 400], ['Aadmin', 'pending_admin', { status: 'pending_manager', adminNote: '   ' }, 400],
  ['Aadmin', 'pending_admin', { status: 'pending_admin' }, 409], ['Aadmin', 'pending_admin', { status: 'returned' }, 409],
  // settled states: nothing moves; a manager is refused outright
  ...['paid', 'rejected', 'returned'].flatMap(st => [['Amanager', st, { status: 'pending_admin' }, 403], ['Amanager', st, { managerNote: 'late note' }, 403], ['Aadmin', st, { status: 'pending_admin' }, 409], ['Aadmin', st, { status: 'paid' }, 409]]),
  // other tenant: not found, whatever the role
  ...['Badmin', 'Bmanager'].flatMap(k => ['pending_manager', 'pending_admin'].map(st => [k, st, { status: 'rejected' }, 404])),
]
for (const [actor, from, body, expected] of CASES) {
  test(`P. ${actor} on ${from} ${JSON.stringify(body)} → ${expected}`, async () => {
    const id = await newExpense(from)
    const before = await snap(id); const auditBefore = await audits(id)
    const r = await patch(actor, id, body)
    assert.equal(r.status, expected, r.text)
    if (expected === 200) { for (let i = 0; i < 60 && (await audits(id)) < auditBefore + 1; i++) await sleep(50) }   // audit rows are written after the response
    await sleep(150)
    if (expected !== 200) { assert.equal(await snap(id), before, 'a refused request must not mutate the record'); assert.equal(await audits(id), auditBefore, 'and writes no audit row') }
    else assert.equal(await audits(id), auditBefore + 1, 'one audit row per applied transition')
  })
}

test('P2. admin send-back is an audited, reasoned transition (expense.returned_to_manager with the note and the previous state) and the claim is reviewable by the manager again', async () => {
  const id = await newExpense('pending_admin')
  const r = await patch('Aadmin', id, { status: 'pending_manager', ...NOTE }); assert.equal(r.status, 200, r.text)
  assert.equal(r.json.status, 'pending_manager')
  for (let i = 0; i < 40 && !(await db.collection('auditlogs').findOne({ targetId: id, action: 'expense.returned_to_manager' })); i++) await sleep(50)
  const a = await db.collection('auditlogs').findOne({ targetId: id, action: 'expense.returned_to_manager' })
  assert.ok(a, 'audited'); assert.equal(a.metadata.note, NOTE.adminNote); assert.equal(a.metadata.from, 'pending_admin')
  assert.equal((await patch('Amanager', id, { status: 'pending_admin' })).status, 200, 'back in the manager stage')
})

test('P3. concurrency at the admin stage: managers racing an admin never win; exactly one admin decision lands, one audit row', async () => {
  const id = await newExpense('pending_admin')
  const rs = await Promise.all([patch('Amanager', id, { status: 'rejected' }), patch('Amanager', id, { status: 'pending_manager', managerNote: 'back' }), patch('Aadmin', id, { status: 'paid' }), patch('Amanager', id, { status: 'paid' }), patch('Aadmin', id, { status: 'rejected' })])
  assert.deepEqual([rs[0].status, rs[1].status, rs[3].status], [403, 403, 403], 'every manager attempt is refused')
  assert.equal(rs.filter(r => r.status === 200).length, 1, rs.map(r => r.status).join()); assert.ok([409].includes(rs.filter(r => r.status !== 200 && r.status !== 403)[0].status))
  await sleep(500)
  const doc = await db.collection('expenses').findOne({ _id: oid(id) }); assert.ok(['paid', 'rejected'].includes(doc.status))
  assert.equal(await db.collection('auditlogs').countDocuments({ targetId: id, action: { $in: ['expense.paid', 'expense.rejected'] } }), 1)
})

test('P4. only admins write payment fields and the employee cannot review at all', async () => {
  const id = await newExpense('pending_admin')
  assert.equal((await patch('Aemployee', id, { status: 'paid', paymentMethod: 'cash' })).status, 403)
  assert.equal((await patch('Amanager', id, { paymentMethod: 'cash', paymentProof: 'x' })).status, 403)
  const doc = await db.collection('expenses').findOne({ _id: oid(id) }); assert.equal(doc.status, 'pending_admin'); assert.ok(!doc.paymentMethod)
})

/* ───────── UI ↔ server agreement (Phase 4D): the table the Web UI renders actions from must equal what the real route allows ───────── */
const policy = () => kit.load('lib/expenses/reviewPolicy.ts')
test('P5. lib/expenses/reviewPolicy (the UI action table) agrees with the real route for every reviewer × state × action', async () => {
  const { reviewActions, ACTION_TARGET } = policy()
  const actors = { manager: 'Amanager', admin: 'Aadmin' }
  for (const role of ['manager', 'admin']) for (const state of ['pending_manager', 'pending_admin', 'paid', 'rejected', 'returned']) for (const action of ['approve', 'reject', 'return', 'pay', 'send_back']) {
    const id = await newExpense(state)
    const body = { status: ACTION_TARGET[action], ...(action === 'send_back' ? { adminNote: 'recheck' } : {}) }
    const r = await patch(actors[role], id, body)
    const allowed = reviewActions(role, state).includes(action)
    assert.equal(r.status === 200, allowed, `${role} ${action} at ${state}: route ${r.status}, UI table says ${allowed ? 'allowed' : 'not allowed'}`)
  }
})

test('P6. the table itself: admins keep the manager stage (no stuck claims in a workspace without a manager); employees and settled states get nothing', () => {
  const { reviewActions, bulkTarget } = policy()
  assert.deepEqual(reviewActions('admin', 'pending_manager'), ['approve', 'reject', 'return'])
  assert.deepEqual(reviewActions('manager', 'pending_manager'), ['approve', 'reject', 'return'])
  assert.deepEqual(reviewActions('admin', 'pending_admin'), ['pay', 'reject', 'send_back'])
  assert.deepEqual(reviewActions('manager', 'pending_admin'), [])
  for (const st of ['paid', 'rejected', 'returned']) for (const r of ['admin', 'manager', 'employee']) assert.deepEqual(reviewActions(r, st), [])
  assert.deepEqual(reviewActions('employee', 'pending_manager'), [])
  assert.equal(bulkTarget('admin', 'pending_manager', 'approve'), 'pending_admin'); assert.equal(bulkTarget('admin', 'pending_admin', 'approve'), 'paid')
  assert.equal(bulkTarget('manager', 'pending_admin', 'approve'), null); assert.equal(bulkTarget('manager', 'pending_admin', 'reject'), null)
})

test('P7. the Web page renders its review actions from the shared table (no re-implemented role/state conditions left)', () => {
  const src = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../app/(app)/rms/page.tsx'), 'utf8')
  assert.match(src, /from '@\/lib\/expenses\/reviewPolicy'/)
  assert.doesNotMatch(src, /isManager && !isAdmin && (exp|expense|e)\.status === 'pending_manager'/)
  assert.doesNotMatch(src, /isAdmin && (exp|expense)\.status === 'pending_admin'/)
})

test('P8. owner decision D-03.1 (approved 2026-10-25): a claim in payout review or paid is NEVER deleted by anyone (409 claim_settled); voiding is the correction path (see expense_void_and_delete.test.js)', async () => {
  const own = (id, k) => kit.api(`/api/rms/${id}`, { method: 'DELETE', token: tok[k] })
  const p1 = await newExpense('paid'); assert.equal((await own(p1, 'Aemployee')).status, 403, 'the owner cannot delete a paid claim')
  const pa = await newExpense('pending_admin'); assert.equal((await own(pa, 'Aemployee')).status, 403)
  assert.equal((await own(p1, 'Bmanager')).status, 404, 'other tenant')
  const r1 = await own(p1, 'Amanager'); assert.equal(r1.status, 409, 'a manager can no longer delete a paid claim'); assert.equal(r1.json.code, 'claim_settled')
  const r2 = await own(p1, 'Aadmin'); assert.equal(r2.status, 409, 'nor can an admin'); assert.equal(r2.json.code, 'claim_settled')
  assert.equal((await own(pa, 'Aadmin')).status, 409, 'a claim in payout review is protected too')
  assert.equal(await db.collection('expenses').countDocuments({ _id: { $in: [oid(p1), oid(pa)] } }), 2, 'both records are kept')
})
