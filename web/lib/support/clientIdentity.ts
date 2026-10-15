import { createHash } from 'crypto'
import { isIP } from 'net'

/**
 * Who is calling the PUBLIC support endpoint, for rate limiting.
 *
 * Forwarding headers (x-forwarded-for, x-real-ip, …) are ordinary request headers: a caller can send any value unless the
 * hosting platform overwrites it. Which header the platform sets authoritatively is deployment knowledge, so the code never
 * guesses: only the header NAMED in TRUSTED_CLIENT_IP_HEADER (set by the owner after verifying it on the real platform, e.g.
 * `x-nf-client-connection-ip` on Netlify) is consulted, and only a single valid IP is accepted. Anything else -> no identity.
 * Callers without an identity share ONE conservative bucket, so changing headers can never mint a fresh budget.
 */
export function trustedClientIp(headers: Headers): string | null {
  const name = process.env.TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase()
  if (!name || !/^[a-z0-9-]{1,64}$/.test(name)) return null
  const value = headers.get(name)
  if (!value || value.length > 45) return null
  return isIP(value) !== 0 ? value : null
}

export const CLIENT_LIMIT_PER_MINUTE = 8
export const UNTRUSTED_LIMIT_PER_MINUTE = 30

/** Rate-limit key + limit for this caller. Raw IPs are never stored: the key holds a truncated SHA-256. */
export function clientRateKey(headers: Headers): { key: string; limit: number; trusted: boolean } {
  const ip = trustedClientIp(headers)
  if (!ip) return { key: 'support:untrusted', limit: UNTRUSTED_LIMIT_PER_MINUTE, trusted: false }
  return { key: `support:ip:${createHash('sha256').update(ip).digest('hex').slice(0, 16)}`, limit: CLIENT_LIMIT_PER_MINUTE, trusted: true }
}
