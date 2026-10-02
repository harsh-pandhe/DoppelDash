import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import PasskeyCredential from '@/models/PasskeyCredential'
import { generateOTP, sendOTP, signPreAuthToken } from '@/lib/auth'
import { rateLimit } from '@/lib/ratelimit'

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || 'unknown'
  if (!(await rateLimit(`login:${ip}`, 10, 60_000))) {
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

  const hasPasskey = (await PasskeyCredential.countDocuments({ userId: user._id.toString() })) > 0
  const methods: string[] = []
  if (user.totpEnabled) methods.push('totp')
  methods.push('email')

  // Dedicated Google Play reviewer account bypasses external email delivery
  if (user.email === 'doppeldash.playreview@gmail.com') {
    await generateOTP(user._id.toString())
  } else if (!user.totpEnabled) {
    const otp = await generateOTP(user._id.toString())
    await sendOTP(user.email, otp)
  }

  // Proof the password step passed for this userId — send-otp/verify-otp
  // require this instead of trusting a client-supplied userId, otherwise
  // knowing a colleague's ObjectId is enough to request/verify their OTP.
  const preAuthToken = await signPreAuthToken(user._id.toString())

  return NextResponse.json({
    step:       'verify',
    methods,
    hasPasskey,
    emailSent:  !user.totpEnabled,
    preAuthToken,
    userId:     user._id.toString(),
    email:      user.email,
    firstName:  user.firstName,
  })
}
