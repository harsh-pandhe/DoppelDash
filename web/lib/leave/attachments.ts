/**
 * Leave medical documents — a PRIVATE, purpose-bound attachment contract (Phase 1J).
 *
 * Medical documents are among the most sensitive files the product holds. They were previously uploaded as `kind=document`, which is stored
 * and delivered PUBLICLY by the storage provider (an unguessable URL is not access control), and `medicalDocs` accepted any string. Now:
 *   1. `POST /api/uploads/sign { kind:'receipt', purpose:'leave_medical', … }` → authenticated, tenant-scoped, size/MIME-constrained ticket;
 *      the server records a manifest row (ReceiptUpload) with organisation, ISSUING USER, purpose and declared type before any byte exists.
 *      The asset is stored as `type=authenticated` (no public delivery URL exists).
 *   2. The client uploads straight to the provider and sends back the URL the provider returned in `medicalDocs`.
 *   3. The server accepts it ONLY if: it is the authenticated-delivery URL of an asset in THIS organisation's private receipt folder; the
 *      manifest says purpose `leave_medical`, same organisation, same user, state issued|attached; it is not used by any other leave /
 *      expense / trip; and the provider confirms private type, a supported format equal to the DECLARED type, and size within the plan limit.
 *      Anything else — public URLs, other hosts, other tenants, raw `cld:` refs, expense/itinerary files, someone else's ticket — is refused.
 *   4. Files are then EXCLUSIVELY claimed (`claimedBy` = the new leave's id, set atomically) BEFORE the leave is written; a failed claim or
 *      a failed write releases only this request's claims. The stored value is the private `cld:` reference; clients only ever see
 *      `/api/lms/<id>/document/<n>.<ext>` (authenticated proxy, authorised on every read).
 * LEGACY: records created before this contract hold plain public URLs. They are returned unchanged (so old records stay reviewable), they are
 * NOT private, and nothing here rewrites, deletes or migrates them. See docs/LEAVE_MEDICAL_DOCUMENTS.md.
 */
import mongoose from 'mongoose'
import ReceiptUpload from '@/models/ReceiptUpload'
import Leave from '@/models/Leave'
import TravelRequest from '@/models/TravelRequest'
import Expense from '@/models/Expense'
import { destroyAttachments, destroyReceiptAsset, isReceiptRef, parseReceiptRef, receiptRefFromUploadUrl, verifyStoredReceipt } from '@/lib/uploads/attachmentStorage'
import { declaredFormatsFor, isReferenced, LEASE_MS, markReceiptRejected, MIN_AGE_MS, RETRY_MS } from '@/lib/uploads/receiptCleanup'
import { getOrganizationLimit } from '@/lib/entitlements/entitlementService'

export const LEAVE_MEDICAL_PURPOSE = 'leave_medical' as const
export const MAX_MEDICAL_DOCS = 10
export const MAX_DOC_VALUE_LENGTH = 2048

export interface AttachmentError { status: number; body: Record<string, unknown> }
const invalid = (i?: number): AttachmentError => ({ status: 400, body: { error: 'Invalid leave request', fields: [i === undefined ? 'medicalDocs' : `medicalDocs[${i}]`], code: 'invalid_leave_request' } })

/** Shape check of the raw client value. Returns the strings, or an error (never throws). */
export function parseMedicalDocsInput(v: unknown): { values: string[] } | AttachmentError {
  if (v === undefined || v === null) return { values: [] }
  if (!Array.isArray(v) || v.length > MAX_MEDICAL_DOCS) return invalid()
  for (let i = 0; i < v.length; i++) if (typeof v[i] !== 'string' || v[i].length === 0 || v[i].length > MAX_DOC_VALUE_LENGTH) return invalid(i)
  return { values: v as string[] }
}

/** Raw client values → private references of THIS organisation (or the index of the first bad value). Pure. */
export function refsFromClientValues(values: string[], orgId: string): { refs: string[] } | { badIndex: number } {
  const refs: string[] = []
  for (let i = 0; i < values.length; i++) {
    const ref = receiptRefFromUploadUrl(values[i], orgId)
    if (!ref || refs.includes(ref)) return { badIndex: i }
    refs.push(ref)
  }
  return { refs }
}

