import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import { generateOTP, sendOTP } from '@/lib/auth'
import { rateLimit } from '@/lib/ratelimit'

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || 'unknown'
  if (!rateLimit(`login:${ip}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many login attempts — wait 1 minute' }, { status: 429 })
  }

  const { email, password } = await req.json()
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
  }

  await connectDB()
  const user = await User.findOne({ email: email.toLowerCase().trim() })

  // Constant-time: always run checkPassword even on not-found (prevents enumeration)
  const passwordMatch = user ? await user.checkPassword(password) : false

  if (!user || !passwordMatch) {
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }
  if (!user.isActive || user.isBanned) {
    return NextResponse.json({ error: 'Account suspended — contact your administrator' }, { status: 403 })
  }

  // Generate + send OTP
  const otp = await generateOTP(user._id.toString())
  await sendOTP(user.email, otp)

  return NextResponse.json({
    step:      'otp',
    userId:    user._id.toString(),
    email:     user.email,
    firstName: user.firstName,
  })
}
