import { NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Employee from '@/models/Employee'
import Leave from '@/models/Leave'
import Expense from '@/models/Expense'
import TravelRequest from '@/models/TravelRequest'
import { getUser, listUsers } from '@/lib/auth'

export async function GET() {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const role = user?.role || 'employee'
  if (role !== 'boss' && role !== 'manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await connectDB()

  const clerkUsers = await listUsers({ limit: 500 })

  const employees = await Employee.find({}, 'clerkUserId firstName lastName lastLoginAt lastActiveAt loginCount onboardingComplete department').lean()
  const empMap    = new Map(employees.map(e => [e.clerkUserId, e]))

  const now   = Date.now()
  const day7  = now - 7  * 24 * 60 * 60 * 1000
  const day30 = now - 30 * 24 * 60 * 60 * 1000

  const userStats = clerkUsers.map(u => {
    const emp = empMap.get(u.id)
    const lastLogin = emp?.lastLoginAt ? new Date(emp.lastLoginAt).getTime() : (u.lastActiveAt || 0)
    return {
      id:         u.id,
      name:       u.fullName || `${u.firstName} ${u.lastName}`.trim(),
      email:      u.email || '',
      role:       u.role || 'employee',
      department: emp?.department || '—',
      lastLoginAt: emp?.lastLoginAt || null,
      loginCount:  emp?.loginCount || 0,
      onboardingComplete: emp?.onboardingComplete ?? true,
      activeIn7d:  lastLogin > day7,
      activeIn30d: lastLogin > day30,
    }
  })

  // Aggregate counts
  const totalUsers     = userStats.length
  const activeIn7d     = userStats.filter(u => u.activeIn7d).length
  const activeIn30d    = userStats.filter(u => u.activeIn30d).length
  const onboardingPend = userStats.filter(u => !u.onboardingComplete).length

  // Feature usage (last 30 days)
  const since30 = new Date(day30)
  const [leavesCount, expensesCount, travelCount] = await Promise.all([
    Leave.countDocuments({ createdAt: { $gte: since30 } }),
    Expense.countDocuments({ createdAt: { $gte: since30 } }),
    TravelRequest.countDocuments({ createdAt: { $gte: since30 } }),
  ])

  // Login activity by day (last 30 days) — approximate from Clerk lastActiveAt
  const loginByDay: Record<string, number> = {}
  userStats.forEach(u => {
    if (!u.lastLoginAt) return
    const d = new Date(u.lastLoginAt).toISOString().split('T')[0]
    loginByDay[d] = (loginByDay[d] || 0) + 1
  })

  return NextResponse.json({
    summary: { totalUsers, activeIn7d, activeIn30d, onboardingPend },
    featureUsage: { leaves: leavesCount, expenses: expensesCount, travel: travelCount },
    users: userStats.sort((a, b) => (b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0) - (a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0)),
    loginByDay,
  })
}