/** Verifies every value against the manifest and the provider. No claim is made here. */
export async function resolveMedicalDocs(values: string[], ctx: { orgId: string; userId: string; claimant: string }): Promise<{ refs: string[]; publicIds: string[] } | AttachmentError> {
  const first = refsFromClientValues(values, ctx.orgId)
  if ('badIndex' in first) return invalid(first.badIndex)
  const maxBytes = await getOrganizationLimit(ctx.orgId, 'maxUploadSizeBytes')
  const publicIds: string[] = []
  for (let i = 0; i < first.refs.length; i++) {
    const ref = first.refs[i]; const parsed = parseReceiptRef(ref, ctx.orgId)
    if (!parsed) return invalid(i)
    const row = await ReceiptUpload.findOne({ orgId: ctx.orgId, publicId: parsed.publicId }).lean()
    const inUse = { status: 409, body: { error: 'That document is already attached to another record.', fields: [`medicalDocs[${i}]`], code: 'attachment_in_use' } }
    if (row && row.purpose === LEAVE_MEDICAL_PURPOSE && row.userId === ctx.userId && row.state === 'deleting' && row.claimedBy && row.claimedBy !== ctx.claimant) return inUse   // reserved by an in-flight leave deletion
    if (!row || row.purpose !== LEAVE_MEDICAL_PURPOSE || row.userId !== ctx.userId || !['issued', 'attached'].includes(row.state)) return invalid(i)
    if (row.claimedBy && row.claimedBy !== ctx.claimant) {
      const holder = mongoose.isValidObjectId(row.claimedBy) ? await Leave.exists({ _id: row.claimedBy, orgId: ctx.orgId }) : null
      if (holder) return inUse
      await ReceiptUpload.updateOne({ orgId: ctx.orgId, publicId: parsed.publicId, claimedBy: row.claimedBy, state: { $in: ['issued', 'attached'] } }, { $unset: { claimedBy: 1 } })   // stale claim (leave never written); never overrides a deletion reservation (state 'deleting')
    }
    const used = (await Leave.exists({ orgId: ctx.orgId, medicalDocs: ref, _id: { $ne: ctx.claimant } }))
      || (await TravelRequest.exists({ orgId: ctx.orgId, itineraryDocs: ref })) || (await Expense.exists({ orgId: ctx.orgId, $or: [{ receipts: ref }, { 'lineItems.receiptUrl': ref }] }))
    if (used) return inUse

    const check = await verifyStoredReceipt(ref, ctx.orgId, maxBytes, undefined, undefined, await declaredFormatsFor(ctx.orgId, parsed.publicId))
    if (check.ok) { publicIds.push(parsed.publicId); continue }
    if (check.reason === 'unavailable') return { status: 503, body: { error: 'We couldn’t verify an attached document right now. Please try again in a moment.', code: 'attachment_verification_unavailable' } }
    if (check.reason !== 'not_found') {
      await markReceiptRejected(ctx.orgId, parsed.publicId).catch(() => undefined)
      void destroyAttachments([ref], ctx.orgId)
    }
    if (check.reason === 'too_large') return { status: 413, body: { error: `A document is larger than your plan allows (${Math.round(maxBytes / 1024 / 1024)} MB).`, fields: [`medicalDocs[${i}]`], code: 'attachment_too_large', maxBytes } }
    if (check.reason === 'type_mismatch') return { status: 400, body: { error: 'That file’s contents don’t match its file type. Please choose the original file.', fields: [`medicalDocs[${i}]`], code: 'attachment_type_mismatch' } }
    return invalid(i)
  }
  return { refs: first.refs, publicIds }
}

/** Atomic EXCLUSIVE claim of every file for `claimant`; returns false (and releases what this call took) if any claim is lost. */
export async function claimMedicalDocs(publicIds: string[], ctx: { orgId: string; userId: string; claimant: string }): Promise<boolean> {
  const taken: string[] = []
  const now = new Date()
  for (const publicId of publicIds) {
    const got = await ReceiptUpload.findOneAndUpdate(
      { orgId: ctx.orgId, publicId, purpose: LEAVE_MEDICAL_PURPOSE, userId: ctx.userId, state: { $in: ['issued', 'attached'] }, $or: [{ claimedBy: { $exists: false } }, { claimedBy: null }, { claimedBy: ctx.claimant }] },
      { $set: { state: 'attached', attachedAt: now, nextCheckAt: new Date(now.getTime() + MIN_AGE_MS), claimedBy: ctx.claimant } },
    ).lean()
    if (!got) { await releaseUnreferencedClaims(ctx.orgId, ctx.claimant, taken); return false }
    taken.push(publicId)
  }
  return true
}

/** Releases claims held by `claimant` on files the leave does NOT actually reference (failed create, lost race). */
export async function releaseUnreferencedClaims(orgId: string, claimant: string, publicIds: string[]): Promise<void> {
  if (!publicIds.length) return
  const leave = mongoose.isValidObjectId(claimant) ? await Leave.findOne({ _id: claimant, orgId }).select('medicalDocs').lean() : null
  const kept = new Set((leave?.medicalDocs || []).map(r => parseReceiptRef(r, orgId)?.publicId).filter(Boolean) as string[])
  const free = publicIds.filter(id => !kept.has(id))
  if (free.length) await ReceiptUpload.updateMany({ orgId, publicId: { $in: free }, claimedBy: claimant }, { $unset: { claimedBy: 1 } })
}

