/**
 * Authentication of Google Play Real-time Developer Notifications delivered through Pub/Sub PUSH.
 *
 * Pub/Sub signs every push with an OIDC ID token (Authorization: Bearer <JWT>) minted for the push subscription's service account.
 * We accept a delivery ONLY if all of these hold:  signature valid against Google's published keys · issuer is Google ·
 * audience equals GOOGLE_PLAY_RTDN_AUDIENCE · `email` equals GOOGLE_PLAY_RTDN_PUSH_SA_EMAIL and `email_verified` is true · not expired.
 * If either setting is missing the endpoint refuses EVERY request (fail closed) — there is no shared-secret fallback and nothing is
 * ever accepted from the query string.
 */
import { createRemoteJWKSet, jwtVerify } from 'jose'
import { PLAY_CONFIG } from './playConfig'

export type RtdnAuthResult = { ok: true } | { ok: false; status: 401 | 503; code: 'rtdn_not_configured' | 'rtdn_unauthorized' }

let jwks: { url: string; set: ReturnType<typeof createRemoteJWKSet> } | null = null
const keySet = () => {
  if (!jwks || jwks.url !== PLAY_CONFIG.oidcJwksUrl) jwks = { url: PLAY_CONFIG.oidcJwksUrl, set: createRemoteJWKSet(new URL(PLAY_CONFIG.oidcJwksUrl), { cooldownDuration: 30_000, cacheMaxAge: 600_000, timeoutDuration: 5_000 }) }
  return jwks.set
}

export async function authenticateRtdn(authorization: string | null): Promise<RtdnAuthResult> {
  if (!PLAY_CONFIG.rtdnAudience || !PLAY_CONFIG.rtdnPushServiceAccount) return { ok: false, status: 503, code: 'rtdn_not_configured' }
  const m = /^Bearer ([A-Za-z0-9._~+/=-]{20,4096})$/.exec(authorization || '')
  if (!m) return { ok: false, status: 401, code: 'rtdn_unauthorized' }
  try {
    const { payload } = await jwtVerify(m[1], keySet(), {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: PLAY_CONFIG.rtdnAudience,
      algorithms: ['RS256'],
      clockTolerance: 30,
    })
    if (payload.email !== PLAY_CONFIG.rtdnPushServiceAccount || payload.email_verified !== true) return { ok: false, status: 401, code: 'rtdn_unauthorized' }
    return { ok: true }
  } catch {
    return { ok: false, status: 401, code: 'rtdn_unauthorized' }   // bad signature, wrong issuer/audience, expired, unreachable key set …
  }
}
