/**
 * Travel list pagination (Slice 5): keyset ("seek") pagination over (createdAt DESC, _id DESC).
 *
 * WHY THIS ORDER. `createdAt` is set once and never changes, so an update can never move a row between pages; `_id` is unique, so it breaks
 * timestamp ties deterministically. (`_id` alone is NOT time-ordered here: keyed requests get a deterministic hash id.) Rows are only ever
 * added at the head, so a continuing reader never sees a duplicate and never skips a row that existed when paging began; a deleted row simply
 * disappears. Rows with no `createdAt` at all (hand-inserted legacy data) sort after every dated row, ordered by `_id`.
 *
 * CURSOR. Opaque `<base64url payload>.<signature>`. The payload is only the position (createdAt ms | null, _id). The signature is an
 * HMAC (server JWT secret, domain-separated) over the payload AND the scope it was issued for — organisation, visibility (own records / whole
 * organisation) and status filter — so a cursor cannot be tampered with, replayed in another tenant, by another employee, or with another
 * filter. Every failure is the same `400 invalid_cursor`: nothing reveals whether a position exists in some other scope.
 */
import { createHmac, timingSafeEqual } from 'crypto'
import TravelRequest from '@/models/TravelRequest'
import { getJwtSecret } from '@/lib/auth/jwt'
import { TRAVEL_STATUSES } from '@/lib/travel/validation'

export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 100
/** Responses WITHOUT pagination params keep the legacy bare-array shape (older Android builds). Bounded, and never silent: see headers. */
export const LEGACY_LIMIT = 200
const MAX_CURSOR_CHARS = 200

export interface ListParams { limit: number; cursor?: string; status?: string; paged: boolean }
export interface ParamProblem { error: string; code: string; fields: string[] }

export function parseListParams(sp: URLSearchParams): ListParams | ParamProblem {
  const one = (k: string): string | undefined | null => { const all = sp.getAll(k); return all.length > 1 ? null : all[0] }
  const bad = (field: string, code: string, error: string): ParamProblem => ({ error, code, fields: [field] })
  const limitRaw = one('limit'), cursor = one('cursor'), status = one('status'), sort = one('sort')
  if (limitRaw === null) return bad('limit', 'invalid_limit', 'Invalid limit')
  if (cursor === null) return bad('cursor', 'invalid_cursor', 'Invalid cursor')
  if (status === null) return bad('status', 'invalid_status', 'Invalid status')
  if (sort === null || (sort !== undefined && sort !== 'newest')) return bad('sort', 'invalid_sort', 'Invalid sort')
  let limit = LEGACY_LIMIT
  if (limitRaw !== undefined) {
    if (!/^[0-9]{1,3}$/.test(limitRaw)) return bad('limit', 'invalid_limit', `limit must be a whole number from 1 to ${MAX_LIMIT}`)
    limit = Number(limitRaw)
    if (limit < 1 || limit > MAX_LIMIT) return bad('limit', 'invalid_limit', `limit must be a whole number from 1 to ${MAX_LIMIT}`)
  }
  if (cursor !== undefined && (cursor.length === 0 || cursor.length > MAX_CURSOR_CHARS || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(cursor))) return bad('cursor', 'invalid_cursor', 'Invalid cursor')
  if (status !== undefined && status !== 'all' && !(TRAVEL_STATUSES as readonly string[]).includes(status)) return bad('status', 'invalid_status', 'Invalid status')
  const paged = limitRaw !== undefined || cursor !== undefined
  return { limit: paged && limitRaw === undefined ? DEFAULT_LIMIT : limit, cursor, status: status && status !== 'all' ? status : undefined, paged }
}

interface Scope { orgId: string; userId: string; manager: boolean; status?: string }
const scopeKey = (s: Scope) => `${s.orgId}|${s.manager ? '*' : s.userId}|${s.status ?? 'all'}`
const sign = (payload: string, s: Scope) => createHmac('sha256', getJwtSecret()).update(`travel-cursor|v1|${scopeKey(s)}|${payload}`).digest('base64url').slice(0, 27)

type Pos = { c: number | null; i: string }
export function encodeCursor(pos: Pos, s: Scope): string {
  const payload = Buffer.from(JSON.stringify({ c: pos.c, i: pos.i }), 'utf8').toString('base64url')
  return `${payload}.${sign(payload, s)}`
}
export function decodeCursor(cursor: string, s: Scope): Pos | null {
  const [payload, sig] = cursor.split('.')
  if (!payload || !sig) return null
  const want = Buffer.from(sign(payload, s)), got = Buffer.from(sig)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (!p || typeof p.i !== 'string' || !/^[a-f0-9]{24}$/i.test(p.i) || !(p.c === null || (Number.isSafeInteger(p.c) && p.c >= 0))) return null
    return { c: p.c, i: p.i }
  } catch { return null }
}

export const SORT = { createdAt: -1, _id: -1 } as const

/**
 * The filter for one page of DATED rows: tenant + visibility + status first (all inside the query), then the keyset condition. The bound
 * `createdAt <= c` lets the index seek straight to the cursor; the residual `$or` only drops the rows of the same instant that were already
 * returned (so at most one tie group is ever re-examined).
 */
export function buildFilter(s: Scope, pos: Pos | null) {
  const base: Record<string, unknown> = { orgId: s.orgId, ...(s.manager ? {} : { userId: s.userId }), ...(s.status ? { status: s.status } : {}) }
  if (!pos) return { ...base, createdAt: { $type: 'date' } }
  const c = new Date(pos.c as number)
  return { ...base, createdAt: { $lte: c }, $or: [{ createdAt: { $lt: c } }, { _id: { $lt: pos.i } }] }
}
/** Hand-inserted legacy rows with no `createdAt` form a final tier, ordered by `_id` (after every dated row). */
export function buildMissingFilter(s: Scope, afterId?: string) {
  return { orgId: s.orgId, ...(s.manager ? {} : { userId: s.userId }), ...(s.status ? { status: s.status } : {}), createdAt: { $exists: false }, ...(afterId ? { _id: { $lt: afterId } } : {}) }
}

export async function listPage(s: Scope, params: ListParams): Promise<{ rows: Record<string, unknown>[]; hasMore: boolean; nextCursor?: string } | { invalidCursor: true }> {
  let pos: Pos | null = null
  if (params.cursor) { pos = decodeCursor(params.cursor, s); if (!pos) return { invalidCursor: true } }
  const want = params.limit + 1
  let found: Record<string, unknown>[] = []
  if (!pos || pos.c !== null) found = (await TravelRequest.find(buildFilter(s, pos) as never).sort(SORT).limit(want).lean()) as unknown as Record<string, unknown>[]
  if (found.length < want) {
    const tail = await TravelRequest.find(buildMissingFilter(s, pos && pos.c === null ? pos.i : undefined) as never).sort({ _id: -1 }).limit(want - found.length).lean()
    found = found.concat(tail as unknown as Record<string, unknown>[])
  }
  const hasMore = found.length > params.limit
  const rows = hasMore ? found.slice(0, params.limit) : found
  const last = rows[rows.length - 1] as { createdAt?: Date; _id: unknown } | undefined
  return { rows, hasMore, ...(hasMore && last ? { nextCursor: encodeCursor({ c: last.createdAt ? new Date(last.createdAt).getTime() : null, i: String(last._id) }, s) } : {}) }
}
