import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { randomBytes } from 'crypto'
import { connectDB } from '@/lib/db'
import SharedDashboard from '@/models/SharedDashboard'
import { getUser } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { rateLimit } from '@/lib/ratelimit'

const EXPIRY_MS: Record<string, number | null> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d':  7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
  'never': null,
}

const VALID_TILE_SIZES = new Set(['sm', 'md', 'lg'])
const MAX_LAYOUT_ENTRIES = 50
const MAX_FILTER_LENGTH = 100

// List existing shares for the current owner
async function GET_handler() {
  const { userId, orgId } = await getUser()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!(await rateLimit(`share-list:${userId}`, 60, 60_000))) {
    return NextResponse.json({ error: 'Too many requests', code: 'rate_limited' }, { status: 429 })
  }

  await connectDB()
  const shares = await SharedDashboard.find({ ownerId: userId, orgId }).sort({ createdAt: -1 }).lean()
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
async function POST_handler(req: NextRequest) {
  const { userId, user, orgId } = await getUser()
  if (!userId || !user || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!(await rateLimit(`share-create:${userId}`, 30, 60_000))) {
    return NextResponse.json({ error: 'Too many requests', code: 'rate_limited' }, { status: 429 })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { layout, filters, expiry } = body as {
    layout?: unknown
    filters?: unknown
    expiry?: unknown
  }

  if (!Array.isArray(layout) || layout.length === 0) {
    return NextResponse.json({ error: 'A non-empty layout snapshot is required' }, { status: 400 })
  }

  if (layout.length > MAX_LAYOUT_ENTRIES) {
    return NextResponse.json({ error: `Layout exceeds maximum allowed tile count of ${MAX_LAYOUT_ENTRIES}` }, { status: 400 })
  }

  const sanitizedLayout: { id: string; size: 'sm' | 'md' | 'lg' }[] = []
  for (const item of layout) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return NextResponse.json({ error: 'Invalid layout item format' }, { status: 400 })
    }
    const { id, size } = item as { id?: unknown; size?: unknown }
    if (typeof id !== 'string' || !id.trim() || id.length > 80) {
      return NextResponse.json({ error: 'Invalid tile id in layout' }, { status: 400 })
    }
    const validSize = typeof size === 'string' && VALID_TILE_SIZES.has(size) ? (size as 'sm' | 'md' | 'lg') : 'sm'
    sanitizedLayout.push({ id: id.trim(), size: validSize })
  }

  const sanitizedFilters = {
    from: '',
    to: '',
    dept: '',
    employee: '',
    status: '',
  }

  if (filters && typeof filters === 'object' && !Array.isArray(filters)) {
    const f = filters as Record<string, unknown>
    for (const key of ['from', 'to', 'dept', 'employee', 'status'] as const) {
      if (typeof f[key] === 'string') {
        sanitizedFilters[key] = (f[key] as string).slice(0, MAX_FILTER_LENGTH).trim()
      }
    }
  }

  if (expiry !== undefined && typeof expiry !== 'string') {
    return NextResponse.json({ error: 'Invalid expiry format' }, { status: 400 })
  }

  const ms = typeof expiry === 'string' && expiry in EXPIRY_MS ? EXPIRY_MS[expiry] : EXPIRY_MS['7d']
  const token = randomBytes(16).toString('hex') // 32 hex chars

  await connectDB()
  const created = await SharedDashboard.create({
    orgId,
    token,
    ownerId:   userId,
    ownerName: user.fullName || `${user.firstName || ''} ${user.lastName || ''}`.trim() || 'DoppelDash User',
    ownerRole: user.role,
    layout:    sanitizedLayout,
    filters:   sanitizedFilters,
    expiresAt: ms === null ? null : new Date(Date.now() + ms),
  })

  // The token is a bearer secret: it is never written to the log (the record id identifies the share).
  await writeAudit({
    action: 'analytics.share_created', performedBy: userId, performedByName: user.fullName || 'User',
    targetId: String(created._id), targetType: 'share', orgId, metadata: { expiry: typeof expiry === 'string' && expiry in EXPIRY_MS ? expiry : '7d', tiles: sanitizedLayout.length },
  })
  return NextResponse.json({ token, url: `/shared/${token}` })
}

export const GET = dbGuard(GET_handler)
export const POST = dbGuard(POST_handler)
