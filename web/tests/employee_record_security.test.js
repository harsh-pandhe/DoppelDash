/**
 * Employee record endpoints (Phase 5B). Real routes, throwaway DB.
 *  - GET /api/employees/[id] used to return the FULL Employee document (address, DOB, medical details, emergency contacts, encrypted bank blob) to ANY member of the organisation.
 *  - PATCH /api/employees/me removed `privileges` but not the dotted path `privileges.food.dailyLimit` (→ self-escalation of reimbursement limits) and let clients set counters/flags.
 *  - PATCH /api/employees/[id] `$set` any field (bank/medical/e-mail/isActive/dotted paths) for managers.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const kit = require('./helpers/authTestKit')

let db, A, B, tok, peer
test.before(async () => {
  db = await kit.connect()
  A = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true }); B = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  tok = {}
  for (const [k, org] of [['A', A], ['B', B]]) for (const r of ['admin', 'manager', 'employee']) tok[`${k}${r}`] = (await kit.login(org[r].email)).accessToken
  const User = kit.load('models/User.ts').default, Employee = kit.load('models/Employee.ts').default
  const email = `peer_${kit.rand()}@test.dd`
  const u = await User.create({ orgId: A.orgId, email, passwordHash: await User.hashPassword(kit.PASSWORD), role: 'employee', firstName: 'Pia', lastName: 'Peer', mustChangePassword: false, isActive: true, sessionVersion: 1 })
  await Employee.create({ clerkUserId: u._id.toString(), orgId: A.orgId, createdByUserId: u._id.toString(), firstName: 'Pia', lastName: 'Peer', email, department: 'QA', designation: 'employee', employeeType: 'full_time', joiningDate: new Date(), onboardingComplete: true, onboardingStep: 5 })
  peer = { id: u._id.toString(), token: (await kit.login(email)).accessToken }
  await db.collection('employees').updateOne({ clerkUserId: A.employee.id }, { $set: { address: '12 Secret Lane', dateOfBirth: new Date('1990-01-02'), 'medicalDetails.bloodGroup': 'O-', 'medicalDetails.conditions': ['asthma'], bankDetails: { bankName: 'ENC', accountNumber: 'ENCRYPTED-BLOB', ifscCode: 'x', accountHolderName: 'x', accountType: 'savings' }, emergencyContacts: [{ name: 'Mum', phone: '999', relationship: 'mother' }] } })
})
test.after(async () => { await kit.cleanupAll(db); await kit.disconnect() })

const get = (t, id) => kit.api(`/api/employees/${id}`, { token: t })
const patch = (t, id, body, raw) => kit.api(`/api/employees/${id}`, { method: 'PATCH', token: t, ...(raw ? { raw } : { body }) })
const emp = id => db.collection('employees').findOne({ clerkUserId: id })
const SENSITIVE = /Secret Lane|asthma|O-|ENCRYPTED-BLOB|Mum|1990-01-02/

test('E1. GET /api/employees/[id]: a colleague gets 403 and no data; anonymous 401; other tenant 404', async () => {
  const r = await get(peer.token, A.employee.id)
  assert.equal(r.status, 403, r.text); assert.doesNotMatch(r.text, SENSITIVE)
  assert.equal((await kit.api(`/api/employees/${A.employee.id}`)).status, 401)
  assert.equal((await get(tok.Bemployee, A.employee.id)).status, 404); assert.equal((await get(tok.Bmanager, A.employee.id)).status, 404)
})

test('E2. GET /api/employees/[id]: the owner, a manager and an admin can read; bank blob is never returned here; medical details only to the owner/admin', async () => {
  const own = await get(tok.Aemployee, A.employee.id); assert.equal(own.status, 200)
  assert.equal(own.json.bankDetails, undefined)
  const mgr = await get(tok.Amanager, A.employee.id); assert.equal(mgr.status, 200); assert.equal(mgr.json.bankDetails, undefined); assert.equal(mgr.json.medicalDetails, undefined, 'manager does not need medical details')
  const adm = await get(tok.Aadmin, A.employee.id); assert.equal(adm.status, 200); assert.equal(adm.json.bankDetails, undefined); assert.equal(adm.json.medicalDetails.bloodGroup, 'O-')
  assert.equal(adm.json.firstName, 'Eve')
})

test('E3. PATCH /api/employees/me cannot change privileges — including via dotted paths — or server-owned counters/flags', async () => {
  const before = await emp(A.employee.id)
  for (const body of [
    { 'privileges.food.dailyLimit': 99999 }, { 'privileges.travelAdvance': 500000 }, { 'privileges.flight.enabled': true, 'privileges.flight.tier': 'business' },
    { privileges: { travelAdvance: 1 } }, { loginCount: 1e6 }, { lastLoginAt: new Date(0) }, { onboardingNudgeSentAt: new Date(0) }, { isActive: false }, { 'isActive': false, department: 'Hacked' },
    { createdByUserId: 'x' }, { reportingManagerId: A.admin.id }, { employeeId: 'EMP-999' }, { $set: { designation: 'CEO' } }, { 'x.y': 1 },
  ]) {
    const r = await kit.api('/api/employees/me', { method: 'PATCH', token: tok.Aemployee, body })
    assert.ok([200, 400].includes(r.status), `${JSON.stringify(body)} → ${r.status} ${r.text}`)
  }
  const after = await emp(A.employee.id)
  assert.deepEqual(after.privileges, before.privileges, 'privileges untouched'); assert.equal(after.loginCount, before.loginCount); assert.equal(after.isActive, before.isActive)
  assert.equal(after.department, before.department); assert.equal(after.designation, before.designation); assert.equal(after.employeeId, before.employeeId); assert.equal(after.reportingManagerId ?? null, before.reportingManagerId ?? null)
  assert.equal(String(after.lastLoginAt ?? ''), String(before.lastLoginAt ?? ''))
})

test('E4. PATCH /api/employees/me still saves the profile fields the Web and Android clients send (and encrypts bank details)', async () => {
  const r = await kit.api('/api/employees/me', { method: 'PATCH', token: tok.Aemployee, body: { phone: '+91 90000 00001', gender: 'female', address: '5 Test Rd', city: 'Pune', state: 'MH', firstName: 'Eve', lastName: 'Tester', bankDetails: { bankName: 'B', accountNumber: '123456789', ifscCode: 'IFSC0001', accountHolderName: 'Eve', accountType: 'savings' }, emergencyContacts: [{ name: 'Dad', phone: '1', relationship: 'father' }], medicalDetails: { bloodGroup: 'A+' }, onboardingStep: 2 } })
  assert.equal(r.status, 200, r.text); assert.equal(r.json.phone, '+91 90000 00001'); assert.equal(r.json.bankDetails.accountNumber, '123456789', 'the owner sees it decrypted')
  const stored = await emp(A.employee.id); assert.notEqual(stored.bankDetails.accountNumber, '123456789', 'stored encrypted'); assert.equal(stored.city, 'Pune'); assert.equal(stored.medicalDetails.bloodGroup, 'A+')
  const done = await kit.api('/api/employees/me', { method: 'PATCH', token: tok.Aemployee, body: { onboardingStep: 4 } }); assert.equal(done.status, 200); assert.equal((await emp(A.employee.id)).onboardingComplete, true)
})

test('E5. PATCH /api/employees/me: malformed JSON, non-object bodies and wrong types are 400, never 500', async () => {
  for (const raw of ['{not json', '[]', '"x"', 'null']) assert.equal((await kit.api('/api/employees/me', { method: 'PATCH', token: tok.Aemployee, raw, headers: { 'Content-Type': 'application/json' } })).status, 400, raw)
  assert.equal((await kit.api('/api/employees/me', { method: 'PATCH', token: tok.Aemployee, body: { phone: { $gt: 1 } } })).status, 400)
  assert.equal((await kit.api('/api/employees/me', { method: 'PATCH', token: tok.Aemployee, body: { dateOfBirth: 'not-a-date' } })).status, 400)
})

test('E6. PATCH /api/employees/[id]: employees 403; other tenant 404; managers/admins may change work assignment only — bank, medical, e-mail, isActive, ids, dotted paths and operators are refused with the field names', async () => {
  assert.equal((await patch(tok.Aemployee, A.employee.id, { designation: 'x' })).status, 403); assert.equal((await patch(peer.token, A.employee.id, { designation: 'x' })).status, 403)
  assert.equal((await patch(tok.Bmanager, A.employee.id, { designation: 'x' })).status, 404); assert.equal((await patch(tok.Badmin, A.employee.id, { designation: 'x' })).status, 404)
  assert.equal((await kit.api(`/api/employees/${A.employee.id}`, { method: 'PATCH', body: { designation: 'x' } })).status, 401)
  const before = JSON.stringify(await emp(A.employee.id))
  for (const body of [{ bankDetails: { accountNumber: 'PLAINTEXT' } }, { 'bankDetails.accountNumber': 'PLAINTEXT' }, { medicalDetails: { bloodGroup: 'X' } }, { email: 'evil@x.test' }, { isActive: false }, { clerkUserId: 'z' }, { 'privileges.food.dailyLimit': 1 }, { $set: { designation: 'x' } }, { loginCount: 9 }, { onboardingComplete: false }]) {
    const r = await patch(tok.Amanager, A.employee.id, body); assert.equal(r.status, 400, `${JSON.stringify(body)} → ${r.status}`); assert.ok(Array.isArray(r.json.fields) && r.json.fields.length, r.text)
  }
  assert.equal(JSON.stringify(await emp(A.employee.id)), before, 'refused requests change nothing')
  const ok = await patch(tok.Amanager, A.employee.id, { designation: 'Senior Tester', department: 'QA2', privileges: { food: { tier: 'basic', dailyLimit: 500 }, taxi: { tier: 'standard', perKmLimit: 12 }, flight: { tier: 'economy', enabled: true }, hotel: { tier: 'budget', perNightLimit: 3000 }, travelAdvance: 10000 } })
  assert.equal(ok.status, 200, ok.text); const e = await emp(A.employee.id); assert.equal(e.designation, 'Senior Tester'); assert.equal(e.privileges.food.dailyLimit, 500)
  assert.equal((await patch(tok.Amanager, A.employee.id, null, '{bad')).status, 400)
  assert.equal((await patch(tok.Amanager, A.employee.id, { reportingManagerId: B.manager.id })).status, 400, 'a manager from another organisation is not a valid reporting manager')
  assert.equal((await patch(tok.Aadmin, A.employee.id, { reportingManagerId: A.manager.id })).status, 200)
})

test('E7. field-leak sweep: no list, detail, analytics, report, notification, search or directory response contains another employee’s bank, medical, address, emergency-contact data — for every role — and admin user detail never returns the bank blob', async () => {
  const LEAKY = /ENCRYPTED-BLOB|accountNumber|ifscCode|asthma|bloodGroup|Secret Lane|\bMum\b|emergencyContacts|medicalDetails|bankDetails/
  const routes = ['/api/employees/directory', '/api/reports', '/api/notifications', '/api/analytics', '/api/analytics/software', '/api/lms/workload', '/api/lms/calendar', '/api/lms', '/api/rms', '/api/travel', '/api/crm', '/api/announcements', '/api/holidays', '/api/auth/me', '/api/search?q=Eve', '/api/admin/users', '/api/admin/audit']
  const asPeer = { 'peer': peer.token, 'Amanager': tok.Amanager, 'Aadmin': tok.Aadmin }
  for (const [who, token] of Object.entries(asPeer)) for (const p of routes) {
    const r = await kit.api(p, { token }); if (r.status === 403) continue
    assert.ok(r.status < 500, `${who} ${p} → ${r.status}`); assert.doesNotMatch(r.text, LEAKY, `${who} ${p} leaks sensitive employee fields`)
  }
  const d = await kit.api(`/api/admin/users/${A.employee.id}`, { token: tok.Aadmin }); assert.equal(d.status, 200)
  assert.equal(d.json.employee.bankDetails, undefined); assert.doesNotMatch(d.text, /ENCRYPTED-BLOB|accountNumber/); assert.equal(d.json.employee.firstName, 'Eve')
  for (const t of [tok.Aemployee, tok.Amanager, peer.token]) assert.equal((await kit.api(`/api/admin/users/${A.employee.id}`, { token: t })).status, 403)
  assert.equal((await kit.api(`/api/admin/users/${A.employee.id}`, { token: tok.Badmin })).status, 404)
  const own = await kit.api('/api/employees/me', { token: tok.Aemployee }); assert.equal(own.status, 200); assert.match(own.text, /Secret Lane|bankName/, 'the owner still sees their own data')
})

test('E8. an invitation for a CONTRACTOR (offered by the invite dialog) can be accepted: the stored employee type is the schema value `contract` (found by the stricter Mongoose typings: `contractor` is not in the Employee enum, so acceptance failed)', async () => {
  const email = `contractor_${kit.rand()}@test.dd`
  const inv = await kit.api('/api/admin/invitations', { method: 'POST', token: tok.Aadmin, body: { email, role: 'employee', firstName: 'Con', lastName: 'Tractor', employeeType: 'contractor' } })
  assert.equal(inv.status, 201, inv.text); const raw = inv.json.rawToken; assert.ok(raw)
  const acc = await kit.api('/api/auth/invitations/accept', { method: 'POST', body: { token: raw, password: 'Inv!ted#Passw0rd9', firstName: 'Con', lastName: 'Tractor' } })
  assert.ok([200, 201].includes(acc.status), `accept → ${acc.status} ${acc.text}`)
  const u = await db.collection('users').findOne({ email }); assert.ok(u, 'the account was created'); const e = await db.collection('employees').findOne({ clerkUserId: String(u._id) })
  assert.ok(e, 'the employee record was created'); assert.equal(e.employeeType, 'contract')
})
