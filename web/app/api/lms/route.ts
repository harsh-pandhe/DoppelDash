import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { connectDB } from '@/lib/db'
import Leave from '@/models/Leave'
import LeaveBalance from '@/models/LeaveBalance'
import { emailLeaveSubmitted } from '@/lib/email'
import { getUser } from '@/lib/auth'
import { notifyTargetsFor } from '@/lib/notify-targets'
import { pick } from '@/lib/pick'
import { LEAVE_CREATE_FIELDS } from '@/lib/apiFields'
import mongoose from 'mongoose'
import { writeAudit } from '@/lib/audit'
import { findOverlappingLeave, type HalfDayPeriod } from '@/lib/leave/overlap'
import { claimMedicalDocs, parseMedicalDocsInput, presentLeave, releaseUnreferencedClaims, resolveMedicalDocs } from '@/lib/leave/attachments'

const DEFAULTS = { casual: 12, sick: 6, earned: 15, privilege: 2, restricted: 2 }

async function GET_handler(req: NextRequest) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  try {
    await connectDB()
    const { searchParams } = new URL(req.url)
    const filter: Record<string, unknown> = role === 'employee' ? { userId, orgId } : { orgId }
    const status = searchParams.get('status')
    const from   = searchParams.get('from')
    const to     = searchParams.get('to')
    if (status) filter.status = status
    if (from || to) {
      filter.startDate = {}
      if (from) (filter.startDate as Record<string, unknown>).$gte = new Date(from)
      if (to)   (filter.startDate as Record<string, unknown>).$lte = new Date(to)
    }
    const leaves = await Leave.find(filter).sort({ createdAt: -1 }).limit(200).lean()
    return NextResponse.json(leaves.map(l => presentLeave(l)))
  } catch (err) {
    console.error('[LMS GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function POST_handler(req: NextRequest) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid request', fields: ['body'] }, { status: 400 })

  // 11B: earned leave capped at 4 days per single application
  if (body.type === 'earned' && Number(body.days) > 4) {
    return NextResponse.json({ error: 'Earned leave is capped at 4 days per application.' }, { status: 400 })
  }

  if (body.type === 'sick' && Number(body.days) > 2 && !(Array.isArray(body.medicalDocs) && body.medicalDocs.length > 0)) {
    return NextResponse.json({ error: 'Medical docs required for sick leave > 2 days.' }, { status: 400 })
  }

  if (body.type in DEFAULTS) {
    const type = body.type as keyof typeof DEFAULTS
    const startDate = new Date(body.startDate)
    // An invalid date or non-numeric day count used to reach the balance aggregation and surface as a bare 500 (found by the live acceptance run).
    const badFields = [
      ...(Number.isNaN(startDate.getTime()) ? ['startDate'] : []),
      ...(Number.isNaN(new Date(body.endDate).getTime()) ? ['endDate'] : []),
      ...(!Number.isFinite(Number(body.days)) || Number(body.days) <= 0 || Number(body.days) > 366 ? ['days'] : []),
      ...(typeof body.reason !== 'string' || !body.reason.trim() ? ['reason'] : []),
    ]
    if (badFields.length) return NextResponse.json({ error: 'Invalid leave request', fields: badFields }, { status: 400 })
    const year = startDate.getFullYear()
    const yearStart = new Date(year, 0, 1)
    const yearEnd   = new Date(year + 1, 0, 1)

    const balanceDoc = await LeaveBalance.findOne({ userId, orgId, year }).lean()
    const entitlement = (balanceDoc as unknown as Record<string, number> | null)?.[type] ?? DEFAULTS[type]

    const usedAgg = await Leave.aggregate([
      { $match: { userId, orgId, type, status: { $in: ['approved', 'pending'] }, startDate: { $gte: yearStart, $lt: yearEnd } } },
      { $group: { _id: null, days: { $sum: '$days' } } },
    ])
    const used = usedAgg[0]?.days || 0

    if (used + Number(body.days) > entitlement) {
      return NextResponse.json({ error: `This would exceed your ${type} leave balance (${used}/${entitlement} already used or pending).` }, { status: 400 })
    }
  }

  // Date-range sanity (found by the live acceptance run: an end date before the start date was accepted with 201).
  // Overlap (owner decision P-01, approved 2026-10-25): the same user may not hold two pending/approved leaves covering the same day.
  // The only exception is a morning + afternoon half-day pair on one day, so a half-day may be declared with `isHalfDay` + `halfDayPeriod`.
  let halfDayPeriod: HalfDayPeriod | undefined
  {
    const start = new Date(body.startDate), end = new Date(body.endDate)
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end.getTime() < start.getTime()) {
      return NextResponse.json({ error: 'Invalid leave request', fields: ['endDate'] }, { status: 400 })
    }
    if (body.isHalfDay !== undefined && body.isHalfDay !== false) {
      const sameDay = Math.floor(start.getTime() / 86_400_000) === Math.floor(end.getTime() / 86_400_000)
      const bad = [
        ...(body.isHalfDay !== true ? ['isHalfDay'] : []),
        ...(body.halfDayPeriod !== 'morning' && body.halfDayPeriod !== 'afternoon' ? ['halfDayPeriod'] : []),
        ...(!sameDay ? ['endDate'] : []),
        ...(Number(body.days) !== 0.5 ? ['days'] : []),
      ]
      if (bad.length) return NextResponse.json({ error: 'Invalid leave request', fields: Array.from(new Set(bad)) }, { status: 400 })
      halfDayPeriod = body.halfDayPeriod
    }
    if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && await findOverlappingLeave(orgId, userId, { start, end, halfDayPeriod })) {
      return NextResponse.json({ error: 'You already have leave covering some of these dates.', code: 'leave_overlap' }, { status: 409 })
    }
  }

  const effectiveOrgId = orgId

  // Medical documents are PRIVATE, purpose-bound files (see lib/leave/attachments.ts). Only sick leave carries them; for any other type the
  // field is ignored (nothing is stored or claimed). Every value must be a server-issued, tenant-scoped, leave-purpose upload of THIS user.
  const leaveId = new mongoose.Types.ObjectId()
  let refs: string[] = []
  let publicIds: string[] = []
  if (body.type === 'sick') {
    const input = parseMedicalDocsInput(body.medicalDocs)
    if ('status' in input) return NextResponse.json(input.body, { status: input.status })
    if (input.values.length > 0) {
      const ctx = { orgId: effectiveOrgId, userId, claimant: String(leaveId) }
      const resolved = await resolveMedicalDocs(input.values, ctx)
      if ('status' in resolved) return NextResponse.json(resolved.body, { status: resolved.status })
      if (!(await claimMedicalDocs(resolved.publicIds, ctx))) return NextResponse.json({ error: 'That document is already attached to another record.', fields: ['medicalDocs'], code: 'attachment_in_use' }, { status: 409 })
      refs = resolved.refs; publicIds = resolved.publicIds
    }
  }

  let leave
  try {
    leave = await Leave.create({
      ...pick(body, LEAVE_CREATE_FIELDS),
      ...(halfDayPeriod ? { isHalfDay: true, halfDayPeriod } : {}),
      _id: leaveId,
      medicalDocs: refs,
      userId,
      userName: user?.fullName || user?.firstName || 'Unknown',
      orgId: effectiveOrgId,
      status: 'pending',
    })
  } catch (err) {
    await releaseUnreferencedClaims(effectiveOrgId, String(leaveId), publicIds).catch(() => undefined)
    if (err instanceof mongoose.Error.ValidationError || err instanceof mongoose.Error.CastError) return NextResponse.json({ error: 'Invalid leave request' }, { status: 400 })
    throw err
  }

  // Same contract as expense.submitted / travel.submitted (and the audited leave decisions): the submission itself is recorded, awaited.
  // Metadata is deliberately limited to non-sensitive facts: no reason text and no document references.
  await writeAudit({
    action: 'leave.submitted',
    performedBy: userId,
    performedByName: user?.fullName || user?.firstName || user?.email || userId,
    targetId: String(leave._id),
    targetType: 'leave',
    metadata: { type: leave.type, days: leave.days, startDate: leave.startDate, endDate: leave.endDate, medicalDocCount: refs.length },
    orgId: effectiveOrgId,
  })

  // Notify reporting manager (+ boss); fallback to all managers if no chain set
  ;(async () => {
    try {
      const recipients = await notifyTargetsFor(userId, effectiveOrgId)
      const employeeName = user?.fullName || user?.firstName || 'An employee'
      for (const email of recipients) {
        emailLeaveSubmitted({
          orgId, managerEmail: email,
          employeeName,
          leaveType: body.type,
          days: body.days,
          reason: body.reason || '',
        })
      }
    } catch { /* best-effort */ }
  })()

  return NextResponse.json(presentLeave(leave.toObject()), { status: 201 })
}

export const GET = dbGuard(GET_handler)
export const POST = dbGuard(POST_handler)
