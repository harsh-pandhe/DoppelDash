import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Leave from '@/models/Leave'
import LeaveBalance from '@/models/LeaveBalance'
import { emailLeaveSubmitted } from '@/lib/email'
import { getUser } from '@/lib/auth'
import { notifyTargetsFor } from '@/lib/notify-targets'
import { pick } from '@/lib/pick'
import { LEAVE_CREATE_FIELDS } from '@/lib/apiFields'

const DEFAULTS = { casual: 12, sick: 6, earned: 15, privilege: 2, restricted: 2 }

export async function GET(req: NextRequest) {
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
    return NextResponse.json(leaves)
  } catch (err) {
    console.error('[LMS GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()
  const body  = await req.json()

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

  const leave = await Leave.create({
    ...pick(body, LEAVE_CREATE_FIELDS),
    userId,
    userName: user?.fullName || user?.firstName || 'Unknown',
    orgId,
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
