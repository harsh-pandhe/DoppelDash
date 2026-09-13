import { NextRequest, NextResponse } from 'next/server'
import { getUser, passkeyRegistrationOptions, passkeyRegistrationVerify } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

/** Get WebAuthn registration options (signed-in user adding a passkey). */
export async function POST() {
  const { userId, user } = await getUser()
  if (!userId || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const options = await passkeyRegistrationOptions(userId, user.email, user.fullName || user.firstName)
  return NextResponse.json(options)
}

/** Verify the browser's registration response and save the credential. */
export async function PUT(req: NextRequest) {
  const { userId, user, orgId } = await getUser()
  if (!userId || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { response, nickname } = await req.json()
  if (!response) return NextResponse.json({ error: 'response required' }, { status: 400 })

  const result = await passkeyRegistrationVerify(userId, response, nickname, orgId)
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 })

  writeAudit({
    action: 'user.passkey_added', performedBy: userId,
    performedByName: user.fullName || user.firstName,
    targetId: userId, targetType: 'user', metadata: { nickname: nickname || '' },
    orgId,
  })
  return NextResponse.json({ ok: true })
}
