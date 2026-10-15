import { NextResponse } from 'next/server'
import { destroyAttachments, isReceiptRef, parseReceiptRef, verifyStoredReceipt } from '@/lib/uploads/attachmentStorage'
import { getOrganizationLimit } from '@/lib/entitlements/entitlementService'
import { claimReceiptForAttach, declaredFormatsFor, markReceiptRejected } from '@/lib/uploads/receiptCleanup'
import Expense from '@/models/Expense'

type LineLike = { receiptUrl?: string }

const extOf = (ref: string) => ref.slice(ref.lastIndexOf('.') + 1).toLowerCase()

/**
 * What API clients see. A stored private reference never leaves the server as a URL: it becomes the AUTHENTICATED
 * retrieval path of this API (`/api/rms/<id>/receipt/<n>.<ext>`; `l<n>` for line items). Legacy public URLs that already
 * exist in the data are passed through unchanged (they remain public until migrated — see docs/RECEIPT_STORAGE_AND_OCR.md).
 */
export function presentExpense<T extends { _id: unknown }>(e: T): T {
  const id = String(e._id)
  const src = e as unknown as { receipts?: string[]; lineItems?: LineLike[] }
  const out = { ...e } as unknown as { receipts?: string[]; lineItems?: LineLike[] }
  delete (out as Record<string, unknown>).__v
  delete (out as Record<string, unknown>).travelConversionOf        // internal marker of the trip→expense protocol (the public link is `travelRequestId`)
  if (Array.isArray(src.receipts)) out.receipts = src.receipts.map((r, i) => (isReceiptRef(r) ? `/api/rms/${id}/receipt/${i}.${extOf(r)}` : r))
  if (Array.isArray(src.lineItems)) {
    out.lineItems = src.lineItems.map((l, i) => (l && isReceiptRef(l.receiptUrl) ? { ...l, receiptUrl: `/api/rms/${id}/receipt/l${i}.${extOf(l.receiptUrl as string)}` } : l))
  }
  return out as unknown as T
}

/** Stored attachment values of an expense (receipts + per-line), as kept in MongoDB. */
export const storedReceipts = (e: { receipts?: string[] }) => [...(e.receipts || [])]
export const storedLineReceipts = (e: { lineItems?: { receiptUrl?: string }[] }) => (e.lineItems || []).map(l => l?.receiptUrl || undefined)

/**
 * Independent, server-side check of freshly uploaded receipts against what the provider ACTUALLY stored (type, format, real
 * byte size vs the plan limit). Returns an error response (and deletes offending files) or null when everything is fine.
 * A reference already attached to another expense is refused: one uploaded file belongs to one claim.
 */
export async function checkNewReceipts(refs: string[], orgId: string, currentExpenseId?: string): Promise<NextResponse | null> {
  if (!refs.length) return null
  const unique = Array.from(new Set(refs))
  const maxBytes = await getOrganizationLimit(orgId, 'maxUploadSizeBytes')
  for (const ref of unique) {
    if (!parseReceiptRef(ref, orgId)) return NextResponse.json({ error: 'Invalid attachment', fields: ['receipts'], code: 'attachment_rejected' }, { status: 400 })
    const used = await Expense.exists({ orgId, ...(currentExpenseId ? { _id: { $ne: currentExpenseId } } : {}), $or: [{ receipts: ref }, { 'lineItems.receiptUrl': ref }] })
    if (used) return NextResponse.json({ error: 'That receipt is already attached to another expense.', fields: ['receipts'], code: 'attachment_in_use' }, { status: 409 })
    let declared: string[] | null = null
    try { declared = await declaredFormatsFor(orgId, parseReceiptRef(ref, orgId)!.publicId) } catch { return NextResponse.json({ error: 'We couldn’t verify the attached receipt right now. Please try again in a moment.', code: 'attachment_verification_unavailable' }, { status: 503 }) }
    const check = await verifyStoredReceipt(ref, orgId, maxBytes, undefined, undefined, declared)
    if (check.ok) {
      // Atomic hand-over with the abandoned-receipt cleanup: if it already claimed this file, the attach is refused.
      let claimed = false
      try { claimed = await claimReceiptForAttach(orgId, parseReceiptRef(ref, orgId)!.publicId) } catch { return NextResponse.json({ error: 'We couldn’t verify the attached receipt right now. Please try again in a moment.', code: 'attachment_verification_unavailable' }, { status: 503 }) }
      if (!claimed) return NextResponse.json({ error: 'A receipt file is invalid or was not uploaded correctly.', fields: ['receipts'], code: 'attachment_rejected' }, { status: 400 })
      continue
    }
    if (check.reason === 'unavailable') {
      return NextResponse.json({ error: 'We couldn’t verify the attached receipt right now. Please try again in a moment.', code: 'attachment_verification_unavailable' }, { status: 503 })
    }
    if (check.reason === 'too_large' || check.reason === 'bad_format' || check.reason === 'wrong_type' || check.reason === 'type_mismatch') {
      // Rejected files can never be attached later (row state 'rejected'); deletion is best effort and retried by the cleanup job.
      await markReceiptRejected(orgId, parseReceiptRef(ref, orgId)!.publicId).catch(() => undefined) // before replying: no window where it is still attachable
      void destroyAttachments([ref], orgId)
    }
    if (check.reason === 'type_mismatch') {
      return NextResponse.json({ error: 'That file’s contents don’t match its file type (for example, a PNG renamed to .pdf). Please choose the original file.', fields: ['receipts'], code: 'attachment_type_mismatch' }, { status: 400 })
    }
    if (check.reason === 'too_large') {
      return NextResponse.json({ error: `A receipt file is larger than your plan allows (${Math.round(maxBytes / 1024 / 1024)} MB).`, fields: ['receipts'], code: 'attachment_too_large', maxBytes }, { status: 413 })
    }
    return NextResponse.json({ error: 'A receipt file is invalid or was not uploaded correctly.', fields: ['receipts'], code: 'attachment_rejected' }, { status: 400 })
  }
  return null
}
