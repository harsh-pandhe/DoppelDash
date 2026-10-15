import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import TravelRequest from '@/models/TravelRequest'
import { getUser } from '@/lib/auth'
import { emailTravelSubmitted } from '@/lib/email'
import { notifyTargetsFor } from '@/lib/notify-targets'
import mongoose from 'mongoose'
import { writeAudit, writeAuditOnce } from '@/lib/audit'
import { presentTravel, resolveItineraryDocs, claimItineraryDocs, releaseUnreferencedClaims, tripIdFor } from '@/lib/travel/attachments'
import { validateTravelCreate } from '@/lib/travel/validation'
import { listPage, parseListParams } from '@/lib/travel/pagination'
import { readJson, apiError } from '@/lib/travel/http'

/**
 * GET /api/travel — newest first (createdAt DESC, _id DESC), keyset-paginated. Employees see their own trips; managers and admins the whole
 * organisation (organisation always from the session; scoping happens in the query, before any limit).
 *   • with `limit` and/or `cursor`  → { items, limit, hasMore, nextCursor? }   (limit 1–100, default 50)
 *   • with neither (older clients)  → the legacy bare array (≤ 200 items). When it is cut short the response says so in the headers
 *     `X-Has-More: true` and `X-Next-Cursor`, so truncation is never silent.
 *   • `status` = all | pending_manager | pending_admin | approved | rejected | cancelled ; `sort` = newest.
 * No total count is returned (no client needs one; an exact count would scan the tenant's rows).
 */
export async function GET(req: NextRequest) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return apiError(401, 'Unauthorized', 'unauthorized')
  const role = user?.role || 'employee'
  const manager = role === 'manager' || role === 'admin'

  const params = parseListParams(new URL(req.url).searchParams)
  if ('code' in params) return apiError(400, params.error, params.code, { fields: params.fields })
  await connectDB()
  const page = await listPage({ orgId, userId, manager, status: params.status }, params)
  if ('invalidCursor' in page) return apiError(400, 'Invalid cursor', 'invalid_cursor', { fields: ['cursor'] })
  const items = page.rows.map(r => presentTravel(r as { _id: unknown }))
  if (params.paged) return NextResponse.json({ items, limit: params.limit, hasMore: page.hasMore, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) })
  return NextResponse.json(items, page.hasMore ? { headers: { 'X-Has-More': 'true', 'X-Next-Cursor': page.nextCursor || '' } } : undefined)
}

