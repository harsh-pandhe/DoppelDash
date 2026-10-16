import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { connectDB } from '@/lib/db'
import Leave from '@/models/Leave'
import Expense from '@/models/Expense'
import TravelRequest from '@/models/TravelRequest'
import Employee from '@/models/Employee'
import { getUser } from '@/lib/auth'

/**
 * Drill-down: return the raw rows behind a clicked chart segment.
 * Query: metric=leave|expense|travel, status=<seg>, from, to, dept, employee, page
 * Scoping mirrors /api/analytics — employees see only their own rows.
 */
const PAGE_SIZE = 50

async function GET_handler(req: NextRequest) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const role = user?.role || 'employee'
  const isManager = role === 'manager' || role === 'admin'

  await connectDB()

  const url        = new URL(req.url)
  const metric     = url.searchParams.get('metric') || 'leave'
  const statusQS   = url.searchParams.get('status') || ''
  const fromQS     = url.searchParams.get('from')
  const toQS       = url.searchParams.get('to')
  const deptQS     = url.searchParams.get('dept')     || ''
  const employeeQS = url.searchParams.get('employee') || ''
  const page       = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10))

  const now = new Date()
  const rangeStart = fromQS ? new Date(fromQS) : new Date(now.getFullYear(), now.getMonth() - 5, 1)
  const rangeEnd   = toQS   ? new Date(toQS)   : now
  rangeEnd.setHours(23, 59, 59, 999)

  const effectiveOrgId = orgId

  // Owner scope (same rules as analytics route)
  const ownerFilter: Record<string, unknown> = isManager ? { orgId: effectiveOrgId } : { userId, orgId: effectiveOrgId }
  if (isManager) {
    if (employeeQS) {
      ownerFilter.userId = employeeQS
    } else if (deptQS) {
      const emps = await Employee.find({ orgId: effectiveOrgId, isActive: true, department: deptQS }, 'clerkUserId').lean()
      const ids = emps.map(e => e.clerkUserId)
      ownerFilter.userId = { $in: ids.length ? ids : ['__none__'] }
    }
  }

  const match: Record<string, unknown> = { createdAt: { $gte: rangeStart, $lte: rangeEnd }, ...ownerFilter }
  if (statusQS) match.status = statusQS

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const Model: any = metric === 'expense' ? Expense : metric === 'travel' ? TravelRequest : Leave
  const total = await Model.countDocuments(match)
  const docs  = await Model.find(match)
    .sort({ createdAt: -1 })
    .skip((page - 1) * PAGE_SIZE)
    .limit(PAGE_SIZE)
    .lean()

  // Normalise to a common row shape the drill table understands
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = docs.map((d: any) => {
    const base = {
      id:        String(d._id),
      userName:  d.userName || '—',
      status:    d.status,
      createdAt: d.createdAt,
    }
    if (metric === 'leave') {
      return { ...base, primary: d.type, detail: d.reason, value: d.days ? `${d.days} day${d.days !== 1 ? 's' : ''}` : '', date: d.startDate }
    }
    if (metric === 'expense') {
      return { ...base, primary: d.title || d.description, detail: d.reason, value: d.amount != null ? `₹${Number(d.amount).toLocaleString('en-IN')}` : '', date: d.startDate || d.date }
    }
    // travel
    return { ...base, primary: d.purpose || d.destination, detail: d.destination, value: d.estimatedTotal != null ? `₹${Number(d.estimatedTotal).toLocaleString('en-IN')}` : '', date: d.departureDate }
  })

  return NextResponse.json({
    metric,
    status: statusQS || null,
    range: { from: rangeStart.toISOString(), to: rangeEnd.toISOString() },
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    rows,
  })
}

export const GET = dbGuard(GET_handler)
