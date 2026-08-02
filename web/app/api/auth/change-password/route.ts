import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { connectDB } from '@/lib/db'
import User from '@/models/User'

export async function POST(req: NextRequest) {
  const { userId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { currentPassword, newPassword } = await req.json()
  if (!newPassword || newPassword.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }

  await connectDB()
  const user = await User.findById(userId)
  if (!user) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // If not first-login, current password is mandatory and must verify —
  // omitting it must never bypass the check (that would let any live
  // session change the password with no re-auth).
  if (!user.mustChangePassword) {
    if (!currentPassword) return NextResponse.json({ error: 'Current password required' }, { status: 400 })
    const ok = await user.checkPassword(currentPassword)
    if (!ok) return NextResponse.json({ error: 'Current password incorrect' }, { status: 401 })
  }

  const hash = await User.hashPassword(newPassword)
  await User.findByIdAndUpdate(userId, {
    passwordHash:       hash,
    mustChangePassword: false,
  })

  return NextResponse.json({ ok: true })
}
