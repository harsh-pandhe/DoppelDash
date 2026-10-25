import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { readJsonObject } from '@/lib/http/body'
import { connectDB } from '@/lib/db'
import PasswordResetToken from '@/models/PasswordResetToken'
import { rateLimit } from '@/lib/ratelimit'

/**
 * POST /api/auth/password-reset/check   { "token": "<reset token>" }
 *
 * Read-only validity check of an emailed reset token, so the UI can show
 * invalid / expired / already-used BEFORE the user types a new password.
 *
 * The token travels ONLY in the request body. It is deliberately never accepted
 * in a query string or path (those end up in access logs, proxies and Referer
 * headers), it is never echoed back, and the response is `no-store`.
 */
const NO_STORE = { 'Cache-Control': 'no-store' }
const json = (body: Record<string, unknown>, status: number) => NextResponse.json(body, { status, headers: NO_STORE })

async function POST_handler(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || 'unknown'
  if (!(await rateLimit(`pwd-reset-check-ip:${ip}`, 30, 60_000))) {
    return json({ valid: false, reason: 'rate_limited', error: 'Too many attempts — please wait 1 minute' }, 429)
  }

  const body = await readJsonObject(req)
  if (!body) return json({ valid: false, reason: 'missing_token', error: 'Invalid JSON body' }, 400)
  const token = typeof body.token === 'string' ? body.token.trim() : ''
  if (!token) return json({ valid: false, reason: 'missing_token', error: 'Reset token is required' }, 400)

  await connectDB()
  const tokenDoc = await PasswordResetToken.findOne({ tokenHash: PasswordResetToken.hashToken(token) }).lean()

  if (!tokenDoc) return json({ valid: false, reason: 'invalid_token', error: 'Invalid or unrecognized password reset token' }, 404)
  if (tokenDoc.usedAt) return json({ valid: false, reason: 'already_used', error: 'This password reset link has already been used' }, 410)
  if (new Date(tokenDoc.expiresAt) <= new Date()) return json({ valid: false, reason: 'expired', error: 'This password reset link has expired' }, 410)

  return json({ valid: true, email: tokenDoc.email }, 200)
}

export const POST = dbGuard(POST_handler)
