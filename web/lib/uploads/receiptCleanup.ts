/**
 * Abandoned-receipt cleanup (see docs/RECEIPT_STORAGE_AND_OCR.md §11).
 *
 * Scope is the `ReceiptUpload` manifest ONLY (rows the server itself created when it issued a receipt ticket). The job never
 * lists the provider, never accepts ids/folders from a request, and re-validates every row against the exact receipt namespace
 * `doppeldash/<orgId>/receipts/<id>` before touching the provider. Nothing else in the cloud (travel/leave documents, profile
 * images, logos, mail images, payment proof, other tenants) can be reached.
 *
 * Safety model:
 *  - age: only rows whose `nextCheckAt` (>= issuedAt + 24h) has passed are considered;
 *  - attach-vs-cleanup: both sides move the row with an atomic conditional update. Attach needs state issued|attached and
 *    sets `attached`; cleanup needs state issued|attached and sets `deleting`. Exactly one wins. After claiming, cleanup
 *    still checks the authoritative Expense records and releases the row if any expense references the asset;
 *  - every failure (DB read, provider call) releases the row for a later retry and NEVER deletes;
 *  - bounded: at most `limit` rows and `maxMs` of work per run; reruns are idempotent (deleted rows are gone, a missing
 *    provider asset counts as deleted).
 * Logs contain aggregate counts and error classes only — no ids, URLs, credentials or receipt data.
 */
import ReceiptUpload from '@/models/ReceiptUpload'
import Expense from '@/models/Expense'
import TravelRequest from '@/models/TravelRequest'
import Leave from '@/models/Leave'
import { ALLOWED_FORMATS, destroyReceiptAsset, formatsForMime, storageConfig, tenantFolder } from '@/lib/uploads/attachmentStorage'

export const MIN_AGE_MS = 24 * 3600_000                 // hard floor: configuration can never lower it
export const RECHECK_REFERENCED_MS = 7 * 24 * 3600_000  // referenced rows are looked at again once a week
export const RETRY_MS = 3600_000                        // failed rows are retried after an hour
export const LEASE_MS = 10 * 60_000
export const DEFAULT_LIMIT = 100
export const MAX_LIMIT = 500

export interface CleanupOptions { apply: boolean; limit?: number; maxMs?: number; cursor?: string | null; now?: Date }
export interface CleanupReport {
  mode: 'dry-run' | 'apply'
  examined: number; eligible: number; deleted: number; alreadyGone: number; skippedReferenced: number; failed: number
  /** True when more rows may be due (call again). */
  more: boolean
  /** Dry-run pagination cursor (opaque; apply mode needs none because processed rows leave the due set). */
  nextCursor: string | null
}

const refsOf = (publicId: string) => ALLOWED_FORMATS.map(f => `cld:${publicId}.${f}`)

/** Strict namespace check: the stored id must be exactly `doppeldash/<orgId>/receipts/<random>` for the row's own tenant. */
export function isReceiptNamespaceId(orgId: string, publicId: string): boolean {
  if (!orgId || typeof publicId !== 'string') return false
  const prefix = tenantFolder(orgId, 'receipt') + '/'
  return publicId.startsWith(prefix) && /^[A-Za-z0-9_-]{8,64}$/.test(publicId.slice(prefix.length))
}

export async function isReferenced(orgId: string, publicId: string): Promise<boolean> {
  const refs = refsOf(publicId)
  if (await Expense.exists({ orgId, $or: [{ receipts: { $in: refs } }, { 'lineItems.receiptUrl': { $in: refs } }] })) return true
  // Travel itinerary documents are references too: the cleanup must never delete a file a trip still uses.
  if (await TravelRequest.exists({ orgId, itineraryDocs: { $in: refs } })) return true
  // Leave medical documents too (sensitive; the cleanup must never delete one a leave still references).
  return !!(await Leave.exists({ orgId, medicalDocs: { $in: refs } }))
}

