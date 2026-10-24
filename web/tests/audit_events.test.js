/**
 * Phase 12 audit coverage: every privileged mutation writes exactly one, tenant-scoped, minimal, secret-free audit event; rejected requests write none
 * and persist nothing; the log is admin-only and tenant-isolated. Real server, throwaway DB (AUTOMATED evidence, not a live-browser result).
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const kit = require('./helpers/authTestKit')

let db, A, B, tok
const SECRET = 'SENTINEL-SECRET-VALUE-91827'
const events = (orgId, action) => db.collection('auditlogs').find({ orgId, ...(action ? { action } : {}) }).sort({ createdAt: 1 }).toArray()
const count = async (orgId, action) => (await events(orgId, action)).length
const post = (u, b, t = tok.adm, m = 'POST') => kit.api(u, { method: m, token: t, body: b })

test.before(async () => {
  db = await kit.connect()
  A = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true }); B = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  tok = { adm: (await kit.login(A.admin.email)).accessToken, mgr: (await kit.login(A.manager.email)).accessToken, emp: (await kit.login(A.employee.email)).accessToken, bAdm: (await kit.login(B.admin.email)).accessToken }
})
test.after(async () => { await kit.cleanupAll(db); await kit.disconnect() })

test('AU1. org settings: one event with field NAMES only; invalid / forbidden requests write none', async () => {
  const before = await count(A.orgId, 'organization.settings_changed')
  assert.equal((await post('/api/org/settings', { name: 'Audit Co', address: SECRET, workHours: { start: '09:00', end: '17:00' } })).status, 200)
  assert.equal((await post('/api/admin/settings', { phone: 5 }, tok.adm, 'PATCH')).status, 400)
  assert.equal((await post('/api/org/settings', { name: 'X' }, tok.emp)).status, 403)
  const ev = await events(A.orgId, 'organization.settings_changed')
  assert.equal(ev.length, before + 1, 'exactly one event; rejected + forbidden requests wrote none')
  const e = ev[ev.length - 1]
  assert.equal(e.performedBy, A.admin.id); assert.equal(e.targetType, 'organization'); assert.equal(e.targetId, A.orgId)
  assert.ok(e.metadata.fields.includes('address') && e.metadata.fields.includes('name'))
  assert.ok(!JSON.stringify(e).includes(SECRET), 'values are not copied into the log')
})

test('AU2. holidays: created + deleted events; invalid create and unknown delete write none', async () => {
  assert.equal((await post('/api/holidays', { name: 'x', date: 'nope' })).status, 400)
  const c = await post('/api/holidays', { name: 'Audit Day', date: '2027-08-15', type: 'national' }); assert.equal(c.status, 200, c.text)
  assert.equal(await count(A.orgId, 'holiday.created'), 1)
  assert.equal((await post('/api/holidays', { id: '0'.repeat(24) }, tok.adm, 'DELETE')).status, 200)
  assert.equal(await count(A.orgId, 'holiday.deleted'), 0, 'deleting a non-existent holiday emits no success event')
  assert.equal((await post('/api/holidays', { id: c.json._id }, tok.adm, 'DELETE')).status, 200)
  const del = await events(A.orgId, 'holiday.deleted'); assert.equal(del.length, 1); assert.equal(del[0].targetId, c.json._id)
  assert.equal((await post('/api/holidays', { name: 'Emp', date: '2027-08-16' }, tok.emp)).status, 403)
  assert.equal(await count(A.orgId, 'holiday.created'), 1)
})

test('AU3. announcements: created / updated / deleted events, PATCH allowlist + validation, nothing partial', async () => {
  const c = await post('/api/announcements', { title: 'Audit ann', body: `<p>${SECRET}</p>`, priority: 'important' }); assert.equal(c.status, 201, c.text)
  const id = c.json._id
  assert.equal((await count(A.orgId, 'announcement.created')), 1)
  // PATCH: server-owned fields are ignored, operators rejected, bad types are 400 and change nothing
  const bad = await post(`/api/announcements/${id}`, { title: 5 }, tok.adm, 'PATCH'); assert.equal(bad.status, 400); assert.deepEqual(bad.json.fields, ['title'])
  const bad2 = await post(`/api/announcements/${id}`, { priority: 'banana' }, tok.adm, 'PATCH'); assert.equal(bad2.status, 400)
  const bad3 = await post(`/api/announcements/${id}`, { pinned: 'yes' }, tok.adm, 'PATCH'); assert.equal(bad3.status, 400)
  assert.equal(await count(A.orgId, 'announcement.updated'), 0, 'rejected edits wrote no event')
  const ok = await post(`/api/announcements/${id}`, { title: 'Edited', authorName: 'Mallory', urgentEmailSent: true, orgId: B.orgId, $set: { title: 'pwn' } }, tok.adm, 'PATCH'); assert.equal(ok.status, 200, ok.text)
  const row = await db.collection('announcements').findOne({ _id: new (require('mongodb').ObjectId)(id) })
  assert.equal(row.title, 'Edited'); assert.notEqual(row.authorName, 'Mallory'); assert.equal(row.orgId, A.orgId); assert.notEqual(row.urgentEmailSent, true)
  const upd = await events(A.orgId, 'announcement.updated'); assert.equal(upd.length, 1); assert.deepEqual(upd[0].metadata.fields, ['title'])
  assert.ok(!JSON.stringify(await events(A.orgId)).includes(SECRET), 'announcement text never lands in the audit log')
  // other tenant cannot edit/delete, and its failures write nothing in either org
  assert.equal((await post(`/api/announcements/${id}`, { title: 'x' }, tok.bAdm, 'PATCH')).status, 404)
  assert.equal((await kit.api(`/api/announcements/${id}`, { method: 'DELETE', token: tok.bAdm })).status, 404)
  assert.equal((await kit.api(`/api/announcements/${id}`, { method: 'DELETE', token: tok.emp })).status, 403)
  assert.equal(await count(A.orgId, 'announcement.deleted') + await count(B.orgId, 'announcement.deleted'), 0)
  assert.equal((await kit.api(`/api/announcements/${id}`, { method: 'DELETE', token: tok.adm })).status, 200)
  assert.equal(await count(A.orgId, 'announcement.deleted'), 1)
})

test('AU4. direct user creation: user.created event; invalid requests create no user and no event', async () => {
  const before = await count(A.orgId, 'user.created'); const users = await db.collection('users').countDocuments({ orgId: A.orgId })
  for (const b of [{ firstName: 'a', lastName: 'b', email: 'nope', newRole: 'employee' }, { firstName: 'a', lastName: 'b', email: 'x@y.co', newRole: 'god' }, { firstName: {}, lastName: 'b', email: 'x@y.co', newRole: 'employee' }, { firstName: 'a', lastName: 'b', email: ['x@y.co'], newRole: 'employee' }]) {
    const r = await post('/api/admin/users', b); assert.equal(r.status, 400, JSON.stringify(b) + r.text)
  }
  assert.equal(await db.collection('users').countDocuments({ orgId: A.orgId }), users, 'rejected requests created no user')
  assert.equal(await count(A.orgId, 'user.created'), before)
  const email = `audit_new_${kit.rand()}@test.dd`
  const ok = await post('/api/admin/users', { firstName: 'New', lastName: 'Person', email, newRole: 'employee', skipWelcomeEmail: true }); assert.ok([200, 201].includes(ok.status), ok.text)
  const ev = await events(A.orgId, 'user.created'); assert.equal(ev.length, before + 1)
  assert.equal(ev[ev.length - 1].metadata.role, 'employee'); assert.ok(!JSON.stringify(ev).includes(email), 'e-mail is not copied into the log')
})

test('AU5. employee profile: admin edit and self sensitive edit emit events; partial write on rejected self edit is gone', async () => {
  const emp = await db.collection('employees').findOne({ orgId: A.orgId, clerkUserId: A.employee.id })
  const r = await post(`/api/employees/${A.employee.id}`, { designation: 'Engineer II' }, tok.adm, 'PATCH'); assert.equal(r.status, 200, r.text)
  const ev = await events(A.orgId, 'employee.profile_updated'); assert.equal(ev.length, 1); assert.deepEqual(ev[0].metadata.fields, ['designation']); assert.equal(ev[0].targetId, A.employee.id)
  assert.equal((await post(`/api/employees/${A.employee.id}`, { designation: 'x'.repeat(5000) }, tok.adm, 'PATCH')).status, 400)
  assert.equal(await count(A.orgId, 'employee.profile_updated'), 1)
  // self edit: onboarding-style change is NOT audited, payout/name change is; a request rejected AFTER the name check must not rename the user
  assert.equal((await post('/api/employees/me', { city: 'Pune' }, tok.emp, 'PATCH')).status, 200)
  assert.equal(await count(A.orgId, 'employee.profile_updated'), 1, 'non-sensitive self edit is a deliberate non-event')
  const bad = await post('/api/employees/me', { firstName: 'Renamed', phone: { x: 1 } }, tok.emp, 'PATCH'); assert.equal(bad.status, 400)
  const u = await db.collection('users').findOne({ email: A.employee.email }); assert.equal(u.firstName, emp.firstName, 'rejected self edit did not rename the user (no partial write)')
  const good = await post('/api/employees/me', { firstName: 'Evelyn', bankDetails: { bankName: 'B', accountNumber: SECRET, ifscCode: 'IFSC0001', accountHolderName: 'E', accountType: 'savings' } }, tok.emp, 'PATCH'); assert.equal(good.status, 200, good.text)
  const ev2 = await events(A.orgId, 'employee.profile_updated'); assert.equal(ev2.length, 2); assert.deepEqual(ev2[1].metadata.fields.sort(), ['firstName', 'payout'])
  assert.ok(!JSON.stringify(ev2).includes(SECRET), 'bank details never reach the log')
})

test('AU6. password change / reset / login: events carry no secret; failed attempts write no success event', async () => {
  const org = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true }); const t = (await kit.login(org.manager.email)).accessToken
  assert.ok(await count(org.orgId, 'auth.login_succeeded') >= 1, 'login recorded'); const login = (await events(org.orgId, 'auth.login_succeeded'))[0]
  assert.equal(login.performedBy, org.manager.id); assert.equal(login.metadata.method, 'otp'); assert.ok(!JSON.stringify(login).includes('112022'), 'OTP never logged')
  const NEW = 'An0ther!Passw0rd#9'
  assert.equal((await post('/api/auth/change-password', { currentPassword: 'wrong-password', newPassword: NEW }, t)).status, 401)
  assert.equal(await count(org.orgId, 'auth.password_changed'), 0, 'failed change writes no success event')
  assert.equal((await post('/api/auth/change-password', { currentPassword: org.manager.password, newPassword: NEW }, t)).status, 200)
  const pc = await events(org.orgId, 'auth.password_changed'); assert.equal(pc.length, 1); assert.ok(!JSON.stringify(pc).includes(NEW) && !JSON.stringify(pc).includes(org.manager.password))
  const rq = await kit.api('/api/auth/password-reset/request', { method: 'POST', body: { email: org.manager.email } }); assert.equal(rq.status, 200)
  assert.equal(await count(org.orgId, 'auth.password_reset_requested'), 1)
  const unknown = await kit.api('/api/auth/password-reset/request', { method: 'POST', body: { email: `nobody_${kit.rand()}@test.dd` } }); assert.equal(unknown.status, 200)
  const token = new URLSearchParams(new URL(rq.json.resetUrl).hash.replace(/^#/, '')).get('token')
  assert.equal((await kit.api('/api/auth/password-reset/confirm', { method: 'POST', body: { token: 'f'.repeat(40), newPassword: NEW } })).status, 400)
  assert.equal(await count(org.orgId, 'auth.password_reset_completed'), 0)
  assert.equal((await kit.api('/api/auth/password-reset/confirm', { method: 'POST', body: { token, newPassword: 'Third!Passw0rd#7' } })).status, 200)
  const all = JSON.stringify(await events(org.orgId))
  assert.equal(await count(org.orgId, 'auth.password_reset_completed'), 1)
  assert.ok(!all.includes(token) && !all.includes('Third!Passw0rd#7'), 'reset token / password never logged')
})

test('AU7. mailbox config, CRM share links, analytics share links: events without tokens or credentials', async () => {
  const mb = await post('/api/user/email-config', { emailAddress: 'someone@example.com', smtpHost: 'smtp.example.com', smtpPort: 587, appPassword: SECRET }, tok.emp)
  assert.equal(mb.status, 200, mb.text); assert.equal(await count(A.orgId, 'mailbox.configured'), 1)
  assert.equal((await post('/api/user/email-config', { emailAddress: 'nope', smtpHost: '', appPassword: '' }, tok.emp)).status, 400); assert.equal(await count(A.orgId, 'mailbox.configured'), 1)
  assert.equal((await kit.api('/api/user/email-config', { method: 'DELETE', token: tok.emp })).status, 200); assert.equal(await count(A.orgId, 'mailbox.removed'), 1)
  assert.equal((await kit.api('/api/user/email-config', { method: 'DELETE', token: tok.emp })).status, 200); assert.equal(await count(A.orgId, 'mailbox.removed'), 1, 'removing nothing is not an event')

  const c = await post('/api/crm', { name: 'Share Me' }); const cid = c.json._id
  const g = await kit.api(`/api/crm/${cid}/share`, { token: tok.adm }); assert.equal(g.status, 200)
  const g2 = await kit.api(`/api/crm/${cid}/share`, { token: tok.adm }); assert.equal(g2.json.token, g.json.token)
  assert.equal(await count(A.orgId, 'contact.share_link_created'), 1, 'reusing an unexpired link is not a new event')
  assert.equal((await kit.api(`/api/crm/${cid}/share`, { method: 'POST', token: tok.adm })).status, 200); assert.equal(await count(A.orgId, 'contact.share_link_created'), 2)
  assert.equal((await kit.api(`/api/crm/${cid}/share`, { method: 'DELETE', token: tok.mgr })).status, 404, 'non-owner cannot revoke'); assert.equal(await count(A.orgId, 'contact.share_link_revoked'), 0)
  assert.equal((await kit.api(`/api/crm/${cid}/share`, { method: 'DELETE', token: tok.adm })).status, 200); assert.equal(await count(A.orgId, 'contact.share_link_revoked'), 1)
  const vis = await post(`/api/crm/${cid}`, { visibility: 'org' }, tok.adm, 'PATCH'); assert.equal(vis.status, 200, vis.text)
  const upd = (await events(A.orgId, 'contact_updated')).pop(); assert.equal(upd.metadata.visibility, 'org')

  const sh = await post('/api/analytics/share', { layout: [{ id: 'kpi', size: 'sm' }], expiry: '1d' }); assert.equal(sh.status, 200, sh.text)
  assert.equal(await count(A.orgId, 'analytics.share_created'), 1)
  assert.equal((await post('/api/analytics/share', { layout: 'x' })).status, 400); assert.equal(await count(A.orgId, 'analytics.share_created'), 1)
  assert.equal((await kit.api(`/api/analytics/share/${sh.json.token}`, { method: 'DELETE', token: tok.adm })).status, 200); assert.equal(await count(A.orgId, 'analytics.share_revoked'), 1)

  const all = JSON.stringify(await events(A.orgId))
  for (const secret of [SECRET, g.json.token, sh.json.token]) assert.ok(!all.includes(secret), 'bearer tokens / credentials never reach the log')
})

test('AU8. audit log is tenant-isolated and admin-only; every new event is scoped to the actor org', async () => {
  const names = ['organization.settings_changed', 'holiday.created', 'announcement.created', 'user.created', 'employee.profile_updated', 'mailbox.configured', 'contact.share_link_created', 'analytics.share_created']
  const rows = await db.collection('auditlogs').find({ action: { $in: names }, orgId: { $in: [A.orgId, B.orgId] } }).toArray()
  assert.ok(rows.length >= names.length); for (const r of rows) assert.ok(r.orgId === A.orgId, `event ${r.action} scoped to the acting org`)
  const mine = await kit.api('/api/admin/audit?limit=200', { token: tok.adm }); assert.equal(mine.status, 200)
  assert.ok(mine.json.logs.some(l => l.action === 'holiday.created')); assert.ok(mine.json.logs.every(l => l.orgId === A.orgId))
  const theirs = await kit.api('/api/admin/audit?limit=200', { token: tok.bAdm }); assert.equal(theirs.status, 200)
  assert.ok(theirs.json.logs.every(l => l.orgId === B.orgId) && !theirs.json.logs.some(l => l.action === 'holiday.created'), 'org B never sees org A events')
  for (const t of [tok.emp, tok.mgr]) assert.equal((await kit.api('/api/admin/audit', { token: t })).status, 403, 'non-admins cannot read the audit log')
  assert.equal((await kit.api('/api/admin/audit')).status, 401)
})

test('AU9. CONCURRENCY: simultaneous deletes / reset confirms succeed exactly once and emit exactly one event', async () => {
  const c = await post('/api/announcements', { title: 'Race', body: '<p>b</p>' }); assert.equal(c.status, 201)
  const rs = await Promise.all(Array.from({ length: 6 }, () => kit.api(`/api/announcements/${c.json._id}`, { method: 'DELETE', token: tok.adm })))
  assert.equal(rs.filter(r => r.status === 200).length, 1, rs.map(r => r.status).join(',')); assert.ok(rs.filter(r => r.status !== 200).every(r => r.status === 404))
  const del = (await events(A.orgId, 'announcement.deleted')).filter(e => e.targetId === c.json._id); assert.equal(del.length, 1, 'one delete -> one event')

  const org = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  const rq = await kit.api('/api/auth/password-reset/request', { method: 'POST', body: { email: org.employee.email } })
  const token = new URLSearchParams(new URL(rq.json.resetUrl).hash.replace(/^#/, '')).get('token')
  const cs = await Promise.all(Array.from({ length: 5 }, () => kit.api('/api/auth/password-reset/confirm', { method: 'POST', body: { token, newPassword: 'Racing!Passw0rd#5' }, ip: kit.freshIp() })))
  assert.equal(cs.filter(r => r.status === 200).length, 1, cs.map(r => r.status).join(',')); assert.ok(cs.filter(r => r.status !== 200).every(r => r.status === 400))
  assert.equal(await count(org.orgId, 'auth.password_reset_completed'), 1)
})
