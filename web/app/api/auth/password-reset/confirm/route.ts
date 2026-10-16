import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { readJsonObject } from '@/lib/http/body'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import PasswordResetToken from '@/models/PasswordResetToken'
import { rateLimit } from '@/lib/ratelimit'
import { revokeAllMobileRefreshTokens } from '@/lib/auth/mobileTokens'

// There is intentionally NO GET handler: a reset token must never travel in a URL
// (query strings are written to access logs and proxies). Validity checks use
// POST /api/auth/password-reset/check with the token in the body.

/**
 * POST /api/auth/password-reset/confirm   { token, newPassword }
 * Atomically consumes the token and updates the user's password.
 */
async function POST_handler(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || 'unknown'
  if (!(await rateLimit(`pwd-reset-confirm-ip:${ip}`, 10, 60_000))) {
    return NextResponse.json({ error: 'Too many reset attempts — please wait 1 minute' }, { status: 429 })
  }

  let body: Record<string, unknown> = {}
  {
    const parsedJson = await readJsonObject(req)
    if (!parsedJson) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    body = parsedJson as typeof body
  }

  const token = typeof body.token === 'string' ? body.token.trim() : ''
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''

  if (!token) {
    return NextResponse.json({ error: 'Reset token is required' }, { status: 400 })
  }

  if (!newPassword || newPassword.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }
  if (newPassword.length > 128) {
    return NextResponse.json({ error: 'Password is too long' }, { status: 400 })
  }

  await connectDB()
  const tokenHash = PasswordResetToken.hashToken(token)
  const now = new Date()

  // Atomically consume token to prevent concurrent replay attacks
  const resetTokenDoc = await PasswordResetToken.findOneAndUpdate(
    {
      tokenHash,
      usedAt: { $exists: false },
      expiresAt: { $gt: now },
    },
    { $set: { usedAt: now } },
    { returnDocument: 'after' }
  )

  if (!resetTokenDoc) {
    const existing = await PasswordResetToken.findOne({ tokenHash }).lean()
    if (!existing) {
      return NextResponse.json({ error: 'Invalid or unrecognized password reset token' }, { status: 400 })
    }
    if (existing.usedAt) {
      return NextResponse.json({ error: 'This password reset link has already been used' }, { status: 400 })
    }
    if (new Date(existing.expiresAt) <= now) {
      return NextResponse.json({ error: 'This password reset link has expired' }, { status: 400 })
    }
    return NextResponse.json({ error: 'Unable to reset password' }, { status: 400 })
  }

  // Retrieve user associated with the token
  const user = await User.findById(resetTokenDoc.userId)
  if (!user) {
    return NextResponse.json({ error: 'Account not found' }, { status: 404 })
  }
  if (!user.isActive || user.isBanned) {
    return NextResponse.json({ error: 'Account suspended — contact your administrator' }, { status: 403 })
  }

  // Hash new password and update user
  const passwordHash = await User.hashPassword(newPassword)
  await User.findByIdAndUpdate(user._id, {
    passwordHash,
    mustChangePassword: false,
    $unset: { otp: 1, otpExpiry: 1 },
    $inc:   { sessionVersion: 1 },
  })
  // A reset must not leave any signed-in device alive (web sessions die via the
  // stamp above; mobile refresh rows are revoked explicitly).
  await revokeAllMobileRefreshTokens(user._id.toString(), 'password_reset')

  return NextResponse.json(
    { message: 'Password has been reset successfully' },
    { status: 200 }
  )
}

export const POST = dbGuard(POST_handler)
