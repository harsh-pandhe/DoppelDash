/**
 * Leave submission is audited like expense.submitted / travel.submitted (found by the live staging acceptance run: the audit log held
 * travel.submitted, contact_created and invitation_created but no entry for a submitted leave request). Real server, throwaway DB.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const kit = require('./helpers/authTestKit')

let db, A, B, tok
test.before(async () => {
  db = await kit.connect(); A = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true }); B = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  tok = { emp: (await kit.login(A.employee.email)).accessToken, adm: (await kit.login(A.admin.email)).accessToken, admB: (await kit.login(B.admin.email)).accessToken }
})
test.after(async () => { await kit.cleanupAll(db); await kit.disconnect() })

test('L-audit. a submitted leave request writes exactly one awaited audit entry (leave.submitted) in the right tenant, visible to that tenant\'s admin only, with only non-sensitive metadata', async () => {
  const reason = 'PRIVATE-REASON-' + kit.rand()
  const r = await kit.api('/api/lms', { method: 'POST', token: tok.emp, body: { type: 'casual', startDate: '2026-12-07', endDate: '2026-12-08', days: 2, reason } })
  assert.equal(r.status, 201, r.text); const id = r.json._id || r.json.id; assert.ok(id)
  const logs = await db.collection('auditlogs').find({ orgId: A.orgId, action: 'leave.submitted', targetId: String(id) }).toArray()
  assert.equal(logs.length, 1, 'exactly one audit entry for the submission')
  assert.equal(logs[0].targetType, 'leave'); assert.equal(logs[0].performedBy, String(A.employee.id)); assert.deepEqual([logs[0].metadata.type, logs[0].metadata.days, logs[0].metadata.medicalDocCount], ['casual', 2, 0])
  assert.doesNotMatch(JSON.stringify(logs[0]), new RegExp(reason), 'the free-text reason is not copied into the audit trail')
  const view = await kit.api('/api/admin/audit?limit=100', { token: tok.adm }); assert.equal(view.status, 200); assert.ok(view.json.logs.some(l => l.action === 'leave.submitted' && l.targetId === String(id)), 'tenant admin sees it')
  const other = await kit.api('/api/admin/audit?limit=100', { token: tok.admB }); assert.equal(other.status, 200); assert.ok(!other.json.logs.some(l => l.targetId === String(id)), 'another tenant\'s admin does not')
  for (const [label, body] of [['no fields', { type: 'casual' }], ['bad start date', { type: 'casual', startDate: 'nope', endDate: '2026-12-08', days: 1, reason: 'x' }], ['bad end date', { type: 'casual', startDate: '2026-12-07', endDate: 'nope', days: 1, reason: 'x' }], ['non-numeric days', { type: 'casual', startDate: '2026-12-07', endDate: '2026-12-08', days: 'abc', reason: 'x' }], ['negative days', { type: 'casual', startDate: '2026-12-07', endDate: '2026-12-08', days: -1, reason: 'x' }], ['absurd days', { type: 'privilege', startDate: '2026-12-07', endDate: '2026-12-08', days: 100000, reason: 'x' }], ['no reason', { type: 'casual', startDate: '2026-12-07', endDate: '2026-12-08', days: 1 }]]) {
    const bad = await kit.api('/api/lms', { method: 'POST', token: tok.emp, body }); assert.equal(bad.status, 400, `${label} -> ${bad.status} ${bad.text.slice(0, 80)}`); assert.ok(Array.isArray(bad.json.fields) || bad.json.error, label)
  }
  assert.equal(await db.collection('auditlogs').countDocuments({ orgId: A.orgId, action: 'leave.submitted' }), 1, 'a rejected submission leaves no audit entry')
})

test('L-range. an end date before the start date is 400 (fields endDate) and stores nothing; a same-day or later end date is accepted', async () => {
  const post = b => kit.api('/api/lms', { method: 'POST', token: tok.emp, body: { type: 'casual', reason: 'range test', ...b } })
  const before = await db.collection('leaves').countDocuments({ orgId: A.orgId })
  const bad = await post({ startDate: '2027-03-10', endDate: '2027-03-09', days: 1 }); assert.equal(bad.status, 400); assert.deepEqual(bad.json.fields, ['endDate'])
  assert.equal(await db.collection('leaves').countDocuments({ orgId: A.orgId }), before, 'nothing stored by the rejected request')
  assert.equal((await post({ startDate: '2027-03-10', endDate: '2027-03-10', days: 1 })).status, 201, 'same-day range')
  assert.equal((await post({ startDate: '2027-05-03', endDate: '2027-05-04', days: 2 })).status, 201, 'two-day range')
})
