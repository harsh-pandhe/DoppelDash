import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import PasswordResetToken from '@/models/PasswordResetToken'
import { rateLimit } from '@/lib/ratelimit'
import { sendMail } from '@/lib/mailer'

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || 'unknown'
  if (!(await rateLimit(`pwd-reset-req-ip:${ip}`, 5, 60_000))) {
    return NextResponse.json({ error: 'Too many password reset requests — please wait 1 minute' }, { status: 429 })
  }

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.toLowerCase().trim() : ''
  if (!email) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  }

  await connectDB()

  // Always return generic response to prevent account enumeration
  const genericMessage = 'If an account exists for this email, a password reset link has been sent.'

  const user = await User.findOne({ email })

  // If user does not exist or is suspended/inactive, return generic response without error
  if (!user || !user.isActive || user.isBanned) {
    return NextResponse.json({ message: genericMessage }, { status: 200 })
  }

  // Invalidate any previous unused tokens for this user
  await PasswordResetToken.updateMany(
    { userId: user._id, usedAt: { $exists: false } },
    { $set: { usedAt: new Date() } }
  )

  // Generate high-entropy token and hash
  const rawToken = PasswordResetToken.generateRawToken()
  const tokenHash = PasswordResetToken.hashToken(rawToken)
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000) // 1 hour

  // Persist token record (ONLY hash is stored in DB)
  await PasswordResetToken.create({
    userId: user._id,
    email: user.email,
    orgId: user.orgId || 'org_doppelmayr',
    tokenHash,
    expiresAt,
  })

  // Format password reset URL
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const resetUrl = `${appUrl}/reset-password?token=${rawToken}`

  // Outbound email notification
  await sendMail({
    to: user.email,
    subject: 'Reset your DoppelDash password',
    text: `Hello ${user.firstName},\n\nA password reset was requested for your DoppelDash account.\n\nUse the link below to set a new password:\n${resetUrl}\n\nThis link expires in 1 hour and can only be used once.\n\nIf you did not request this, please ignore this email.`,
    html: `
      <p>Hello ${user.firstName},</p>
      <p>A password reset was requested for your DoppelDash account.</p>
      <p><a href="${resetUrl}" style="display:inline-block;padding:10px 20px;background:#0057A8;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:bold;">Reset Password</a></p>
      <p>Or paste this link into your browser:<br/><a href="${resetUrl}">${resetUrl}</a></p>
      <p><small>This link expires in 1 hour and can only be used once. If you did not request this, please ignore this email.</small></p>
    `,
  })

  // Never log the raw token to stdout or server logs
  const responseData: Record<string, unknown> = { message: genericMessage }

  // Expose resetUrl in non-production environments to facilitate automated testing without configured SMTP
  if (process.env.NODE_ENV !== 'production') {
    responseData.resetUrl = resetUrl
  }

  return NextResponse.json(responseData, { status: 200 })
}
