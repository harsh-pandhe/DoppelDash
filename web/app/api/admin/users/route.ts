import { NextResponse } from 'next/server'
import { auth, currentUser, clerkClient } from '@clerk/nextjs/server'
import { connectDB } from '@/lib/db'
import LeaveBalance from '@/models/LeaveBalance'

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const me   = await currentUser().catch(() => null)
  const role = (me?.unsafeMetadata?.role as string) || 'employee'
  if (role !== 'boss') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const client    = await clerkClient()
  const { data: users } = await client.users.getUserList({ limit: 100, orderBy: '-created_at' })

  await connectDB()
  const year     = new Date().getFullYear()
  const balances = await LeaveBalance.find({ year }).lean()
  const balMap   = new Map(balances.map(b => [b.userId, b]))

  const result = users.map(u => {
    const bal = balMap.get(u.id)
    return {
      id:        u.id,
      name:      u.fullName || `${u.firstName} ${u.lastName}`.trim(),
      email:     u.primaryEmailAddress?.emailAddress || '',
      role:      (u.unsafeMetadata?.role as string) || 'employee',
      banned:    u.banned,
      lastActive: u.lastActiveAt,
      createdAt: u.createdAt,
      balance:   { casual: bal?.casual ?? 12, medical: bal?.medical ?? 6, earned: bal?.earned ?? 15 },
    }
  })

  return NextResponse.json(result)
}
