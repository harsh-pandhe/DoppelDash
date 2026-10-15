/**
 * Receipt / attachment storage (Cloudinary) — the single place that knows how uploads are authorised, how stored files
 * are referenced, and how they are delivered.
 *
 * SECURITY MODEL
 *  1. Uploads are SIGNED by the server for an authenticated user. The server picks the tenant folder, a random public id,
 *     the allowed formats, `overwrite=false` and (for receipts) `type=authenticated`; the client cannot change any of it.
 *     The API secret never leaves the server.
 *  2. PRODUCTION FAILS CLOSED. If signing credentials are missing or incomplete there is NO upload path: the ticket
 *     endpoint answers 503 and attachment URLs are rejected. A legacy *unsigned* mode exists only for local development
 *     and only when ALLOW_UNSIGNED_UPLOADS=1 — it is ignored when NODE_ENV=production. Provider base-URL overrides used by
 *     test fakes are ignored in production too.
 *  3. Receipts are stored as `type=authenticated` assets (not publicly deliverable). The database keeps a provider-neutral
 *     reference (`cld:<publicId>.<ext>`), never a delivery URL. Files are retrieved only through
 *     GET /api/rms/<id>/receipt/<n>: the caller is authorised against the expense, then the server downloads the file from
 *     the provider with a freshly signed private-download request and streams it (`Cache-Control: no-store`).
 *  4. Before a new reference is stored the server independently asks the provider what was ACTUALLY uploaded (format, byte
 *     size, delivery type) and rejects/deletes anything outside the plan limits — direct-to-provider uploads cannot bypass
 *     the size/format rules.
 *
 * Env (server only except the cloud name):
 *   CLOUDINARY_CLOUD_NAME | NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME   cloud name
 *   CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET                    REQUIRED in production (signing + admin/download calls)
 *   CLOUDINARY_SIGNED_PRESET                                     optional SIGNED upload preset: lets the provider enforce
 *                                                                allowed formats / size / type itself (recommended)
 *   ALLOW_UNSIGNED_UPLOADS=1 + NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET   dev-only legacy mode (never in production)
 *   CLOUDINARY_UPLOAD_BASE / CLOUDINARY_DELIVERY_BASE            test fakes only (ignored in production)
 */
import { createHash, randomBytes } from 'crypto'
import { maxUploadCeilingBytes } from '@/lib/entitlements/plans'

export const ALLOWED_FORMATS = ['jpg', 'jpeg', 'png', 'webp', 'heic', 'pdf'] as const
export const ALLOWED_MIME: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/heic': 'heic', 'application/pdf': 'pdf',
}
/** Provider formats that count as the declared MIME type (jpeg and jpg are the same format). */
export function formatsForMime(mime: unknown): string[] | null {
  const m = typeof mime === 'string' ? mime.toLowerCase().replace('image/jpg', 'image/jpeg') : ''
  const f = ALLOWED_MIME[m]
  return f ? (f === 'jpg' ? ['jpg', 'jpeg'] : [f]) : null
}
export type UploadKind = 'receipt' | 'card' | 'document' | 'image'
const KIND_FOLDER: Record<UploadKind, string> = { receipt: 'receipts', card: 'cards', document: 'documents', image: 'images' }
export const UPLOAD_KINDS = Object.keys(KIND_FOLDER) as UploadKind[]
export const MAX_ATTACHMENT_URL_LENGTH = 2048
/**
 * Largest receipt this backend will ever stream back: the biggest per-file limit of any plan (canonical, from the plan
 * config — 25 MB today). Uploads are limited to the ORGANISATION's own plan limit and re-verified at attach time, so every
 * stored receipt is ≤ its plan limit ≤ this ceiling; reading is therefore never stricter than writing, including after a
 * plan downgrade. The stream is bounded (never buffered), see the receipt route.
 */
export const receiptSizeCeiling = () => maxUploadCeilingBytes()

export const isProduction = (env: NodeJS.ProcessEnv = process.env) => env.NODE_ENV === 'production'

export type ConfigProblem = 'missing_cloud_name' | 'incomplete_signing' | 'unsigned_not_enabled' | null

