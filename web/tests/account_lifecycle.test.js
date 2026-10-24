/**
 * Owner decisions D-02.5 / D-02.8 / D-03.3 / D-03.4 (approved 2026-10-25). Real routes + real cron route, throwaway DB, local fake providers.
 *  D-02.8  DELETE /api/user/account is a 14-day SOFT delete: sign-in blocked, sessions revoked, data untouched, restorable by password login.
 *  D-03.4  Members are pseudonymised ("Former member") on retained records; a sole-owner disband keeps claims/leave/travel until retention ends.
 *  D-03.3  /api/cron/retention-purge: dry-run by default, `apply` removes due deletions and records past their retention period.
 *  D-02.5  Neither the request nor the completed-deletion audit entry stores the deleted user's e-mail.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const mongoose = require('mongoose')
const kit = require('./helpers/authTestKit')

const CRON = process.env.CRON_SECRET
const BASE = process.env.TEST_URL
const DAY = 864e5
let db
test.before(async () => { assert.ok(CRON && BASE, 'runner exports CRON_SECRET/TEST_URL'); db = await kit.connect() })
test.after(async () => { await kit.cleanupAll(db); await kit.disconnect() })

const sleep = ms => new Promise(r => setTimeout(r, ms))
const oid = s => new mongoose.Types.ObjectId(s)
const org = () => kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: false })
const tokenFor = async u => (await kit.login(u.email)).accessToken
const cron = (body, auth = `Bearer ${CRON}`, method = 'POST') => fetch(`${BASE}/api/cron/retention-purge`, { method, headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: auth } : {}) }, body: method === 'POST' && body !== undefined ? JSON.stringify(body) : undefined }).then(async r => ({ status: r.status, json: await r.json().catch(() => ({})) }))
const del = token => kit.api('/api/user/account', { method: 'DELETE', token })
const login = (email, extra = {}) => kit.api('/api/auth/login', { method: 'POST', body: { email, password: 'Str0ng!Passw0rd#', ...extra } })
const user = id => db.collection('users').findOne({ _id: oid(id) })
const backdate = (id, days = 15) => db.collection('users').updateOne({ _id: oid(id) }, { $set: { deletionRequestedAt: new Date(Date.now() - days * DAY), deletionScheduledFor: new Date(Date.now() - (days - 14) * DAY) } })
const seed = async (o, u) => {
  const exp = await db.collection('expenses').insertOne({ orgId: o.orgId, userId: u.id, userName: 'Eve Tester', title: 'Taxi', reason: 'QA', amount: 321, startDate: new Date(), status: 'paid', paidAt: new Date(), lineItems: [], receipts: [], createdAt: new Date(), updatedAt: new Date() })
  const lv = await db.collection('leaves').insertOne({ orgId: o.orgId, userId: u.id, userName: 'Eve Tester', type: 'casual', startDate: new Date(), endDate: new Date(), days: 1, reason: 'x', status: 'approved', createdAt: new Date(), updatedAt: new Date() })
  await db.collection('auditlogs').insertOne({ orgId: o.orgId, action: 'expense.submitted', performedBy: u.id, performedByName: 'Eve Tester', targetId: String(exp.insertedId), targetType: 'expense', metadata: { employeeName: 'Eve Tester', email: u.email }, createdAt: new Date(), updatedAt: new Date() })
  return { expenseId: String(exp.insertedId), leaveId: String(lv.insertedId) }
}

test('LC1. DELETE is a 14-day soft delete: scheduled, sessions revoked, sign-in blocked with a restore hint, data untouched, no e-mail in the audit entry', async () => {
  const o = await org(); const t = await tokenFor(o.employee); const s = await seed(o, o.employee)
  const r = await del(t); assert.equal(r.status, 200, r.text)
  assert.equal(r.json.success, true); assert.equal(r.json.scheduled, true)
  const until = new Date(r.json.restoreUntil).getTime(); assert.ok(Math.abs(until - (Date.now() + 14 * DAY)) < 5 * 60e3, 'restoreUntil ≈ now + 14 days')
  const u = await user(o.employee.id); assert.equal(u.isActive, false); assert.ok(u.deletionRequestedAt && u.deletionScheduledFor)
  assert.equal((await kit.api('/api/auth/me', { token: t })).status, 401, 'the old session is dead')
  const l = await login(o.employee.email); assert.equal(l.status, 403, l.text); assert.equal(l.json.code, 'account_pending_deletion'); assert.ok(l.json.restoreUntil)
  assert.equal((await db.collection('expenses').findOne({ _id: oid(s.expenseId) })).userName, 'Eve Tester', 'nothing is purged yet')
  assert.equal(await db.collection('employees').countDocuments({ clerkUserId: o.employee.id }), 1)
  for (let i = 0; i < 40 && !(await db.collection('auditlogs').findOne({ targetId: o.employee.id, action: 'user.account_deletion_requested' })); i++) await sleep(50)
  const a = await db.collection('auditlogs').findOne({ targetId: o.employee.id, action: 'user.account_deletion_requested' }); assert.ok(a, 'the request is audited')
  assert.equal(JSON.stringify(a.metadata).includes(o.employee.email), false, 'D-02.5: no e-mail in the audit entry')
})

test('LC2. signing in with the password and restoreAccount:true inside the grace window cancels the deletion', async () => {
  const o = await org(); await del(await tokenFor(o.employee))
  const l = await login(o.employee.email, { restoreAccount: true }); assert.equal(l.status, 200, l.text); assert.equal(l.json.step, 'verify')
  const u = await user(o.employee.id); assert.equal(u.isActive, true); assert.equal(u.deletionScheduledFor, undefined); assert.equal(u.deletionRequestedAt, undefined)
  assert.ok((await kit.login(o.employee.email)).accessToken, 'a normal full sign-in works again')
})

test('LC3. a wrong password never restores; after the grace window restore is refused and the account stays blocked', async () => {
  const o = await org(); await del(await tokenFor(o.employee))
  const bad = await kit.api('/api/auth/login', { method: 'POST', body: { email: o.employee.email, password: 'Wrong!Passw0rd#1', restoreAccount: true } }); assert.equal(bad.status, 401)
  assert.equal((await user(o.employee.id)).isActive, false)
  await backdate(o.employee.id)
  const late = await login(o.employee.email, { restoreAccount: true }); assert.equal(late.status, 403, late.text); assert.notEqual(late.json.step, 'verify')
  assert.equal((await user(o.employee.id)).isActive, false)
})

test('LC4. retention job gates: 401 without the secret, 405 for GET, 400 for unknown fields/modes, dry-run changes nothing', async () => {
  assert.equal((await cron({}, null)).status, 401); assert.equal((await cron({}, 'Bearer wrong-secret-value')).status, 401)
  assert.equal((await cron(undefined, `Bearer ${CRON}`, 'GET')).status, 405)
  assert.equal((await cron({ mode: 'nuke' })).status, 400); assert.equal((await cron({ mode: 'dry-run', orgId: 'x' })).status, 400)
  const o = await org(); await del(await tokenFor(o.employee)); await backdate(o.employee.id)
  const d = await cron({ mode: 'dry-run' }); assert.equal(d.status, 200, JSON.stringify(d.json)); assert.equal(d.json.apply, false); assert.ok(d.json.deletionsDue >= 1); assert.equal(d.json.deletionsExecuted, 0)
  assert.ok(await user(o.employee.id), 'a dry-run deletes nothing')
  assert.equal((await cron(undefined)).json.apply, false, 'an empty body is a dry-run')
})

test('LC5. apply: the member is purged, retained records say "Former member", audit entries are pseudonymised, colleagues are untouched', async () => {
  const o = await org(); const s = await seed(o, o.employee); const mgr = await seed(o, o.manager)
  await del(await tokenFor(o.employee)); await backdate(o.employee.id)
  const r = await cron({ mode: 'apply' }); assert.equal(r.status, 200, JSON.stringify(r.json)); assert.ok(r.json.deletionsExecuted >= 1); assert.equal(r.json.deletionsFailed, 0)
  assert.equal(await user(o.employee.id), null, 'user record gone'); assert.equal(await db.collection('employees').countDocuments({ clerkUserId: o.employee.id }), 0)
  assert.equal((await db.collection('expenses').findOne({ _id: oid(s.expenseId) })).userName, 'Former member', 'claim kept, name replaced')
  assert.equal((await db.collection('leaves').findOne({ _id: oid(s.leaveId) })).userName, 'Former member')
  const a = await db.collection('auditlogs').findOne({ targetId: s.expenseId, action: 'expense.submitted' }); assert.equal(a.performedByName, 'Former member'); assert.equal(a.metadata.employeeName, 'Former member'); assert.equal(a.metadata.email, undefined)
  assert.equal((await db.collection('expenses').findOne({ _id: oid(mgr.expenseId) })).userName, 'Eve Tester', 'a colleague’s record is untouched')
  assert.ok(await db.collection('organizations').findOne({ orgId: o.orgId }), 'the organisation stays')
  const done = await db.collection('auditlogs').findOne({ targetId: o.employee.id, action: 'user.account_deleted' }); assert.ok(done, 'completion audited')
  assert.equal(JSON.stringify(done.metadata).includes(o.employee.email), false, 'D-02.5: no e-mail in the completion entry')
  assert.equal((await cron({ mode: 'apply' })).json.deletionsExecuted, 0, 'idempotent: a second run finds nothing due')
})

test('LC6. sole-owner disband: tenant deactivated, non-financial data purged after the grace window, claims/leave kept until retention ends, then the shell goes', async () => {
  const o = await org(); await db.collection('users').deleteMany({ _id: { $in: [oid(o.manager.id), oid(o.employee.id)] } })
  await db.collection('organizations').updateOne({ orgId: o.orgId }, { $set: { ownerId: o.admin.id } })
  const s = await seed(o, o.admin)
  await db.collection('contacts').insertOne({ orgId: o.orgId, userId: o.admin.id, name: 'C', createdAt: new Date(), updatedAt: new Date() })
  await db.collection('announcements').insertOne({ orgId: o.orgId, title: 'A', createdAt: new Date(), updatedAt: new Date() })
  const r = await del(await tokenFor(o.admin)); assert.equal(r.status, 200, r.text); assert.equal(r.json.scheduled, true)
  const before = await db.collection('organizations').findOne({ orgId: o.orgId }); assert.ok(before.disbandRequestedAt, 'tenant deactivated at once')
  assert.equal(await db.collection('contacts').countDocuments({ orgId: o.orgId }), 1, 'nothing purged during the grace window')
  await backdate(o.admin.id)
  const p = await cron({ mode: 'apply' }); assert.equal(p.status, 200, JSON.stringify(p.json)); assert.equal(p.json.deletionsFailed, 0)
  assert.equal(await db.collection('contacts').countDocuments({ orgId: o.orgId }), 0, 'non-financial data purged'); assert.equal(await db.collection('announcements').countDocuments({ orgId: o.orgId }), 0)
  assert.equal(await db.collection('expenses').countDocuments({ orgId: o.orgId }), 1, 'the paid claim is retained'); assert.equal(await db.collection('leaves').countDocuments({ orgId: o.orgId }), 1)
  const org2 = await db.collection('organizations').findOne({ orgId: o.orgId }); assert.ok(org2.disbandedAt); assert.equal(org2.ownerId, undefined)
  const yrs = (org2.retentionHoldUntil - Date.now()) / (365.25 * DAY); assert.ok(yrs > 7.9 && yrs < 8.1, 'held for 8 years')
  assert.equal(await user(o.admin.id), null)
  // time passes: the retained records fall out of retention, the job removes them and finally the empty shell
  const old = new Date(Date.now() - 9 * 365 * DAY)
  await db.collection('expenses').updateOne({ _id: oid(s.expenseId) }, { $set: { paidAt: old, createdAt: old } }); await db.collection('leaves').updateOne({ _id: oid(s.leaveId) }, { $set: { endDate: new Date(Date.now() - 4 * 365 * DAY) } })
  const q = await cron({ mode: 'apply' }); assert.ok(q.json.expiredClaims >= 1 && q.json.expiredLeave >= 1, JSON.stringify(q.json))
  assert.equal(await db.collection('expenses').countDocuments({ orgId: o.orgId }), 0); assert.equal(await db.collection('leaves').countDocuments({ orgId: o.orgId }), 0)
  assert.equal(await db.collection('organizations').countDocuments({ orgId: o.orgId }), 0, 'the empty shell is removed')
})

test('LC7. retention periods: claims 8 y from payment, leave 3 y, travel 2 y, audit 8 y — newer records survive', async () => {
  const o = await org(); const y = n => new Date(Date.now() - n * 365.25 * DAY)
  const mk = (extra) => db.collection('expenses').insertOne({ orgId: o.orgId, userId: o.employee.id, userName: 'Eve', title: 't', reason: 'r', amount: 1, startDate: new Date(), lineItems: [], receipts: [], createdAt: new Date(), updatedAt: new Date(), ...extra })
  const oldPaid = await mk({ status: 'paid', paidAt: y(9), createdAt: y(9) }), newPaid = await mk({ status: 'paid', paidAt: y(7), createdAt: y(9) }), oldNeverPaid = await mk({ status: 'rejected', createdAt: y(9) }), recent = await mk({ status: 'pending_manager' })
  const lv = (endDate) => db.collection('leaves').insertOne({ orgId: o.orgId, userId: o.employee.id, userName: 'Eve', type: 'casual', startDate: endDate, endDate, days: 1, reason: 'x', status: 'approved', createdAt: new Date(), updatedAt: new Date() })
  const oldL = await lv(y(4)), newL = await lv(y(2))
  const tr = (createdAt) => db.collection('travelrequests').insertOne({ orgId: o.orgId, userId: o.employee.id, userName: 'Eve', status: 'approved', createdAt, updatedAt: createdAt })
  const oldT = await tr(y(3)), newT = await tr(y(1))
  const au = (createdAt) => db.collection('auditlogs').insertOne({ orgId: o.orgId, action: 'x.y', performedBy: 'u', performedByName: 'U', targetId: 't', targetType: 'user', metadata: {}, createdAt, updatedAt: createdAt })
  const oldA = await au(y(9)), newA = await au(y(5))
  const dry = await cron({ mode: 'dry-run' }); assert.ok(dry.json.expiredClaims >= 2 && dry.json.expiredLeave >= 1 && dry.json.expiredTravel >= 1 && dry.json.expiredAudit >= 1)
  assert.ok(await db.collection('expenses').findOne({ _id: oldPaid.insertedId }), 'dry-run deletes nothing')
  await cron({ mode: 'apply' })
  const has = (c, r) => db.collection(c).findOne({ _id: r.insertedId })
  assert.equal(await has('expenses', oldPaid), null); assert.equal(await has('expenses', oldNeverPaid), null); assert.ok(await has('expenses', newPaid)); assert.ok(await has('expenses', recent))
  assert.equal(await has('leaves', oldL), null); assert.ok(await has('leaves', newL))
  assert.equal(await has('travelrequests', oldT), null); assert.ok(await has('travelrequests', newT))
  assert.equal(await has('auditlogs', oldA), null); assert.ok(await has('auditlogs', newA))
})

// ───────────── D-02.7 ownership transfer ─────────────
const transfer = (token, body) => kit.api('/api/org/transfer-ownership', { method: 'POST', token, body })
const ownedOrg = async () => { const o = await org(); await db.collection('organizations').updateOne({ orgId: o.orgId }, { $set: { ownerId: o.admin.id } }); await db.collection('users').updateOne({ _id: oid(o.manager.id) }, { $set: { role: 'admin' } }); return o }
const ownerOf = orgId => db.collection('organizations').findOne({ orgId }).then(x => x.ownerId)

test('OT1. the owner transfers to another active admin; it is audited with ids only; the former owner can then leave like a member', async () => {
  const o = await ownedOrg(); const t = await tokenFor(o.admin)
  assert.equal((await del(t)).status, 400, 'an owner with members is still refused'); 
  const r = await transfer(t, { newOwnerId: o.manager.id }); assert.equal(r.status, 200, r.text); assert.equal(r.json.ownerId, o.manager.id)
  assert.equal(await ownerOf(o.orgId), o.manager.id)
  for (let i = 0; i < 40 && !(await db.collection('auditlogs').findOne({ orgId: o.orgId, action: 'org.ownership_transferred' })); i++) await sleep(50)
  const a = await db.collection('auditlogs').findOne({ orgId: o.orgId, action: 'org.ownership_transferred' }); assert.ok(a); assert.deepEqual(a.metadata, { from: o.admin.id, to: o.manager.id })
  assert.equal(JSON.stringify(a).includes('@'), false, 'no e-mail addresses in the entry')
  const t2 = await tokenFor(o.admin); const d = await del(t2); assert.equal(d.status, 200, d.text); assert.equal(d.json.scheduled, true)
  assert.equal((await db.collection('organizations').findOne({ orgId: o.orgId })).disbandRequestedAt, undefined, 'a former owner leaving does not disband the tenant')
})

test('OT2. only the current owner may transfer (403 for other admins, managers, employees); the body is validated; nothing changes on refusal', async () => {
  const o = await ownedOrg(); const t = await tokenFor(o.admin)
  assert.equal((await transfer(await tokenFor(o.manager), { newOwnerId: o.admin.id })).status, 403, 'a non-owner admin')
  assert.equal((await transfer(await tokenFor(o.employee), { newOwnerId: o.admin.id })).status, 403)
  for (const [body, status] of [[{ newOwnerId: o.employee.id }, 400], [{ newOwnerId: o.admin.id }, 400], [{ newOwnerId: 'not-an-id' }, 400], [{}, 400], [{ newOwnerId: o.manager.id, extra: 1 }, 400], [{ newOwnerId: String(new mongoose.Types.ObjectId()) }, 404]]) {
    const r = await transfer(t, body); assert.equal(r.status, status, JSON.stringify(body) + r.text)
  }
  await db.collection('users').updateOne({ _id: oid(o.manager.id) }, { $set: { isActive: false } }); assert.equal((await transfer(t, { newOwnerId: o.manager.id })).status, 400, 'an inactive member cannot become owner')
  const other = await ownedOrg(); assert.equal((await transfer(t, { newOwnerId: other.manager.id })).status, 404, 'another tenant’s user is answered like an unknown id')
  assert.equal(await ownerOf(o.orgId), o.admin.id, 'ownership unchanged after every refusal')
  assert.equal((await transfer(null, { newOwnerId: o.manager.id })).status, 401)
})

test('OT3. concurrent transfers by the owner: exactly one lands', async () => {
  const o = await ownedOrg(); const t = await tokenFor(o.admin)
  await db.collection('users').updateOne({ _id: oid(o.employee.id) }, { $set: { role: 'admin' } })
  const rs = await Promise.all([transfer(t, { newOwnerId: o.manager.id }), transfer(t, { newOwnerId: o.employee.id })])
  assert.equal(rs.filter(r => r.status === 200).length, 1, rs.map(r => r.status).join()); assert.ok(rs.every(r => [200, 403, 409].includes(r.status)))
  assert.ok([o.manager.id, o.employee.id].includes(await ownerOf(o.orgId)))
})
