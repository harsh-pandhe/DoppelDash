import { NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Leave from '@/models/Leave'
import LeaveBalance from '@/models/LeaveBalance'
import { getUser } from '@/lib/auth'

const TYPES = ['casual', 'sick', 'earned', 'privilege', 'restricted'] as const
const DEFAULTS = { casual: 12, sick: 6, earned: 15, privilege: 2, restricted: 2, lwpDays: 0 }

/**
 * Returns the authenticated user's leave balance for the current year.
 * Entitlement comes from LeaveBalance (upserted with defaults).
 * Used = sum of approved days in calendar year, per type.
 * `medical` is legacy data — counted as `sick` for backwards compatibility.
 */
export async function GET() {
  const { userId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await connectDB()
  const year = new Date().getFullYear()

  const balance = await LeaveBalance.findOneAndUpdate(
    { userId, year },
    { $setOnInsert: { ...DEFAULTS, userId, year } },
    { upsert: true, returnDocument: 'after' },
  ).lean()

  const yearStart = new Date(year, 0, 1)
  const yearEnd   = new Date(year + 1, 0, 1)

  const usedAgg = await Leave.aggregate([
    { $match: { userId, status: 'approved', startDate: { $gte: yearStart, $lt: yearEnd } } },
    { $group: { _id: '$type', days: { $sum: '$days' } } },
  ])

  const usedMap: Record<string, number> = {}
  for (const row of usedAgg) {
    const t = row._id === 'medical' ? 'sick' : row._id
    usedMap[t] = (usedMap[t] || 0) + (row.days || 0)
  }

  const result: Record<string, { entitlement: number; used: number; remaining: number }> = {}
  for (const t of TYPES) {
    const entitlement = (balance as unknown as Record<string, number> | null)?.[t] ?? DEFAULTS[t as keyof typeof DEFAULTS]
    const used        = usedMap[t] || 0
    result[t] = { entitlement, used, remaining: Math.max(0, entitlement - used) }
  }

  return NextResponse.json({
    year,
    balance: result,
    lwpDays: usedMap['lwp'] || 0,
  })
}
