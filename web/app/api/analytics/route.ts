import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Leave from '@/models/Leave'
import Expense from '@/models/Expense'
import TravelRequest from '@/models/TravelRequest'
import Contact from '@/models/Contact'
import Announcement from '@/models/Announcement'
import AuditLog from '@/models/AuditLog'
import { getUser } from '@/lib/auth'

function buildMonths(start: Date, end: Date) {
  const months: { year: number; month: number; label: string }[] = []
  const cur  = new Date(start.getFullYear(), start.getMonth(), 1)
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
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = user?.role || 'employee'
  const isManager = role === 'manager' || role === 'boss'

  await connectDB()

  const url    = new URL(req.url)
  const fromQS = url.searchParams.get('from')
  const toQS   = url.searchParams.get('to')

  const now = new Date()
  const rangeStart = fromQS ? new Date(fromQS) : new Date(now.getFullYear(), now.getMonth() - 5, 1)
  const rangeEnd   = toQS   ? new Date(toQS)   : now
  rangeEnd.setHours(23, 59, 59, 999)

  const months = buildMonths(rangeStart, rangeEnd)
  const ownerFilter = isManager ? {} : { userId }
  const baseMatch   = { createdAt: { $gte: rangeStart, $lte: rangeEnd }, ...ownerFilter }

  const day30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  const [
    leaveAgg,
    expenseAgg,
    leaveStatus,
    expenseStatus,
    leaveTypeAgg,
    travelStatus,
    expenseAmountAgg,
    topSpendersAgg,
    leavesIn30d,
    expensesIn30d,
    travelIn30d,
    contactCount,
    contactsWithEmail,
    pendingLeavesCount,
    pendingExpensesCount,
    pendingTravelCount,
    recentAudits,
  ] = await Promise.all([
    Leave.aggregate([
      { $match: baseMatch },
      { $group: { _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } }, count: { $sum: 1 }, days: { $sum: '$days' } } },
    ]),
    Expense.aggregate([
      { $match: baseMatch },
      { $group: { _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } }, count: { $sum: 1 }, total: { $sum: '$amount' } } },
    ]),
    Leave.aggregate([
      { $match: baseMatch },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Expense.aggregate([
      { $match: baseMatch },
      { $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$amount' } } },
    ]),
    Leave.aggregate([
      { $match: baseMatch },
      { $group: { _id: '$type', count: { $sum: 1 }, days: { $sum: '$days' } } },
    ]),
    TravelRequest.aggregate([
      { $match: baseMatch },
      { $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$estimatedTotal' } } },
    ]),
    Expense.aggregate([
      { $match: { ...baseMatch, status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    Expense.aggregate([
      { $match: { ...baseMatch, status: 'paid' } },
      { $group: { _id: { userId: '$userId', userName: '$userName' }, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      { $sort: { total: -1 } },
      { $limit: 5 },
    ]),
    Leave.countDocuments({ createdAt: { $gte: day30 }, ...ownerFilter }),
    Expense.countDocuments({ createdAt: { $gte: day30 }, ...ownerFilter }),
    TravelRequest.countDocuments({ createdAt: { $gte: day30 }, ...ownerFilter }),
    isManager ? Contact.countDocuments({}) : Contact.countDocuments({ createdBy: userId }),
    isManager
      ? Contact.countDocuments({ email: { $exists: true, $ne: '' } })
      : Contact.countDocuments({ createdBy: userId, email: { $exists: true, $ne: '' } }),
    Leave.countDocuments({ status: 'pending', ...ownerFilter }),
    Expense.countDocuments({ status: { $in: ['pending_manager','pending_boss'] }, ...ownerFilter }),
    TravelRequest.countDocuments({ status: { $in: ['pending_manager','pending_boss'] }, ...ownerFilter }),
    isManager
      ? AuditLog.find({}).sort({ createdAt: -1 }).limit(10).lean()
      : Promise.resolve([]),
  ])

  // Pivot month-grouped arrays
  const leaveByMonth = months.map(m => {
    const f = leaveAgg.find((a: { _id: { year: number; month: number } }) => a._id.year === m.year && a._id.month === m.month)
    return { label: m.label, count: f?.count ?? 0, days: f?.days ?? 0 }
  })
  const expenseByMonth = months.map(m => {
    const f = expenseAgg.find((a: { _id: { year: number; month: number } }) => a._id.year === m.year && a._id.month === m.month)
    return { label: m.label, count: f?.count ?? 0, total: f?.total ?? 0 }
  })

  const totalLeaves     = leaveByMonth.reduce((s, m) => s + m.count, 0)
  const totalExpenses   = expenseByMonth.reduce((s, m) => s + (m.total ?? 0), 0)
  const totalExpenseCount = expenseByMonth.reduce((s, m) => s + m.count, 0)
  const approvedLeaves  = leaveStatus.find((s: { _id: string; count: number }) => s._id === 'approved')?.count || 0
  const paidExpense     = expenseAmountAgg[0]?.total || 0
  const pendingPayout   = expenseStatus.find((s: { _id: string; total?: number; count: number }) => s._id === 'pending_boss')?.total || 0
  const travelApproved  = travelStatus.find((s: { _id: string; count: number }) => s._id === 'approved')?.count || 0
  const announcementCount = await Announcement.countDocuments({})

  return NextResponse.json({
    range: { from: rangeStart.toISOString(), to: rangeEnd.toISOString() },
    kpis: {
      totalLeaves,
      approvedLeaves,
      pendingLeaves:  pendingLeavesCount,
      totalExpenses,         // ₹ in selected range
      totalExpenseCount,     // claim count in selected range
      paidExpense,           // ₹ paid out
      pendingPayout,         // ₹ awaiting payout
      pendingExpensesCount,
      travelApproved,
      pendingTravel:  pendingTravelCount,
      contactCount,
      contactsWithEmail,
      announcementCount,
      leavesIn30d,
      expensesIn30d,
      travelIn30d,
    },
    leaveByMonth,
    expenseByMonth,
    leaveStatus,
    expenseStatus,
    travelStatus,
    leaveType: leaveTypeAgg,
    topSpenders: topSpendersAgg.map((e: { _id: { userId: string; userName: string }; total: number; count: number }) => ({
      userId:   e._id.userId,
      userName: e._id.userName,
      total:    e.total,
      count:    e.count,
    })),
    recentAudits: recentAudits.map((a: { action: string; performedByName: string; createdAt: Date; metadata?: Record<string, unknown> }) => ({
      action:          a.action,
      performedByName: a.performedByName,
      createdAt:       a.createdAt,
      metadata:        a.metadata,
    })),
  })
}
