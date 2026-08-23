import { NextRequest, NextResponse } from 'next/server'
import { COOKIE_NAME, revokeMobileRefreshToken } from '@/lib/auth'

export async function POST(req: NextRequest) {
  // Mobile sends its refresh token so it's revoked server-side, not just
  // dropped on-device — otherwise a copy of it (e.g. from a backup) would
  // still be able to mint new access tokens after "logout".
  const body = await req.json().catch(() => null)
  if (body?.refreshToken) await revokeMobileRefreshToken(body.refreshToken)

  const res = NextResponse.json({ ok: true })
  res.cookies.set(COOKIE_NAME, '', { maxAge: 0, path: '/' })
  return res
}
