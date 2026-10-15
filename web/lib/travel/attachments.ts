/**
 * Travel itinerary attachments (Slice 2).
 *
 * THE CONTRACT. An itinerary document is a PRIVATE receipt-storage file (same bucket folder, same signed-ticket flow, same provider
 * verification as expense receipts) that was issued FOR travel:
 *   1. `POST /api/uploads/sign { kind:'receipt', purpose:'travel_itinerary', … }` → the server records a manifest row (ReceiptUpload) with
 *      the organisation, the ISSUING USER, the purpose and the declared type, before any byte exists.
 *   2. The client uploads straight to the provider and sends back the URL the provider returned for that upload in `itineraryDocs`.
 *   3. The server accepts it ONLY if all of these hold (anything else → 400, 409 or 503, never stored):
 *        – the value is the authenticated-delivery URL of an asset inside THIS organisation's private receipt folder (not a public URL,
 *          path, raw `cld:` reference, other host, other tenant, traversal, wrong shape);
 *        – a manifest row exists with purpose `travel_itinerary`, the same organisation and the same user, in state issued|attached
 *          (never rejected/deleting);
 *        – it is not already used by another trip, another claim holder, or any expense;
 *        – the provider confirms the stored asset: private type, supported format that equals the DECLARED type, size within the plan limit.
 *   4. Files are then EXCLUSIVELY claimed (`claimedBy` = the new trip's id, set atomically) BEFORE the trip is written; a failed
 *      claim or a failed write releases only the claims made by this request. The stored reference is the private `cld:` form;
 *      clients only ever see `/api/travel/<id>/itinerary/<n>.<ext>` (authenticated proxy).
 * Receipt tickets (purpose `expense_receipt`/absent) can never be used here, and travel files can never be attached to an expense
 * receipt through the normal expense flow. Existing stored strings (legacy) are NEVER rewritten or deleted.
 */
import { createHash } from 'crypto'
import mongoose from 'mongoose'
import ReceiptUpload from '@/models/ReceiptUpload'
import TravelRequest from '@/models/TravelRequest'
import Expense from '@/models/Expense'
import { destroyAttachments, isReceiptRef, parseReceiptRef, receiptRefFromUploadUrl, verifyStoredReceipt } from '@/lib/uploads/attachmentStorage'
import { declaredFormatsFor, markReceiptRejected, MIN_AGE_MS } from '@/lib/uploads/receiptCleanup'
import { presentTravelRecord } from '@/lib/travel/present'
import { getOrganizationLimit } from '@/lib/entitlements/entitlementService'

export const ITINERARY_PURPOSE = 'travel_itinerary' as const

export interface AttachmentError { status: number; body: Record<string, unknown> }
const invalid = (i: number): AttachmentError => ({ status: 400, body: { error: 'Invalid travel request', fields: [`itineraryDocs[${i}]`], code: 'invalid_travel_request' } })

/** The id a new trip will get. Keyed requests get a DETERMINISTIC id (same org+user+key → same id) so concurrent retries share one claim holder. */
export function tripIdFor(orgId: string, userId: string, clientRequestId?: string): mongoose.Types.ObjectId {
  if (!clientRequestId) return new mongoose.Types.ObjectId()
  return new mongoose.Types.ObjectId(createHash('sha256').update(`travel|${orgId}|${userId}|${clientRequestId}`).digest('hex').slice(0, 24))
}

/** Pure, side-effect-free part of resolution: raw client values → private references of THIS organisation (or the index of the first bad value). */
export function refsFromClientValues(values: string[], orgId: string): { refs: string[] } | { badIndex: number } {
  const refs: string[] = []
  for (let i = 0; i < values.length; i++) {
    const ref = receiptRefFromUploadUrl(values[i], orgId)
    if (!ref || refs.includes(ref)) return { badIndex: i }
    refs.push(ref)
  }
  return { refs }
}

/**
 * Verifies every value against the manifest and the provider. NO claim is made here; the only side effect is rejecting + deleting
 * (best effort) an uploaded file that failed provider verification so it can never be used later.
 */
