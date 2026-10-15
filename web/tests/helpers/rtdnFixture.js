/**
 * Shared RTDN test fixture: the audience / push service account the TEST SERVER is configured with (see scripts/ci/run-backend-tests.js),
 * plus a throw-away OIDC key pair whose public half is published to the local fake provider's /oidc/certs. Test-only.
 */
const crypto = require('node:crypto')
const fake = require('./fakeProviders')
const AUD = 'https://staging.example.test/api/billing/play/rtdn'
const PUSH_SA = 'pubsub-push@example-project.iam.gserviceaccount.com'
const ENV = { GOOGLE_PLAY_RTDN_AUDIENCE: AUD, GOOGLE_PLAY_RTDN_PUSH_SA_EMAIL: PUSH_SA, GOOGLE_PLAY_OIDC_JWKS_URL: `${fake.BASE}/oidc/certs` }
const pair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })
let jose
async function register() {
  jose = jose || (await import('jose'))
  const jwk = await jose.exportJWK(pair.publicKey); Object.assign(jwk, { kid: 'fixture-k', alg: 'RS256', use: 'sig' })
  await fetch(`${fake.BASE}/__oidc`, { method: 'POST', body: JSON.stringify({ keys: [jwk] }) })
}
async function authHeaders(over = {}) {
  jose = jose || (await import('jose'))
  const t = await new jose.SignJWT({ email: over.email ?? PUSH_SA, email_verified: true }).setProtectedHeader({ alg: 'RS256', kid: 'fixture-k' }).setIssuer('https://accounts.google.com').setAudience(over.aud ?? AUD).setIssuedAt().setExpirationTime('10m').sign(pair.privateKey)
  return { authorization: `Bearer ${t}` }
}
module.exports = { AUD, PUSH_SA, ENV, register, authHeaders }
