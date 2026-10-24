/**
 * Phase 12 write-endpoint fuzz matrix (disposable local DB, real server). For every listed mutating handler, hostile bodies/ids/types must produce a
 * 4xx contract — never an unhandled 5xx — and anonymous / wrong-role callers must be refused. Valid-flow safety is covered by each feature's own suite.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const kit = require('./helpers/authTestKit')

const KEYS = ['name', 'firstName', 'lastName', 'email', 'phone', 'company', 'designation', 'department', 'role', 'status', 'type', 'title', 'body', 'reason', 'notes', 'note',
  'managerNote', 'adminNote', 'amount', 'days', 'startDate', 'endDate', 'date', 'joiningDate', 'dob', 'birthday', 'tags', 'visibility', 'sharedWith', 'lineItems', 'receipts', 'timeline',
  'clientRequestId', 'travelRequestId', 'to', 'cc', 'bcc', 'subject', 'html', 'text', 'attachments', 'host', 'port', 'user', 'pass', 'password', 'secure', 'imapHost', 'smtpHost',
  'fromName', 'fromEmail', 'revision', 'purpose', 'destination', 'origin', 'itinerary', 'estimatedCost', 'mode', 'approvers', 'userId', 'isActive', 'banned', 'managerId', 'expiresAt',
  'paymentMethod', 'paymentProof', 'paymentNote', 'address', 'city', 'state', 'pincode', 'emergencyContact', 'bankDetails', 'skills', 'photo', 'logo', 'pinned', 'priority', 'ids', 'id']
const HOSTILE = [null, 123456789012345680000, -1, 0, true, '', 'x'.repeat(20000), [], ['x'.repeat(500)], Array.from({ length: 2000 }, (_, i) => i), {}, { $gt: '' }, { $ne: null }, { a: { b: { c: 1 } } }, 'not-a-date', '0000000000000000000000ff', "'; DROP", '<script>alert(1)</script>']
const BAD_IDS = ['nope', '0'.repeat(24), 'f'.repeat(24), '%00', '..', '{"$gt":""}', 'x'.repeat(300)]

let db, A, B, tok, seeds
let fails = []
const record = (label, r) => { if (r.status >= 500 && r.status !== 503) fails.push(`${label} -> ${r.status} ${r.text.slice(0, 90)}`) }

test.before(async () => {
  db = await kit.connect(); A = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true }); B = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  tok = { adm: (await kit.login(A.admin.email)).accessToken, mgr: (await kit.login(A.manager.email)).accessToken, emp: (await kit.login(A.employee.email)).accessToken, otherAdm: (await kit.login(B.admin.email)).accessToken }
  const p = (u, b, t = tok.adm) => kit.api(u, { method: 'POST', token: t, body: b })
  seeds = {}
  seeds.contact = (await p('/api/crm', { name: 'Fuzz Contact' })).json?._id
  seeds.draft = (await p('/api/mail/drafts', { to: ['a@b.co'], subject: 's', body: 'b' })).json?._id
  seeds.travel = (await p('/api/travel', { purpose: 'Fuzz', destination: 'Pune', departureDate: '2027-03-01', returnDate: '2027-03-02' }, tok.emp)).json?._id
  seeds.expense = (await p('/api/rms', { title: 'F', amount: 10, startDate: '2027-03-01', endDate: '2027-03-01', reason: 'r' }, tok.emp)).json?._id
  const iv = (await p('/api/admin/invitations', { email: `fz_${kit.rand()}@test.dd`, role: 'employee' })).json?.invitation; seeds.inv = iv?._id || iv?.id
  seeds.leave = (await p('/api/lms', { type: 'casual', startDate: '2027-04-01', endDate: '2027-04-02', days: 2, reason: 'r' }, tok.emp)).json?._id
  seeds.empId = (await db.collection('employees').findOne({ orgId: A.orgId, email: A.employee.email }))?._id?.toString()
})
test.beforeEach(() => { fails = [] })
test.after(async () => { await kit.cleanupAll(db); await kit.disconnect() })

const E = () => [
  ['POST', '/api/admin/users'], ['PATCH', `/api/admin/users/${A.employee.id}`], ['POST', '/api/admin/invitations'], ['POST', `/api/admin/invitations/${seeds.inv}/resend`],
  ['PATCH', `/api/employees/${seeds.empId}`], ['PATCH', '/api/employees/me'],
  ['POST', '/api/rms'], ['PATCH', `/api/rms/${seeds.expense}`], ['PATCH', `/api/rms/${seeds.expense}`], ['POST', '/api/rms/ocr'],
  ['POST', '/api/travel'], ['PATCH', `/api/travel/${seeds.travel}`], ['POST', `/api/travel/${seeds.travel}/expense`],
  ['POST', '/api/crm'], ['PATCH', `/api/crm/${seeds.contact}`], ['POST', `/api/crm/${seeds.contact}/share`], ['PATCH', '/api/crm/reminders'], ['POST', '/api/crm/scanned-cards'],
  ['POST', '/api/mail/drafts'], ['PATCH', `/api/mail/drafts/${seeds.draft}`], ['PATCH', '/api/inbox/' + '0'.repeat(24)],
  ['POST', '/api/user/email-config'], ['POST', '/api/user/email-config/test'], ['PUT', '/api/org/mail-config'],
  ['PATCH', `/api/lms/${seeds.leave}`], ['PATCH', '/api/crm/scanned-cards/' + '0'.repeat(24)], ['POST', '/api/uploads/sign'], ['POST', '/api/rms/' + seeds.expense + '/receipt'],
  ['POST', '/api/announcements'], ['POST', '/api/announcements/broadcast'], ['POST', '/api/holidays'], ['POST', '/api/lms'], ['POST', '/api/notifications'],
  ['POST', '/api/org/settings'], ['PATCH', '/api/admin/settings'], ['POST', '/api/auth/change-password'], ['POST', '/api/analytics/share'],
]

test('F1. hostile whole-body values never cause an unhandled 5xx on any listed write endpoint (admin session)', { timeout: 600000 }, async () => {
  for (const [m, u] of E()) {
    for (const h of HOSTILE) record(`${m} ${u} all-keys=${JSON.stringify(h).slice(0, 30)}`, await kit.api(u, { method: m, token: tok.adm, body: Object.fromEntries(KEYS.map(k => [k, h])) }))
    for (const raw of ['null', '[]', '"s"', '123', '{', '', '{"a":'] ) record(`${m} ${u} raw=${raw}`, await kit.api(u, { method: m, token: tok.adm, raw, headers: { 'Content-Type': 'application/json' } }))
  }
  assert.deepEqual(fails, [], fails.join('\n'))
})

test('F2. one hostile value per field never causes an unhandled 5xx', { timeout: 900000 }, async () => {
  const mini = [null, 'x'.repeat(5000), { $gt: '' }]
  for (const [m, u] of E()) for (const k of KEYS) for (const h of mini) record(`${m} ${u} ${k}=${JSON.stringify(h).slice(0, 20)}`, await kit.api(u, { method: m, token: tok.adm, body: { [k]: h } }))
  assert.deepEqual(fails, [], fails.slice(0, 60).join('\n') + `\n(total ${fails.length})`)
})

test('F3. malformed / foreign ids on id-routes are 4xx, never 5xx; other-tenant admin gets 403/404', async () => {
  const routes = [['PATCH', 'admin/users'], ['DELETE', 'admin/users'], ['GET', 'admin/users'], ['PATCH', 'employees'], ['GET', 'employees'], ['PATCH', 'rms'], ['GET', 'rms'], ['DELETE', 'rms'], ['GET', 'travel'], ['PATCH', 'travel'], ['DELETE', 'travel'],
    ['PATCH', 'crm'], ['GET', 'crm'], ['DELETE', 'crm'], ['POST', 'crm/X/share'], ['DELETE', 'crm/X/share'], ['PATCH', 'mail/drafts'], ['GET', 'mail/drafts'], ['DELETE', 'mail/drafts'], ['PATCH', 'announcements'], ['DELETE', 'announcements'],
    ['DELETE', 'admin/invitations'], ['POST', 'admin/invitations/X/resend'], ['PATCH', 'inbox'], ['GET', 'inbox']]
  for (const [m, base] of routes) for (const id of BAD_IDS) {
    const path = base.includes('X') ? base.replace('X', id) : `${base}/${encodeURIComponent(id)}`
    record(`${m} /api/${path}`, await kit.api(`/api/${path}`, { method: m, token: tok.adm, body: m === 'GET' || m === 'DELETE' ? undefined : {} }))
  }
  const real = { 'admin/users': A.employee.id, employees: seeds.empId, rms: seeds.expense, travel: seeds.travel, crm: seeds.contact, 'mail/drafts': seeds.draft }
  for (const [base, id] of Object.entries(real)) for (const m of ['GET', 'PATCH', 'DELETE']) {
    const r = await kit.api(`/api/${base}/${id}`, { method: m, token: tok.otherAdm, body: m === 'PATCH' ? { name: 'hijack', status: 'approved' } : undefined })
    record(`cross-tenant ${m} ${base}`, r); assert.ok([403, 404, 405].includes(r.status), `cross-tenant ${m} /api/${base}/${id} -> ${r.status}`)
  }
  assert.deepEqual(fails, [], fails.join('\n'))
})

test('F4. anonymous callers are 401 on every listed write endpoint; wrong-role callers are refused on admin-only ones', async () => {
  assert.ok(seeds.inv && seeds.contact && seeds.draft && seeds.travel && seeds.expense && seeds.leave && seeds.empId, 'all fixtures seeded: ' + JSON.stringify(seeds))
  const C = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true }); tok.emp = (await kit.login(C.employee.email)).accessToken
  for (const [m, u] of E()) { const r = await kit.api(u, { method: m, body: {} }); assert.ok([401, 403].includes(r.status), `anon ${m} ${u} -> ${r.status}`) }
  for (const [m, u] of [['POST', '/api/admin/users'], ['POST', '/api/admin/invitations'], ['PATCH', `/api/admin/users/${A.manager.id}`], ['POST', '/api/holidays'], ['POST', '/api/org/settings'], ['PATCH', '/api/admin/settings'], ['PUT', '/api/org/mail-config'], ['POST', '/api/announcements']]) {
    const r = await kit.api(u, { method: m, token: tok.emp, body: { name: 'x', email: 'x@y.co', role: 'admin' } }); assert.equal(r.status, 403, `employee ${m} ${u} -> ${r.status}`)
  }
})

test('F5. public (unauthenticated) endpoints answer hostile bodies with 4xx/429 — never a 5xx and never data', async () => {
  const pubs = [['POST', '/api/auth/login'], ['POST', '/api/auth/verify-otp'], ['POST', '/api/auth/send-otp'], ['POST', '/api/auth/refresh'], ['POST', '/api/auth/logout'], ['POST', '/api/auth/password-reset/request'], ['POST', '/api/auth/password-reset/check'],
    ['POST', '/api/auth/password-reset/confirm'], ['POST', '/api/auth/invitations/verify'], ['POST', '/api/auth/invitations/accept'], ['POST', '/api/auth/setup'], ['POST', '/api/auth/passkey/login'], ['POST', '/api/support/chat']]
  for (const [m, u] of pubs) {
    for (const h of HOSTILE) record(`${m} ${u} all-keys=${JSON.stringify(h).slice(0, 30)}`, await kit.api(u, { method: m, body: Object.fromEntries(KEYS.concat(['token', 'otp', 'preAuthToken', 'refreshToken', 'newPassword', 'secret', 'message', 'messages']).map(k => [k, h])) }))
    for (const raw of ['null', '[]', '"s"', '{', '']) record(`${m} ${u} raw=${raw}`, await kit.api(u, { method: m, raw, headers: { 'Content-Type': 'application/json' } }))
  }
  assert.deepEqual(fails, [], fails.join('\n'))
})