export async function resolveItineraryDocs(values: string[], ctx: { orgId: string; userId: string; claimant: string }): Promise<{ refs: string[]; publicIds: string[] } | AttachmentError> {
  const first = refsFromClientValues(values, ctx.orgId)
  if ('badIndex' in first) return invalid(first.badIndex)
  const maxBytes = await getOrganizationLimit(ctx.orgId, 'maxUploadSizeBytes')
  const publicIds: string[] = []
  for (let i = 0; i < first.refs.length; i++) {
    const ref = first.refs[i]; const parsed = parseReceiptRef(ref, ctx.orgId)
    if (!parsed) return invalid(i)
    const row = await ReceiptUpload.findOne({ orgId: ctx.orgId, publicId: parsed.publicId }).lean()
    if (!row || row.purpose !== ITINERARY_PURPOSE || row.userId !== ctx.userId || !['issued', 'attached'].includes(row.state)) return invalid(i)
    // already taken? (another trip holding the claim, another trip/expense referencing it). A stale claim (holder trip never created) is released.
    if (row.claimedBy && row.claimedBy !== ctx.claimant) {
      const holder = mongoose.isValidObjectId(row.claimedBy) ? await TravelRequest.exists({ _id: row.claimedBy, orgId: ctx.orgId }) : null
      if (holder) return { status: 409, body: { error: 'That document is already attached to another trip.', fields: [`itineraryDocs[${i}]`], code: 'attachment_in_use' } }
      await ReceiptUpload.updateOne({ orgId: ctx.orgId, publicId: parsed.publicId, claimedBy: row.claimedBy }, { $unset: { claimedBy: 1 } })
    }
    const used = (await TravelRequest.exists({ orgId: ctx.orgId, itineraryDocs: ref, _id: { $ne: ctx.claimant } })) || (await Expense.exists({ orgId: ctx.orgId, $or: [{ receipts: ref }, { 'lineItems.receiptUrl': ref }] }))
    if (used) return { status: 409, body: { error: 'That document is already attached to another trip.', fields: [`itineraryDocs[${i}]`], code: 'attachment_in_use' } }

    const declared = await declaredFormatsFor(ctx.orgId, parsed.publicId)
    const check = await verifyStoredReceipt(ref, ctx.orgId, maxBytes, undefined, undefined, declared)
    if (check.ok) { publicIds.push(parsed.publicId); continue }
    if (check.reason === 'unavailable') return { status: 503, body: { error: 'We couldn’t verify an attached document right now. Please try again in a moment.', code: 'attachment_verification_unavailable' } }
    if (check.reason !== 'not_found') {
      await markReceiptRejected(ctx.orgId, parsed.publicId).catch(() => undefined)
      void destroyAttachments([ref], ctx.orgId)
    }
    if (check.reason === 'too_large') return { status: 413, body: { error: `A document is larger than your plan allows (${Math.round(maxBytes / 1024 / 1024)} MB).`, fields: [`itineraryDocs[${i}]`], code: 'attachment_too_large', maxBytes } }
    if (check.reason === 'type_mismatch') return { status: 400, body: { error: 'That file’s contents don’t match its file type. Please choose the original file.', fields: [`itineraryDocs[${i}]`], code: 'attachment_type_mismatch' } }
    return invalid(i)
  }
  return { refs: first.refs, publicIds }
}

/** Atomic EXCLUSIVE claim of every file for `claimant`; returns false (and releases what this call took) if any claim is lost. */
export async function claimItineraryDocs(publicIds: string[], ctx: { orgId: string; userId: string; claimant: string }): Promise<boolean> {
  const taken: string[] = []
  const now = new Date()
  for (const publicId of publicIds) {
    const got = await ReceiptUpload.findOneAndUpdate(
      { orgId: ctx.orgId, publicId, purpose: ITINERARY_PURPOSE, userId: ctx.userId, state: { $in: ['issued', 'attached'] }, $or: [{ claimedBy: { $exists: false } }, { claimedBy: null }, { claimedBy: ctx.claimant }] },
      { $set: { state: 'attached', attachedAt: now, nextCheckAt: new Date(now.getTime() + MIN_AGE_MS), claimedBy: ctx.claimant } },
    ).lean()
    if (!got) { await releaseUnreferencedClaims(ctx.orgId, ctx.claimant, taken); return false }
    taken.push(publicId)
  }
  return true
}

/** Releases claims held by `claimant` on files the trip does NOT actually reference (failed create, lost race, key conflict). */
export async function releaseUnreferencedClaims(orgId: string, claimant: string, publicIds: string[]): Promise<void> {
  if (!publicIds.length) return
  const trip = mongoose.isValidObjectId(claimant) ? await TravelRequest.findOne({ _id: claimant, orgId }).select('itineraryDocs').lean() : null
  const kept = new Set((trip?.itineraryDocs || []).map(r => parseReceiptRef(r, orgId)?.publicId).filter(Boolean) as string[])
  const free = publicIds.filter(id => !kept.has(id))
  if (free.length) await ReceiptUpload.updateMany({ orgId, publicId: { $in: free }, claimedBy: claimant }, { $unset: { claimedBy: 1 } })
}

export interface ConversionAttachments { transferred: string[]; excluded: number; unavailable: boolean }
/**
 * Decides which of a trip's stored itinerary values may be copied to a generated expense. Only `cld:` references of THIS organisation that the
 * manifest says were issued for travel and are held by THIS trip, and that the provider confirms right now. Everything else (legacy strings,
 * foreign/forged/unverifiable references) is excluded — and stays on the trip untouched. Never throws on a bad value.
 */
