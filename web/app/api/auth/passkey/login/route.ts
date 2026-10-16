import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { passkeyLoginOptions, passkeyLoginVerify, signToken, isWebAccessAllowed, setWebSessionCookie } from '@/lib/auth'
import { rateLimit } from '@/lib/ratelimit'
import type { AuthenticationResponseJSON } from '@simplewebauthn/server'

/** Get authentication options for a passkey sign-in (public, by email). */
async function POST_handler(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || 'unknown'
  if (!(await rateLimit(`pk-login:${ip}`, 10, 60_000))) {
    return NextResponse.json({ error: 'Too many attempts — wait 1 minute' }, { status: 429 })
  }

  const raw = await req.text().catch(() => '')
  if (raw.length > 64 * 1024) {
    return NextResponse.json({ error: 'Payload too large', code: 'payload_too_large' }, { status: 413 })
  }

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { email } = body as { email?: unknown }
  if (!email || typeof email !== 'string' || !email.trim()) {
    return NextResponse.json({ error: 'email required' }, { status: 400 })
  }

  const result = await passkeyLoginOptions(email.trim().toLowerCase())
  if (!result) {
    return NextResponse.json({ error: 'No passkey found for this account — sign in with password instead' }, { status: 404 })
  }
  return NextResponse.json({ options: result.options, userId: result.userId })
}

/** Verify the browser's authentication response and create the session. */
async function PUT_handler(req: NextRequest) {
  const raw = await req.text().catch(() => '')
  if (raw.length > 64 * 1024) {
    return NextResponse.json({ error: 'Payload too large', code: 'payload_too_large' }, { status: 413 })
  }

  let body: unknown
  try {
    body = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const { userId, response } = body as { userId?: unknown; response?: unknown }
  if (!userId || typeof userId !== 'string' || !response || typeof response !== 'object') {
    return NextResponse.json({ error: 'userId and response required' }, { status: 400 })
  }

  if (!(await rateLimit(`pk-verify:${userId}`, 10, 60_000))) {
    return NextResponse.json({ error: 'Too many attempts' }, { status: 429 })
  }

  const result = await passkeyLoginVerify(userId, response as AuthenticationResponseJSON)
  if (!result.ok) {
    const status = result.reason === 'Account suspended' ? 403 : 401
    return NextResponse.json({ error: result.reason }, { status })
  }

  const pub = result.user.toPublic()
  if (!pub.isActive || pub.isBanned) {
    return NextResponse.json({ error: 'Account suspended — contact your administrator' }, { status: 403 })
  }
  if (!pub.orgId) {
    return NextResponse.json({ error: 'This account is not assigned to an organization — contact support' }, { status: 403 })
  }

  const token = await signToken(pub)

  // Passkeys are a browser flow: no web entitlement → no session at all.
  const webAccess = await isWebAccessAllowed(pub.orgId)
  const res = NextResponse.json({
    user: pub,
    mustChangePassword: result.user.mustChangePassword,
    webAccess,
  })
  if (webAccess) setWebSessionCookie(res, token)
  return res
}

export const POST = dbGuard(POST_handler)
export const PUT = dbGuard(PUT_handler)
