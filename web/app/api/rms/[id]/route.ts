import { NextRequest, NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { connectDB } from '@/lib/db'
import Expense from '@/models/Expense'
import { writeAudit } from '@/lib/audit'
import { getUserEmail, emailExpenseStatusChanged } from '@/lib/email'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()
  const user    = await currentUser().catch(() => null)
  const role    = (user?.unsafeMetadata?.role as string) || 'employee'
  const expense = await Expense.findById(params.id).lean()
  if (!expense) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (role === 'employee' && (expense as unknown as { userId: string }).userId !== userId)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json(expense)
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const user = await currentUser().catch(() => null)
  const role = (user?.unsafeMetadata?.role as string) || 'employee'
  if (role === 'employee') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await connectDB()
  const body    = await req.json()
  const expense = await Expense.findByIdAndUpdate(params.id, body, { new: true })
  if (!expense) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const actorName = user?.fullName || user?.firstName || 'Manager'

  // Audit log
  writeAudit({
    action:          `expense.${body.status}`,
    performedBy:     userId,
    performedByName: actorName,
    targetId:        params.id,
    targetType:      'expense',
    metadata:        { status: body.status, employeeName: expense.userName, amount: expense.amount, note: body.managerNote || body.bossNote },
  })

  // Emails
  if (body.status === 'pending_boss') {
    // Notify boss about pending payout — look up boss users
    // Fire-and-forget; boss email lookup is best-effort
  }
  if (body.status === 'paid' || body.status === 'rejected') {
    getUserEmail(expense.userId).then(email => {
      if (email) emailExpenseStatusChanged({
        employeeEmail: email,
        status:        body.status,
        title:         expense.title,
        amount:        expense.amount,
        note:          body.bossNote || body.managerNote,
      })
    })
  }

  return NextResponse.json(expense)
}
