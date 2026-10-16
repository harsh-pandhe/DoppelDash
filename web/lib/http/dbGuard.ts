import { NextResponse } from 'next/server'

/**
 * Database-outage contract for route handlers. A connection failure, server-selection timeout, pool exhaustion or query timeout means we cannot
 * authenticate, authorise or read tenant data — so the request FAILS CLOSED (no cached/stale privilege is ever substituted) with a documented,
 * retryable answer instead of an unhandled 500:
 *
 *   503  { "error": "The service is temporarily unavailable. Please try again in a moment.", "code": "service_unavailable" }   + Retry-After: 5
 *
 * Nothing about the failure (host, port, connection string, driver message, stack) is returned or logged beyond the error class name. Any OTHER
 * error is re-thrown unchanged, so existing per-route error contracts (400/401/403/404/409/…) are untouched.
 */
const DB_ERROR_NAMES = new Set([
  'MongoServerSelectionError', 'MongooseServerSelectionError', 'MongoNetworkError', 'MongoNetworkTimeoutError', 'MongoTopologyClosedError',
  'MongoPoolClearedError', 'MongoPoolClosedError', 'MongoServerClosedError', 'MongoWaitQueueTimeoutError', 'MongoNotConnectedError', 'MongoExpiredSessionError',
])
const DB_MESSAGE = /buffering timed out|server selection timed out|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|connection pool|topology (?:was )?(?:closed|destroyed)|not connected|database access is disabled|MongoNotConnected/i

export function isDbUnavailable(err: unknown, depth = 0): boolean {
  if (!err || typeof err !== 'object' || depth > 3) return false
  const e = err as { name?: string; code?: unknown; message?: string; cause?: unknown; reason?: unknown }
  if (e.name && DB_ERROR_NAMES.has(e.name)) return true
  if (e.name === 'MongoServerError' && (e.code === 50 || e.code === 11600 || e.code === 91 || e.code === 6)) return true   // MaxTimeMSExpired, InterruptedAtShutdown, ShutdownInProgress, HostUnreachable
  if (typeof e.message === 'string' && DB_MESSAGE.test(e.message) && /mongo|mongoose|server selection|buffering|database/i.test(`${e.name} ${e.message}`)) return true
  return isDbUnavailable(e.cause, depth + 1) || isDbUnavailable(e.reason, depth + 1)
}

export const unavailableResponse = () => NextResponse.json(
  { error: 'The service is temporarily unavailable. Please try again in a moment.', code: 'service_unavailable' },
  { status: 503, headers: { 'Retry-After': '5', 'Cache-Control': 'no-store, max-age=0' } },
)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dbGuard<T extends (...args: any[]) => Promise<Response>>(handler: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const guarded = async (...args: any[]) => {
    try { return await handler(...args) }
    catch (err) {
      if (!isDbUnavailable(err)) throw err
      console.error('[db] unavailable', (err as Error)?.name)
      return unavailableResponse()
    }
  }
  return guarded as unknown as T
}
