import { NextRequest, NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { connectDB } from '@/lib/db'
import SharedDashboard from '@/models/SharedDashboard'
import { getUser } from '@/lib/auth'

const EXPIRY_MS: Record<string, number | null> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d':  7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  'never': null,
}

// List existing shares for the current owner
export async function GET() {
  const { userId, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const effectiveOrgId = orgId
  await connectDB()
  const shares = await SharedDashboard.find({ ownerId: userId, orgId: effectiveOrgId }).sort({ createdAt: -1 }).lean()
  return NextResponse.json({
    shares: shares.map(s => ({
      token:     s.token,
      expiresAt: s.expiresAt,
      viewCount: s.viewCount,
      createdAt: s.createdAt,
      expired:   !!s.expiresAt && new Date(s.expiresAt) < new Date(),
    })),
  })
}

// Create a new share token from the supplied layout + filters snapshot
export async function POST(req: NextRequest) {
  const { userId, user, orgId } = await getUser()
  if (!userId || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const effectiveOrgId = orgId
  await connectDB()

  const body = await req.json().catch(() => ({}))
  const { layout, filters, expiry } = body as {
    layout?: unknown
    filters?: { from?: string; to?: string; dept?: string; employee?: string; status?: string }
    expiry?: string
  }
  if (!Array.isArray(layout) || layout.length === 0) {
    return NextResponse.json({ error: 'A non-empty layout snapshot is required' }, { status: 400 })
  }

  const ms = expiry && expiry in EXPIRY_MS ? EXPIRY_MS[expiry] : EXPIRY_MS['7d']
  const token = randomBytes(16).toString('hex')   // 32 hex chars, unguessable

  await SharedDashboard.create({
    orgId:     effectiveOrgId,
    token,
    ownerId:   userId,
    ownerName: user.fullName || `${user.firstName} ${user.lastName}`.trim(),
    ownerRole: user.role,
    layout,
    filters: {
      from:     filters?.from     || '',
      to:       filters?.to       || '',
      dept:     filters?.dept     || '',
      employee: filters?.employee || '',
      status:   filters?.status   || '',
    },
    expiresAt: ms === null ? null : new Date(Date.now() + ms),
  })

  return NextResponse.json({ token, url: `/shared/${token}` })
}
