import crypto from 'crypto'
import type { NextRequest } from 'next/server'

/**
 * Cron / scheduler authentication.
 *
 * The shared secret is accepted ONLY in the `Authorization: Bearer <CRON_SECRET>` header (this is what
 * Vercel Cron sends automatically when CRON_SECRET is set; external schedulers add the header).
 * It is deliberately NOT accepted as `?secret=…`: a query string is written to access logs, proxies and
 * monitoring tools, which would leak a credential that can trigger tenant-wide e-mail jobs.
 *
 * Fails closed when CRON_SECRET is unset; the comparison is constant-time.
 */
export function isCronAuthorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET
  if (!expected) return false
  const provided = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1]
  if (!provided) return false
  const a = crypto.createHash('sha256').update(provided).digest()
  const b = crypto.createHash('sha256').update(expected).digest()
  return crypto.timingSafeEqual(a, b)
}
