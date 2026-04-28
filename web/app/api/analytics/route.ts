import { NextRequest, NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { connectDB } from '@/lib/db'
import Leave from '@/models/Leave'
import Expense from '@/models/Expense'

function buildMonths(start: Date, end: Date) {
  const months: { year: number; month: number; label: string }[] = []
  const cur = new Date(start.getFullYear(), start.getMonth(), 1)
  const last = new Date(end.getFullYear(), end.getMonth(), 1)
  while (cur <= last) {
    months.push({
      year:  cur.getFullYear(),
      month: cur.getMonth() + 1,
      label: cur.toLocaleString('en-IN', { month: 'short', year: '2-digit' }),
    })
    cur.setMonth(cur.getMonth() + 1)
  }
  return months
}

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await currentUser().catch(() => null)
  const role = (user?.unsafeMetadata?.role as string) || 'employee'
  const isManager = role === 'manager' || role === 'boss'

  await connectDB()

  const url    = new URL(req.url)
  const fromQS = url.searchParams.get('from')
  const toQS   = url.searchParams.get('to')

  const now = new Date()
  const rangeStart = fromQS ? new Date(fromQS) : new Date(now.getFullYear(), now.getMonth() - 5, 1)
  const rangeEnd   = toQS   ? new Date(toQS)   : now

  // Clamp rangeEnd to end of that day
  rangeEnd.setHours(23, 59, 59, 999)

  const months = buildMonths(rangeStart, rangeEnd)

  const ownerFilter = isManager ? {} : { userId }
  const leaveMatch   = { createdAt: { $gte: rangeStart, $lte: rangeEnd }, ...ownerFilter }
  const expenseMatch = { createdAt: { $gte: rangeStart, $lte: rangeEnd }, ...ownerFilter }

  const [leaveAgg, expenseAgg] = await Promise.all([
    Leave.aggregate([
      { $match: leaveMatch },
      { $group: { _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } }, count: { $sum: 1 }, days: { $sum: '$days' } } },
    ]),
    Expense.aggregate([
      { $match: expenseMatch },
      { $group: { _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } }, count: { $sum: 1 }, total: { $sum: '$amount' } } },
    ]),
  ])

  const leaveByMonth = months.map(m => {
    const found = leaveAgg.find((a: { _id: { year: number; month: number }; count: number; days: number }) => a._id.year === m.year && a._id.month === m.month)
    return { label: m.label, count: found?.count ?? 0, days: found?.days ?? 0 }
  })

  const expenseByMonth = months.map(m => {
    const found = expenseAgg.find((a: { _id: { year: number; month: number }; count: number; total: number }) => a._id.year === m.year && a._id.month === m.month)
    return { label: m.label, count: found?.count ?? 0, total: found?.total ?? 0 }
  })

  // Status breakdowns also respect the date range
  const [leaveStatus, expenseStatus] = await Promise.all([
    Leave.aggregate([
      { $match: { createdAt: { $gte: rangeStart, $lte: rangeEnd }, ...ownerFilter } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Expense.aggregate([
      { $match: { createdAt: { $gte: rangeStart, $lte: rangeEnd }, ...ownerFilter } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ])

  return NextResponse.json({ leaveByMonth, expenseByMonth, leaveStatus, expenseStatus })
}
