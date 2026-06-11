import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import { generateOTP, sendOTP } from '@/lib/auth'
import { rateLimit } from '@/lib/ratelimit'

/** Send (or resend) the email OTP for a user mid-login. */
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || 'unknown'
  const { userId } = await req.json()
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  if (!rateLimit(`send-otp:${ip}:${userId}`, 3, 60_000)) {
    return NextResponse.json({ error: 'Too many requests — wait 1 minute' }, { status: 429 })
  }

  await connectDB()
  const user = await User.findById(userId)
  if (!user || !user.isActive || user.isBanned) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const otp = await generateOTP(user._id.toString())
  await sendOTP(user.email, otp)
  return NextResponse.json({ ok: true })
}
