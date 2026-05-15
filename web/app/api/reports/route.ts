import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Leave from '@/models/Leave'
import Expense from '@/models/Expense'
import TravelRequest from '@/models/TravelRequest'
import Contact from '@/models/Contact'
import Employee from '@/models/Employee'
import { getUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  const isManager = role === 'manager' || role === 'boss'

  await connectDB()
  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to   = searchParams.get('to')

  const dateFilter: Record<string, Date> = {}
  if (from) dateFilter.$gte = new Date(from)
  if (to)   dateFilter.$lte = new Date(to + 'T23:59:59')

  const ownerFilter: Record<string, unknown> = isManager ? {} : { userId }
  const match: Record<string, unknown> = { ...ownerFilter }
  if (from || to) match.createdAt = dateFilter

  const [
    leaveSummary,
    expenseSummary,
    travelSummary,
    leaveByType,
    expenseByStatus,
    travelByStatus,
  ] = await Promise.all([
    Leave.aggregate([
      { $match: match },
      { $group: {
          _id: { userId: '$userId', userName: '$userName' },
          totalRequests: { $sum: 1 },
          totalDays:     { $sum: '$days' },
          approved:      { $sum: { $cond: [{ $eq: ['$status','approved'] }, 1, 0] } },
          rejected:      { $sum: { $cond: [{ $eq: ['$status','rejected'] }, 1, 0] } },
        } },
      { $sort: { totalDays: -1 } },
    ]),
    Expense.aggregate([
      { $match: match },
      { $group: {
          _id: { userId: '$userId', userName: '$userName' },
          totalRequests: { $sum: 1 },
          totalAmount:   { $sum: '$amount' },
          paid:          { $sum: { $cond: [{ $eq: ['$status','paid'] }, '$amount', 0] } },
          pending:       { $sum: { $cond: [{ $in: ['$status', ['pending_manager','pending_boss']] }, '$amount', 0] } },
        } },
      { $sort: { totalAmount: -1 } },
    ]),
    TravelRequest.aggregate([
      { $match: match },
      { $group: {
          _id: { userId: '$userId', userName: '$userName' },
          totalRequests: { $sum: 1 },
          totalEstimate: { $sum: '$estimatedTotal' },
          approved:      { $sum: { $cond: [{ $eq: ['$status','approved'] }, 1, 0] } },
        } },
      { $sort: { totalEstimate: -1 } },
    ]),
    Leave.aggregate([
      { $match: match },
      { $group: { _id: '$type', count: { $sum: 1 }, days: { $sum: '$days' } } },
    ]),
    Expense.aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
    ]),
    TravelRequest.aggregate([
      { $match: match },
      { $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$estimatedTotal' } } },
    ]),
  ])

  // Upcoming birthdays (next 30 days) — employees + CRM contacts
  const today = new Date()
  const daysUntilFor = (d: Date) => {
    const thisYear = new Date(today.getFullYear(), d.getMonth(), d.getDate())
    const diff = Math.ceil((thisYear.getTime() - today.getTime()) / 86400000)
    return diff < 0 ? diff + 365 : diff
  }

  // Employees — visible to everyone (so all can wish each other)
  const employees = await Employee.find({
    $or: [
      { dateOfBirth:        { $exists: true, $ne: null } },
      { workAnniversary:    { $exists: true, $ne: null } },
      { personalAnniversary:{ $exists: true, $ne: null } },
    ],
  }).select('firstName lastName photo dateOfBirth workAnniversary personalAnniversary department designation').lean()

  const employeeBirthdays = employees
    .filter(e => e.dateOfBirth)
    .map(e => ({
      source:    'employee' as const,
      kind:      'birthday' as const,
      name:      `${e.firstName} ${e.lastName}`.trim(),
      company:   e.department || e.designation,
      photo:     e.photo,
      date:      e.dateOfBirth!,
      daysUntil: daysUntilFor(new Date(e.dateOfBirth!)),
    }))
    .filter(e => e.daysUntil >= 0 && e.daysUntil <= 30)

  const employeeAnniversaries = employees
    .filter(e => e.workAnniversary)
    .map(e => ({
      source:    'employee' as const,
      kind:      'work_anniversary' as const,
      name:      `${e.firstName} ${e.lastName}`.trim(),
      company:   e.department,
      photo:     e.photo,
      date:      e.workAnniversary!,
      daysUntil: daysUntilFor(new Date(e.workAnniversary!)),
      years:     today.getFullYear() - new Date(e.workAnniversary!).getFullYear(),
    }))
    .filter(e => e.daysUntil >= 0 && e.daysUntil <= 30)

  // CRM contacts (owner-scoped)
  const contacts = await Contact.find({ createdBy: userId, birthday: { $exists: true, $ne: null } })
    .select('name birthday company').lean()
  const contactBirthdays = contacts
    .map(c => ({
      source:    'contact' as const,
      kind:      'birthday' as const,
      name:      c.name,
      company:   c.company,
      date:      c.birthday!,
      daysUntil: daysUntilFor(new Date(c.birthday!)),
    }))
    .filter(c => c.daysUntil >= 0 && c.daysUntil <= 30)

  const upcomingBirthdays = [
    ...employeeBirthdays,
    ...contactBirthdays,
  ].sort((a, b) => a.daysUntil - b.daysUntil)

  const upcomingAnniversaries = employeeAnniversaries.sort((a, b) => a.daysUntil - b.daysUntil)

  return NextResponse.json({
    leaveSummary,
    expenseSummary,
    travelSummary,
    leaveByType,
    expenseByStatus,
    travelByStatus,
    upcomingBirthdays,
    upcomingAnniversaries,
  })
}
