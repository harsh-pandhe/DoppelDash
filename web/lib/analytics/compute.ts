import { connectDB } from '@/lib/db'
import Leave from '@/models/Leave'
import Expense from '@/models/Expense'
import TravelRequest from '@/models/TravelRequest'
import Contact from '@/models/Contact'
import Announcement from '@/models/Announcement'
import AuditLog from '@/models/AuditLog'
import Employee from '@/models/Employee'
import { listUsers } from '@/lib/auth'

export interface AnalyticsParams {
  from?: string | null
  to?: string | null
  dept?: string
  employee?: string
  status?: string
  compare?: string
  includeFilterOptions?: boolean  // only for managers in the interactive dashboard
}

function buildMonths(start: Date, end: Date) {
  const months: { year: number; month: number; label: string }[] = []
  const cur  = new Date(start.getFullYear(), start.getMonth(), 1)
  const last = new Date(end.getFullYear(), end.getMonth(), 1)
  while (cur <= last) {
    months.push({ year: cur.getFullYear(), month: cur.getMonth() + 1, label: cur.toLocaleString('en-IN', { month: 'short', year: '2-digit' }) })
    cur.setMonth(cur.getMonth() + 1)
  }
  return months
}

/**
 * Core analytics aggregation. Scoped by (userId, role). Used by the authed dashboard
 * route AND the public shared-dashboard route (which passes the share owner's identity).
 */