export interface StorageConfig {
  production: boolean
  cloudName: string | null
  apiKey: string | null
  apiSecret: string | null
  signedPreset: string | null
  unsignedPreset: string | null
  /** Legacy unsigned tickets: only ever true outside production AND with an explicit opt-in. */
  unsignedAllowed: boolean
  uploadBase: string
  deliveryBase: string
  signed: boolean
  /** Why uploads are unavailable (null = a usable mode is configured). Logged server-side, never shown to users. */
  problem: ConfigProblem
}

export function storageConfig(env: NodeJS.ProcessEnv = process.env): StorageConfig {
  const production = isProduction(env)
  const cloudName = (env.CLOUDINARY_CLOUD_NAME || env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME || '').trim() || null
  const apiKey = (env.CLOUDINARY_API_KEY || '').trim() || null
  const apiSecret = (env.CLOUDINARY_API_SECRET || '').trim() || null
  const unsignedPreset = (env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET || env.CLOUDINARY_UPLOAD_PRESET || '').trim() || null
  const unsignedAllowed = !production && env.ALLOW_UNSIGNED_UPLOADS === '1' && !!unsignedPreset
  // Base-URL overrides exist for local fakes. They are ignored in production so a stray env var can never redirect storage.
  const uploadBase = (!production && env.CLOUDINARY_UPLOAD_BASE ? env.CLOUDINARY_UPLOAD_BASE : 'https://api.cloudinary.com').replace(/\/+$/, '')
  const deliveryBase = (!production && env.CLOUDINARY_DELIVERY_BASE ? env.CLOUDINARY_DELIVERY_BASE : 'https://res.cloudinary.com').replace(/\/+$/, '')
  const signed = !!(cloudName && apiKey && apiSecret)
  let problem: ConfigProblem = null
  if (!cloudName) problem = 'missing_cloud_name'
  else if (!signed && !unsignedAllowed) problem = (apiKey || apiSecret) ? 'incomplete_signing' : 'unsigned_not_enabled'
  return {
    production, cloudName, apiKey, apiSecret, unsignedPreset, unsignedAllowed, uploadBase, deliveryBase, signed, problem,
    signedPreset: (env.CLOUDINARY_SIGNED_PRESET || '').trim() || null,
  }
}

/** Cloudinary API signature: sha1 of the sorted `k=v&k=v` string of the signed params + secret. */
export function cloudinarySignature(params: Record<string, string | number>, secret: string): string {
  const toSign = Object.keys(params).filter(k => params[k] !== '' && params[k] !== undefined).sort().map(k => `${k}=${params[k]}`).join('&')
  return createHash('sha1').update(toSign + secret).digest('hex')
}

export const tenantFolder = (orgId: string, kind: UploadKind) => `doppeldash/${orgId}/${KIND_FOLDER[kind]}`

export interface UploadTicket {
  mode: 'signed' | 'unsigned'
  uploadUrl: string
  /** Form fields the client must send alongside `file` — exactly these, unchanged. */
  fields: Record<string, string>
  maxBytes: number
  allowedMimeTypes: string[]
  expiresAt?: string
}

