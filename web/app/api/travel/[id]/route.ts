import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { connectDB } from '@/lib/db'
import TravelRequest from '@/models/TravelRequest'
import { writeAudit } from '@/lib/audit'
import { presentTravel, planDocsUpdate, resolveItineraryDocs, claimItineraryDocs, releaseUnreferencedClaims, releaseRemovedClaims } from '@/lib/travel/attachments'
import { readJson, apiError } from '@/lib/travel/http'
import { validateTravelPatch, MAX_ITINERARY_DOCS } from '@/lib/travel/validation'
import { getUser, listUsers } from '@/lib/auth'
import { selfApprovalCheck, SELF_APPROVAL_ERROR } from '@/lib/permissions'
import {
  getUserEmail,
  emailTravelForwardedToBoss,
  emailTravelDecision,
} from '@/lib/email'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return apiError(401, 'Unauthorized', 'unauthorized')
  if (!mongoose.isValidObjectId(params.id)) return apiError(404, 'Not found', 'not_found')
  await connectDB()
  const role = user?.role || 'employee'
  const tr = await TravelRequest.findOne({ _id: params.id, orgId }).lean()
  if (!tr) return apiError(404, 'Not found', 'not_found')
  if (role === 'employee' && (tr as unknown as { userId: string }).userId !== userId) {
    return apiError(403, 'Forbidden', 'forbidden')
  }
  return NextResponse.json(presentTravel(tr as never))
}

/** Matches the revision the caller read. Records that predate the token have none: they read (and match) as revision 0. */
const revisionIs = (n: number) => (n === 0 ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] } : { revision: n })
const conflict = (current?: number) => NextResponse.json({ error: 'This request was changed by someone else. Reload it and try again.', code: 'revision_conflict', ...(current !== undefined ? { currentRevision: current } : {}) }, { status: 409 })

