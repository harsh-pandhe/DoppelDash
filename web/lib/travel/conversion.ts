/**
 * Trip → expense conversion (Slice 4).
 *
 * TOPOLOGY. The supported/tested MongoDB is a STANDALONE server (no replica set), where multi-document transactions do not exist
 * ("Transaction numbers are only allowed on a replica set member or mongos"). So atomicity is NOT claimed. The guarantee is built from
 * single-document atomic writes, database uniqueness and a deterministic, idempotent, resumable protocol:
 *
 *   state on the trip (`conversion`):   (none) ──reserve──▶ reserved ──link──▶ linked ──finish──▶ complete
 *
 *   1. RESERVE   one conditional findOneAndUpdate (org, owner, status approved, no expenseId, no live lease) writes a 30 s lease.
 *                A lost race waits (bounded) and then resolves to the winner's expense; an expired lease can be taken over.
 *   2. EXPENSE   the expense has a DETERMINISTIC _id (hash of org+trip) AND `travelConversionOf`, covered by a partial unique index
 *                (orgId, travelConversionOf). A second insert — from a racing request or a takeover after a crash — gets E11000 and adopts
 *                the existing row. Duplicates are impossible even if step 1 were bypassed.
 *   3. LINK      one conditional update (status approved, expenseId still absent): sets `expenseId`, state=linked and `$inc revision`.
 *                It can succeed once, so the revision advances exactly once per logical conversion.
 *   4. FINISH    idempotent: marks the transferred files (`ReceiptUpload.transferredTo`), writes the exactly-once audit entries
 *                (unique `dedupeKey` index) and sets state=complete. Any request that finds `expenseId` set and state≠complete re-runs it.
 *
 * Every step is safe to repeat and safe to run twice at the same time, so a crash at ANY point is repaired by simply calling again; there
 * is no state that needs a human. A handled failure before the expense exists releases the reservation at once; a crash leaves it to expire.
 * Known limit: a crash between steps leaves the trip in `reserved`/`linked` until the next call (nothing is repaired in the background),
 * and the expense row may exist without a link until then — it is found again through its unique key, never duplicated.
 */
import { createHash, randomUUID } from 'crypto'
import mongoose from 'mongoose'
import TravelRequest from '@/models/TravelRequest'
import Expense from '@/models/Expense'
import ReceiptUpload from '@/models/ReceiptUpload'
import { writeAuditOnce } from '@/lib/audit'
import { attachmentsForExpense, ITINERARY_PURPOSE } from '@/lib/travel/attachments'
import { parseReceiptRef } from '@/lib/uploads/attachmentStorage'
import { presentExpense } from '@/lib/expenses/receipts'
import { hit, stall } from '@/lib/travel/failpoints'

export const LEASE_MS = 30_000
const waitMs = () => Number(process.env.TRAVEL_CONVERSION_WAIT_MS) || 8_000
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
const NO_EXPENSE = { $in: [null, ''] }

const MODE_CATEGORY: Record<string, string> = { train: 'travel', flight: 'flight', bus: 'travel', taxi: 'taxi', own_vehicle: 'travel', other: 'misc' }

/** The id of the one expense a trip can ever generate. Deterministic, so every request/takeover addresses the same row. */
export function expenseIdFor(orgId: string, tripId: string): mongoose.Types.ObjectId {
  return new mongoose.Types.ObjectId(createHash('sha256').update(`travel-expense|${orgId}|${tripId}`).digest('hex').slice(0, 24))
}

export interface ConversionResult { status: number; body: Record<string, unknown>; headers?: Record<string, string> }
const fail = (status: number, error: string, code: string, headers?: Record<string, string>): ConversionResult => ({ status, body: { error, code }, headers })
const CONFLICT = () => fail(409, 'This trip can’t be converted to an expense right now. Please contact your administrator.', 'conversion_conflict')

type TripDoc = {
  _id: unknown; orgId: string; userId: string; userName: string; status: string; purpose: string; destination: string
  departureDate: Date; returnDate: Date; legs?: { mode: string; from: string; to: string; date: Date; estimatedCost?: number }[]
  accommodation?: { required?: boolean; city?: string; checkIn?: Date; estimatedCost?: number }
  itineraryDocs?: string[]; expenseId?: string; conversion?: { state: string; token?: string; leaseUntil?: Date }
}

