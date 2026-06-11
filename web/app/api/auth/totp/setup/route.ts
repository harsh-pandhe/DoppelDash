import { NextRequest, NextResponse } from 'next/server'
import { getUser, beginTotpSetup, confirmTotpSetup, disableTotp } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

/** Begin TOTP setup — returns otpauth URL for the QR code. */
export async function POST() {
  const { userId, user } = await getUser()
  if (!userId || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { otpauthUrl, secret } = await beginTotpSetup(userId, user.email)
  return NextResponse.json({ otpauthUrl, secret })
}

/** Confirm setup with a code from the authenticator app. */
export async function PUT(req: NextRequest) {
  const { userId, user } = await getUser()
  if (!userId || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { code } = await req.json()
  if (!code) return NextResponse.json({ error: 'code required' }, { status: 400 })

  const ok = await confirmTotpSetup(userId, String(code))
  if (!ok) return NextResponse.json({ error: 'Incorrect code — check your authenticator app and try again' }, { status: 400 })

  writeAudit({
    action: 'user.totp_enabled', performedBy: userId,
    performedByName: user.fullName || user.firstName,
    targetId: userId, targetType: 'user', metadata: {},
  })
  return NextResponse.json({ ok: true })
}

/** Disable TOTP for the signed-in user. */
export async function DELETE() {
  const { userId, user } = await getUser()
  if (!userId || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await disableTotp(userId)
  writeAudit({
    action: 'user.totp_disabled', performedBy: userId,
    performedByName: user.fullName || user.firstName,
    targetId: userId, targetType: 'user', metadata: {},
  })
  return NextResponse.json({ ok: true })
}