export async function POST(req: NextRequest) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return apiError(401, 'Unauthorized', 'unauthorized')
  const userName = user?.fullName || user?.firstName || 'Employee'

  const parsed = await readJson(req)
  if ('response' in parsed) return parsed.response
  const checked = validateTravelCreate(parsed.body)
  if ('problems' in checked) return NextResponse.json(checked.problems, { status: 400 })
  const { data, clientRequestId, requestHash } = checked

  await connectDB()
  const effectiveOrgId = orgId
  const actorName = user?.fullName || user?.firstName || user?.email || userId

  // The submission audit is part of the creation: it is written for a new record AND (idempotently, via a unique index) when a
  // retry replays an existing one — so a crash/failure between "record created" and "audit written" is healed by the client's retry.
  const audit = (tr: { _id: unknown; userName: string; destination: string; estimatedTotal: number }) =>
    writeAuditOnce({
      action: 'travel.submitted', performedBy: userId, performedByName: actorName, targetId: String(tr._id), targetType: 'travel_request', orgId: effectiveOrgId,
      metadata: { employeeName: tr.userName, destination: tr.destination, amount: tr.estimatedTotal },
    })
  const auditFailed = () => NextResponse.json({ error: 'The request was saved but could not be recorded yet. Please retry the same submission.', code: 'audit_failed' }, { status: 500 })

  // Replay of an existing logical request (same organisation + user + key).
  const replay = async (prior: { requestHash?: string; _id: unknown; userName: string; destination: string; estimatedTotal: number }) => {
    if (prior.requestHash !== requestHash) {
      return NextResponse.json({ error: 'This idempotency key was already used with a different request.', fields: ['clientRequestId'], code: 'idempotency_key_conflict' }, { status: 409 })
    }
    try { await audit(prior) } catch (err) { console.error('[travel] audit failed on replay', (err as Error)?.name); return auditFailed() }
    return NextResponse.json(presentTravel(prior as never), { status: 200 })
  }

  if (clientRequestId) {
    const prior = await TravelRequest.findOne({ orgId: effectiveOrgId, userId, clientRequestId }).lean()
    if (prior) return replay(prior as never)
  } else {
    // No key: a best-effort double-tap guard (same user, identical validated request within 10 s → 409, like Expenses).
    // It is NOT race-proof by design; only a key gives database-enforced uniqueness.
    const dup = await TravelRequest.findOne({ orgId: effectiveOrgId, userId, requestHash, createdAt: { $gte: new Date(Date.now() - 10_000) } }).lean()
    if (dup) {
      try { await audit(dup as never) } catch (err) { console.error('[travel] audit failed on duplicate', (err as Error)?.name); return auditFailed() }
      return NextResponse.json({ error: 'This travel request was just submitted. Refresh to see it.', duplicateOf: String((dup as { _id: unknown })._id), code: 'duplicate_submission' }, { status: 409 })
    }
  }

  // Itinerary documents: resolved against the private-attachment contract and EXCLUSIVELY claimed before the trip is written.
  // Nothing is claimed if any value fails; a failed claim/write releases only what THIS request took.
  const claimant = tripIdFor(effectiveOrgId, userId, clientRequestId)
  const claimCtx = { orgId: effectiveOrgId, userId, claimant: String(claimant) }
  let refs: string[] = []; let publicIds: string[] = []
  if (data.itineraryDocs.length) {
    const r = await resolveItineraryDocs(data.itineraryDocs, claimCtx)
    if ('status' in r) return NextResponse.json(r.body, { status: r.status })
    if (!(await claimItineraryDocs(r.publicIds, claimCtx))) return NextResponse.json({ error: 'That document is already attached to another trip.', fields: ['itineraryDocs'], code: 'attachment_in_use' }, { status: 409 })
    refs = r.refs; publicIds = r.publicIds
  }

  let tr
  try {
    tr = await TravelRequest.create({
      _id: claimant,
      userId, userName, orgId: effectiveOrgId,
      ...data,
      itineraryDocs: refs,
      status: 'pending_manager',
      requestHash,
      ...(clientRequestId ? { clientRequestId } : {}),
    })
  } catch (err) {
    // Two concurrent submits with the same key: the unique index lets exactly one win; the other replays the winner.
    if ((err as { code?: number })?.code === 11000 && clientRequestId) {
      const prior = await TravelRequest.findOne({ orgId: effectiveOrgId, userId, clientRequestId }).lean()
      if (prior) { await releaseUnreferencedClaims(effectiveOrgId, String(claimant), publicIds); return replay(prior as never) }
    }
    await releaseUnreferencedClaims(effectiveOrgId, String(claimant), publicIds)
    if (err instanceof mongoose.Error.ValidationError) return NextResponse.json({ error: 'Invalid travel request', fields: Object.keys(err.errors), code: 'invalid_travel_request' }, { status: 400 })
    throw err
  }

  try { await audit(tr) } catch (err) { console.error('[travel] audit failed', (err as Error)?.name); return auditFailed() }
  if (refs.length) await writeAudit({ action: 'travel.attachments_added', performedBy: userId, performedByName: actorName, targetId: String(tr._id), targetType: 'travel_request', orgId: effectiveOrgId, metadata: { count: refs.length } })

  // Notify reporting manager (+ boss); fallback to all managers if no chain set
  ;(async () => {
    try {
      const recipients = await notifyTargetsFor(userId, effectiveOrgId)
      for (const email of recipients) {
        emailTravelSubmitted({
          orgId, managerEmail: email,
          employeeName: userName,
          purpose: tr.purpose, destination: tr.destination,
          departureDate: tr.departureDate,
          returnDate:    tr.returnDate,
          estimatedTotal:   tr.estimatedTotal,
          advanceRequested: tr.advanceRequested,
        })
      }
    } catch { /* best-effort */ }
  })()

  return NextResponse.json(presentTravel(tr.toObject()), { status: 201 })
}
