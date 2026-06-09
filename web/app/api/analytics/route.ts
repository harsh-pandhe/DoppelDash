import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { computeAnalytics } from '@/lib/analytics/compute'

export async function GET(req: NextRequest) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const data = await computeAnalytics(userId, user?.role || 'employee', {
    from:     url.searchParams.get('from'),
    to:       url.searchParams.get('to'),
    dept:     url.searchParams.get('dept')     || '',
    employee: url.searchParams.get('employee') || '',
    status:   url.searchParams.get('status')   || '',
    compare:  url.searchParams.get('compare')  || 'none',
    includeFilterOptions: true,
  })

  return NextResponse.json(data)
}