/** Issues an upload ticket, or null when no SAFE mode is configured (production: missing/incomplete signing config). */
export function issueUploadTicket(opts: { orgId: string; kind: UploadKind; maxBytes: number; mime?: string }, cfg = storageConfig(), now = Date.now()): UploadTicket | null {
  if (!cfg.cloudName) return null
  const uploadUrl = `${cfg.uploadBase}/v1_1/${cfg.cloudName}/auto/upload`
  const allowedMimeTypes = Object.keys(ALLOWED_MIME)
  if (cfg.signed) {
    const timestamp = Math.floor(now / 1000)
    // The declared type is BOUND into the signature: the provider itself rejects any file whose real (content-detected)
    // format is not the declared one, and the client cannot widen it (changing it invalidates the signature).
    const declared = formatsForMime(opts.mime)
    const signedParams: Record<string, string | number> = {
      allowed_formats: (declared ?? ALLOWED_FORMATS).join(','),
      folder: tenantFolder(opts.orgId, opts.kind),
      overwrite: 'false',
      public_id: randomBytes(16).toString('hex'),
      timestamp,
    }
    // Receipts hold personal/financial data: stored as authenticated assets (no public delivery URL exists for them).
    if (opts.kind === 'receipt') signedParams.type = 'authenticated'
    // Optional SIGNED preset: lets the provider itself enforce formats/size/type even if our params were ever bypassed.
    if (cfg.signedPreset) signedParams.upload_preset = cfg.signedPreset
    const signature = cloudinarySignature(signedParams, cfg.apiSecret!)
    const fields: Record<string, string> = { api_key: cfg.apiKey!, signature }
    for (const [k, v] of Object.entries(signedParams)) fields[k] = String(v)
    return { mode: 'signed', uploadUrl, fields, maxBytes: opts.maxBytes, allowedMimeTypes, expiresAt: new Date((timestamp + 3600) * 1000).toISOString() }
  }
  if (cfg.unsignedAllowed && cfg.unsignedPreset) {
    return { mode: 'unsigned', uploadUrl, fields: { upload_preset: cfg.unsignedPreset }, maxBytes: opts.maxBytes, allowedMimeTypes }
  }
  return null
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const EXT = `(?:${ALLOWED_FORMATS.join('|')})`

/** A reference to a stored receipt, as kept in MongoDB. Provider-neutral: not a URL, grants no access by itself. */
export const RECEIPT_REF_PREFIX = 'cld:'
export const isReceiptRef = (v: unknown): v is string => typeof v === 'string' && v.startsWith(RECEIPT_REF_PREFIX)

export function parseReceiptRef(ref: unknown, orgId: string): { publicId: string; ext: string } | null {
  if (!isReceiptRef(ref) || ref.length > 300) return null
  const m = new RegExp(`^cld:(doppeldash/${escapeRe(orgId)}/receipts/[A-Za-z0-9_-]{8,64})\\.(${ALLOWED_FORMATS.join('|')})$`, 'i').exec(ref)
  return m ? { publicId: m[1], ext: m[2].toLowerCase() } : null
}

/**
 * Turns the URL the provider returned for a fresh upload into a receipt reference — only if it is an AUTHENTICATED asset
 * inside this tenant's receipts folder of our cloud. Anything else (public assets, other tenants, other hosts, queries,
 * credentials, traversal, wrong extension, unconfigured storage) returns null.
 */
export function receiptRefFromUploadUrl(url: unknown, orgId: string, cfg = storageConfig()): string | null {
  if (typeof url !== 'string' || url.length > MAX_ATTACHMENT_URL_LENGTH || !cfg.cloudName || !cfg.signed) return null
  let u: URL, base: URL
  try { u = new URL(url); base = new URL(cfg.deliveryBase) } catch { return null }
  if (u.username || u.password || u.search || u.hash || u.origin !== base.origin) return null
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && !cfg.production && cfg.deliveryBase !== 'https://res.cloudinary.com')) return null
  const basePath = base.pathname.replace(/\/+$/, '')
  if (basePath && !u.pathname.startsWith(basePath + '/')) return null
  const path = u.pathname.slice(basePath.length)
  if (/%2e|%2f|%5c|\\|\.\./i.test(path)) return null
  const m = new RegExp(`^/${escapeRe(cfg.cloudName)}/image/authenticated/(?:s--[A-Za-z0-9_-]{8}--/)?(?:v\\d+/)?(doppeldash/${escapeRe(orgId)}/receipts/[A-Za-z0-9_-]{8,64})\\.(${ALLOWED_FORMATS.join('|')})$`, 'i').exec(path)
  return m ? `${RECEIPT_REF_PREFIX}${m[1]}.${m[2].toLowerCase()}` : null
}

/**
 * Legacy PUBLIC attachment URLs (documents/images uploaded under the public delivery type, and receipts stored before
 * private delivery). Only used for non-receipt kinds and for passing through pre-existing data; never created for receipts.
 */
