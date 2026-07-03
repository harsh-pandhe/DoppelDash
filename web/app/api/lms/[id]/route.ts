import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Leave from '@/models/Leave'
import LeaveBalance from '@/models/LeaveBalance'
import { writeAudit } from '@/lib/audit'
import { getUserEmail, emailLeaveStatusChanged } from '@/lib/email'
import { getUser } from '@/lib/auth'

const DEFAULTS = { casual: 12, sick: 6, earned: 15, privilege: 2, restricted: 2 }

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()
  const role = user?.role || 'employee'
  const leave = await Leave.findById(params.id).lean()
  if (!leave) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (role === 'employee' && (leave as unknown as { userId: string }).userId !== userId)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json(leave)
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  if (role === 'employee') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await connectDB()
  const body  = await req.json()

  const existingLeave = await Leave.findById(params.id)
  if (!existingLeave) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (body.status !== undefined && body.status !== existingLeave.status) {
    const VALID_TRANSITIONS: Record<string, string[]> = {
      pending:  ['approved', 'rejected'],
      approved: [],
      rejected: [],
    }
    if (!VALID_TRANSITIONS[existingLeave.status]?.includes(body.status)) {
      return NextResponse.json({ error: `Cannot move from ${existingLeave.status} to ${body.status}` }, { status: 409 })
    }

    if (body.status === 'approved' && existingLeave.type in DEFAULTS) {
      const type = existingLeave.type as keyof typeof DEFAULTS
      const year = existingLeave.startDate.getFullYear()
      const yearStart = new Date(year, 0, 1)
      const yearEnd   = new Date(year + 1, 0, 1)

      const balanceDoc = await LeaveBalance.findOne({ userId: existingLeave.userId, year }).lean()
      const entitlement = (balanceDoc as unknown as Record<string, number> | null)?.[type] ?? DEFAULTS[type]

      const usedAgg = await Leave.aggregate([
        { $match: { userId: existingLeave.userId, type, status: 'approved', startDate: { $gte: yearStart, $lt: yearEnd }, _id: { $ne: existingLeave._id } } },
        { $group: { _id: null, days: { $sum: '$days' } } },
      ])
      const used = usedAgg[0]?.days || 0

      if (used + existingLeave.days > entitlement) {
        return NextResponse.json({ error: `Approving this would exceed the employee's ${type} leave balance (${used}/${entitlement} used).` }, { status: 409 })
      }
    }
  }

  const leave = await Leave.findByIdAndUpdate(
    params.id,
    { ...body, approvedBy: userId },
    { returnDocument: 'after' }
  )
  if (!leave) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const actorName = user?.fullName || user?.firstName || 'Manager'

  writeAudit({
    action:          `leave.${body.status}`,
    performedBy:     userId,
    performedByName: actorName,
    targetId:        params.id,
    targetType:      'leave',
    metadata:        { status: body.status, employeeName: leave.userName, days: leave.days, note: body.managerNote },
  })

  if (body.status === 'approved' || body.status === 'rejected') {
    getUserEmail(leave.userId).then(email => {
      if (email) emailLeaveStatusChanged({
        employeeEmail: email,
        status:        body.status,
        leaveType:     leave.type,
        days:          leave.days,
        note:          body.managerNote,
      })
    })
  }

  return NextResponse.json(leave)
}

// Employee can withdraw their own pending request; managers/boss can delete any.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()
  const role = user?.role || 'employee'
  const leave = await Leave.findById(params.id)
  if (!leave) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isOwner = leave.userId === userId
  const isPriv  = role === 'manager' || role === 'admin'
  if (!isPriv && !(isOwner && leave.status === 'pending')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await leave.deleteOne()
  writeAudit({
    action:          isOwner ? 'leave.withdrawn' : 'leave.deleted',
    performedBy:     userId,
    performedByName: user?.fullName || user?.firstName || 'User',
    targetId:        params.id,
    targetType:      'leave',
    metadata:        { type: leave.type, days: leave.days, status: leave.status, employeeName: leave.userName },
  })
  return NextResponse.json({ success: true })
}
