import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import { rotateMobileRefreshToken, signMobileAccessToken } from '@/lib/auth'
import { rateLimit } from '@/lib/ratelimit'
import { REFRESH_LIMITS } from '@/lib/auth/limits'

// Mobile-only: exchanges a still-valid refresh token for a new access token
// + a rotated refresh token. No cookie/session involved.
//
// Rotation is atomic (see lib/auth/mobileTokens.ts): of any number of
// simultaneous requests carrying the same token exactly one succeeds. Every
// failure — unknown, expired, reused, stale after a password change, suspended
// account — is the same generic 401 so nothing can be probed.
export async function POST(req: NextRequest) {
  const ip = (req.headers.get('x-forwarded-for') || 'unknown').split(',')[0].trim()
  if (!(await rateLimit(`refresh:${ip}`, REFRESH_LIMITS.perIpPerMinute, 60_000))) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let body: { refreshToken?: unknown } = {}
  try { body = await req.json() } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (typeof body.refreshToken !== 'string' || !body.refreshToken) {
    return NextResponse.json({ error: 'refreshToken required' }, { status: 400 })
  }

  const rotated = await rotateMobileRefreshToken(body.refreshToken)
  if (!rotated.ok) {
    return NextResponse.json({ error: 'Invalid or expired refresh token' }, { status: 401 })
  }

  await connectDB()
  const user = await User.findById(rotated.userId)
  if (!user || !user.isActive || user.isBanned || !user.orgId) {
    return NextResponse.json({ error: 'Invalid or expired refresh token' }, { status: 401 })
  }

  const accessToken = await signMobileAccessToken(user.toPublic())
  return NextResponse.json({ accessToken, refreshToken: rotated.refreshToken })
}