export function isAllowedAttachmentUrl(url: unknown, orgId: string, cfg = storageConfig()): boolean {
  if (typeof url !== 'string' || url.length > MAX_ATTACHMENT_URL_LENGTH || !cfg.cloudName || !cfg.signed) return false
  let u: URL, base: URL
  try { u = new URL(url); base = new URL(cfg.deliveryBase) } catch { return false }
  if (u.username || u.password || u.search || u.hash || u.origin !== base.origin) return false
  if (u.protocol !== 'https:' && !(u.protocol === 'http:' && !cfg.production && cfg.deliveryBase !== 'https://res.cloudinary.com')) return false
  const basePath = base.pathname.replace(/\/+$/, '')
  if (basePath && !u.pathname.startsWith(basePath + '/')) return false
  const path = u.pathname.slice(basePath.length)
  if (/%2e|%2f|%5c|\\|\.\./i.test(path)) return false
  const re = new RegExp(`^/${escapeRe(cfg.cloudName)}/(?:image|raw)/upload/(?:v\\d+/)?doppeldash/${escapeRe(orgId)}/(?:receipts|cards|documents|images)/[A-Za-z0-9_-]{8,64}\\.${EXT}$`, 'i')
  return re.test(path)
}

const adminAuth = (cfg: StorageConfig) => `Basic ${Buffer.from(`${cfg.apiKey}:${cfg.apiSecret}`).toString('base64')}`

export type AssetCheck =
  | { ok: true; bytes: number; format: string }
  | { ok: false; reason: 'not_found' | 'too_large' | 'bad_format' | 'wrong_type' | 'type_mismatch' | 'unavailable' }

/**
 * Asks the PROVIDER what was actually stored (Admin API resource lookup) and checks it against the plan: delivery type
 * must be `authenticated`, format allowed, byte size within `maxBytes`. This is the server-side check of the real file —
 * direct-to-provider uploads cannot slip past size/format limits. Provider errors are `unavailable` (callers fail closed).
 */
export async function verifyStoredReceipt(ref: string, orgId: string, maxBytes: number, cfg = storageConfig(), fetchImpl: typeof fetch = fetch, declaredFormats?: string[] | null): Promise<AssetCheck> {
  const parsed = parseReceiptRef(ref, orgId)
  if (!parsed || !cfg.signed) return { ok: false, reason: 'not_found' }
  try {
    const res = await fetchImpl(`${cfg.uploadBase}/v1_1/${cfg.cloudName}/resources/image/authenticated/${parsed.publicId}`, {
      headers: { Authorization: adminAuth(cfg) }, signal: AbortSignal.timeout(6000),
    })
    if (res.status === 404) return { ok: false, reason: 'not_found' }
    if (!res.ok) return { ok: false, reason: 'unavailable' }
    const j = await res.json() as { bytes?: number; format?: string; type?: string; public_id?: string }
    if (j.public_id !== parsed.publicId) return { ok: false, reason: 'not_found' }
    if (j.type !== 'authenticated') return { ok: false, reason: 'wrong_type' }
    const format = String(j.format || '').toLowerCase()
    if (!(ALLOWED_FORMATS as readonly string[]).includes(format)) return { ok: false, reason: 'bad_format' }
    // The extension we would later serve under must be the file's REAL format (jpeg == jpg): a client must not be able to
    // label a JPEG as a PDF (or vice versa) and have us serve it with the wrong type.
    const norm = (f: string) => (f === 'jpeg' ? 'jpg' : f)
    if (norm(format) !== norm(parsed.ext)) return { ok: false, reason: 'bad_format' }
    // The type the uploader DECLARED (recorded server-side when the ticket was issued, before any bytes existed) must be the
    // real content type. A PNG renamed .pdf (declared application/pdf) lands here as a mismatch.
    if (declaredFormats && !declaredFormats.includes(format)) return { ok: false, reason: 'type_mismatch' }
    if (typeof j.bytes !== 'number' || j.bytes <= 0) return { ok: false, reason: 'unavailable' }
    if (j.bytes > maxBytes) return { ok: false, reason: 'too_large' }
    return { ok: true, bytes: j.bytes, format }
  } catch (err) {
    console.error('[storage] verify failed', (err as Error)?.name === 'TimeoutError' ? 'timeout' : (err as Error)?.message?.slice(0, 100))
    return { ok: false, reason: 'unavailable' }
  }
}

