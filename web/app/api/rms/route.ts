import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Expense from '@/models/Expense'
import { emailExpenseSubmitted } from '@/lib/email'
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
    const expenses = await Expense.find(filter).sort({ createdAt: -1 }).limit(200).lean()
    return NextResponse.json(expenses)
  } catch (err) {
    console.error('[RMS GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()
  const body    = await req.json()
  const expense = await Expense.create({
    ...body,
    userId,
    userName: user?.fullName || user?.firstName || 'Unknown',
    status: 'pending_manager',
  })

  // Notify reporting manager (+ boss); fallback to all managers if no chain set
  ;(async () => {
    try {
      const recipients = await notifyTargetsFor(userId)
      const employeeName = user?.fullName || user?.firstName || 'An employee'
      for (const email of recipients) {
        emailExpenseSubmitted({
          managerEmail: email,
          employeeName,
          title:  body.title,
          amount: body.amount,
        })
      }
    } catch { /* best-effort */ }
  })()

  return NextResponse.json(expense, { status: 201 })
}
