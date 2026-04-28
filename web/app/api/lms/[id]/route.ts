import { NextRequest, NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { connectDB } from '@/lib/db'
import Leave from '@/models/Leave'
import { writeAudit } from '@/lib/audit'
import { getUserEmail, emailLeaveStatusChanged } from '@/lib/email'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()
  const user  = await currentUser().catch(() => null)
  const role  = (user?.unsafeMetadata?.role as string) || 'employee'
  const leave = await Leave.findById(params.id).lean()
  if (!leave) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (role === 'employee' && (leave as unknown as { userId: string }).userId !== userId)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json(leave)
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = await currentUser().catch(() => null)
  const role = (user?.unsafeMetadata?.role as string) || 'employee'
  if (role === 'employee') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await connectDB()
  const body  = await req.json()
  const leave = await Leave.findByIdAndUpdate(
    params.id,
    { ...body, approvedBy: userId },
    { new: true }
  )
  if (!leave) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const actorName = user?.fullName || user?.firstName || 'Manager'

  // Audit log (fire-and-forget)
  writeAudit({
    action:          `leave.${body.status}`,
    performedBy:     userId,
    performedByName: actorName,
    targetId:        params.id,
    targetType:      'leave',
    metadata:        { status: body.status, employeeName: leave.userName, days: leave.days, note: body.managerNote },
  })

  // Email employee (fire-and-forget)
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