/**
 * PATCH contract (see lib/travel/validation.ts):  { revision, status?, managerNote?, adminNote? }  or  { revision, itineraryDocs }
 *  - status changes: managers and admins only (employees → 403), the existing transition table, boss-only approve/reject at pending_admin,
 *    self-approval rules, notes: manager → managerNote only, admin → managerNote and adminNote.
 *  - itineraryDocs: the trip's OWNER only, and only while the trip is still pending_manager (the same window in which the owner may cancel it).
 *  - every successful write is a conditional update matched on the revision the caller read and bumps it; a stale caller gets 409 and changes nothing.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return apiError(401, 'Unauthorized', 'unauthorized')
  if (!mongoose.isValidObjectId(params.id)) return apiError(404, 'Not found', 'not_found')
  const role = user?.role || 'employee'
  const actorName = user?.fullName || user?.firstName || 'Manager'

  const parsed = await readJson(req)
  if ('response' in parsed) return parsed.response
  // Precedence is deliberately the pre-existing one: employees may not review (403) and another organisation's record is a plain 404 —
  // both decided BEFORE any field validation, so a request's content can never be used to probe either.
  const b = parsed.body as Record<string, unknown> | null
  const wantsDocs = !!b && typeof b === 'object' && !Array.isArray(b) && Object.prototype.hasOwnProperty.call(b, 'itineraryDocs')
  if (role === 'employee' && !wantsDocs) return apiError(403, 'Forbidden', 'forbidden')

  await connectDB()
  const tr = await TravelRequest.findOne({ _id: params.id, orgId })
  if (!tr) return apiError(404, 'Not found', 'not_found')
  const v = validateTravelPatch(parsed.body)
  if ('problems' in v) return NextResponse.json({ error: v.problems.error, fields: v.problems.fields, code: v.problems.code }, { status: v.problems.status })
  const docsOp = v.itineraryDocs !== undefined
  const current = typeof tr.revision === 'number' ? tr.revision : 0
  if (docsOp && tr.userId !== userId) return apiError(403, 'Forbidden', 'forbidden')
  // Cheap early check (no provider calls, no side effects). The conditional write below is what actually guarantees it.
  if (v.revision !== current) return conflict(current)

  /* ───────────── itinerary documents: add / replace / remove ───────────── */
  if (docsOp) {
    if (tr.status !== 'pending_manager') return NextResponse.json({ error: 'This request can no longer be edited.', code: 'not_editable' }, { status: 409 })
    const plan = planDocsUpdate(tr.toObject(), v.itineraryDocs!)
    if ('badIndex' in plan) return NextResponse.json({ error: 'Invalid travel update', fields: [`itineraryDocs[${plan.badIndex}]`], code: 'invalid_travel_request' }, { status: 400 })
    if (plan.slots.length > MAX_ITINERARY_DOCS) return NextResponse.json({ error: 'Invalid travel update', fields: ['itineraryDocs'], code: 'invalid_travel_request' }, { status: 400 })

    const tripId = String(tr._id); const ctx = { orgId, userId, claimant: tripId }
    const fresh = plan.slots.filter((x): x is Extract<typeof x, { kind: 'new' }> => x.kind === 'new')
    let newRefs: string[] = []; let newIds: string[] = []
    if (fresh.length) {
      const r = await resolveItineraryDocs(fresh.map(x => x.value), ctx)
      if ('status' in r) {
        const body = JSON.parse(JSON.stringify(r.body)) as { fields?: string[] }       // map the index inside `fresh` back to the caller's index
        if (body.fields) body.fields = body.fields.map(f => f.replace(/itineraryDocs\[(\d+)\]/, (_m, i) => `itineraryDocs[${fresh[Number(i)]?.desiredIndex ?? 0}]`))
        return NextResponse.json(body, { status: r.status })
      }
      // A "new" file that the trip ALREADY stores (kept or omitted) is not new: re-adding it would be a no-op that still bumps the revision and
      // writes misleading add/remove audit events. To keep a file, send its proxy path.
      const stored = new Set(tr.itineraryDocs || [])
      const dup = r.refs.findIndex(ref => stored.has(ref))
      if (dup >= 0) return NextResponse.json({ error: 'Invalid travel update', fields: [`itineraryDocs[${fresh[dup].desiredIndex}]`], code: 'invalid_travel_request' }, { status: 400 })
      // Claim the NEW files first (exclusive, atomic). The existing documents are released only after the write below has succeeded.
      if (!(await claimItineraryDocs(r.publicIds, ctx))) return NextResponse.json({ error: 'That document is already attached to another trip.', fields: ['itineraryDocs'], code: 'attachment_in_use' }, { status: 409 })
      newRefs = r.refs; newIds = r.publicIds
    }
    let k = 0
    const finalDocs = plan.slots.map(x => (x.kind === 'keep' ? x.value : newRefs[k++]))

    // The write: conditional on the revision (and on the trip still being editable). Anything else → nothing changed.
    const updated = await TravelRequest.findOneAndUpdate(
      { _id: tripId, orgId, userId, status: 'pending_manager', ...revisionIs(v.revision) },
      { $set: { itineraryDocs: finalDocs }, $inc: { revision: 1 } },
      { new: true },
    )
    if (!updated) {
      await releaseUnreferencedClaims(orgId, tripId, newIds)                              // only the claims THIS request acquired
      const fresh2 = await TravelRequest.findOne({ _id: tripId, orgId }).select('revision').lean()
      return conflict(typeof fresh2?.revision === 'number' ? fresh2.revision : 0)
    }
    await releaseRemovedClaims(orgId, tripId, plan.removed)
    const removedCount = plan.removed.length, addedCount = newRefs.length
    const base = { performedBy: userId, performedByName: tr.userName, targetId: tripId, targetType: 'travel_request' as const, orgId }
    if (addedCount) await writeAudit({ ...base, action: 'travel.attachments_added', metadata: { count: addedCount } })
    if (removedCount) await writeAudit({ ...base, action: 'travel.attachments_removed', metadata: { count: removedCount } })
    return NextResponse.json(presentTravel(updated.toObject()))
  }

  /* ───────────── status transition (+ notes) ───────────── */
  const status = v.status!
  // State machine
  const VALID_TRANSITIONS: Record<string, string[]> = {
    pending_manager: ['pending_admin', 'approved', 'rejected'],
    pending_admin:    ['approved', 'rejected', 'pending_manager'],
    approved:        [],
    rejected:        [],
    cancelled:       [],
  }
  if (!VALID_TRANSITIONS[tr.status]?.includes(status)) {
    return NextResponse.json({ error: `Cannot move from ${tr.status} to ${status}`, code: 'invalid_transition' }, { status: 409 })
  }
  // Boss-only actions on pending_admin
  if (tr.status === 'pending_admin' && (status === 'approved' || status === 'rejected') && role !== 'admin') {
    return apiError(403, 'Only the boss can approve at this stage', 'boss_only')
  }
  // Notes: a manager writes the manager note; the boss may write both.
  if (v.adminNote !== undefined && role !== 'admin') return NextResponse.json({ error: 'Only the boss can write the admin note', code: 'note_not_permitted', fields: ['adminNote'] }, { status: 403 })

  const check = selfApprovalCheck(userId, role, tr.userId)
  if (check.blocked) return apiError(403, SELF_APPROVAL_ERROR, 'self_approval_forbidden')
  const selfApproved = check.selfApproved

  const $set: Record<string, unknown> = { status }
  const $unset: Record<string, 1> = {}
  for (const k of ['managerNote', 'adminNote'] as const) { if (v[k] === undefined) continue; if (v[k] === null) $unset[k] = 1; else $set[k] = v[k] }
  const now = new Date()
  if (status === 'approved') { $set.approvedBy = userId; $set.approvedAt = now }
  if (status === 'rejected') { $set.rejectedBy = userId; $set.rejectedAt = now }

  // Conditional write: lands only if the record is still at the revision (and status) the caller read — two approvers acting on the
  // same revision get exactly one success; the other gets 409 and NOTHING (fields, notes, audit, notifications) is applied for it.
  const updated = await TravelRequest.findOneAndUpdate(
    { _id: params.id, orgId, status: tr.status, ...revisionIs(v.revision) },
    { $set, ...(Object.keys($unset).length ? { $unset } : {}), $inc: { revision: 1 } },
    { new: true },
  )
  if (!updated) {
    const latest = await TravelRequest.findOne({ _id: params.id, orgId }).select('revision').lean()
    return conflict(typeof latest?.revision === 'number' ? latest.revision : 0)
  }
  const note = v.managerNote ?? v.adminNote ?? undefined

  await writeAudit({
    action:          selfApproved ? `travel.${status}.self_approved` : `travel.${status}`,
    performedBy:     userId,
    performedByName: actorName,
    targetId:        params.id,
    targetType:      'travel_request',
    metadata:        { employeeName: updated.userName, destination: updated.destination, amount: updated.estimatedTotal, note, ...(selfApproved ? { selfApproved: true } : {}) },
    orgId,
  })

  // Notifications (fire-and-forget)
  if (status === 'pending_admin') {
    ;(async () => {
      try {
        const users = await listUsers({ limit: 500, orgId })
        const bosses = users.filter(u => u.role === 'admin')
        for (const b of bosses) {
          if (b.email) {
            emailTravelForwardedToBoss({
              orgId, bossEmail:    b.email,
              employeeName: updated.userName,
              purpose:      updated.purpose,
              destination:  updated.destination,
              departureDate:updated.departureDate,
              returnDate:   updated.returnDate,
              estimatedTotal:   updated.estimatedTotal,
              advanceRequested: updated.advanceRequested,
            })
          }
        }
      } catch { /* best-effort */ }
    })()
  }
  if (status === 'approved' || status === 'rejected') {
    getUserEmail(updated.userId).then(email => {
      if (email) emailTravelDecision({
        orgId, employeeEmail: email,
        status,
        purpose:       updated.purpose,
        destination:   updated.destination,
        departureDate: updated.departureDate,
        returnDate:    updated.returnDate,
        estimatedTotal:updated.estimatedTotal,
        note,
      })
    })
  }

  return NextResponse.json(presentTravel(updated.toObject() as never))
}

