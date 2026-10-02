import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import AuditLog from '@/models/AuditLog'
import { getUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ((user?.role) !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await connectDB()
  const { searchParams } = new URL(req.url)
  const targetType = searchParams.get('type')
  const action     = searchParams.get('action')
  const performer  = searchParams.get('performer')   // performedBy userId
  const q          = searchParams.get('q')           // free-text search across action + performedByName
  const from       = searchParams.get('from')
  const to         = searchParams.get('to')
  const limit      = Math.min(Number(searchParams.get('limit') || 50), 200)
  const skip       = Math.max(0, Number(searchParams.get('skip') || 0))
  const effectiveOrgId = orgId || 'org_doppelmayr'
  const match: Record<string, unknown> = { orgId: effectiveOrgId }
  // UI filter 'travel' maps to the travel_request targetType
  if (targetType) match.targetType = targetType === 'travel' ? 'travel_request' : targetType
  if (action)     match.action     = action
  if (performer)  match.performedBy = performer
  if (q) {
    const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')
    match.$or = [{ action: rx }, { performedByName: rx }]
  }
  if (from || to) {
    match.createdAt = {}
    if (from) (match.createdAt as Record<string, Date>).$gte = new Date(from)
    if (to)   (match.createdAt as Record<string, Date>).$lte = new Date(to + 'T23:59:59')
  }

  const [logs, total] = await Promise.all([
    AuditLog.find(match).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    AuditLog.countDocuments(match),
  ])
  return NextResponse.json({ logs, total, hasMore: skip + logs.length < total })
}
