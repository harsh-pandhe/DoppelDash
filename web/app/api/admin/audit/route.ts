import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import AuditLog from '@/models/AuditLog'
import { getUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if ((user?.role) !== 'boss') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await connectDB()
  const { searchParams } = new URL(req.url)
  const targetType = searchParams.get('type')
  const action     = searchParams.get('action')
  const performer  = searchParams.get('performer')   // performedBy userId
  const q          = searchParams.get('q')           // free-text search across action + performedByName
  const from       = searchParams.get('from')
  const to         = searchParams.get('to')
  const limit      = Math.min(Number(searchParams.get('limit') || 100), 500)

  const match: Record<string, unknown> = {}
  if (targetType) match.targetType = targetType
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

  const logs = await AuditLog.find(match).sort({ createdAt: -1 }).limit(limit).lean()
  return NextResponse.json(logs)
}