export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, orgId } = await getUser()
  if (!userId) return apiError(401, 'Unauthorized', 'unauthorized')
  if (!mongoose.isValidObjectId(params.id)) return apiError(404, 'Not found', 'not_found')
  await connectDB()
  const tr = await TravelRequest.findOne({ _id: params.id, orgId })
  if (!tr) return apiError(404, 'Not found', 'not_found')
  if (tr.userId !== userId) return apiError(403, 'Forbidden', 'forbidden')
  if (tr.status !== 'pending_manager') return apiError(409, 'Cannot cancel — already actioned', 'not_cancellable')
  // Atomic: cancelling and a concurrent review cannot both win (the loser sees 409). Bumps the revision like every other state change.
  const cancelled = await TravelRequest.findOneAndUpdate({ _id: params.id, orgId, userId, status: 'pending_manager' }, { $set: { status: 'cancelled' }, $inc: { revision: 1 } }, { new: true })
  if (!cancelled) return apiError(409, 'Cannot cancel — already actioned', 'not_cancellable')
  await writeAudit({
    action:          'travel.cancelled',
    performedBy:     userId,
    performedByName: tr.userName,
    targetId:        params.id,
    targetType:      'travel_request',
    metadata:        { destination: tr.destination, amount: tr.estimatedTotal },
    orgId,
  })
  return NextResponse.json({ success: true, _id: String(cancelled._id), status: 'cancelled', revision: typeof cancelled.revision === 'number' ? cancelled.revision : 0 })
}
