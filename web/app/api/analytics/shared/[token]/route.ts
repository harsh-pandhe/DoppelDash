import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { connectDB } from '@/lib/db'
import SharedDashboard from '@/models/SharedDashboard'
import { computeAnalytics } from '@/lib/analytics/compute'
import { rateLimit } from '@/lib/ratelimit'

const TOKEN_REGEX = /^[a-f0-9]{32}$/i

/**
 * PUBLIC (no auth) — resolve a share token, enforce expiry, then run the analytics
 * aggregation scoped to the OWNER's identity + role at share time. Read-only.
 * Never imports an auth helper that throws on missing session.
 */
async function GET_handler(req: NextRequest, { params: paramsPromise }: { params: Promise<{ token: string }> }) {
  const params = await paramsPromise
  const token = params?.token
  if (!token || typeof token !== 'string' || !TOKEN_REGEX.test(token)) {
    return NextResponse.json({ error: 'This shared dashboard does not exist.' }, { status: 404 })
  }

  const ip = (req.headers.get('x-forwarded-for') || '127.0.0.1').split(',')[0].trim()
  if (!(await rateLimit(`shared-analytics:${ip}`, 60, 60_000))) {
    return NextResponse.json({ error: 'Too many requests', code: 'rate_limited' }, { status: 429 })
  }

  if (!(await rateLimit(`shared-token:${token}`, 120, 60_000))) {
    return NextResponse.json({ error: 'Too many requests', code: 'rate_limited' }, { status: 429 })
  }

  await connectDB()
  const share = await SharedDashboard.findOne({ token })
  if (!share || !share.orgId) {
    return NextResponse.json({ error: 'This shared dashboard does not exist.' }, { status: 404 })
  }

  if (share.expiresAt && new Date(share.expiresAt) < new Date()) {
    return NextResponse.json({ error: 'This shared link has expired.', expired: true }, { status: 410 })
  }

  // Bump view count (best-effort, non-blocking on failure)
  SharedDashboard.updateOne({ _id: share._id }, { $inc: { viewCount: 1 } }).catch(() => {})

  const f = share.filters || ({} as typeof share.filters)
  const data = await computeAnalytics(share.ownerId, share.ownerRole, {
    from: f.from || null, to: f.to || null,
    dept: f.dept || '', employee: f.employee || '', status: f.status || '',
    compare: 'none',
    includeFilterOptions: false,   // no interactive filters on a read-only share
  }, share.orgId)

  // Public data minimization: sanitize any sensitive user IDs or raw audit metadata
  const sanitizedTopSpenders = (data.topSpenders || []).map((s, idx) => ({
    userId: `sp_${idx + 1}`,
    userName: s.userName,
    total: s.total,
    count: s.count,
  }))

  const sanitizedRecentAudits = (data.recentAudits || []).map(a => {
    const rawMeta = (a.metadata || {}) as Record<string, unknown>
    const safeMeta: Record<string, unknown> = {}
    if (typeof rawMeta.employeeName === 'string') safeMeta.employeeName = rawMeta.employeeName
    if (typeof rawMeta.amount === 'number') safeMeta.amount = rawMeta.amount
    if (typeof rawMeta.days === 'number') safeMeta.days = rawMeta.days
    if (typeof rawMeta.destination === 'string') safeMeta.destination = rawMeta.destination

    return {
      action: a.action,
      performedByName: a.performedByName,
      createdAt: a.createdAt,
      metadata: safeMeta,
    }
  })

  return NextResponse.json({
    readOnly:  true,
    ownerName: share.ownerName,
    expiresAt: share.expiresAt,
    layout:    share.layout,
    data: {
      ...data,
      topSpenders: sanitizedTopSpenders,
      recentAudits: sanitizedRecentAudits,
      filterOptions: undefined,
    },
  })
}

export const GET = dbGuard(GET_handler)
