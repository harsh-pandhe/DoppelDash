import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Leave from '@/models/Leave'
import { writeAudit } from '@/lib/audit'
import { getUserEmail, emailLeaveStatusChanged } from '@/lib/email'
import { getUser } from '@/lib/auth'

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
  const isPriv  = role === 'manager' || role === 'boss'
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
