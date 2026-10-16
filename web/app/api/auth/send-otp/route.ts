import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { readJsonObject } from '@/lib/http/body'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import { generateOTP, sendOTP, verifyPreAuthToken } from '@/lib/auth'
import { rateLimit } from '@/lib/ratelimit'

/** Send (or resend) the email OTP for a user mid-login. */
async function POST_handler(req: NextRequest) {
  const ip = (req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim()
  let body: { preAuthToken?: unknown } = {}
  {
    const parsedJson = await readJsonObject(req)
    if (!parsedJson) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    body = parsedJson as typeof body
  }
  const userId = typeof body.preAuthToken === 'string' && body.preAuthToken ? await verifyPreAuthToken(body.preAuthToken) : null
  if (!userId) return NextResponse.json({ error: 'Session expired — sign in again' }, { status: 401 })

  if (!(await rateLimit(`send-otp:${ip}:${userId}`, 3, 60_000))) {
    return NextResponse.json({ error: 'Too many requests — wait 1 minute' }, { status: 429 })
  }
  // Per-account cap too, so rotating IPs cannot be used to flood one inbox.
  if (!(await rateLimit(`send-otp:acct:${userId}`, 10, 15 * 60_000))) {
    return NextResponse.json({ error: 'Too many codes requested — try again in a few minutes' }, { status: 429 })
  }

  await connectDB()
  const user = await User.findById(userId)
  if (!user || !user.isActive || user.isBanned) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const otp = await generateOTP(user._id.toString())
  const delivered = await sendOTP(user.email, otp, user.orgId)
  if (!delivered) {
    // Safe, generic: no provider details, no configuration hints.
    return NextResponse.json({ error: 'We couldn’t send your code right now. Please try again shortly.' }, { status: 503 })
  }
  return NextResponse.json({ ok: true })
}

export const POST = dbGuard(POST_handler)
