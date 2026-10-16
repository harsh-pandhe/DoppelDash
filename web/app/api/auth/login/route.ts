import crypto from 'node:crypto'
import { dbGuard } from '@/lib/http/dbGuard'
import { readJsonObject } from '@/lib/http/body'
import bcrypt from 'bcryptjs'
import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import PasskeyCredential from '@/models/PasskeyCredential'
import { generateOTP, sendOTP, signPreAuthToken } from '@/lib/auth'
import { LOGIN_LIMITS } from '@/lib/auth/limits'
import { rateLimit, rateLimitPeek, rateLimitHit, rateLimitClear, rateLimitMark, rateLimitMarked } from '@/lib/ratelimit'

// Precomputed bcrypt hash so an unknown e-mail costs the same CPU as a wrong password.
const TIMING_EQUALISER_HASH = '$2b$12$aezQiWHN.0cF6i.zcQOPnuHn8MSizk8zGiA7GDM686CI/9dBkuBQ.'

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get('x-forwarded-for') || ''
  return forwarded.split(',')[0].trim() || 'unknown'
}

const accountKey = (email: string) => crypto.createHash('sha256').update(email).digest('hex').slice(0, 32)

async function POST_handler(req: NextRequest) {
  const ip = clientIp(req)
  if (!(await rateLimit(`login:${ip}`, LOGIN_LIMITS.ipPerMinute, 60_000))) {
    return NextResponse.json({ error: 'Too many login attempts — wait 1 minute' }, { status: 429 })
  }

  let body: { email?: unknown; password?: unknown } = {}
  {
    const parsedJson = await readJsonObject(req)
    if (!parsedJson) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    body = parsedJson as typeof body
  }
  const email = typeof body.email === 'string' ? body.email.toLowerCase().trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!email || !password || email.length > 254 || password.length > 1024) {
    return NextResponse.json({ error: 'Email and password required' }, { status: 400 })
  }

  const acct = accountKey(email)
  const keyAccountIp = `login-fail:acct-ip:${acct}:${ip}`
  const keyAccount = `login-fail:acct:${acct}`
  const keyKnownIp = `login-known:${acct}:${ip}`

  const ipOk = await rateLimitPeek(keyAccountIp, LOGIN_LIMITS.accountIpFailures)
  const accountOk = (await rateLimitPeek(keyAccount, LOGIN_LIMITS.accountFailures)) || (await rateLimitMarked(keyKnownIp))
  if (!ipOk || !accountOk) {
    const res = NextResponse.json({ error: 'Too many failed attempts — try again in 15 minutes or reset your password.' }, { status: 429 })
    res.headers.set('Retry-After', String(Math.ceil(LOGIN_LIMITS.windowMs / 1000)))
    return res
  }

  await connectDB()
  const user = await User.findOne({ email })

  // Constant-time-ish: always run exactly one bcrypt comparison (prevents enumeration by timing).
  const passwordMatch = user
    ? await user.checkPassword(password)
    : await bcrypt.compare(password, TIMING_EQUALISER_HASH).then(() => false)

  if (!user || !passwordMatch) {
    await Promise.all([rateLimitHit(keyAccountIp, LOGIN_LIMITS.windowMs), rateLimitHit(keyAccount, LOGIN_LIMITS.windowMs)])
    return NextResponse.json({ error: 'Invalid email or password' }, { status: 401 })
  }
  if (!user.isActive || user.isBanned) {
    return NextResponse.json({ error: 'Account suspended — contact your administrator' }, { status: 403 })
  }

  // Correct password: this IP is no longer suspicious for this account.
  await Promise.all([rateLimitClear(keyAccountIp), rateLimitMark(keyKnownIp, LOGIN_LIMITS.knownIpTtlMs)])

  const hasPasskey = (await PasskeyCredential.countDocuments({ userId: user._id.toString() })) > 0
  const methods: string[] = []
  if (user.totpEnabled) methods.push('totp')
  methods.push('email')

  // Dedicated Google Play reviewer account bypasses external email delivery
  let emailSent = false
  let emailDeliveryFailed = false
  if (user.isReviewer === true && user.email === 'doppeldash.playreview@gmail.com') {
    await generateOTP(user._id.toString())
    emailSent = true
  } else if (!user.totpEnabled) {
    const otp = await generateOTP(user._id.toString())
    emailSent = await sendOTP(user.email, otp, user.orgId)
    emailDeliveryFailed = !emailSent
  }

  // Proof the password step passed for this userId. This token authorises ONLY
  // send-otp / verify-otp — verifyToken() refuses it everywhere else.
  const preAuthToken = await signPreAuthToken(user._id.toString())

  return NextResponse.json({
    step:       'verify',
    methods,
    hasPasskey,
    emailSent,
    // The UI offers "Email me the code" (POST /api/auth/send-otp) when this is true.
    ...(emailDeliveryFailed ? { emailDeliveryFailed: true } : {}),
    preAuthToken,
    userId:     user._id.toString(),
    email:      user.email,
    firstName:  user.firstName,
  })
}

export const POST = dbGuard(POST_handler)
