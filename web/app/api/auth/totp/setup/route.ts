import { NextRequest, NextResponse } from 'next/server'
import { getUser, beginTotpSetup, confirmTotpSetup, disableTotp } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { rateLimit } from '@/lib/ratelimit'

/** Begin TOTP setup — returns otpauth URL for the QR code. */
export async function POST() {
  const { userId, user, orgId } = await getUser()
  if (!userId || !user || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!(await rateLimit(`totp-setup:${userId}`, 10, 60_000))) {
    return NextResponse.json({ error: 'Too many setup attempts — wait 1 minute', code: 'rate_limited' }, { status: 429 })
  }

  const { otpauthUrl, secret } = await beginTotpSetup(userId, user.email)
  return NextResponse.json({ otpauthUrl, secret })
}

/** Confirm setup with a code from the authenticator app. */
export async function PUT(req: NextRequest) {
  const { userId, user, orgId } = await getUser()
  if (!userId || !user || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!(await rateLimit(`totp-verify-setup:${userId}`, 10, 60_000))) {
    return NextResponse.json({ error: 'Too many verification attempts — wait 1 minute', code: 'rate_limited' }, { status: 429 })
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

  const { code } = body as { code?: unknown }
  if (code === undefined || code === null) return NextResponse.json({ error: 'code required' }, { status: 400 })

  const codeStr = String(code).trim()
  if (!/^\d{6}$/.test(codeStr)) {
    return NextResponse.json({ error: 'Invalid 6-digit code format' }, { status: 400 })
  }

  const ok = await confirmTotpSetup(userId, codeStr)
  if (!ok) return NextResponse.json({ error: 'Incorrect code — check your authenticator app and try again' }, { status: 400 })

  await writeAudit({
    action: 'user.totp_enabled', performedBy: userId,
    performedByName: user.fullName || user.firstName,
    targetId: userId, targetType: 'user', metadata: {},
    orgId,
  })
  return NextResponse.json({ ok: true })
}

/** Disable TOTP for the signed-in user. */
export async function DELETE() {
  const { userId, user, orgId } = await getUser()
  if (!userId || !user || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!(await rateLimit(`totp-disable:${userId}`, 10, 60_000))) {
    return NextResponse.json({ error: 'Too many disable attempts — wait 1 minute', code: 'rate_limited' }, { status: 429 })
  }

  await disableTotp(userId)
  await writeAudit({
    action: 'user.totp_disabled', performedBy: userId,
    performedByName: user.fullName || user.firstName,
    targetId: userId, targetType: 'user', metadata: {},
    orgId,
  })
  return NextResponse.json({ ok: true })
}
