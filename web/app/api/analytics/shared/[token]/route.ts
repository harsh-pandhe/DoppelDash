import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import SharedDashboard from '@/models/SharedDashboard'
import { computeAnalytics } from '@/lib/analytics/compute'

/**
 * PUBLIC (no auth) — resolve a share token, enforce expiry, then run the analytics
 * aggregation scoped to the OWNER's identity + role at share time. Read-only.
 * Never imports an auth helper that throws on missing session.
 */
export async function GET(_req: NextRequest, { params }: { params: { token: string } }) {
  await connectDB()
  const share = await SharedDashboard.findOne({ token: params.token })
  if (!share) return NextResponse.json({ error: 'This shared dashboard does not exist.' }, { status: 404 })

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
  }, share.orgId || 'org_doppelmayr')

  return NextResponse.json({
    readOnly:  true,
    ownerName: share.ownerName,
    expiresAt: share.expiresAt,
    layout:    share.layout,
    data,
  })
}
