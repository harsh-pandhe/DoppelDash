import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { getUser, passkeyRegistrationOptions, passkeyRegistrationVerify } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'
import { rateLimit } from '@/lib/ratelimit'
import type { RegistrationResponseJSON } from '@simplewebauthn/types'

/** Get WebAuthn registration options (signed-in user adding a passkey). */
async function POST_handler() {
  const { userId, user, orgId } = await getUser()
  if (!userId || !user || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!(await rateLimit(`pk-reg-opt:${userId}`, 15, 60_000))) {
    return NextResponse.json({ error: 'Too many registration attempts — wait 1 minute', code: 'rate_limited' }, { status: 429 })
  }

  const options = await passkeyRegistrationOptions(userId, user.email, user.fullName || user.firstName)
  return NextResponse.json(options)
}

/** Verify the browser's registration response and save the credential. */
async function PUT_handler(req: NextRequest) {
  const { userId, user, orgId } = await getUser()
  if (!userId || !user || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!(await rateLimit(`pk-reg-verify:${userId}`, 15, 60_000))) {
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

  const { response, nickname } = body as { response?: unknown; nickname?: unknown }
  if (!response || typeof response !== 'object') return NextResponse.json({ error: 'response required' }, { status: 400 })

  const nick = typeof nickname === 'string' ? nickname.trim().slice(0, 100) : ''

  const result = await passkeyRegistrationVerify(userId, response as RegistrationResponseJSON, nick, orgId)
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 })

  await writeAudit({
    action: 'user.passkey_added', performedBy: userId,
    performedByName: user.fullName || user.firstName,
    targetId: userId, targetType: 'user', metadata: { nickname: nick },
    orgId,
  })
  return NextResponse.json({ ok: true })
}

export const POST = dbGuard(POST_handler)
export const PUT = dbGuard(PUT_handler)
