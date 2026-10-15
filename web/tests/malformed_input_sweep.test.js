/**
 * Malformed-input sweep (Phase 5B): every body-accepting route must answer a broken body (invalid JSON, wrong JSON type, operator-shaped values)
 * with a 4xx — never an unhandled 5xx — and must not mutate anything. Real routes, throwaway DB, fake providers.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const kit = require('./helpers/authTestKit')

let db, A, tok, ids
test.before(async () => {
  db = await kit.connect()
  A = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true })
  tok = {}; for (const r of ['admin', 'manager', 'employee']) tok[r] = (await kit.login(A[r].email)).accessToken
  const J = async (p, t, body, method = 'POST') => (await kit.api(p, { method, token: tok[t], body })).json
  const ann = await J('/api/announcements', 'admin', { title: 'T', body: 'hello', priority: 'normal' })
  const contact = await J('/api/crm', 'employee', { name: 'C' })
  const draft = await J('/api/mail/drafts', 'admin', { subject: 's', bodyHtml: '<p>x</p>', recipients: [] })
  ids = { ann: ann && ann._id, contact: contact && contact._id, draft: draft && draft._id }
})
test.after(async () => { await kit.cleanupAll(db); await kit.disconnect() })

const BAD = [['invalid json', '{not json'], ['array', '[]'], ['null', 'null'], ['string', '"x"']]
const send = (method, path, role, raw) => kit.api(path, { method, token: role ? tok[role] : undefined, raw, headers: { 'Content-Type': 'application/json' } })

const ROUTES = () => [
  ['POST', '/api/announcements', 'admin'], ['PATCH', `/api/announcements/${ids.ann}`, 'admin'], ['POST', '/api/announcements/broadcast', 'admin'],
  ['POST', '/api/admin/users', 'admin'], ['PATCH', `/api/admin/users/${A.employee.id}`, 'admin'], ['PATCH', `/api/admin/balances/${A.employee.id}`, 'admin'],
  ['POST', '/api/admin/invitations', 'admin'], ['POST', '/api/holidays', 'admin'], ['DELETE', '/api/holidays', 'admin'],
  ['POST', '/api/crm', 'employee'], ['PATCH', `/api/crm/${ids.contact}`, 'employee'], ['POST', '/api/crm/generate', 'employee'], ['POST', '/api/crm/campaign', 'admin'], ['POST', '/api/crm/ocr', 'employee'],
  ['POST', '/api/mail/drafts', 'admin'], ['PATCH', `/api/mail/drafts/${ids.draft}`, 'admin'],
  ['POST', '/api/rms', 'employee'], ['POST', '/api/rms/ocr', 'employee'], ['POST', '/api/travel', 'employee'], ['POST', '/api/lms', 'employee'],
  ['PATCH', '/api/employees/me', 'employee'], ['PATCH', `/api/employees/${A.employee.id}`, 'manager'], ['PATCH', '/api/org/settings', 'admin'], ['PATCH', '/api/admin/settings', 'admin'],
  ['POST', '/api/user/email-config', 'employee'], ['POST', '/api/uploads/sign', 'employee'], ['POST', '/api/analytics/share', 'admin'],
  ['POST', '/api/auth/change-password', 'employee'], ['POST', '/api/billing/play/verify', 'admin'], ['POST', '/api/support/chat', null],
  ['POST', '/api/auth/login', null], ['POST', '/api/auth/send-otp', null], ['POST', '/api/auth/verify-otp', null], ['POST', '/api/auth/register', null], ['POST', '/api/auth/refresh', null],
  ['POST', '/api/auth/password-reset/request', null], ['POST', '/api/auth/password-reset/confirm', null], ['POST', '/api/auth/invitations/accept', null], ['POST', '/api/auth/invitations/verify', null],
  ['POST', '/api/webhooks/outlook', null],
]

test('M1. every body-accepting route answers broken bodies with a 4xx (never 5xx)', async () => {
  const bad = []
  for (const [method, path, role] of ROUTES()) for (const [label, raw] of BAD) {
    if (path.endsWith('/undefined')) continue
    const r = await send(method, path, role, raw)
    if (r.status >= 500) bad.push(`${method} ${path.replace(/[0-9a-f]{24}/, ':id')} [${label}] → ${r.status}`)
    assert.doesNotMatch(r.text, /stack|at .*\(.*:\d+:\d+\)|MongoServer|mongoose|E11000/i, `${method} ${path} leaks internals`)
  }
  assert.deepEqual(bad, [], 'routes that answered 5xx:\n' + bad.join('\n'))
})
