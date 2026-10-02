import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import PasswordResetToken from '@/models/PasswordResetToken'
import { rateLimit } from '@/lib/ratelimit'

/**
 * GET /api/auth/password-reset/confirm?token=...
 * Inspects token validity for UI rendering before form submission.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) {
    return NextResponse.json({ valid: false, reason: 'missing_token', error: 'Reset token is required' }, { status: 400 })
  }

  await connectDB()
  const tokenHash = PasswordResetToken.hashToken(token)
  const tokenDoc = await PasswordResetToken.findOne({ tokenHash }).lean()

  if (!tokenDoc) {
    return NextResponse.json({ valid: false, reason: 'invalid_token', error: 'Invalid or unrecognized password reset token' }, { status: 404 })
  }

  if (tokenDoc.usedAt) {
    return NextResponse.json({ valid: false, reason: 'already_used', error: 'This password reset link has already been used' }, { status: 410 })
  }

  if (new Date(tokenDoc.expiresAt) <= new Date()) {
    return NextResponse.json({ valid: false, reason: 'expired', error: 'This password reset link has expired' }, { status: 410 })
  }

  return NextResponse.json({
    valid: true,
    email: tokenDoc.email,
  })
}

/**
 * POST /api/auth/password-reset/confirm
 * Atomically consumes the token and updates the user's password.
 */
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || 'unknown'
  if (!(await rateLimit(`pwd-reset-confirm-ip:${ip}`, 10, 60_000))) {
    return NextResponse.json({ error: 'Too many reset attempts — please wait 1 minute' }, { status: 429 })
  }

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const token = typeof body.token === 'string' ? body.token.trim() : ''
  const newPassword = typeof body.newPassword === 'string' ? body.newPassword : ''

  if (!token) {
    return NextResponse.json({ error: 'Reset token is required' }, { status: 400 })
  }

  if (!newPassword || newPassword.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
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

  return NextResponse.json(
    { message: 'Password has been reset successfully' },
    { status: 200 }
  )
}
