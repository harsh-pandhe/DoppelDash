import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import SharedDashboard from '@/models/SharedDashboard'
import { getUser } from '@/lib/auth'

// Revoke a share — owner only
export async function DELETE(_req: NextRequest, { params }: { params: { token: string } }) {
  const { userId, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const effectiveOrgId = orgId || 'org_doppelmayr'
  await connectDB()
  const res = await SharedDashboard.deleteOne({ token: params.token, ownerId: userId, orgId: effectiveOrgId })
  if (res.deletedCount === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
