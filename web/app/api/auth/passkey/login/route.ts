import { NextRequest, NextResponse } from 'next/server'
import { passkeyLoginOptions, passkeyLoginVerify, signToken, isWebAccessAllowed, setWebSessionCookie } from '@/lib/auth'
import { rateLimit } from '@/lib/ratelimit'

/** Get authentication options for a passkey sign-in (public, by email). */
export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || 'unknown'
  if (!(await rateLimit(`pk-login:${ip}`, 10, 60_000))) {
    return NextResponse.json({ error: 'Too many attempts — wait 1 minute' }, { status: 429 })
  }

  const { email } = await req.json()
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })

  const result = await passkeyLoginOptions(email)
  if (!result) {
    return NextResponse.json({ error: 'No passkey found for this account — sign in with password instead' }, { status: 404 })
  }
  return NextResponse.json({ options: result.options, userId: result.userId })
}

/** Verify the browser's authentication response and create the session. */
export async function PUT(req: NextRequest) {
  const { userId, response } = await req.json()
  if (!userId || !response) return NextResponse.json({ error: 'userId and response required' }, { status: 400 })

  if (!(await rateLimit(`pk-verify:${userId}`, 10, 60_000))) {
    return NextResponse.json({ error: 'Too many attempts' }, { status: 429 })
  }

  const result = await passkeyLoginVerify(userId, response)
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 401 })

  const pub   = result.user.toPublic()
  if (!pub.orgId) return NextResponse.json({ error: 'This account is not assigned to an organization — contact support' }, { status: 403 })
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
