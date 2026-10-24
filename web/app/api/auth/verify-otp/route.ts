import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import { verifyOTP, verifyTotp, signToken, verifyPreAuthToken, isWebAccessAllowed, setWebSessionCookie, signMobileAccessToken, issueMobileRefreshToken } from '@/lib/auth'
import { rateLimit } from '@/lib/ratelimit'
import { writeAudit } from '@/lib/audit'

async function POST_handler(req: NextRequest) {
  const raw = await req.text().catch(() => '')
  if (raw.length > 64 * 1024) {
    return NextResponse.json({ error: 'Payload too large', code: 'payload_too_large' }, { status: 413 })
  }

  let body: { preAuthToken?: unknown; otp?: unknown; method?: unknown } = {}
  try { body = JSON.parse(raw) } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const { preAuthToken, otp, method } = body
  if (!otp) return NextResponse.json({ error: 'otp required' }, { status: 400 })

  const userId = typeof preAuthToken === 'string' && preAuthToken ? await verifyPreAuthToken(preAuthToken) : null
  if (!userId) return NextResponse.json({ error: 'Session expired — sign in again' }, { status: 401 })

  if (!(await rateLimit(`otp:${userId}`, 10, 60_000))) {
    return NextResponse.json({ error: 'Too many OTP attempts' }, { status: 429 })
  }

  if (method === 'totp') {
    const otpStr = String(otp).trim()
    if (!/^\d{6}$/.test(otpStr)) {
      return NextResponse.json({ error: 'Invalid 6-digit code format' }, { status: 400 })
    }
    const ok = await verifyTotp(userId, otpStr)
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
  if (!user.isActive || user.isBanned) {
    return NextResponse.json({ error: 'Account suspended — contact your administrator' }, { status: 403 })
  }
  if (!user.orgId) {
    // No tenant, no session. Never default an organisation.
    return NextResponse.json({ error: 'This account is not assigned to an organization — contact support' }, { status: 403 })
  }

  const pub   = user.toPublic()
  const token = await signToken(pub)

  // Web uses the cookie above; the mobile app has no cookie jar, so it also
  // gets a short-lived Bearer access token + rotating opaque refresh token
  // (a new device "family" per login).
  const accessToken  = await signMobileAccessToken(pub)
  const refreshToken = await issueMobileRefreshToken(pub.id, { sessionVersion: pub.sessionVersion })

  // The web cookie is minted only for organisations whose persisted entitlement enables the web client.
  const webAccess = await isWebAccessAllowed(pub.orgId)
  await writeAudit({
    action: 'auth.login_succeeded', performedBy: pub.id, performedByName: `${user.firstName} ${user.lastName}`.trim() || 'User',
    targetId: pub.id, targetType: 'auth', orgId: pub.orgId, metadata: { method: 'otp', web: webAccess },
  })
  const res = NextResponse.json({
    user: pub,
    mustChangePassword: user.mustChangePassword,
    accessToken,
    refreshToken,
    webAccess,
  })
  if (webAccess) setWebSessionCookie(res, token)
  return res
}

export const POST = dbGuard(POST_handler)
