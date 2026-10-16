import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { getUser } from '@/lib/auth'
import { computeAnalytics } from '@/lib/analytics/compute'

async function GET_handler(req: NextRequest) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const effectiveOrgId = orgId
  const data = await computeAnalytics(userId, user?.role || 'employee', {
    from:     url.searchParams.get('from'),
    to:       url.searchParams.get('to'),
    dept:     url.searchParams.get('dept')     || '',
    employee: url.searchParams.get('employee') || '',
    status:   url.searchParams.get('status')   || '',
    compare:  url.searchParams.get('compare')  || 'none',
    includeFilterOptions: true,
  }, effectiveOrgId)

  return NextResponse.json(data)
}

export const GET = dbGuard(GET_handler)
