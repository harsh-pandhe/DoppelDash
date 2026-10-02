import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { COOKIE_NAME, COOKIE_OPTS, revokeMobileRefreshToken, verifyToken } from '@/lib/auth'
import { connectDB } from '@/lib/db'
import RevokedToken from '@/models/RevokedToken'

export async function POST(req: NextRequest) {
  // 1. Identify active session token from cookie or Authorization header
  const cookieToken = req.cookies.get(COOKIE_NAME)?.value
  const headerToken = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1]
  const token = cookieToken || headerToken

  if (token) {
    try {
      await connectDB()
      const payload = await verifyToken(token)
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
      const tokenIdentifier = payload?.jti || tokenHash
      const expiresAt = payload?.exp
        ? new Date(payload.exp * 1000)
        : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)

      await RevokedToken.updateOne(
        { tokenIdentifier },
        {
          $setOnInsert: {
            tokenIdentifier,
            userId: payload?.userId,
            expiresAt,
            revokedAt: new Date(),
            reason: 'logout',
          },
        },
        { upsert: true }
      )
    } catch (e) {
      if (process.env.NODE_ENV !== 'production') {
        console.error('[logout] token revocation error:', e instanceof Error ? e.message : e)
      }
    }
  }

  // 2. Mobile sends its refresh token so it's revoked server-side
  const body = await req.json().catch(() => null)
  if (body?.refreshToken) await revokeMobileRefreshToken(body.refreshToken)

  // 3. Clear session cookie in browser
  const res = NextResponse.json({ ok: true, message: 'Logged out successfully' })
  res.cookies.set(COOKIE_NAME, '', { ...COOKIE_OPTS, maxAge: 0, path: '/' })
  return res
}
