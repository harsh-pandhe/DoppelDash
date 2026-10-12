import crypto from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import PasswordResetToken from '@/models/PasswordResetToken'
import { rateLimit } from '@/lib/ratelimit'
import { getMailService } from '@/lib/mail'
import { devOnly } from '@/lib/auth/devShortcuts'

export async function POST(req: NextRequest) {
  const ip = (req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim()
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
  if (!email || email.length > 254) {
    return NextResponse.json({ error: 'Email is required' }, { status: 400 })
  }

  // Per-address cap so one inbox cannot be flooded from many IPs. Counted whether or
  // not the account exists, so the response never reveals which addresses are real.
  const emailKey = crypto.createHash('sha256').update(email).digest('hex').slice(0, 32)
  const underCap = await rateLimit(`pwd-reset-req-acct:${emailKey}`, 5, 60 * 60_000)

  await connectDB()

  // Always return the same generic response — no account enumeration, and no
  // signal when mail delivery fails.
  const genericMessage = 'If an account exists for this email, a password reset link has been sent.'

  const user = underCap ? await User.findOne({ email }) : null

  // Unknown / suspended / orgless accounts get the generic answer and nothing else.
  if (!user || !user.isActive || user.isBanned || !user.orgId) {
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

  // Persist token record (ONLY the hash is stored)
  await PasswordResetToken.create({
    userId: user._id,
    email: user.email,
    orgId: user.orgId,
    tokenHash,
    expiresAt,
  })

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  // The token rides in the URL FRAGMENT: browsers never send it to the server, so it cannot reach
  // access logs, proxies or Referer headers. The reset page reads it client-side and POSTs it in a body.
  const resetUrl = `${appUrl}/reset-password#token=${rawToken}`

  // Delivery goes through the platform mail provider. A failure is logged safely
  // inside the mail layer and deliberately NOT surfaced (it would leak existence).
  await getMailService().sendPasswordReset({ to: user.email, firstName: user.firstName, resetUrl, orgId: user.orgId })

  // The reset URL is echoed ONLY on a developer machine (devOnly() is undefined in
  // production and on any deploy platform, so the key never serialises there).
  return NextResponse.json({ message: genericMessage, resetUrl: devOnly(resetUrl) }, { status: 200 })
}
