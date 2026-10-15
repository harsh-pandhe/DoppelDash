import { NextRequest, NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { connectDB } from '@/lib/db'
import Expense from '@/models/Expense'
import TravelRequest from '@/models/TravelRequest'
import { writeAudit } from '@/lib/audit'
import { getUserEmail, emailExpenseStatusChanged, emailExpensePendingPayout } from '@/lib/email'
import { getUser, listUsers } from '@/lib/auth'
import { pick } from '@/lib/pick'
import { selfApprovalCheck, SELF_APPROVAL_ERROR } from '@/lib/permissions'
import { EXPENSE_CREATE_FIELDS } from '@/lib/apiFields'
import { validateExpense, validateReview } from '@/lib/expenses/validation'
import { destroyAttachments } from '@/lib/uploads/attachmentStorage'
import { presentExpense, checkNewReceipts, storedReceipts, storedLineReceipts } from '@/lib/expenses/receipts'

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!mongoose.isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await connectDB()
  const role = user?.role || 'employee'
  const expense = await Expense.findOne({ _id: params.id, orgId }).lean()
  if (!expense) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (role === 'employee' && (expense as unknown as { userId: string }).userId !== userId)
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return NextResponse.json(presentExpense(expense as never))
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!mongoose.isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const role = user?.role || 'employee'

  await connectDB()
  const existingExpense = await Expense.findOne({ _id: params.id, orgId })
  if (!existingExpense) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (role === 'employee') {
    if ((existingExpense as unknown as { userId: string }).userId !== userId)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (existingExpense.status !== 'returned')
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid request', fields: ['body'] }, { status: 400 })
  }
  // Whitelist + validate by role — an employee resubmitting must not be able to inject userId/approvedBy/paidBy
  // (or pre-approve their own line items), and an approver must not be able to edit amounts or, unless admin,
  // payment details.
  let updates: Record<string, unknown>
  let newRefs: string[] = []
  if (role === 'employee') {
    const checked = validateExpense(pick(body, EXPENSE_CREATE_FIELDS), 'update', {
      orgId, expenseId: params.id,
      existingReceipts: storedReceipts(existingExpense), existingLineReceipts: storedLineReceipts(existingExpense),
    })
    if ('problems' in checked) return NextResponse.json(checked.problems, { status: 400 })
    updates = checked.data
    newRefs = checked.newRefs
    const attach = await checkNewReceipts(newRefs, orgId, params.id)
    if (attach) return attach
  } else {
    const checked = validateReview(body, role)
    if ('problems' in checked) return NextResponse.json(checked.problems, { status: 400 })
    updates = checked.data
  }

  if (updates.travelRequestId) {
    if (!mongoose.isValidObjectId(updates.travelRequestId as string)) {
      return NextResponse.json({ error: 'Invalid travelRequestId' }, { status: 400 })
    }
    const tr = await TravelRequest.findOne({ _id: updates.travelRequestId, orgId })
    if (!tr) {
      return NextResponse.json({ error: 'Referenced travel request not found in this organization' }, { status: 404 })
    }
  }

  // Reviewers also approve/reject individual line items via a positional path
  // (`lineItems.3.status`). Allowed explicitly — the generic whitelist can't
  // express it, and a blanket dotted-key pass would reopen mass-assignment.
  let touchedLineItems = false
  if (role !== 'employee') {
    for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
      const m = /^lineItems\.(\d+)\.status$/.exec(key)
      if (m && (value === 'approved' || value === 'rejected')) {
        // The index must name an existing line. MongoDB would otherwise PAD the array up to it with empty elements
        // (`lineItems.99.status` on a 3-line claim → 100 lines, and later writes fail validation).
        if (Number(m[1]) >= (existingExpense.lineItems?.length ?? 0)) {
          return NextResponse.json({ error: 'Invalid line item', fields: [key] }, { status: 400 })
        }
        updates[key] = value
        touchedLineItems = true
      }
    }
  }

  let selfApproved = false
  // Per-line-item approval is an approval decision too — same separation of
  // duties as a whole-expense transition, or it becomes the obvious bypass.
  if (touchedLineItems) {
    const check = selfApprovalCheck(userId, role, existingExpense.userId)
    if (check.blocked) return NextResponse.json({ error: SELF_APPROVAL_ERROR }, { status: 403 })
    selfApproved = check.selfApproved
  }

  if (role === 'employee') {
    updates.status = 'pending_manager'
  } else if (updates.status !== undefined) {
    const VALID_TRANSITIONS: Record<string, string[]> = {
      pending_manager: ['pending_admin', 'rejected', 'returned'],
      pending_admin:    ['paid', 'rejected', 'pending_manager'],
      paid:            [],
      rejected:        [],
      returned:        [],
    }
    if (!VALID_TRANSITIONS[existingExpense.status]?.includes(updates.status as string)) {
      return NextResponse.json({ error: `Cannot move from ${existingExpense.status} to ${updates.status}` }, { status: 409 })
    }
    if (updates.status === 'paid' && role !== 'admin') {
      return NextResponse.json({ error: 'Only the boss can mark expenses as paid' }, { status: 403 })
    }
    const check = selfApprovalCheck(userId, role, existingExpense.userId)
    if (check.blocked) return NextResponse.json({ error: SELF_APPROVAL_ERROR }, { status: 403 })
    selfApproved = check.selfApproved
  }

  // Optimistic concurrency: the write only lands if the expense is still in the status we validated against.
  // Two approvers acting at once (or a double tap) get one success and one 409 — never a double transition.
  let expense
  try {
    expense = await Expense.findOneAndUpdate(
      { _id: params.id, orgId, status: existingExpense.status },
      updates,
      { returnDocument: 'after', runValidators: true },
    )
  } catch (err) {
    if (err instanceof mongoose.Error.ValidationError || err instanceof mongoose.Error.CastError) {
      return NextResponse.json({ error: 'Invalid expense' }, { status: 400 })
    }
    throw err
  }
  if (!expense) {
    const still = await Expense.exists({ _id: params.id, orgId })
    return still
      ? NextResponse.json({ error: 'This expense was just updated by someone else. Refresh and try again.' }, { status: 409 })
      : NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  // Receipts the employee removed/replaced are no longer referenced: delete them from storage (best-effort, own tenant only).
  if (role === 'employee') {
    const keep = new Set<string>([
      ...((updates.receipts as string[] | undefined) ?? storedReceipts(existingExpense)),
      ...(((updates.lineItems as { receiptUrl?: string }[] | undefined) ?? (existingExpense.lineItems || [])).map(l => l?.receiptUrl).filter(Boolean) as string[]),
    ])
    const before = [...storedReceipts(existingExpense), ...(storedLineReceipts(existingExpense).filter(Boolean) as string[])]
    const dropped = before.filter(u => !keep.has(u))
    if (dropped.length) void destroyAttachments(dropped, orgId)
  }

  const actorName = user?.fullName || user?.firstName || 'Manager'

  const baseAction = role === 'employee' && updates.status === 'pending_manager'
    ? 'expense.resubmitted'
    : updates.status === 'pending_manager' ? 'expense.returned_to_manager'
    : updates.status === 'returned' ? 'expense.returned_to_employee'
    : `expense.${updates.status}`
  const auditAction = selfApproved ? `${baseAction}.self_approved` : baseAction

  writeAudit({
    action:          auditAction,
    performedBy:     userId,
    performedByName: actorName,
    targetId:        params.id,
    targetType:      'expense',
    metadata:        { status: updates.status, employeeName: expense.userName, amount: expense.amount, note: updates.managerNote || updates.adminNote, ...(selfApproved ? { selfApproved: true } : {}) },
    orgId,
  })

  // Notify boss(es) when manager approves (pending_admin)
  if (updates.status === 'pending_admin') {
    ;(async () => {
      try {
        const users = await listUsers({ limit: 500, orgId })
        const bosses = users.filter(u => u.role === 'admin')
        for (const b of bosses) {
          if (b.email) {
            emailExpensePendingPayout({
              orgId, bossEmail:    b.email,
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
        orgId, employeeEmail: email,
        status,
        title:         expense.title,
        amount:        expense.amount,
        note:          (updates.adminNote || updates.managerNote) as string | undefined,
      })
    })
  }

  return NextResponse.json(presentExpense(expense.toObject()))
}

// Employee withdraws their own returned/pending_manager request; managers/boss can delete any.
export async function DELETE(_req: NextRequest, { params }: { params: { id: string } }) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!mongoose.isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  await connectDB()
  const role = user?.role || 'employee'
  const expense = await Expense.findOne({ _id: params.id, orgId })
  if (!expense) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const isOwner = expense.userId === userId
  const isPriv  = role === 'manager' || role === 'admin'
  const canOwnerDelete = isOwner && (expense.status === 'pending_manager' || expense.status === 'returned')
  if (!isPriv && !canOwnerDelete) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  await expense.deleteOne()
  const files = [...(expense.receipts || []), ...((expense.lineItems || []).map((l: { receiptUrl?: string }) => l.receiptUrl).filter(Boolean) as string[])]
  if (files.length) void destroyAttachments(files, orgId)
  writeAudit({
    action:          isOwner ? 'expense.withdrawn' : 'expense.deleted',
    performedBy:     userId,
    performedByName: user?.fullName || user?.firstName || 'User',
    targetId:        params.id,
    targetType:      'expense',
    metadata:        { title: expense.title, amount: expense.amount, status: expense.status, employeeName: expense.userName },
    orgId,
  })
  return NextResponse.json({ success: true })
}