export async function convertTrip(ctx: { tripId: string; orgId: string; userId: string; failpoint?: string }): Promise<ConversionResult> {
  const { tripId, orgId, userId, failpoint } = ctx
  const first = await TravelRequest.findOne({ _id: tripId, orgId }).lean<TripDoc>()
  if (!first) return fail(404, 'Not found', 'not_found')
  if (first.userId !== userId) return fail(403, 'Forbidden', 'forbidden')
  if (first.status !== 'approved') return fail(409, 'Travel not approved', 'travel_not_approved')

  const started = Date.now()
  const token = randomUUID()
  for (;;) {
    const tr = await TravelRequest.findOne({ _id: tripId, orgId }).lean<TripDoc>()
    if (!tr || tr.userId !== userId) return fail(404, 'Not found', 'not_found')
    if (tr.status !== 'approved') return fail(409, 'Travel not approved', 'travel_not_approved')
    if (tr.expenseId) return finish(tr, orgId, failpoint, false)               // already converted (or linked and awaiting completion): idempotent
    if (tr.returnDate > new Date()) return fail(409, 'Trip not finished yet', 'trip_not_finished')

    const now = new Date()
    const reserved = await TravelRequest.findOneAndUpdate(
      {
        _id: tripId, orgId, userId, status: 'approved', expenseId: NO_EXPENSE,
        $or: [{ 'conversion.leaseUntil': { $exists: false } }, { 'conversion.leaseUntil': null }, { 'conversion.leaseUntil': { $lt: now } }],
      },
      { $set: { conversion: { state: 'reserved', token, leaseUntil: new Date(now.getTime() + LEASE_MS), startedAt: now } } },
      { new: true },
    ).lean<TripDoc>()
    if (reserved) return runReserved(reserved, orgId, token, failpoint)

    // Someone else holds a live lease: wait (bounded) for their result instead of racing or failing a double-tap.
    if (Date.now() - started >= waitMs()) return fail(409, 'This trip is already being converted. Please try again in a moment.', 'conversion_in_progress', { 'Retry-After': '2' })
    await sleep(100)
  }
}

/** Holder of the lease: make sure the expense exists, then link and finish. */
async function runReserved(tr: TripDoc, orgId: string, token: string, failpoint: string | undefined): Promise<ConversionResult> {
  const tripId = String(tr._id)
  const release = () => TravelRequest.updateOne({ _id: tripId, orgId, 'conversion.token': token, 'conversion.state': 'reserved', expenseId: NO_EXPENSE }, { $unset: { conversion: 1 } }).catch(() => undefined)
  let created = false
  try {
    hit(failpoint, 'after_reserve')
    let expense = await Expense.findOne({ orgId, travelConversionOf: tripId })       // a previous (crashed) holder may have inserted it
    if (!expense) {
      // Itinerary documents are NEVER copied as raw strings: only references the manifest + provider still confirm for THIS trip are transferred.
      // Anything else (legacy strings, foreign/forged/unverifiable references) stays on the trip, untouched, and is reported — not silently dropped.
      const att = await attachmentsForExpense(tr, orgId)
      if (att.unavailable) { await release(); return fail(503, 'We couldn’t verify the trip documents right now. Please try again in a moment.', 'attachment_verification_unavailable') }
      if (failpoint === 'expense_insert_error') throw new Error('simulated insert failure')
      const lineItems = (tr.legs || []).map(l => ({ description: `${l.mode} · ${l.from} → ${l.to}`, amount: l.estimatedCost || 0, date: l.date, category: MODE_CATEGORY[l.mode] || 'travel', status: 'pending' as const }))
      if (tr.accommodation?.required && tr.accommodation.estimatedCost) {
        lineItems.push({ description: `Accommodation · ${tr.accommodation.city || tr.destination}`, amount: tr.accommodation.estimatedCost, date: tr.accommodation.checkIn || tr.departureDate, category: 'hotel', status: 'pending' as const })
      }
      try {
        expense = await Expense.create({
          _id: expenseIdFor(orgId, tripId), userId: tr.userId, userName: tr.userName, orgId,
          title: `Travel — ${tr.destination}`, reason: tr.purpose, amount: lineItems.reduce((a, l) => a + l.amount, 0),
          travelFrom: tr.legs?.[0]?.from, travelTo: tr.destination, startDate: tr.departureDate, endDate: tr.returnDate,
          lineItems, hasLineItems: lineItems.length > 0, travelRequestId: tripId, travelConversionOf: tripId, receipts: att.transferred, status: 'pending_manager',
        })
        created = true
      } catch (err) {
        if ((err as { code?: number })?.code !== 11000) throw err
        expense = await Expense.findOne({ orgId, travelConversionOf: tripId })       // lost the insert race: adopt the winner's row
        if (!expense) throw err
      }
    }
    hit(failpoint, 'after_expense')
    await stall(failpoint, 'after_expense')

    const link = await TravelRequest.findOneAndUpdate(
      { _id: tripId, orgId, userId: tr.userId, status: 'approved', expenseId: NO_EXPENSE },
      { $set: { expenseId: String(expense._id), 'conversion.state': 'linked' }, $inc: { revision: 1 } },
      { new: true },
    ).lean<TripDoc>()
    const linked = link ?? (await TravelRequest.findOne({ _id: tripId, orgId }).lean<TripDoc>())     // lost the link race: whoever won linked the SAME deterministic row
    if (!linked || linked.expenseId !== String(expense._id)) return CONFLICT()
    hit(failpoint, 'after_link')
    return await finish(linked, orgId, failpoint, created)
  } catch (err) {
    if ((err as Error)?.name === 'FailpointCrash') throw err                       // a simulated crash: no cleanup, like a dead process
    await release()                                                                // nothing is linked yet: free the lease so the user can retry at once
    console.error('[travel-conversion] failed', (err as Error)?.name)
    return fail(500, 'We couldn’t create the expense. Please try again.', 'conversion_failed')
  }
}

