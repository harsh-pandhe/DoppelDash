import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { readJsonObject } from '@/lib/http/body'
import { getUser, COOKIE_NAME, COOKIE_OPTS, revokeAllMobileRefreshTokens } from '@/lib/auth'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import { rateLimit } from '@/lib/ratelimit'
import { writeAudit } from '@/lib/audit'

async function POST_handler(req: NextRequest) {
  const { userId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!(await rateLimit(`change-pwd:${userId}`, 5, 60_000))) {
    return NextResponse.json({ error: 'Too many password change attempts — please wait 1 minute' }, { status: 429 })
  }

  let body: Record<string, unknown> = {}
  {
    const parsedJson = await readJsonObject(req)
    if (!parsedJson) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    body = parsedJson as typeof body
  }

  const currentPassword = typeof body.currentPassword === 'string' ? body.currentPassword : ''
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''

  if (!newPassword || newPassword.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }
  if (newPassword.length > 128) {
    return NextResponse.json({ error: 'Password is too long' }, { status: 400 })
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
  // Bumping sessionVersion kills every web session and every outstanding access
  // token; revoking the refresh rows kills every mobile device (including this
  // one — same semantics as web: the user signs in again).
  await User.findByIdAndUpdate(userId, {
    passwordHash:       hash,
    mustChangePassword: false,
    $inc:               { sessionVersion: 1 },
  })
  await revokeAllMobileRefreshTokens(userId, 'password_change')
  // No password material in the log — only that it happened and whether it was the forced first-login change.
  await writeAudit({
    action: 'auth.password_changed', performedBy: userId, performedByName: `${user.firstName} ${user.lastName}`.trim() || 'User',
    targetId: userId, targetType: 'auth', orgId: user.orgId, metadata: { forced: !!user.mustChangePassword },
  })

  const res = NextResponse.json({ ok: true, message: 'Password updated. Please sign in again.' })
  res.cookies.set(COOKIE_NAME, '', { ...COOKIE_OPTS, maxAge: 0, path: '/' })
  return res
}

export const POST = dbGuard(POST_handler)
