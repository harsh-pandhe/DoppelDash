// Browser → Cloudinary upload, authorised by OUR server.
//
// The browser asks POST /api/uploads/sign for a ticket (authenticated; the server picks the tenant folder, the
// unguessable public id and the allowed formats, and applies the plan's size limit) and then uploads the file
// straight to Cloudinary with exactly the returned fields. That keeps large PDFs off serverless request limits
// (Netlify caps bodies at ~6 MB) while no API secret ever reaches the client and nobody unauthenticated can upload.
//
// Legacy fallback: if the server has no signing credentials it returns an *unsigned* ticket (the old public
// preset) — same behaviour as before, but the server flags it so it can be retired by setting the API secret.

export type UploadKind = 'receipt' | 'card' | 'document' | 'image'

// Fallback ceiling (the largest plan limit), used only when the organisation's own limit cannot be read. The pre-check below
// normally uses the authenticated organisation's limit (`entitlements.limits.maxUploadSizeBytes` from GET /api/auth/me);
// the SERVER re-applies the plan limit when it issues the ticket and when the receipt is attached, and stays authoritative.
const MAX_BYTES = 25 * 1024 * 1024
const mbText = (bytes: number) => `${Math.round((bytes / 1024 / 1024) * 10) / 10}`.replace(/\.0$/, '')

let limitCache: { value: number | null; at: number } | null = null
/** The signed-in organisation's per-file upload limit in bytes, or null when the server did not provide one. */
export async function planUploadLimit(): Promise<number | null> {
  if (limitCache && Date.now() - limitCache.at < 30_000) return limitCache.value
  let value: number | null = null
  try {
    const res = await fetch('/api/auth/me')
    if (res.ok) {
      const v = (await res.json())?.entitlements?.limits?.maxUploadSizeBytes
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) value = v
    }
  } catch { /* fall back to the ceiling; the server still enforces the plan */ }
  limitCache = { value, at: Date.now() }
  return value
}
export function clearUploadLimitCache() { limitCache = null }

/** Pure boundary check: a file of exactly `limit` bytes is accepted, one byte more is rejected. */
export function oversizeMessage(name: string, size: number, limit: number): string | null {
  return size > limit ? `${name} is larger than the ${mbText(limit)} MB limit for your plan.` : null
}
const ALLOWED_TYPES = [
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic', 'application/pdf',
]
const EXT_MIME: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', pdf: 'application/pdf' }

function mimeOf(file: File): string {
  if (file.type) return file.type === 'image/jpg' ? 'image/jpeg' : file.type
  return EXT_MIME[file.name.split('.').pop()?.toLowerCase() || ''] || ''
}

interface UploadTicket { mode: 'signed' | 'unsigned'; uploadUrl: string; fields: Record<string, string> }

// `kind` selects the server-side storage policy. Only 'receipt' is stored privately (authenticated delivery); the other
// kinds are still signed, tenant-foldered uploads but remain publicly deliverable until their features are migrated.
/** `purpose` states what a private receipt-storage upload is FOR (travel itinerary documents); the server records it and enforces it. */
export async function uploadToCloudinary(file: File, kind: UploadKind = 'document', purpose?: 'expense_receipt' | 'travel_itinerary' | 'leave_medical'): Promise<string> {
  const tooBig = oversizeMessage(file.name, file.size, (await planUploadLimit()) ?? MAX_BYTES)
  if (tooBig) throw new Error(tooBig)
  const mimeType = mimeOf(file)
  if (!ALLOWED_TYPES.includes(mimeType)) {
    throw new Error(`${file.name} is not an allowed file type (images and PDF only).`)
  }

  const ticketRes = await fetch('/api/uploads/sign', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, mimeType, sizeBytes: file.size, ...(purpose ? { purpose } : {}) }),
  })
  if (!ticketRes.ok) {
    const detail = await ticketRes.json().catch(() => null)
    throw new Error(detail?.error || 'Upload is not available right now')
  }
  const ticket = await ticketRes.json() as UploadTicket

  const formData = new FormData()
  for (const [k, v] of Object.entries(ticket.fields)) formData.append(k, v)
  formData.append('file', file) // `file` last, as Cloudinary expects

  const res = await fetch(ticket.uploadUrl, { method: 'POST', body: formData })
  if (!res.ok) {
    const detail = await res.json().catch(() => null)
    const msg = String(detail?.error?.message || '')
    // The ticket pins the provider to the DECLARED type, so a file whose contents are another type (a PNG renamed .pdf) is refused here.
    if (res.status === 400 && /not allowed/i.test(msg)) throw new Error(`${file.name}: the file’s contents don’t match its type (for example, a PNG renamed to .pdf). Please choose the original file.`)
    throw new Error(msg || 'Upload failed')
  }

  const data = await res.json()
  return data.secure_url as string
}

export async function uploadMultiple(files: File[], kind: UploadKind = 'document'): Promise<string[]> {
  return Promise.all(files.map(f => uploadToCloudinary(f, kind)))
}
