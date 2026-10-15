/**
 * DoppelDash — invitation tokens never travel in URLs, are never echoed, never logged.
 *
 *   - emailed / admin-visible invite links carry the token in the URL FRAGMENT
 *   - preview = POST /api/auth/invitations/verify { token } (body only), read-only
 *   - the old GET /api/auth/invitations/<token> contract is removed (405, never reads the segment)
 *   - acceptance = POST body; tenant and role come from the stored invitation, never the client
 *   - responses and the rendered /invite HTML never contain the token
 *   - with DD_SERVER_LOG set: NO real invitation token appears anywhere in the server log
 *     (no exclusion rules — only token-shaped DECOYS are used for the deliberate legacy-URL probes)
 *
 * Requires the dev server on TEST_URL + the same throwaway DB (and SMTP on 127.0.0.1:2525 to capture the e-mails).
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const kit = require('./helpers/authTestKit')

let db
let smtp
const realTokens = new Set()     // every genuine invitation token this suite created
const DECOY = 'dec0' + 'cd'.repeat(30)   // token-shaped, never a real secret — used only for legacy-URL probes
const OTHER_SUITE_DECOY = 'dec0' + 'ab'.repeat(30)   // the password-reset hygiene suite's decoy (same log)

test.before(async () => { db = await kit.connect(); smtp = await kit.startFakeSmtp(2525) })
test.after(async () => { await kit.cleanupAll(db); await smtp.stop(); await kit.disconnect() })

const tokenFromUrl = u => new URLSearchParams(new URL(u).hash.replace(/^#/, '')).get('token')
const verify = (token, extra = {}) => kit.api('/api/auth/invitations/verify', { method: 'POST', body: { token }, ...extra })
const INVITEE_PW = 'Inv!ted#Passw0rd9'

async function invite(org, { role = 'employee', email, adminToken } = {}) {
  const admin = adminToken ? { accessToken: adminToken } : await kit.login(org.admin.email)
  const to = email || `inv_${kit.rand()}@test.dd`
  const r = await kit.api('/api/admin/invitations', { method: 'POST', token: admin.accessToken, body: { email: to, role, firstName: 'Ina', lastName: 'Vitee' } })
  assert.equal(r.status, 201, r.text)
  const url = r.json.inviteUrl
  assert.ok(url, 'dev backend returns the link for automation')
  const token = tokenFromUrl(url)
  realTokens.add(token)
  return { admin, to, url, token, id: r.json.invitation?._id || r.json.invitation?.id, res: r }
}

test('I1. the invite link carries its token in the URL fragment — never the query string or path', async () => {
  const org = await kit.createOrg()
  const { url, token } = await invite(org)
  const u = new URL(url)
  assert.equal(u.pathname, '/invite')
  assert.equal(u.search, '', 'no query string at all')
  assert.ok(!u.pathname.includes(token))
  assert.match(u.hash, /^#token=[0-9a-f]{64}$/)
})

test('I2. POST /verify is a read-only preview from the stored invitation; the token is never echoed; no-store', async () => {
  const org = await kit.createOrg({ name: 'Hygiene Org' })
  const { to, token } = await invite(org, { role: 'manager' })
  const res = await verify(token)
  assert.equal(res.status, 200)
  assert.equal(res.json.valid, true)
  assert.equal(res.json.email, to); assert.equal(res.json.role, 'manager'); assert.equal(res.json.organizationName, 'Hygiene Org'); assert.equal(res.json.orgId, org.orgId)
  assert.ok(!res.text.includes(token), 'response never contains the token')
  assert.match(res.headers.get('cache-control') || '', /no-store/)
  assert.equal((await verify(token)).status, 200, 'previewing does not consume the invitation')
})

test('I3. invalid, missing, expired, revoked and already-used invitations keep distinct, safe answers', async () => {
  const org = await kit.createOrg()
  const bogus = 'f'.repeat(64)
  const invalid = await verify(bogus)
  assert.equal(invalid.status, 404); assert.equal(invalid.json.reason, 'invalid_token'); assert.ok(!invalid.text.includes(bogus))
  assert.equal((await verify('')).json.reason, 'missing_token')
  assert.equal((await kit.api('/api/auth/invitations/verify', { method: 'POST', body: {} })).status, 400)
  assert.equal((await kit.api('/api/auth/invitations/verify', { method: 'POST', raw: '{nope' })).status, 400)

  const expiring = await invite(org)
  await db.collection('invitations').updateOne({ orgId: org.orgId, email: expiring.to }, { $set: { expiresAt: new Date(Date.now() - 60_000) } })
  const expired = await verify(expiring.token)
  assert.equal(expired.status, 410); assert.equal(expired.json.reason, 'expired'); assert.ok(!expired.text.includes(expiring.token))

  const revoking = await invite(org, { adminToken: expiring.admin.accessToken })
  const del = await kit.api(`/api/admin/invitations/${revoking.id}`, { method: 'DELETE', token: revoking.admin.accessToken })
  assert.ok(del.status < 300, del.text)
  const revoked = await verify(revoking.token)
  assert.equal(revoked.status, 410); assert.equal(revoked.json.reason, 'revoked')

  const using = await invite(org, { adminToken: expiring.admin.accessToken })
  const acc = await kit.api('/api/auth/invitations/accept', { method: 'POST', body: { token: using.token, password: INVITEE_PW, firstName: 'U', lastName: 'Sed' } })
  assert.equal(acc.status, 200, acc.text)
  const used = await verify(using.token)
  assert.equal(used.status, 410); assert.equal(used.json.reason, 'already_accepted'); assert.ok(!used.text.includes(using.token))
})

test('I4. the old GET path contract is removed: 405, never reads the segment; a query-string token on POST is ignored', async () => {
  const getOld = await kit.api(`/api/auth/invitations/${DECOY}`)
  assert.equal(getOld.status, 405)
  assert.equal(getOld.json.code, 'endpoint_removed')
  assert.ok(!getOld.text.includes(DECOY), 'the path segment is never echoed')
  assert.equal(getOld.headers.get('allow'), 'POST')
  assert.equal((await kit.api('/api/auth/invitations/verify')).status, 405, 'verify itself is POST-only')

  const queryOnly = await kit.api(`/api/auth/invitations/verify?token=${DECOY}`, { method: 'POST', body: {} })
  assert.equal(queryOnly.status, 400, 'only the body counts')
  assert.ok(!queryOnly.text.includes(DECOY))
})

test('I5. acceptance: token in the POST body; tenant and role come from the invitation, never the client; no token in the response', async () => {
  const org = await kit.createOrg()
  const other = await kit.createOrg()
  const { token, to } = await invite(org, { role: 'employee' })
  const acc = await kit.api('/api/auth/invitations/accept', {
    method: 'POST',
    body: { token, password: INVITEE_PW, firstName: 'Ina', lastName: 'Vitee', orgId: other.orgId, role: 'admin', organizationId: other.orgId },
  })
  assert.equal(acc.status, 200, acc.text)
  assert.equal(acc.json.user.orgId, org.orgId, 'client-supplied orgId ignored')
  assert.equal(acc.json.user.role, 'employee', 'client-supplied role ignored')
  assert.equal(acc.json.user.email, to)
  assert.ok(acc.json.accessToken && acc.json.refreshToken, 'a real session is issued')
  assert.ok(!acc.text.includes(token), 'the invitation token is not echoed')
  const me = await kit.api('/api/auth/me', { token: acc.json.accessToken })
  assert.equal(me.status, 200); assert.equal(me.json.organization.orgId, org.orgId); assert.equal(me.json.role ?? me.json.user.role, 'employee')
  assert.equal((await kit.api('/api/auth/invitations/accept', { method: 'POST', body: { token, password: INVITEE_PW } })).status >= 400, true, 'single use')
})

test('I6. the /invite page HTML never contains a token; a legacy ?token= link is answered by a token-free bridge page', async () => {
  const org = await kit.createOrg()
  const { token } = await invite(org)
  const plain = await fetch(`${kit.BASE_URL}/invite`)
  assert.equal(plain.status, 200)
  assert.ok(!(await plain.text()).includes(token), 'the page HTML never contains a real token')

  // Legacy link shape (e-mails sent before the fragment format) — probed with a DECOY, never a real token.
  const legacy = await fetch(`${kit.BASE_URL}/invite?token=${DECOY}`)
  assert.equal(legacy.status, 200)
  assert.match(legacy.headers.get('content-type') || '', /text\/html/)
  assert.equal(legacy.headers.get('referrer-policy'), 'no-referrer')
  assert.match(legacy.headers.get('cache-control') || '', /no-store/)
  const bridge = await legacy.text()
  assert.ok(!bridge.includes(DECOY), 'the legacy query token is never rendered into the HTML')
  assert.match(bridge, /location\.replace/, 'the bridge moves the token into the fragment client-side')
})

test('I7. invitation e-mails (new + resend) link with a fragment token and no query-string token link', async () => {
  const org = await kit.createOrg({ name: 'Mail Hygiene Org' })
  smtp.clear()
  const first = await invite(org)
  const mail = await smtp.waitFor(m => m.to.includes(first.to))
  const html = String(mail.html)
  const links = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1].replace(/&amp;/g, '&')).filter(h => /\/invite/.test(h))
  assert.ok(links.length >= 1, 'the e-mail has an invite link')
  for (const l of links) { assert.equal(new URL(l).search, '', 'no ?token= in the e-mailed link'); assert.equal(tokenFromUrl(l), first.token) }
  assert.doesNotMatch(html + mail.text, /invite\?token=|[?&]token=/, 'no query-string token anywhere in the message')

  smtp.clear()
  const rs = await kit.api(`/api/admin/invitations/${first.id}/resend`, { method: 'POST', token: first.admin.accessToken })
  assert.equal(rs.status, 200, rs.text)
  const newToken = tokenFromUrl(rs.json.inviteUrl)
  realTokens.add(newToken)
  assert.notEqual(newToken, first.token, 'resend rotates the token')
  const mail2 = await smtp.waitFor(m => m.to.includes(first.to))
  assert.doesNotMatch(String(mail2.html) + mail2.text, /[?&]token=/)
  assert.ok(String(mail2.html).includes(`#token=${newToken}`))
  assert.ok([404, 410].includes((await verify(first.token)).status), 'the old token is dead (rotated hash → unknown, or revoked)')
  assert.equal((await verify(newToken)).status, 200)
})

test('I8. the server log never contains a REAL invitation token (when DD_SERVER_LOG is set) — no exclusions', { skip: !process.env.DD_SERVER_LOG && 'set DD_SERVER_LOG to scan a dev-server log' }, () => {
  const log = fs.readFileSync(process.env.DD_SERVER_LOG, 'utf8')
  assert.ok(realTokens.size >= 8, `the suite created real tokens to look for (${realTokens.size})`)
  for (const t of realTokens) assert.ok(!log.includes(t), 'a real invitation token appears in the server log')
  const real = log.split('\n').filter(l => !l.includes(DECOY) && !l.includes(OTHER_SUITE_DECOY)).join('\n')   // DECOY lines are the deliberate legacy-URL probes
  assert.doesNotMatch(real, /\/api\/auth\/invitations\/[0-9a-f]{64}/, 'no request path carries a 64-hex token')
  assert.doesNotMatch(real, /\/invite\?[^\s]*token=/, 'no invite link query token')
  // The only token-shaped values in request lines may be this suite's own DECOY probes.
  const hexLines = real.split('\n').filter(l => /[0-9a-f]{64}/.test(l))
  assert.deepEqual(hexLines.slice(0, 3), [], 'no 256-bit hex secret in any log line')
})