export async function attachmentsForExpense(trip: { _id: unknown; itineraryDocs?: string[] }, orgId: string): Promise<ConversionAttachments> {
  const out: ConversionAttachments = { transferred: [], excluded: 0, unavailable: false }
  const maxBytes = await getOrganizationLimit(orgId, 'maxUploadSizeBytes')
  for (const doc of trip.itineraryDocs || []) {
    const parsed = isReceiptRef(doc) ? parseReceiptRef(doc, orgId) : null
    if (!parsed) { out.excluded++; continue }
    const row = await ReceiptUpload.findOne({ orgId, publicId: parsed.publicId }).lean()
    if (!row || row.purpose !== ITINERARY_PURPOSE || row.claimedBy !== String(trip._id) || row.state !== 'attached') { out.excluded++; continue }
    const check = await verifyStoredReceipt(doc, orgId, maxBytes, undefined, undefined, await declaredFormatsFor(orgId, parsed.publicId))
    if (check.ok) out.transferred.push(doc)
    else if (check.reason === 'unavailable') { out.unavailable = true; return out }
    else out.excluded++
  }
  return out
}

/** API view of a trip (explicit allowlist; see lib/travel/present.ts). Kept as the single entry point the routes import. */
export function presentTravel<T extends { _id: unknown }>(t: T): T {
  return presentTravelRecord(t) as unknown as T
}


/* ───────────────────────── Slice 3: add / replace / remove on an EXISTING trip ───────────────────────── */

export interface DocsPlan {
  /** For every entry of the desired list, in order: the stored value being KEPT, or a placeholder for a NEW upload (resolved separately). */
  slots: ({ kind: 'keep'; value: string; index: number } | { kind: 'new'; value: string; desiredIndex: number })[]
  removed: string[]
}
const PATH_RE = /^\/api\/travel\/([a-f0-9]{24})\/itinerary\/(\d{1,3})(?:\.[a-z0-9]{2,5})?$/i

/**
 * Interprets the client's COMPLETE desired list against what the trip stores now. An entry is KEPT only if it is the proxy path of THIS trip
 * (a valid index, used once) or — for legacy plain values — exactly equals a stored legacy value. Anything else is a candidate NEW upload
 * (which the caller then resolves against the private-attachment contract and which fails if it is not a genuine server-issued upload).
 */
export function planDocsUpdate(trip: { _id: unknown; itineraryDocs?: string[] }, desired: string[]): DocsPlan | { badIndex: number } {
  const current = trip.itineraryDocs || []; const used = new Set<number>(); const slots: DocsPlan['slots'] = []
  for (let i = 0; i < desired.length; i++) {
    const v = desired[i]; const m = PATH_RE.exec(v)
    if (m && m[1].toLowerCase() === String(trip._id).toLowerCase()) {
      const idx = Number(m[2])
      if (idx >= current.length || used.has(idx)) return { badIndex: i }
      used.add(idx); slots.push({ kind: 'keep', value: current[idx], index: idx }); continue
    }
    const legacyIdx = isReceiptRef(v) ? -1 : current.findIndex((c, j) => c === v && !used.has(j) && !isReceiptRef(c))
    if (legacyIdx >= 0) { used.add(legacyIdx); slots.push({ kind: 'keep', value: current[legacyIdx], index: legacyIdx }); continue }
    slots.push({ kind: 'new', value: v, desiredIndex: i })
  }
  return { slots, removed: current.filter((_, j) => !used.has(j)) }
}

/**
 * After a successful write: release the claims of documents that left the trip. Safe against a concurrent re-add of the same file: if the trip
 * references a file again by the time we look, its claim is restored (a referenced file is never left unclaimed, and the cleanup job also
 * protects any file a trip still references). Files that were never claimed (legacy values) are ignored.
 */
export async function releaseRemovedClaims(orgId: string, tripId: string, removed: string[]): Promise<void> {
  const ids = removed.map(r => (isReceiptRef(r) ? parseReceiptRef(r, orgId)?.publicId : undefined)).filter(Boolean) as string[]
  if (!ids.length) return
  await ReceiptUpload.updateMany({ orgId, publicId: { $in: ids }, claimedBy: tripId }, { $unset: { claimedBy: 1 } })
  const trip = await TravelRequest.findOne({ _id: tripId, orgId }).select('itineraryDocs').lean()
  const stillUsed = new Set((trip?.itineraryDocs || []).map(r => parseReceiptRef(r, orgId)?.publicId).filter(Boolean) as string[])
  const restore = ids.filter(id => stillUsed.has(id))
  if (restore.length) await ReceiptUpload.updateMany({ orgId, publicId: { $in: restore }, purpose: ITINERARY_PURPOSE, $or: [{ claimedBy: { $exists: false } }, { claimedBy: null }] }, { $set: { claimedBy: tripId } })
}
