import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { connectDB } from '@/lib/db'
import SharedDashboard from '@/models/SharedDashboard'
import { getUser } from '@/lib/auth'
import { rateLimit } from '@/lib/ratelimit'

const TOKEN_REGEX = /^[a-f0-9]{32}$/i

// Revoke a share — owner only
async function DELETE_handler(_req: NextRequest, { params: paramsPromise }: { params: Promise<{ token: string }> }) {
  const params = await paramsPromise
  const { userId, orgId } = await getUser()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!(await rateLimit(`share-revoke:${userId}`, 30, 60_000))) {
    return NextResponse.json({ error: 'Too many requests', code: 'rate_limited' }, { status: 429 })
  }

  const token = params?.token
  if (!token || typeof token !== 'string' || !TOKEN_REGEX.test(token)) {
    return NextResponse.json({ error: 'Invalid or malformed share token' }, { status: 400 })
  }

  await connectDB()
  const res = await SharedDashboard.deleteOne({ token, ownerId: userId, orgId })
  if (res.deletedCount === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

export const DELETE = dbGuard(DELETE_handler)