/** Idempotent completion for a trip whose `expenseId` is set; also the whole path of a plain retry. */
async function finish(tr: TripDoc, orgId: string, failpoint: string | undefined, created: boolean): Promise<ConversionResult> {
  const tripId = String(tr._id)
  // The association is verified from the database, never from the caller: same organisation, same trip, same owner.
  const expense = mongoose.isValidObjectId(tr.expenseId) ? await Expense.findOne({ _id: tr.expenseId, orgId }) : null
  if (!expense || expense.userId !== tr.userId || (expense.travelRequestId && expense.travelRequestId !== tripId)) return CONFLICT()

  const docs = tr.itineraryDocs || []
  const receipts = expense.receipts || []
  const excluded = Math.max(0, docs.length - receipts.length)                      // receipts ⊆ the trip's documents, so this is derivable on every retry
  // `conversion` absent = converted before Slice 4: return the expense, do not invent history. Otherwise complete whatever is pending.
  if (tr.conversion && tr.conversion.state !== 'complete') {
    const actor = { performedBy: tr.userId, performedByName: tr.userName, targetId: tripId, targetType: 'travel_request' as const, orgId }
    try {
      const ids = receipts.map(r => parseReceiptRef(r, orgId)?.publicId).filter(Boolean) as string[]
      if (ids.length) await ReceiptUpload.updateMany({ orgId, publicId: { $in: ids }, purpose: ITINERARY_PURPOSE, claimedBy: tripId }, { $set: { transferredTo: String(expense._id) } })
      hit(failpoint, 'after_mark')
      if (failpoint === 'audit_error') throw new Error('simulated audit failure')
      if (docs.length) await writeAuditOnce({ ...actor, action: 'travel.attachments_converted', dedupeKey: `travel.attachments_converted|${tripId}`, metadata: { transferred: receipts.length, excluded, expenseId: String(expense._id) } })
      hit(failpoint, 'after_audit_attachments')
      await writeAuditOnce({ ...actor, action: 'travel.expense_created', dedupeKey: `travel.expense_created|${tripId}`, metadata: { expenseId: String(expense._id), transferred: receipts.length, excluded } })
      hit(failpoint, 'after_audit')
      await TravelRequest.updateOne({ _id: tripId, orgId, expenseId: String(expense._id) }, { $set: { 'conversion.state': 'complete', 'conversion.completedAt': new Date() } })
    } catch (err) {
      if ((err as Error)?.name === 'FailpointCrash') throw err
      console.error('[travel-conversion] completion failed', (err as Error)?.name)
      return fail(503, 'Your expense draft was created, but we couldn’t finish recording it. Please try again to complete it.', 'conversion_incomplete')
    }
  }
  return { status: created ? 201 : 200, body: { ...presentExpense(expense.toObject()), ...(excluded ? { attachmentsExcluded: excluded } : {}) } }
}