export async function computeAnalytics(userId: string, role: string, p: AnalyticsParams, orgId: string) {
  const isManager = role === 'manager' || role === 'admin'
  const effectiveOrgId = orgId
  await connectDB()

  const now = new Date()
  const rangeStart = p.from ? new Date(p.from) : new Date(now.getFullYear(), now.getMonth() - 5, 1)
  const rangeEnd   = p.to   ? new Date(p.to)   : now
  rangeEnd.setHours(23, 59, 59, 999)
  const months = buildMonths(rangeStart, rangeEnd)

  const deptQS = p.dept || '', employeeQS = p.employee || '', statusQS = p.status || ''

  const employees = await Employee.find({ orgId: effectiveOrgId, isActive: true }, 'clerkUserId department firstName lastName').lean()
  const departments = Array.from(new Set(employees.map(e => e.department).filter(Boolean))).sort()

  const ownerFilter: Record<string, unknown> = isManager ? { orgId: effectiveOrgId } : { userId, orgId: effectiveOrgId }
  if (isManager) {
    if (employeeQS) ownerFilter.userId = employeeQS
    else if (deptQS) {
      const ids = employees.filter(e => e.department === deptQS).map(e => e.clerkUserId)
      ownerFilter.userId = { $in: ids.length ? ids : ['__none__'] }
    }
  }

  const baseMatch: Record<string, unknown> = { createdAt: { $gte: rangeStart, $lte: rangeEnd }, ...ownerFilter }
  const LEAVE_STATUSES  = new Set(['pending', 'approved', 'rejected'])
  const EXP_STATUSES    = new Set(['pending_manager', 'pending_admin', 'paid', 'rejected', 'returned'])
  const TRAVEL_STATUSES = new Set(['pending_manager', 'pending_admin', 'approved', 'rejected', 'cancelled'])
  const leaveMatch  = statusQS && LEAVE_STATUSES.has(statusQS)  ? { ...baseMatch, status: statusQS } : baseMatch
  const expMatch    = statusQS && EXP_STATUSES.has(statusQS)    ? { ...baseMatch, status: statusQS } : baseMatch
  const travelMatch = statusQS && TRAVEL_STATUSES.has(statusQS) ? { ...baseMatch, status: statusQS } : baseMatch
  const day30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  const [
    leaveAgg, expenseAgg, leaveStatus, expenseStatus, leaveTypeAgg, travelStatus,
    expenseAmountAgg, topSpendersAgg, leavesIn30d, expensesIn30d, travelIn30d,
    contactCount, contactsWithEmail, pendingLeavesCount, pendingExpensesCount, pendingTravelCount, recentAudits,
  ] = await Promise.all([
    Leave.aggregate([{ $match: leaveMatch }, { $group: { _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } }, count: { $sum: 1 }, days: { $sum: '$days' } } }]),
    Expense.aggregate([{ $match: expMatch }, { $group: { _id: { year: { $year: '$createdAt' }, month: { $month: '$createdAt' } }, count: { $sum: 1 }, total: { $sum: '$amount' } } }]),
    Leave.aggregate([{ $match: leaveMatch }, { $group: { _id: '$status', count: { $sum: 1 } } }]),
    Expense.aggregate([{ $match: expMatch }, { $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$amount' } } }]),
    Leave.aggregate([{ $match: leaveMatch }, { $group: { _id: '$type', count: { $sum: 1 }, days: { $sum: '$days' } } }]),
    TravelRequest.aggregate([{ $match: travelMatch }, { $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$estimatedTotal' } } }]),
    Expense.aggregate([{ $match: { ...baseMatch, status: 'paid' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    Expense.aggregate([{ $match: { ...baseMatch, status: 'paid' } }, { $group: { _id: { userId: '$userId', userName: '$userName' }, total: { $sum: '$amount' }, count: { $sum: 1 } } }, { $sort: { total: -1 } }, { $limit: 5 }]),
    Leave.countDocuments({ createdAt: { $gte: day30 }, ...ownerFilter }),
    Expense.countDocuments({ createdAt: { $gte: day30 }, ...ownerFilter }),
    TravelRequest.countDocuments({ createdAt: { $gte: day30 }, ...ownerFilter }),
    isManager ? Contact.countDocuments({ orgId: effectiveOrgId }) : Contact.countDocuments({ orgId: effectiveOrgId, createdBy: userId }),
    isManager ? Contact.countDocuments({ orgId: effectiveOrgId, email: { $exists: true, $ne: '' } }) : Contact.countDocuments({ orgId: effectiveOrgId, createdBy: userId, email: { $exists: true, $ne: '' } }),
    Leave.countDocuments({ status: 'pending', ...ownerFilter }),
    Expense.countDocuments({ status: { $in: ['pending_manager', 'pending_admin'] }, ...ownerFilter }),
    TravelRequest.countDocuments({ status: { $in: ['pending_manager', 'pending_admin'] }, ...ownerFilter }),
    isManager ? AuditLog.find({ orgId: effectiveOrgId }).sort({ createdAt: -1 }).limit(10).lean() : Promise.resolve([]),
  ])

  const leaveByMonth = months.map(m => {
    const f = leaveAgg.find((a: { _id: { year: number; month: number } }) => a._id.year === m.year && a._id.month === m.month)
    return { label: m.label, count: f?.count ?? 0, days: f?.days ?? 0 }
  })
  const expenseByMonth = months.map(m => {
    const f = expenseAgg.find((a: { _id: { year: number; month: number } }) => a._id.year === m.year && a._id.month === m.month)
    return { label: m.label, count: f?.count ?? 0, total: f?.total ?? 0 }
  })

  const totalLeaves       = leaveByMonth.reduce((s, m) => s + m.count, 0)
  const totalExpenses     = expenseByMonth.reduce((s, m) => s + (m.total ?? 0), 0)
  const totalExpenseCount = expenseByMonth.reduce((s, m) => s + m.count, 0)
  const approvedLeaves    = leaveStatus.find((s: { _id: string; count: number }) => s._id === 'approved')?.count || 0
  const paidExpense       = expenseAmountAgg[0]?.total || 0
  const pendingPayout     = expenseStatus.find((s: { _id: string; total?: number }) => s._id === 'pending_admin')?.total || 0
  const travelApproved    = travelStatus.find((s: { _id: string; count: number }) => s._id === 'approved')?.count || 0
  const announcementCount = await Announcement.countDocuments({ orgId: effectiveOrgId })

  // Compare period
  let previous: { totalLeaves: number; approvedLeaves: number; totalExpenses: number; paidExpense: number } | undefined
  const compareQS = p.compare || 'none'
  if (compareQS === 'mom' || compareQS === 'yoy') {
    let prevStart: Date, prevEnd: Date
    if (compareQS === 'yoy') {
      prevStart = new Date(rangeStart); prevStart.setFullYear(prevStart.getFullYear() - 1)
      prevEnd   = new Date(rangeEnd);   prevEnd.setFullYear(prevEnd.getFullYear() - 1)
    } else {
      const span = rangeEnd.getTime() - rangeStart.getTime()
      prevEnd   = new Date(rangeStart.getTime() - 1)
      prevStart = new Date(prevEnd.getTime() - span)
    }
    const prevBase: Record<string, unknown> = { createdAt: { $gte: prevStart, $lte: prevEnd }, ...ownerFilter }
    const prevLeaveMatch = statusQS && LEAVE_STATUSES.has(statusQS) ? { ...prevBase, status: statusQS } : prevBase
    const prevExpMatch   = statusQS && EXP_STATUSES.has(statusQS)   ? { ...prevBase, status: statusQS } : prevBase
    const [pLeave, pApproved, pExp, pPaid] = await Promise.all([
      Leave.countDocuments(prevLeaveMatch),
      Leave.countDocuments({ ...prevBase, status: 'approved' }),
      Expense.aggregate([{ $match: prevExpMatch }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Expense.aggregate([{ $match: { ...prevBase, status: 'paid' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    ])
    previous = { totalLeaves: pLeave, approvedLeaves: pApproved, totalExpenses: pExp[0]?.total || 0, paidExpense: pPaid[0]?.total || 0 }
  }

  // Filter options (interactive dashboard only)
  let filterOptions: { departments: string[]; employees: { userId: string; name: string; department: string }[] } | undefined
  if (isManager && p.includeFilterOptions) {
    const clerkUsers = await listUsers({ limit: 500, orgId: effectiveOrgId }).catch(() => [])
    const nameById = new Map(clerkUsers.map(u => [u.id, u.fullName || `${u.firstName} ${u.lastName}`.trim()]))
    filterOptions = {
      departments,
      employees: employees
        .map(e => ({ userId: e.clerkUserId, name: nameById.get(e.clerkUserId) || `${e.firstName} ${e.lastName}`.trim(), department: e.department || '' }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }
  }

  return {
    range: { from: rangeStart.toISOString(), to: rangeEnd.toISOString() },
    appliedFilters: { dept: deptQS || null, employee: employeeQS || null, status: statusQS || null },
    compare: compareQS === 'mom' || compareQS === 'yoy' ? compareQS : null,
    previous,
    filterOptions,
    kpis: {
      totalLeaves, approvedLeaves, pendingLeaves: pendingLeavesCount,
      totalExpenses, totalExpenseCount, paidExpense, pendingPayout, pendingExpensesCount,
      travelApproved, pendingTravel: pendingTravelCount,
      contactCount, contactsWithEmail, announcementCount,
      leavesIn30d, expensesIn30d, travelIn30d,
    },
    leaveByMonth, expenseByMonth, leaveStatus, expenseStatus, travelStatus,
    leaveType: leaveTypeAgg,
    topSpenders: topSpendersAgg.map((e: { _id: { userId: string; userName: string }; total: number; count: number }) => ({ userId: e._id.userId, userName: e._id.userName, total: e.total, count: e.count })),
    recentAudits: recentAudits.map((a: { action: string; performedByName: string; createdAt: Date; metadata?: Record<string, unknown> }) => ({ action: a.action, performedByName: a.performedByName, createdAt: a.createdAt, metadata: a.metadata })),
  }
}
