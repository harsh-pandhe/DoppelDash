import { NextRequest, NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { connectDB } from '@/lib/db'
import Leave from '@/models/Leave'
import Expense from '@/models/Expense'
import Contact from '@/models/Contact'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const me   = await currentUser().catch(() => null)
  const role = (me?.unsafeMetadata?.role as string) || 'employee'
  const isManager = role === 'manager' || role === 'boss'

  await connectDB()
  const { searchParams } = new URL(req.url)
  const from = searchParams.get('from')
  const to   = searchParams.get('to')

  const dateFilter: Record<string, Date> = {}
  if (from) dateFilter.$gte = new Date(from)
  if (to)   dateFilter.$lte = new Date(to + 'T23:59:59')

  const leaveMatch: Record<string, unknown>   = isManager ? {} : { userId }
  const expenseMatch: Record<string, unknown> = isManager ? {} : { userId }
  if (from || to) {
    leaveMatch.createdAt   = dateFilter
    expenseMatch.createdAt = dateFilter
  }

  const [leaveSummary, expenseSummary, leaveByType, expenseByStatus] = await Promise.all([
    // Leave: per employee
    Leave.aggregate([
      { $match: leaveMatch },
      { $group: { _id: { userId: '$userId', userName: '$userName' }, totalRequests: { $sum: 1 }, totalDays: { $sum: '$days' }, approved: { $sum: { $cond: [{ $eq: ['$status','approved'] }, 1, 0] } } } },
      { $sort: { totalDays: -1 } },
    ]),
    // Expense: per employee
    Expense.aggregate([
      { $match: expenseMatch },
      { $group: { _id: { userId: '$userId', userName: '$userName' }, totalRequests: { $sum: 1 }, totalAmount: { $sum: '$amount' }, paid: { $sum: { $cond: [{ $eq: ['$status','paid'] }, '$amount', 0] } } } },
      { $sort: { totalAmount: -1 } },
    ]),
    // Leave by type
    Leave.aggregate([
      { $match: leaveMatch },
      { $group: { _id: '$type', count: { $sum: 1 }, days: { $sum: '$days' } } },
    ]),
    // Expense by status
    Expense.aggregate([
      { $match: expenseMatch },
      { $group: { _id: '$status', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
    ]),
  ])

  // Upcoming birthdays (next 30 days) from CRM
  const contacts = await Contact.find({ createdBy: userId, birthday: { $exists: true, $ne: null } })
    .select('name birthday company').lean()
  const today  = new Date()
  const upcoming = contacts
    .map(c => {
      const bday   = new Date(c.birthday!)
      const thisYear = new Date(today.getFullYear(), bday.getMonth(), bday.getDate())
      const daysUntil = Math.ceil((thisYear.getTime() - today.getTime()) / 86400000)
      return { name: c.name, company: c.company, birthday: c.birthday, daysUntil: daysUntil < 0 ? daysUntil + 365 : daysUntil }
    })
    .filter(c => c.daysUntil >= 0 && c.daysUntil <= 30)
    .sort((a, b) => a.daysUntil - b.daysUntil)

  return NextResponse.json({ leaveSummary, expenseSummary, leaveByType, expenseByStatus, upcomingBirthdays: upcoming })
}