export async function runReceiptCleanup(opts: CleanupOptions): Promise<CleanupReport> {
  const now = opts.now ?? new Date()
  const limit = Math.max(1, Math.min(MAX_LIMIT, Math.floor(opts.limit ?? DEFAULT_LIMIT)))
  const deadline = Date.now() + (opts.maxMs ?? 40_000)
  const rep: CleanupReport = { mode: opts.apply ? 'apply' : 'dry-run', examined: 0, eligible: 0, deleted: 0, alreadyGone: 0, skippedReferenced: 0, failed: 0, more: false, nextCursor: null }
  const cfg = storageConfig()
  if (opts.apply && !cfg.signed) { rep.failed = 0; return rep } // no provider access → nothing can be deleted

  const due = { state: { $in: ['issued', 'attached', 'rejected'] }, nextCheckAt: { $lte: now } }
  // Never even consider a row younger than the floor, whatever nextCheckAt says (defence in depth).
  const old = { issuedAt: { $lte: new Date(now.getTime() - MIN_AGE_MS) } }

  if (!opts.apply) {
    const q: Record<string, unknown> = { ...due, ...old }
    if (opts.cursor && /^[a-f0-9]{24}$/i.test(opts.cursor)) q._id = { $gt: opts.cursor }
    let rows
    try { rows = await ReceiptUpload.find(q).sort({ _id: 1 }).limit(limit + 1).lean() } catch { rep.failed++; return rep }
    rep.more = rows.length > limit
    for (const r of rows.slice(0, limit)) {
      rep.examined++
      if (!isReceiptNamespaceId(r.orgId, r.publicId)) { rep.failed++; continue }
      try { if (await isReferenced(r.orgId, r.publicId)) rep.skippedReferenced++; else rep.eligible++ } catch { rep.failed++ }
    }
    if (rep.more) rep.nextCursor = String(rows[limit - 1]._id)
    return rep
  }

  const release = (id: unknown, state: 'issued' | 'attached' | 'rejected', nextMs: number, fail: boolean) =>
    ReceiptUpload.updateOne({ _id: id as never, state: 'deleting' }, { $set: { state, nextCheckAt: new Date(now.getTime() + nextMs) }, $unset: { leaseUntil: 1 }, ...(fail ? { $inc: { failures: 1 } } : {}) }).catch(() => undefined)

  while (rep.examined < limit && Date.now() < deadline) {
    // Atomic claim: wins only if attach has not (yet) taken the row. A crashed run's expired lease is reclaimable.
    let row
    try {
      row = await ReceiptUpload.findOneAndUpdate(
        { $or: [{ ...due, ...old }, { state: 'deleting', leaseUntil: { $lte: now }, ...old }] },
        { $set: { state: 'deleting', leaseUntil: new Date(now.getTime() + LEASE_MS) } },
        { sort: { nextCheckAt: 1 }, new: false },
      ).lean()
    } catch { rep.failed++; break }
    if (!row) break
    rep.examined++
    const prev: 'issued' | 'attached' | 'rejected' = row.state === 'attached' ? 'attached' : row.state === 'rejected' ? 'rejected' : 'issued'
    if (!isReceiptNamespaceId(row.orgId, row.publicId)) { rep.failed++; await release(row._id, prev, 365 * 24 * 3600_000, true); continue }
    try {
      if (await isReferenced(row.orgId, row.publicId)) {
        rep.skippedReferenced++
        await release(row._id, 'attached', RECHECK_REFERENCED_MS, false)
        continue
      }
    } catch { rep.failed++; await release(row._id, prev, RETRY_MS, true); continue }
    rep.eligible++
    const res = await destroyReceiptAsset(row.publicId, row.orgId, cfg)
    if (res === 'error') { rep.failed++; await release(row._id, prev, RETRY_MS, true); continue }
    if (res === 'not_found') rep.alreadyGone++; else rep.deleted++
    await ReceiptUpload.deleteOne({ _id: row._id, state: 'deleting' }).catch(() => { rep.failed++ })
  }
  try { rep.more = !!(await ReceiptUpload.exists({ ...due, ...old })) } catch { rep.more = true }
  return rep
}

/** Records a freshly issued receipt ticket. Throws on DB failure: the caller must then refuse the ticket (fail closed). */
export async function recordReceiptTicket(orgId: string, publicId: string, declaredMime?: string, meta: { purpose?: 'expense_receipt' | 'travel_itinerary' | 'leave_medical'; userId?: string } = {}, now = new Date()) {
  await ReceiptUpload.create({ orgId, publicId, state: 'issued', issuedAt: now, nextCheckAt: new Date(now.getTime() + MIN_AGE_MS), ...(declaredMime ? { declaredMime } : {}), ...(meta.purpose ? { purpose: meta.purpose } : {}), ...(meta.userId ? { userId: meta.userId } : {}) })
}

/** The type declared when this upload's ticket was issued (server-side record), or null for untracked/legacy uploads. */
export async function declaredFormatsFor(orgId: string, publicId: string): Promise<string[] | null> {
  const row = await ReceiptUpload.findOne({ orgId, publicId }).select('declaredMime').lean()
  return row?.declaredMime ? formatsForMime(row.declaredMime) : null
}

/** A file that failed verification can never be attached (claim refuses 'rejected'); the cleanup job retries its deletion. */
export async function markReceiptRejected(orgId: string, publicId: string) {
  await ReceiptUpload.updateOne({ orgId, publicId, state: { $in: ['issued', 'attached'] } }, { $set: { state: 'rejected' } })
}

/**
 * Called at attach time, before the expense is written. Atomically moves issued|attached → attached (pushing the next
 * cleanup check out by another 24h). Returns false when cleanup has already claimed the row — the attach must be refused.
 * Rows without a manifest entry (tickets issued before the manifest existed) are allowed, and untracked.
 */
export async function claimReceiptForAttach(orgId: string, publicId: string, now = new Date()): Promise<boolean> {
  const upd = await ReceiptUpload.findOneAndUpdate(
    { orgId, publicId, state: { $in: ['issued', 'attached'] }, purpose: { $nin: ['travel_itinerary', 'leave_medical'] } },   // a travel or leave file is never claimable as an expense receipt
    { $set: { state: 'attached', attachedAt: now, nextCheckAt: new Date(now.getTime() + MIN_AGE_MS) } },
  ).lean()
  if (upd) return true
  return !(await ReceiptUpload.exists({ orgId, publicId })) // no row at all → legacy/untracked; row in 'deleting' → refuse
}
