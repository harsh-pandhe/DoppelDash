import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { acceptInvitation } from '@/lib/invitations/invitationService'
import { isWebAccessAllowed, setWebSessionCookie } from '@/lib/auth'
import { rateLimit } from '@/lib/ratelimit'

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || 'unknown'
  if (!(await rateLimit(`invite-accept:${ip}`, 10, 60_000))) {
    return NextResponse.json({ error: 'Too many acceptance attempts — wait 1 minute' }, { status: 429 })
  }

  let body: Record<string, unknown> = {}
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const token = typeof body.token === 'string' ? body.token.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : undefined
  const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : undefined

  if (!token) {
    return NextResponse.json({ error: 'Invitation token is required' }, { status: 400 })
  }

  if (!password || password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
  }

  await connectDB()

  try {
    // Note: Any client-supplied orgId or role in the body is completely ignored.
    // The server derives tenant and role strictly from the verified invitation.
    const result = await acceptInvitation({
      rawToken: token,
      password,
      firstName,
      lastName,
    })

    const webAccess = await isWebAccessAllowed((result.user as { orgId: string }).orgId)
    const res = NextResponse.json(
      {
        message: 'Invitation accepted successfully',
        webAccess,
        user: result.user,
        employee: result.employee,
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
      },
      { status: 200 }
    )

    // The web cookie carries the session JWT; mobile clients use accessToken + refreshToken.
    if (webAccess) setWebSessionCookie(res, result.sessionToken)
    return res
  } catch (err: unknown) {
    const error = err as { statusCode?: number; message?: string }
    const status = error.statusCode || 400
    return NextResponse.json({ error: error.message || 'Failed to accept invitation' }, { status })
  }
}
