import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Leave from '@/models/Leave'
import { emailLeaveSubmitted } from '@/lib/email'
import { getUser } from '@/lib/auth'
import { notifyTargetsFor } from '@/lib/notify-targets'

export async function GET(req: NextRequest) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  try {
    await connectDB()
    const { searchParams } = new URL(req.url)
    const filter: Record<string, unknown> = role === 'employee' ? { userId } : {}
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
    return NextResponse.json(leaves)
  } catch (err) {
    console.error('[LMS GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()
  const body  = await req.json()
  const leave = await Leave.create({
    ...body,
    userId,
    userName: user?.fullName || user?.firstName || 'Unknown',
    status: 'pending',
  })

  // Notify reporting manager (+ boss); fallback to all managers if no chain set
  ;(async () => {
    try {
      const recipients = await notifyTargetsFor(userId)
      const employeeName = user?.fullName || user?.firstName || 'An employee'
      for (const email of recipients) {
        emailLeaveSubmitted({
          managerEmail: email,
          employeeName,
          leaveType: body.type,
          days: body.days,
          reason: body.reason || '',
        })
      }
    } catch { /* best-effort */ }
  })()

  return NextResponse.json(leave, { status: 201 })
}
