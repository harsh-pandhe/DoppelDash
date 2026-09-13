import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Leave from '@/models/Leave'
import Employee from '@/models/Employee'
import { getUser, listUsers } from '@/lib/auth'

// Team workload heatmap: for each team member, which of the next N days they're
// on approved leave. Manager/boss only.
export async function GET(req: NextRequest) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  if (role !== 'manager' && role !== 'admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await connectDB()
  const days = Math.min(60, Math.max(7, Number(new URL(req.url).searchParams.get('days')) || 14))

  const start = new Date(); start.setHours(0, 0, 0, 0)
  const end = new Date(start); end.setDate(end.getDate() + days - 1); end.setHours(23, 59, 59, 999)

  const clerkUsers = await listUsers({ limit: 500, orgId })
  const employees = await Employee.find({ orgId, isActive: true }, 'clerkUserId firstName lastName').lean()
  const empMap = new Map(employees.map(e => [e.clerkUserId, e]))

  const roster = clerkUsers
    .filter(u => !u.banned)
    .map(u => {
      const e = empMap.get(u.id)
      return { userId: u.id, name: u.fullName || (e ? `${e.firstName} ${e.lastName}`.trim() : 'Unknown') }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  // Approved leaves overlapping the window
  const leaves = await Leave.find({
    orgId,
    status: 'approved',
    startDate: { $lte: end },
    endDate: { $gte: start },
  }, 'userId type startDate endDate isHalfDay').lean()

  // Build day buckets per user
  const dayKeys: string[] = []
  for (let i = 0; i < days; i++) {
    const d = new Date(start); d.setDate(start.getDate() + i)
    dayKeys.push(d.toISOString().slice(0, 10))
  }

  const byUser: Record<string, Record<string, { type: string; half: boolean }>> = {}
  for (const l of leaves) {
    const s = new Date(l.startDate); s.setHours(0, 0, 0, 0)
    const e = new Date(l.endDate); e.setHours(0, 0, 0, 0)
    for (let d = new Date(Math.max(s.getTime(), start.getTime())); d <= e && d <= end; d.setDate(d.getDate() + 1)) {
      const k = d.toISOString().slice(0, 10)
      byUser[l.userId] ??= {}
      byUser[l.userId][k] = { type: l.type, half: !!l.isHalfDay }
    }
  }

  const rows = roster.map(r => ({
    userId: r.userId,
    name: r.name,
    onLeaveDays: Object.keys(byUser[r.userId] || {}).length,
    cells: dayKeys.map(k => byUser[r.userId]?.[k] || null),
  }))

  return NextResponse.json({ startDate: dayKeys[0], days: dayKeys, rows })
}
