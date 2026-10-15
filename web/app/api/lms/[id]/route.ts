import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { connectDB } from '@/lib/db'
import Leave from '@/models/Leave'
import LeaveBalance from '@/models/LeaveBalance'
import { writeAudit } from '@/lib/audit'
import { getUserEmail, emailLeaveStatusChanged } from '@/lib/email'
import { getUser } from '@/lib/auth'
import { pick } from '@/lib/pick'
import { selfApprovalCheck, SELF_APPROVAL_ERROR } from '@/lib/permissions'
import { LEAVE_REVIEW_FIELDS } from '@/lib/apiFields'
import { disposeLeaveDocs, presentLeave, reserveLeaveDocs, restoreLeaveDocs } from '@/lib/leave/attachments'

const DEFAULTS = { casual: 12, sick: 6, earned: 15, privilege: 2, restricted: 2 }

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!mongoose.isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await connectDB()
  const role = user?.role || 'employee'
  const leave = await Leave.findOne({ _id: params.id, orgId }).lean()
  if (!leave) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (role === 'employee' && (leave as unknown as { userId: string }).userId !== userId)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json(presentLeave(leave as never))
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!mongoose.isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const role = user?.role || 'employee'
  if (role === 'employee') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await connectDB()
  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid request', fields: ['body'] }, { status: 400 })

  const existingLeave = await Leave.findOne({ _id: params.id, orgId })
  if (!existingLeave) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let selfApproved = false
  if (body.status !== undefined && body.status !== existingLeave.status) {
    const VALID_TRANSITIONS: Record<string, string[]> = {
      pending:  ['approved', 'rejected'],
      approved: [],
      rejected: [],
    }
    if (!VALID_TRANSITIONS[existingLeave.status]?.includes(body.status)) {
      return NextResponse.json({ error: `Cannot move from ${existingLeave.status} to ${body.status}` }, { status: 409 })
    }

    const check = selfApprovalCheck(userId, role, existingLeave.userId)
    if (check.blocked) return NextResponse.json({ error: SELF_APPROVAL_ERROR }, { status: 403 })
    selfApproved = check.selfApproved

    if (body.status === 'approved' && existingLeave.type in DEFAULTS) {
      const type = existingLeave.type as keyof typeof DEFAULTS
      const year = existingLeave.startDate.getFullYear()
      const yearStart = new Date(year, 0, 1)
      const yearEnd   = new Date(year + 1, 0, 1)

      const balanceDoc = await LeaveBalance.findOne({ userId: existingLeave.userId, orgId, year }).lean()
      const entitlement = (balanceDoc as unknown as Record<string, number> | null)?.[type] ?? DEFAULTS[type]

      const usedAgg = await Leave.aggregate([
        { $match: { userId: existingLeave.userId, orgId, type, status: 'approved', startDate: { $gte: yearStart, $lt: yearEnd }, _id: { $ne: existingLeave._id } } },
        { $group: { _id: null, days: { $sum: '$days' } } },
      ])
      const used = usedAgg[0]?.days || 0

      if (used + existingLeave.days > entitlement) {
        return NextResponse.json({ error: `Approving this would exceed the employee's ${type} leave balance (${used}/${entitlement} used).` }, { status: 409 })
      }
    }
  }

  const leave = await Leave.findOneAndUpdate(
    { _id: params.id, orgId },
    {
      ...pick(body, LEAVE_REVIEW_FIELDS),
      // Only an approval records an approver — a rejection must not look approved.
      ...(body.status === 'approved' ? { approvedBy: userId } : {}),
    },
    { returnDocument: 'after' }
  )
  if (!leave) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const actorName = user?.fullName || user?.firstName || 'Manager'

  writeAudit({
    action:          selfApproved ? `leave.${body.status}.self_approved` : `leave.${body.status}`,
    performedBy:     userId,
    performedByName: actorName,
    targetId:        params.id,
    targetType:      'leave',
    metadata:        { status: body.status, employeeName: leave.userName, days: leave.days, note: body.managerNote, ...(selfApproved ? { selfApproved: true } : {}) },
    orgId,
  })

  if (body.status === 'approved' || body.status === 'rejected') {
    getUserEmail(leave.userId).then(email => {
      if (email) emailLeaveStatusChanged({
        orgId, employeeEmail: email,
        status:        body.status,
        leaveType:     leave.type,
        days:          leave.days,
        note:          body.managerNote,
      })
    })
  }

  return NextResponse.json(presentLeave(leave.toObject()))
}

// Employee can withdraw their own pending request; managers/boss can delete any.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!mongoose.isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await connectDB()
  const role = user?.role || 'employee'
  const leave = await Leave.findOne({ _id: params.id, orgId })
  if (!leave) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isOwner = leave.userId === userId
  const isPriv  = role === 'manager' || role === 'admin'
  if (!isPriv && !(isOwner && leave.status === 'pending')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Reserve the private documents FIRST (no submission can claim them from here on), then delete the leave, then destroy the files.
  let reserved: string[]
  try { reserved = await reserveLeaveDocs(orgId, params.id, leave.medicalDocs) }
  catch { return NextResponse.json({ error: 'Could not remove the leave right now. Please try again.' }, { status: 503 }) }
  let removed = 0
  try { removed = (await Leave.deleteOne({ _id: params.id, orgId })).deletedCount || 0 }
  catch {
    await restoreLeaveDocs(orgId, params.id, reserved).catch(() => undefined)
    return NextResponse.json({ error: 'Could not remove the leave right now. Please try again.' }, { status: 503 })
  }
  if (!removed) {   // someone else removed it first; that request disposes of the (jointly reserved) files
    if (await Leave.exists({ _id: params.id, orgId }).catch(() => true)) await restoreLeaveDocs(orgId, params.id, reserved).catch(() => undefined)
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  const documentsDeleted = await disposeLeaveDocs(orgId, params.id, leave.medicalDocs)
  writeAudit({
    action:          isOwner ? 'leave.withdrawn' : 'leave.deleted',
    performedBy:     userId,
    performedByName: user?.fullName || user?.firstName || 'User',
    targetId:        params.id,
    targetType:      'leave',
    metadata:        { type: leave.type, days: leave.days, status: leave.status, employeeName: leave.userName },
    orgId,
  })
  return NextResponse.json({ success: true, documentsDeleted })   // false = a file is queued for retry by the cleanup, not yet physically gone
}
