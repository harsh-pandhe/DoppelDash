import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { isCronAuthorized } from '@/lib/cron/auth'
import { connectDB } from '@/lib/db'
import { runRetentionPurge } from '@/lib/account/lifecycle'

/**
 * Retention / deletion-grace purge (owner decisions D-02.8, D-03.3, D-03.4; docs/RETENTION_DECISIONS.md). NOT scheduled anywhere by this repository.
 *
 *   POST /api/cron/retention-purge
 *   Authorization: Bearer <CRON_SECRET>                 (header only)
 *   { "mode": "dry-run" | "apply" }
 *
 *  - Only POST exists; every other method answers 405 and does nothing.
 *  - An omitted mode / empty body is a DRY-RUN (counts only). Unknown fields or modes are a 400 and nothing runs.
 *  - `apply` additionally needs RETENTION_PURGE_APPLY=1 in the server environment, otherwise 403 (fail closed).
 *  - The request can never name users, organisations or records. Responses carry counts only.
 */
const NO_STORE = { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' }
const reply = (status: number, body: Record<string, unknown>, extra: Record<string, string> = {}) => NextResponse.json(body, { status, headers: { ...NO_STORE, ...extra } })
const methodNotAllowed = () => reply(405, { error: 'Method not allowed', code: 'method_not_allowed' }, { Allow: 'POST' })
export const GET = methodNotAllowed
export const PUT = methodNotAllowed
export const PATCH = methodNotAllowed
export const DELETE = methodNotAllowed

async function POST_handler(req: NextRequest) {
  if (!isCronAuthorized(req)) return reply(401, { error: 'Unauthorized', code: 'unauthorized' }, { 'WWW-Authenticate': 'Bearer' })
  let raw = ''
  try { raw = await req.text() } catch { return reply(400, { error: 'Invalid request', code: 'invalid_request' }) }
  if (raw.length > 1024) return reply(400, { error: 'Invalid request', code: 'invalid_request' })
  let body: Record<string, unknown> = {}
  if (raw.trim() !== '') {
    let parsed: unknown
    try { parsed = JSON.parse(raw) } catch { return reply(400, { error: 'Invalid request', code: 'invalid_request' }) }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return reply(400, { error: 'Invalid request', code: 'invalid_request' })
    body = parsed as Record<string, unknown>
  }
  if (Object.keys(body).some(k => k !== 'mode')) return reply(400, { error: 'Invalid request', code: 'invalid_request' })
  const mode = body.mode === undefined ? 'dry-run' : body.mode
  if (mode !== 'dry-run' && mode !== 'apply') return reply(400, { error: 'Invalid mode', code: 'invalid_mode' })
  const applyEnabled = process.env.RETENTION_PURGE_APPLY === '1'
  if (mode === 'apply' && !applyEnabled) return reply(403, { error: 'Apply mode is disabled on this server', code: 'apply_disabled' })
  try {
    await connectDB()
    const report = await runRetentionPurge({ apply: mode === 'apply' })
    console.log('[retention-purge]', JSON.stringify(report))
    return reply(200, { ...report, applyEnabled })
  } catch (err) {
    console.error('[retention-purge] failed', (err as Error)?.name)
    return reply(500, { error: 'Purge failed', code: 'purge_failed' })
  }
}

export const POST = dbGuard(POST_handler)
