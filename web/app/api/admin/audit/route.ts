import { NextRequest, NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { connectDB } from '@/lib/db'
import AuditLog from '@/models/AuditLog'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const me = await currentUser().catch(() => null)
  if ((me?.unsafeMetadata?.role as string) !== 'boss')
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await connectDB()
  const { searchParams } = new URL(req.url)
  const targetType = searchParams.get('type')
  const from       = searchParams.get('from')
  const to         = searchParams.get('to')
  const limit      = Math.min(Number(searchParams.get('limit') || 100), 500)

  const match: Record<string, unknown> = {}
  if (targetType) match.targetType = targetType
  if (from || to) {
    match.createdAt = {}
    if (from) (match.createdAt as Record<string, Date>).$gte = new Date(from)
    if (to)   (match.createdAt as Record<string, Date>).$lte = new Date(to + 'T23:59:59')
  }

  const logs = await AuditLog.find(match).sort({ createdAt: -1 }).limit(limit).lean()
  return NextResponse.json(logs)
}