/**
 * Leave deletion lifecycle (race-free ordering):
 *   1. reserveLeaveDocs   — BEFORE the leave is deleted: attached+claimed-by-this-leave → `deleting` (the existing cleanup claim state, with a lease).
 *                           From this instant no submission can claim or resolve the file (claim needs issued|attached; resolve answers 409) and the
 *                           stale-claim recovery ignores it. Ownership (`claimedBy`) is still recorded so the reservation can be undone.
 *   2. delete the leave   — if that fails (or removes nothing) → restoreLeaveDocs puts the files back to `attached`, still claimed by the leave.
 *   3. disposeLeaveDocs   — leave gone: if ANY surviving record still references a file it is restored (never deleted); otherwise the provider asset
 *                           is destroyed and the manifest row removed only after the provider confirmed. A provider failure keeps the row in `deleting`
 *                           with a retry lease, so the abandoned-upload cleanup retries it (it re-checks references itself) and attach stays refused.
 * A crash between 1 and 2 is self-healing: the cleanup reclaims the expired lease, sees the leave still references the file, and releases it.
 */
const privatePublicIds = (orgId: string, stored: string[] | undefined) =>
  (stored || []).map(r => (isReceiptRef(r) ? parseReceiptRef(r, orgId)?.publicId : undefined)).filter(Boolean) as string[]

/** Returns the publicIds this call reserved. Throws on a database error: the caller must then NOT delete the leave. */
export async function reserveLeaveDocs(orgId: string, leaveId: string, stored: string[] | undefined): Promise<string[]> {
  const reserved: string[] = []
  try {
    for (const publicId of privatePublicIds(orgId, stored)) {
      const got = await ReceiptUpload.findOneAndUpdate(
        { orgId, publicId, purpose: LEAVE_MEDICAL_PURPOSE, claimedBy: leaveId, state: { $in: ['issued', 'attached'] } },
        { $set: { state: 'deleting', leaseUntil: new Date(Date.now() + LEASE_MS) } },
      ).lean()
      if (got) reserved.push(publicId)
    }
    return reserved
  } catch (err) { await restoreLeaveDocs(orgId, leaveId, reserved); throw err }
}

/** The leave still exists: put reserved files back as attached + claimed by it. Only rows still reserved by this leave are touched. */
export async function restoreLeaveDocs(orgId: string, leaveId: string, publicIds: string[]): Promise<void> {
  if (!publicIds.length) return
  await ReceiptUpload.updateMany({ orgId, publicId: { $in: publicIds }, purpose: LEAVE_MEDICAL_PURPOSE, claimedBy: leaveId, state: 'deleting' },
    { $set: { state: 'attached', nextCheckAt: new Date(Date.now() + MIN_AGE_MS) }, $unset: { leaseUntil: 1 } })
}

/**
 * The leave is gone (called by the request whose delete actually removed it, which may differ from the one that reserved: concurrent deletes).
 * Handles every private file of the leave whose row is reserved (`deleting`, claimed by this leave). Returns true only when each is physically
 * gone or still legitimately referenced; never throws.
 */
export async function disposeLeaveDocs(orgId: string, leaveId: string, stored: string[] | undefined): Promise<boolean> {
  let clean = true
  for (const publicId of privatePublicIds(orgId, stored)) {
    try {
      if (!(await ReceiptUpload.exists({ orgId, publicId, purpose: LEAVE_MEDICAL_PURPOSE, state: 'deleting', claimedBy: leaveId }))) continue   // not reserved by this leave's deletion
      if (await isReferenced(orgId, publicId)) {   // a surviving authoritative record still uses it: keep the file
        await ReceiptUpload.updateOne({ orgId, publicId, claimedBy: leaveId, state: 'deleting' }, { $set: { state: 'attached', nextCheckAt: new Date(Date.now() + MIN_AGE_MS) }, $unset: { leaseUntil: 1, claimedBy: 1 } })
        continue
      }
      await ReceiptUpload.updateOne({ orgId, publicId, claimedBy: leaveId, state: 'deleting' }, { $unset: { claimedBy: 1 } })   // still `deleting`: nothing can claim it
      const res = await destroyReceiptAsset(publicId, orgId)
      if (res === 'deleted' || res === 'not_found') { await ReceiptUpload.deleteOne({ orgId, publicId, purpose: LEAVE_MEDICAL_PURPOSE, state: 'deleting' }); continue }
      clean = false
      await ReceiptUpload.updateOne({ orgId, publicId, state: 'deleting' }, { $set: { leaseUntil: new Date(Date.now() + RETRY_MS) }, $inc: { failures: 1 } })
    } catch (err) { clean = false; console.error('[leave-docs] dispose failed', (err as Error)?.name) }
  }
  return clean
}

const extOf = (ref: string) => ref.slice(ref.lastIndexOf('.') + 1).toLowerCase()

/**
 * API view of a leave: private references become the authenticated proxy path; legacy plain values (public URLs from before this contract)
 * pass through unchanged. No provider URL, signature or storage reference of a private file ever leaves the server.
 */
export function presentLeave<T extends { _id: unknown }>(leave: T): T {
  const id = String(leave._id)
  const src = leave as unknown as { medicalDocs?: string[] }
  const out = { ...leave } as unknown as { medicalDocs?: string[] }
  delete (out as Record<string, unknown>).__v
  if (Array.isArray(src.medicalDocs)) out.medicalDocs = src.medicalDocs.map((d, i) => (isReceiptRef(d) ? `/api/lms/${id}/document/${i}.${extOf(d)}` : d))
  return out as unknown as T
}