/**
 * Short-lived, signed provider download request for one receipt (Cloudinary "private download"): signed with the API
 * secret and carrying a timestamp the provider only honours for a short window. It is used server-side only and is never
 * handed to a client. PROVIDER-DEPENDENT: confirm the exact request shape against the real account in staging.
 */
export function privateDownloadUrl(ref: string, orgId: string, cfg = storageConfig(), now = Date.now()): string | null {
  const parsed = parseReceiptRef(ref, orgId)
  if (!parsed || !cfg.signed) return null
  const params = { format: parsed.ext, public_id: parsed.publicId, timestamp: Math.floor(now / 1000), type: 'authenticated' }
  const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])), api_key: cfg.apiKey!, signature: cloudinarySignature(params, cfg.apiSecret!) })
  return `${cfg.uploadBase}/v1_1/${cfg.cloudName}/image/download?${q.toString()}`
}

/**
 * Best-effort removal of assets we no longer reference (withdrawn expense, replaced receipt). Only touches assets inside the
 * caller's own tenant folder, only in signed mode, and never throws — storage hygiene must not break a business operation.
 */
export async function destroyAttachments(items: string[], orgId: string, cfg = storageConfig(), fetchImpl: typeof fetch = fetch): Promise<number> {
  if (!cfg.signed || !items?.length) return 0
  let removed = 0
  for (const item of items) {
    let publicId: string | null = null
    let type: 'authenticated' | 'upload' = 'upload'
    const ref = parseReceiptRef(item, orgId)
    if (ref) { publicId = ref.publicId; type = 'authenticated' }
    else if (isAllowedAttachmentUrl(item, orgId, cfg)) publicId = new URL(item).pathname.match(/\/upload\/(?:v\d+\/)?(doppeldash\/.+)\.[A-Za-z0-9]+$/)?.[1] ?? null
    if (!publicId) continue
    try {
      const timestamp = Math.floor(Date.now() / 1000)
      const params = { public_id: publicId, timestamp, type, invalidate: 'true' }
      const body = new URLSearchParams({ public_id: publicId, timestamp: String(timestamp), type, invalidate: 'true', api_key: cfg.apiKey!, signature: cloudinarySignature(params, cfg.apiSecret!) })
      const res = await fetchImpl(`${cfg.uploadBase}/v1_1/${cfg.cloudName}/image/destroy`, { method: 'POST', body, signal: AbortSignal.timeout(8000) })
      if (res.ok) removed++
    } catch (err) {
      console.error('[storage] destroy failed', (err as Error)?.message) // never log URLs/secrets
    }
  }
  return removed
}

/**
 * Deletes ONE receipt asset by exact tenant-scoped public id and reports what happened (used by the abandoned-receipt cleanup,
 * which must distinguish "gone" from "failed"). The id is re-validated against the tenant's receipt folder; never throws.
 */
export async function destroyReceiptAsset(publicId: string, orgId: string, cfg = storageConfig(), fetchImpl: typeof fetch = fetch): Promise<'deleted' | 'not_found' | 'error'> {
  if (!cfg.signed || !new RegExp(`^doppeldash/${escapeRe(orgId)}/receipts/[A-Za-z0-9_-]{8,64}$`).test(publicId)) return 'error'
  try {
    const timestamp = Math.floor(Date.now() / 1000)
    const params = { public_id: publicId, timestamp, type: 'authenticated', invalidate: 'true' }
    const body = new URLSearchParams({ public_id: publicId, timestamp: String(timestamp), type: 'authenticated', invalidate: 'true', api_key: cfg.apiKey!, signature: cloudinarySignature(params, cfg.apiSecret!) })
    const res = await fetchImpl(`${cfg.uploadBase}/v1_1/${cfg.cloudName}/image/destroy`, { method: 'POST', body, signal: AbortSignal.timeout(8000) })
    if (!res.ok) return 'error'
    const j = await res.json().catch(() => null) as { result?: string } | null
    if (j?.result === 'ok') return 'deleted'
    if (j?.result === 'not found') return 'not_found'
    return 'error'
  } catch (err) {
    console.error('[storage] destroy failed', (err as Error)?.name)
    return 'error'
  }
}
