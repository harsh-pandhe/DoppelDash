import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Expense from '@/models/Expense'
import { writeAudit } from '@/lib/audit'
import { getUserEmail, emailExpenseStatusChanged, emailExpensePendingPayout } from '@/lib/email'
import { getUser, listUsers } from '@/lib/auth'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()
  const role = user?.role || 'employee'
  const expense = await Expense.findById(params.id).lean()
  if (!expense) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (role === 'employee' && (expense as unknown as { userId: string }).userId !== userId)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json(expense)
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'

  await connectDB()
  const existingExpense = await Expense.findById(params.id)
  if (!existingExpense) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (role === 'employee') {
    if ((existingExpense as unknown as { userId: string }).userId !== userId)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (existingExpense.status !== 'returned')
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json()
  const updates: Record<string, unknown> = { ...body }
  if (role === 'employee') {
    updates.status = 'pending_manager'
    delete updates.managerNote
    delete updates.bossNote
  }

  const expense = await Expense.findByIdAndUpdate(params.id, updates, { returnDocument: 'after' })
  if (!expense) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const actorName = user?.fullName || user?.firstName || 'Manager'

  const auditAction = role === 'employee' && updates.status === 'pending_manager'
    ? 'expense.resubmitted'
    : updates.status === 'pending_manager' ? 'expense.returned_to_manager'
    : updates.status === 'returned' ? 'expense.returned_to_employee'
    : `expense.${updates.status}`

  writeAudit({
    action:          auditAction,
    performedBy:     userId,
    performedByName: actorName,
    targetId:        params.id,
    targetType:      'expense',
    metadata:        { status: updates.status, employeeName: expense.userName, amount: expense.amount, note: updates.managerNote || updates.bossNote },
  })

  // Notify boss(es) when manager approves (pending_boss)
  if (updates.status === 'pending_boss') {
    ;(async () => {
      try {
        const users = await listUsers({ limit: 500 })
        const bosses = users.filter(u => u.role === 'boss')
        for (const b of bosses) {
          if (b.email) {
            emailExpensePendingPayout({
              bossEmail:    b.email,
              employeeName: expense.userName,
              title:        expense.title,
              amount:       expense.amount,
            })
          }
        }
      } catch { /* best-effort */ }
    })()
  }

  if (updates.status === 'paid' || updates.status === 'rejected') {
    const status = updates.status as 'paid' | 'rejected'
    getUserEmail(expense.userId).then(email => {
      if (email) emailExpenseStatusChanged({
        employeeEmail: email,
        status,
        title:         expense.title,
        amount:        expense.amount,
        note:          (updates.bossNote || updates.managerNote) as string | undefined,
      })
    })
  }

  return NextResponse.json(expense)
}

// Employee withdraws their own returned/pending_manager request; managers/boss can delete any.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  await connectDB()
  const role = user?.role || 'employee'
  const expense = await Expense.findById(params.id)
  if (!expense) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isOwner = expense.userId === userId
  const isPriv  = role === 'manager' || role === 'boss'
  const canOwnerDelete = isOwner && (expense.status === 'pending_manager' || expense.status === 'returned')
  if (!isPriv && !canOwnerDelete) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await expense.deleteOne()
  writeAudit({
    action:          isOwner ? 'expense.withdrawn' : 'expense.deleted',
    performedBy:     userId,
    performedByName: user?.fullName || user?.firstName || 'User',
    targetId:        params.id,
    targetType:      'expense',
    metadata:        { title: expense.title, amount: expense.amount, status: expense.status, employeeName: expense.userName },
  })
  return NextResponse.json({ success: true })
}
