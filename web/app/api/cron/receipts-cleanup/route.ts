import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { isCronAuthorized } from '@/lib/cron/auth'
import { connectDB } from '@/lib/db'
import { DEFAULT_LIMIT, MAX_LIMIT, runReceiptCleanup } from '@/lib/uploads/receiptCleanup'

/**
 * Abandoned-receipt cleanup (see docs/RECEIPT_STORAGE_AND_OCR.md §11). NOT scheduled anywhere by this repository.
 *
 *   POST /api/cron/receipts-cleanup
 *   Authorization: Bearer <CRON_SECRET>                (header only — never the query string or the body)
 *   Content-Type: application/json
 *   { "mode": "dry-run" | "apply", "limit"?: 1..500, "cursor"?: "<24 hex>" (dry-run only) }
 *
 *  - Only POST exists. GET (and every other method) answers 405 with `Allow: POST` and does nothing, so a link, a prefetch,
 *    a crawler or a health probe can never trigger a deletion.
 *  - The request body selects the mode; the query string is never read. An omitted mode (or an empty body) is a DRY-RUN;
 *    an unknown/malformed mode, unknown field or bad value is a 400 and nothing runs.
 *  - `apply` additionally needs RECEIPT_CLEANUP_APPLY=1 in the server environment, otherwise 403 (fail closed).
 *  - The request can never name assets, folders or tenants: unknown fields are rejected.
 * Status codes: 200 ok · 400 malformed · 401 missing/invalid credentials (also when CRON_SECRET is unset: fail closed)
 *               403 apply requested but disabled · 405 wrong method · 500 job failed. Bodies are fixed strings or counts only.
 */
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' }
const reply = (status: number, body: Record<string, unknown>, extra: Record<string, string> = {}) =>
  NextResponse.json(body, { status, headers: { ...NO_STORE, ...extra } })

const methodNotAllowed = () => reply(405, { error: 'Method not allowed', code: 'method_not_allowed' }, { Allow: 'POST' })
export const GET = methodNotAllowed
export const PUT = methodNotAllowed
export const PATCH = methodNotAllowed
export const DELETE = methodNotAllowed

const MAX_BODY_BYTES = 2048

async function POST_handler(req: NextRequest) {
  if (!isCronAuthorized(req)) return reply(401, { error: 'Unauthorized', code: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' })

  // ── parse & validate the body (everything fails closed to "do nothing") ──
  let raw = ''
  try { raw = await req.text() } catch { return reply(400, { error: 'Invalid request', code: 'invalid_request' }) }
  if (raw.length > MAX_BODY_BYTES) return reply(400, { error: 'Invalid request', code: 'invalid_request' })
  let body: Record<string, unknown> = {}
  if (raw.trim() !== '') {
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { return reply(400, { error: 'Invalid request', code: 'invalid_request' }) }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return reply(400, { error: 'Invalid request', code: 'invalid_request' })
    body = parsed as Record<string, unknown>
  }
  const allowed = new Set(['mode', 'limit', 'cursor'])
  if (Object.keys(body).some(k => !allowed.has(k))) return reply(400, { error: 'Invalid request', code: 'invalid_request' })

  const mode = body.mode === undefined ? 'dry-run' : body.mode
  if (mode !== 'dry-run' && mode !== 'apply') return reply(400, { error: 'Invalid mode', code: 'invalid_mode' })
  let limit = DEFAULT_LIMIT
  if (body.limit !== undefined) {
    if (typeof body.limit !== 'number' || !Number.isInteger(body.limit) || body.limit < 1 || body.limit > MAX_LIMIT) return reply(400, { error: 'Invalid limit', code: 'invalid_limit' })
    limit = body.limit
  }
  let cursor: string | null = null
  if (body.cursor !== undefined) {
    if (mode !== 'dry-run' || typeof body.cursor !== 'string' || !/^[a-f0-9]{24}$/i.test(body.cursor)) return reply(400, { error: 'Invalid cursor', code: 'invalid_cursor' })
    cursor = body.cursor
  }

  const applyEnabled = process.env.RECEIPT_CLEANUP_APPLY === '1'
  if (mode === 'apply' && !applyEnabled) return reply(403, { error: 'Apply mode is disabled on this server', code: 'apply_disabled' })

  try {
    await connectDB()
    const report = await runReceiptCleanup({ apply: mode === 'apply', limit, cursor })
    console.log('[receipt-cleanup]', JSON.stringify({ ...report, nextCursor: undefined }))
    return reply(200, { ...report, applyEnabled })
  } catch (err) {
    console.error('[receipt-cleanup] failed', (err as Error)?.name)
    return reply(500, { error: 'Cleanup failed', code: 'cleanup_failed' })
  }
}

export const POST = dbGuard(POST_handler)
