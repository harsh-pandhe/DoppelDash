/**
 * DoppelDash — persisted entitlement matrix, mobile (Bearer) vs browser (cookie).
 *
 * Exact expected states (public organisations are intentionally Android-enabled):
 *   Public Free        plan=free     source=none          lifetimeGrant=false webEnabled=false androidEnabled=true
 *   Public Premium     plan=premium  source=subscription  lifetimeGrant=false webEnabled=false androidEnabled=true
 *   Doppelmayr grant   plan=premium  source=lifetime_grant lifetimeGrant=true webEnabled=true  androidEnabled=true
 * For each: a real mobile login hydrates /api/auth/me from the PERSISTED server response, the mobile Bearer session works,
 * and a browser cookie session exists only where webEnabled is true. Premium alone never grants the browser.
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const kit = require('./helpers/authTestKit')

let db
test.before(async () => { db = await kit.connect() })
test.after(async () => { await kit.cleanupAll(db); await kit.disconnect() })

const CASES = [
  { name: 'public free', opts: { plan: 'free', webEnabled: false }, expect: { plan: 'free', source: 'none', lifetimeGrant: false, webEnabled: false, androidEnabled: true } },
  { name: 'public premium (subscription)', opts: { plan: 'premium', webEnabled: false }, expect: { plan: 'premium', source: 'subscription', lifetimeGrant: false, webEnabled: false, androidEnabled: true } },
  { name: 'doppelmayr-style lifetime grant', opts: { plan: 'premium', lifetimeGrant: true, webEnabled: true }, expect: { plan: 'premium', source: 'lifetime_grant', lifetimeGrant: true, webEnabled: true, androidEnabled: true } },
]

for (const c of CASES) {
  test(`E1 ${c.name}: persisted fields, mobile login + /auth/me, and the browser boundary`, async () => {
    const org = await kit.createOrg({ name: `Matrix ${c.name}`, ...c.opts })
    const persisted = await db.collection('organizations').findOne({ orgId: org.orgId })
    assert.equal(persisted.plan, c.expect.plan)
    assert.equal(persisted.entitlementSource, c.expect.source)
    assert.equal(persisted.lifetimeGrant, c.expect.lifetimeGrant)
    assert.equal(persisted.webEnabled, c.expect.webEnabled)
    assert.equal(persisted.androidEnabled, c.expect.androidEnabled)

    const s1 = await kit.api('/api/auth/login', { method: 'POST', body: { email: org.employee.email, password: kit.PASSWORD } })
    const s2 = await kit.api('/api/auth/verify-otp', { method: 'POST', body: { preAuthToken: s1.json.preAuthToken, method: 'email', otp: '112022' } })
    assert.equal(s2.status, 200)
    assert.ok(s2.json.accessToken && s2.json.refreshToken, 'every organisation gets mobile tokens')

    const me = await kit.api('/api/auth/me', { token: s2.json.accessToken })
    assert.equal(me.status, 200)
    const e = me.json.entitlements
    assert.deepEqual(
      { plan: e.plan, source: e.source, lifetimeGrant: e.lifetimeGrant, webEnabled: e.webEnabled, androidEnabled: e.androidEnabled },
      c.expect, '/auth/me reports the persisted entitlement')
    assert.equal(me.json.organization.orgId, org.orgId)
    assert.equal((await kit.api('/api/lms/balance', { token: s2.json.accessToken })).status < 400, true, 'Android feature API works')

    const cookie = s2.headers.get('set-cookie') || ''
    if (c.expect.webEnabled) {
      assert.match(cookie, /dd_session=[^;]/, 'web-enabled organisation gets a browser session')
      assert.equal(s2.json.webAccess, true)
      assert.equal((await kit.api('/api/auth/me', { cookie: cookie.split(';')[0] })).status, 200)
    } else {
      assert.doesNotMatch(cookie, /dd_session=[^;]/, 'no browser session without webEnabled, whatever the plan')
      assert.equal(s2.json.webAccess, false)
    }
  })
}

test('E2 premium plan alone never grants browser access (same plan, only webEnabled differs)', async () => {
  const a = await kit.createOrg({ plan: 'premium', webEnabled: false })
  const b = await kit.createOrg({ plan: 'premium', webEnabled: true })
  const login = async org => {
    const s1 = await kit.api('/api/auth/login', { method: 'POST', body: { email: org.employee.email, password: kit.PASSWORD } })
    return kit.api('/api/auth/verify-otp', { method: 'POST', body: { preAuthToken: s1.json.preAuthToken, method: 'email', otp: '112022' } })
  }
  const ra = await login(a); const rb = await login(b)
  assert.equal(ra.json.webAccess, false); assert.equal(rb.json.webAccess, true)
  assert.doesNotMatch(ra.headers.get('set-cookie') || '', /dd_session=[^;]/)
  assert.match(rb.headers.get('set-cookie') || '', /dd_session=[^;]/)
})
