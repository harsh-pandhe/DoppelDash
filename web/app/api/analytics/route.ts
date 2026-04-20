import { NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { connectDB } from '@/lib/db'
import Leave from '@/models/Leave'
import Expense from '@/models/Expense'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await currentUser()
  const role = (user?.unsafeMetadata?.role as string) || 'employee'
  const isManager = role === 'manager' || role === 'boss'

  await connectDB()

  // Build 6-month labels
  const now = new Date()
  const months: { year: number; month: number; label: string }[] = []
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    months.push({
      year:  d.getFullYear(),
      month: d.getMonth() + 1,       // 1-indexed for MongoDB $month
      label: d.toLocaleString('en-IN', { month: 'short', year: '2-digit' }),
    })
  }

  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)
  const leaveMatch  = { createdAt: { $gte: sixMonthsAgo }, ...(isManager ? {} : { userId }) }
  const expenseMatch = { createdAt: { $gte: sixMonthsAgo }, ...(isManager ? {} : { userId }) }

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

  // Map aggregation results to 6-month array
  const leaveByMonth = months.map(m => {
    const found = leaveAgg.find((a: { _id: { year: number; month: number }; count: number; days: number }) => a._id.year === m.year && a._id.month === m.month)
    return { label: m.label, count: found?.count ?? 0, days: found?.days ?? 0 }
  })

  const expenseByMonth = months.map(m => {
    const found = expenseAgg.find((a: { _id: { year: number; month: number }; count: number; total: number }) => a._id.year === m.year && a._id.month === m.month)
    return { label: m.label, count: found?.count ?? 0, total: found?.total ?? 0 }
  })

  // Status breakdowns
  const [leaveStatus, expenseStatus] = await Promise.all([
    Leave.aggregate([
      { $match: isManager ? {} : { userId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Expense.aggregate([
      { $match: isManager ? {} : { userId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
  ])

  return NextResponse.json({ leaveByMonth, expenseByMonth, leaveStatus, expenseStatus })
}
