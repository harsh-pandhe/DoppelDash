/**
 * SMTP destination policy (Phase 5B): "connect my mailbox" made the server open connections to any host/port the user typed (loopback, cloud metadata,
 * private ranges) and echoed the connection error. Real routes for the validation, unit tests (fake resolver) for the DNS-rebinding guard.
 * No test connects to a real mail server.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const kit = require('./helpers/authTestKit')
const policy = () => kit.load('lib/mail/smtpHostPolicy.ts')

let db, A, tok
test.before(async () => { db = await kit.connect(); A = await kit.createOrg({ plan: 'premium', webEnabled: true, lifetimeGrant: true }); tok = (await kit.login(A.employee.email)).accessToken })
test.after(async () => { await db.collection('useremailconfigs').deleteMany({ orgId: A.orgId }); await kit.cleanupAll(db); await kit.disconnect() })
const save = body => kit.api('/api/user/email-config', { method: 'POST', token: tok, body })
const stored = () => db.collection('useremailconfigs').findOne({ orgId: A.orgId })

test('S1. policy unit: private / loopback / link-local / metadata / mapped IPv6 addresses are private; public ones are not', () => {
  const { isPrivateAddress } = policy()
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '224.0.0.1']) assert.equal(isPrivateAddress(ip), true, ip)
  for (const ip of ['8.8.8.8', '172.32.0.1', '203.0.113.5', '2607:f8b0:4005:80a::200e']) assert.equal(isPrivateAddress(ip), false, ip)
})

test('S2. policy unit: host syntax and ports', () => {
  const { checkSmtpHostSyntax, checkSmtpPort } = policy()
  for (const h of ['localhost', '127.0.0.1', '[::1]', '169.254.169.254', '10.0.0.5', 'mailhost', 'db.internal', 'printer.local', 'a.corp']) assert.throws(() => checkSmtpHostSyntax(h), /private_host/, h)
  for (const h of ['', ' ', 'bad host.com', 'a/b.com', 'user@x.com', 'x'.repeat(260) + '.com', '-bad-.com']) assert.throws(() => checkSmtpHostSyntax(h), /invalid_host/, JSON.stringify(h))
  for (const h of ['smtp.gmail.com', 'mail.example.org', '203.0.113.7', 'SMTP.Office365.com']) assert.doesNotThrow(() => checkSmtpHostSyntax(h), h)
  for (const p of [587, '465', 25, 2525]) assert.doesNotThrow(() => checkSmtpPort(p))
  for (const p of [27017, 22, 80, 6379, 0, -1, 587.5, 'x', null, undefined]) assert.throws(() => checkSmtpPort(p), /invalid_port/, String(p))
})

test('S3. DNS-rebinding guard: a public-looking name that resolves to ANY private address is refused; unresolvable names are refused; IP literals skip DNS', async () => {
  const { assertPublicSmtpHost } = policy()
  await assert.rejects(assertPublicSmtpHost('evil.example.com', async () => ['203.0.113.9', '10.0.0.7']), /private_host/)
  await assert.rejects(assertPublicSmtpHost('evil.example.com', async () => ['::1']), /private_host/)
  await assert.rejects(assertPublicSmtpHost('evil.example.com', async () => { throw new Error('ENOTFOUND') }), /unresolvable_host/)
  await assert.rejects(assertPublicSmtpHost('evil.example.com', async () => []), /unresolvable_host/)
  await assert.rejects(assertPublicSmtpHost('127.0.0.1', async () => ['8.8.8.8']), /private_host/)
  await assert.doesNotReject(assertPublicSmtpHost('smtp.example.com', async () => ['203.0.113.9', '2607:f8b0:4005:80a::200e']))
  await assert.doesNotReject(assertPublicSmtpHost('203.0.113.9', async () => { throw new Error('must not resolve literals') }))
})

test('S4. enforcement switch: on for production-like hosts or SMTP_HOST_POLICY=enforce; ALLOW_PRIVATE_SMTP_HOSTS only ever relaxes a developer machine', () => {
  const { smtpHostPolicyEnforced } = policy()
  assert.equal(smtpHostPolicyEnforced({ NODE_ENV: 'production' }), true); assert.equal(smtpHostPolicyEnforced({ NETLIFY: 'true' }), true)
  assert.equal(smtpHostPolicyEnforced({ NODE_ENV: 'development', SMTP_HOST_POLICY: 'enforce' }), true); assert.equal(smtpHostPolicyEnforced({ NODE_ENV: 'development' }), false)
  assert.equal(smtpHostPolicyEnforced({ NODE_ENV: 'production', ALLOW_PRIVATE_SMTP_HOSTS: 'true' }), true, 'the override never applies to production')
  assert.equal(smtpHostPolicyEnforced({ NETLIFY: 'true', ALLOW_PRIVATE_SMTP_HOSTS: 'true' }), true)
  assert.equal(smtpHostPolicyEnforced({ NODE_ENV: 'development', ALLOW_PRIVATE_SMTP_HOSTS: 'true' }), false)
})

test('S5. POST /api/user/email-config refuses internal hosts, odd ports and bad shapes — 400 with a stable code, nothing stored', async () => {
  for (const [smtpHost, smtpPort, code] of [['127.0.0.1', 587, 'private_host'], ['localhost', 587, 'private_host'], ['169.254.169.254', 80, 'private_host'], ['10.0.0.5', 587, 'private_host'], ['[::1]', 587, 'private_host'], ['db.internal', 587, 'private_host'], ['mongo', 587, 'private_host'], ['smtp.example.com', 27017, 'invalid_port'], ['smtp.example.com', 22, 'invalid_port'], ['bad host', 587, 'invalid_host']]) {
    const r = await save({ emailAddress: 'me@example.com', smtpHost, smtpPort, appPassword: 'pw' }); assert.equal(r.status, 400, `${smtpHost}:${smtpPort} → ${r.status} ${r.text}`); assert.equal(r.json.code, code, r.text)
    assert.doesNotMatch(r.text, /ECONN|stack|mongo/i)
  }
  for (const body of [{ emailAddress: 'not-an-email', smtpHost: 'smtp.example.com', appPassword: 'pw' }, { emailAddress: 'me@example.com', smtpHost: { $gt: '' }, appPassword: 'pw' }, { emailAddress: 'me@example.com', smtpHost: 'smtp.example.com', appPassword: 'x'.repeat(600) }, { emailAddress: 'me@example.com', smtpHost: 'smtp.example.com', appPassword: { a: 1 } }]) assert.equal((await save(body)).status, 400, JSON.stringify(body).slice(0, 80))
  assert.equal(await stored(), null, 'nothing was stored by any refused request')
})

test('S6. a valid public configuration is stored (password encrypted, never returned); the connection test refuses a stored internal host with a generic message and is rate limited; DELETE affects only the caller', async () => {
  const ok = await save({ emailAddress: 'me@example.com', smtpHost: 'SMTP.Example.com', smtpPort: 587, appPassword: 'super-secret-pw' }); assert.equal(ok.status, 200, ok.text)
  const s = await stored(); assert.equal(s.smtpHost, 'smtp.example.com'); assert.notEqual(s.appPassword, 'super-secret-pw')
  const g = await kit.api('/api/user/email-config', { token: tok }); assert.equal(g.status, 200); assert.doesNotMatch(g.text, /super-secret-pw|appPassword/)
  await db.collection('useremailconfigs').updateOne({ orgId: A.orgId }, { $set: { smtpHost: '169.254.169.254', smtpPort: 80 } })      // a record that predates the policy
  await db.collection('ratelimits').deleteMany({ key: /^email-test:/ })
  const t = await kit.api('/api/user/email-config/test', { method: 'POST', token: tok }); assert.equal(t.status, 400, t.text); assert.equal(t.json.code, 'private_host'); assert.doesNotMatch(t.text, /169\.254|ECONN/)
  let last; for (let i = 0; i < 6; i++) last = await kit.api('/api/user/email-config/test', { method: 'POST', token: tok })
  assert.equal(last.status, 429)
  assert.equal((await kit.api('/api/user/email-config/test', { method: 'POST' })).status, 401)
  assert.equal((await kit.api('/api/user/email-config', { method: 'DELETE', token: tok })).status, 200); assert.equal(await stored(), null)
})
