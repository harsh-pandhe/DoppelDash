import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import mongoose from 'mongoose'
import { connectDB } from '@/lib/db'
import Expense from '@/models/Expense'
import TravelRequest from '@/models/TravelRequest'
import { emailExpenseSubmitted } from '@/lib/email'
import { getUser } from '@/lib/auth'
import { notifyTargetsFor } from '@/lib/notify-targets'
import { pick } from '@/lib/pick'
import { EXPENSE_CREATE_FIELDS } from '@/lib/apiFields'
import { validateExpense, EXPENSE_STATUSES } from '@/lib/expenses/validation'
import { writeAudit } from '@/lib/audit'
import { presentExpense, checkNewReceipts } from '@/lib/expenses/receipts'

async function GET_handler(req: NextRequest) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  try {
    await connectDB()
    const { searchParams } = new URL(req.url)
    const filter: Record<string, unknown> = role === 'employee' ? { userId, orgId } : { orgId }
    const status = searchParams.get('status')
    const from   = searchParams.get('from')
    const to     = searchParams.get('to')
    if (status) {
      if (!(EXPENSE_STATUSES as readonly string[]).includes(status)) return NextResponse.json({ error: 'Invalid status', fields: ['status'] }, { status: 400 })
      filter.status = status
    }
    if (from || to) {
      const range: Record<string, Date> = {}
      for (const [k, v, op] of [['from', from, '$gte'], ['to', to, '$lte']] as const) {
        if (!v) continue
        const d = new Date(v)
        if (Number.isNaN(d.getTime())) return NextResponse.json({ error: `Invalid ${k} date`, fields: [k] }, { status: 400 })
        range[op] = d
      }
      filter.startDate = range
    }
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '200', 10) || 200, 1), 200)
    const skip  = Math.max(parseInt(searchParams.get('skip') || '0', 10) || 0, 0)
    const expenses = await Expense.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean()
    return NextResponse.json(expenses.map(presentExpense))
  } catch (err) {
    console.error('[RMS GET]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

async function POST_handler(req: NextRequest) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const effectiveOrgId = orgId
  await connectDB()
  const raw = await req.json().catch(() => null)
  const checked = validateExpense(pick(raw, EXPENSE_CREATE_FIELDS), 'create', { orgId: effectiveOrgId })
  if ('problems' in checked) return NextResponse.json(checked.problems, { status: 400 })
  const body = checked.data

  // Idempotency FIRST: a retried or double-tapped submit (same caller, same clientRequestId) must return the claim it already created —
  // including when it carries receipts. Checking attachments first made the retry fail with `attachment_in_use` because the first
  // attempt had already attached them.
  const clientRequestId = body.clientRequestId as string | undefined
  if (clientRequestId) {
    const prior = await Expense.findOne({ orgId: effectiveOrgId, userId, clientRequestId }).lean()
    if (prior) return NextResponse.json(presentExpense(prior as never), { status: 200 })
  }

  const attach = await checkNewReceipts(checked.newRefs, effectiveOrgId)
  if (attach) return attach

  if (body.travelRequestId) {
    if (!mongoose.isValidObjectId(body.travelRequestId)) {
      return NextResponse.json({ error: 'Invalid travelRequestId' }, { status: 400 })
    }
    const tr = await TravelRequest.findOne({ _id: body.travelRequestId, orgId: effectiveOrgId })
    if (!tr) {
      return NextResponse.json({ error: 'Referenced travel request not found in this organization' }, { status: 404 })
    }
  }

  // Duplicate submission without a key: refuse an identical claim created in the last few seconds (the keyed case is handled above).
  if (!clientRequestId) {
    const dup = await Expense.findOne({
      orgId: effectiveOrgId, userId, title: body.title as string, amount: body.amount as number, startDate: body.startDate as Date,
      createdAt: { $gte: new Date(Date.now() - 10_000) },
    }).lean()
    if (dup) return NextResponse.json({ error: 'This expense was just submitted. Refresh to see it.', duplicateOf: String((dup as { _id: unknown })._id) }, { status: 409 })
  }

  let expense
  try {
    expense = await Expense.create({
      ...body,
      userId,
      userName: user?.fullName || user?.firstName || 'Unknown',
      orgId: effectiveOrgId,
      status: 'pending_manager',
    })
  } catch (err) {
    // A malformed client payload is a 400, never a 500 (Android and Web both rely on a meaningful status).
    if (err instanceof mongoose.Error.ValidationError) {
      return NextResponse.json({ error: 'Invalid expense', fields: Object.keys(err.errors) }, { status: 400 })
    }
    // Two concurrent submits with the same idempotency key: the unique index lets exactly one win.
    if ((err as { code?: number })?.code === 11000 && clientRequestId) {
      const prior = await Expense.findOne({ orgId: effectiveOrgId, userId, clientRequestId }).lean()
      if (prior) return NextResponse.json(presentExpense(prior as never), { status: 200 })
    }
    throw err
  }

  await writeAudit({
    action: 'expense.submitted',
    performedBy: userId,
    performedByName: user?.fullName || user?.firstName || user?.email || userId,
    targetId: expense._id.toString(),
    targetType: 'expense',
    metadata: { title: expense.title, amount: expense.amount, employeeName: expense.userName },
    orgId: effectiveOrgId,
  })

  // Notify reporting manager (+ boss); fallback to all managers if no chain set
  ;(async () => {
    try {
      const recipients = await notifyTargetsFor(userId, effectiveOrgId)
      const employeeName = user?.fullName || user?.firstName || 'An employee'
      for (const email of recipients) {
        emailExpenseSubmitted({
          orgId, managerEmail: email,
          employeeName,
          title:  expense.title,
          amount: expense.amount,
        })
      }
    } catch { /* best-effort */ }
  })()

  return NextResponse.json(presentExpense(expense.toObject()), { status: 201 })
}

export const GET = dbGuard(GET_handler)
export const POST = dbGuard(POST_handler)
