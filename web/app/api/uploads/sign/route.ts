import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { rateLimit } from '@/lib/ratelimit'
import { getOrganizationLimit } from '@/lib/entitlements/entitlementService'
import { recordReceiptTicket } from '@/lib/uploads/receiptCleanup'
import { ALLOWED_MIME, UPLOAD_KINDS, issueUploadTicket, storageConfig, type UploadKind } from '@/lib/uploads/attachmentStorage'

/**
 * Issues a short-lived, server-constrained upload ticket for an AUTHENTICATED user. The client uploads the file
 * straight to Cloudinary with exactly the returned fields (so large PDFs never pass through serverless limits) but
 * cannot choose the folder, the public id, the allowed formats or the tenant — and the API secret never leaves here.
 *
 * Body: { kind: 'receipt' | 'card' | 'document' | 'image', mimeType: string, sizeBytes: number }
 */
export async function POST(req: NextRequest) {
  const { userId, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!(await rateLimit(`upload-sign:${userId}`, 60, 60_000))) {
    return NextResponse.json({ error: 'Too many uploads — wait a minute', code: 'rate_limited' }, { status: 429 })
  }

  const body = await req.json().catch(() => null) as { kind?: unknown; mimeType?: unknown; sizeBytes?: unknown; purpose?: unknown } | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid request', code: 'invalid_body' }, { status: 400 })

  const kind = body.kind
  if (typeof kind !== 'string' || !(UPLOAD_KINDS as string[]).includes(kind)) return NextResponse.json({ error: 'Invalid upload kind', code: 'invalid_kind', fields: ['kind'] }, { status: 400 })
  // What the upload is FOR (receipts only). Absent = expense receipt. Recorded server-side with the issuing user.
  let purpose: 'expense_receipt' | 'travel_itinerary' = 'expense_receipt'
  if (body.purpose !== undefined) {
    if (kind !== 'receipt' || (body.purpose !== 'expense_receipt' && body.purpose !== 'travel_itinerary')) return NextResponse.json({ error: 'Invalid upload purpose', code: 'invalid_purpose', fields: ['purpose'] }, { status: 400 })
    purpose = body.purpose
  }
  const mime = typeof body.mimeType === 'string' ? body.mimeType.toLowerCase().replace('image/jpg', 'image/jpeg') : ''
  if (!ALLOWED_MIME[mime]) return NextResponse.json({ error: 'Unsupported file type. Use JPEG, PNG, WebP, HEIC or PDF.', code: 'unsupported_type', fields: ['mimeType'] }, { status: 415 })
  const size = body.sizeBytes
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return NextResponse.json({ error: 'sizeBytes is required', code: 'invalid_size', fields: ['sizeBytes'] }, { status: 400 })

  // The size cap comes from the organisation's plan via the central entitlement resolver (never from the client).
  const maxBytes = await getOrganizationLimit(orgId, 'maxUploadSizeBytes')
  if (size > maxBytes) {
    return NextResponse.json({ error: `File is too large. The limit for your plan is ${Math.round(maxBytes / 1024 / 1024)} MB.`, code: 'file_too_large', maxBytes }, { status: 413 })
  }

  const cfg = storageConfig()
  const ticket = issueUploadTicket({ orgId, kind: kind as UploadKind, maxBytes, mime }, cfg)
  if (!ticket) {
    // FAIL CLOSED: no safe upload mode is configured (production: signing credentials missing/incomplete). There is no
    // unsigned fallback. The reason is logged for operators; users get a safe, generic message.
    console.error('[uploads] storage not configured — refusing to issue an upload ticket:', cfg.problem)
    return NextResponse.json({ error: 'File uploads are temporarily unavailable. Please try again later or contact your administrator.', code: 'storage_not_configured' }, { status: 503 })
  }

  // Receipts are tracked in the upload manifest so abandoned files can be found by age later. Fail closed: an untracked
  // receipt upload would be an orphan nobody can ever clean up.
  if (kind === 'receipt' && ticket.mode === 'signed') {
    try { await recordReceiptTicket(orgId, `${ticket.fields.folder}/${ticket.fields.public_id}`, mime, { purpose, userId }) } catch (err) {
      console.error('[uploads] could not record receipt upload', (err as Error)?.name)
      return NextResponse.json({ error: 'File uploads are temporarily unavailable. Please try again later or contact your administrator.', code: 'storage_not_configured' }, { status: 503 })
    }
  }

  return NextResponse.json(ticket, { headers: { 'Cache-Control': 'no-store' } })
}
