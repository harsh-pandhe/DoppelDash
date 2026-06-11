import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import { verifyOTP, verifyTotp, signToken, COOKIE_NAME, COOKIE_OPTS } from '@/lib/auth'
import { rateLimit } from '@/lib/ratelimit'

export async function POST(req: NextRequest) {
  const { userId, otp, method } = await req.json()
  if (!userId || !otp) return NextResponse.json({ error: 'userId and otp required' }, { status: 400 })

  if (!rateLimit(`otp:${userId}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many OTP attempts' }, { status: 429 })
  }

  if (method === 'totp') {
    const ok = await verifyTotp(userId, String(otp))
    if (!ok) return NextResponse.json({ error: 'Incorrect authenticator code' }, { status: 401 })
    await connectDB()
    await User.findByIdAndUpdate(userId, {
      lastLoginAt: new Date(), lastActiveAt: new Date(), $inc: { loginCount: 1 },
    })
  } else {
    const result = await verifyOTP(userId, String(otp))
    if (!result.ok) {
      return NextResponse.json({ error: result.reason || 'Invalid OTP' }, { status: 401 })
    }
  }

  await connectDB()
  const user = await User.findById(userId)
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  const pub   = user.toPublic()
  const token = await signToken(pub)

  const res = NextResponse.json({
    user: pub,
    mustChangePassword: user.mustChangePassword,
  })
  res.cookies.set(COOKIE_NAME, token, COOKIE_OPTS)
  return res
}
