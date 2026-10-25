import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { isSendableAddress } from '@/lib/mail/escape'
import { checkSmtpHostSyntax, checkSmtpPort, SmtpPolicyError, SMTP_POLICY_MESSAGES } from '@/lib/mail/smtpHostPolicy'
import { isProductionLike } from '@/lib/auth/devShortcuts'
import { readJsonObject } from '@/lib/http/body'
import { connectDB } from '@/lib/db'
import UserEmailConfig from '@/models/UserEmailConfig'
import { encrypt } from '@/lib/encrypt'
import { getUser } from '@/lib/auth'
import { writeAudit } from '@/lib/audit'

async function GET_handler() {
  const { userId, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await connectDB()
  const config = await UserEmailConfig.findOne({ userId, orgId }).lean() as Record<string, unknown> | null
  if (!config) return NextResponse.json(null)

  return NextResponse.json({
    emailAddress: config.emailAddress,
    smtpHost:     config.smtpHost,
    smtpPort:     config.smtpPort,
    isVerified:   config.isVerified,
  })
}

async function POST_handler(req: NextRequest) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { emailAddress?: string; smtpHost?: string; smtpPort?: number; appPassword?: string }
  {
    const parsedJson = await readJsonObject(req)
    if (!parsedJson) return NextResponse.json({ error: 'Invalid body' }, { status: 400 })
    body = parsedJson as typeof body
  }

  const { emailAddress, smtpHost, smtpPort = 587, appPassword } = body
  if (!emailAddress || !smtpHost || !appPassword) {
    return NextResponse.json({ error: 'emailAddress, smtpHost, and appPassword are required' }, { status: 400 })
  }
  // Destination policy (SSRF guard) + shape checks: the server will connect to this host, so it must be a public SMTP server on a standard port.
  if (typeof emailAddress !== 'string' || !isSendableAddress(emailAddress.trim()) || typeof smtpHost !== 'string' || typeof appPassword !== 'string' || appPassword.length > 512) {
    return NextResponse.json({ error: 'Invalid request', fields: ['emailAddress', 'smtpHost', 'appPassword'] }, { status: 400 })
  }
  try {
    if (!(process.env.ALLOW_PRIVATE_SMTP_HOSTS === 'true' && !isProductionLike())) checkSmtpHostSyntax(smtpHost)
    checkSmtpPort(smtpPort)
  } catch (e) {
    const code = e instanceof SmtpPolicyError ? e.code : 'invalid_host'
    return NextResponse.json({ error: SMTP_POLICY_MESSAGES[code], code, fields: [code === 'invalid_port' ? 'smtpPort' : 'smtpHost'] }, { status: 400 })
  }

  await connectDB()
  const encrypted = encrypt(appPassword)
  await UserEmailConfig.findOneAndUpdate(
    { userId, orgId },
    { userId, orgId, emailAddress: emailAddress.trim(), smtpHost: smtpHost.trim().toLowerCase(), smtpPort: Number(smtpPort), appPassword: encrypted, isVerified: false },
    { upsert: true, returnDocument: 'after' }
  )

  await writeAudit({
    action: 'mailbox.configured', performedBy: userId, performedByName: user?.fullName || 'User',
    targetId: userId, targetType: 'mailbox', orgId, metadata: {},
  })
  return NextResponse.json({ ok: true })
}

async function DELETE_handler() {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await connectDB()
  const res = await UserEmailConfig.deleteOne({ userId, orgId })
  if (res.deletedCount) {
    await writeAudit({
      action: 'mailbox.removed', performedBy: userId, performedByName: user?.fullName || 'User',
      targetId: userId, targetType: 'mailbox', orgId, metadata: {},
    })
  }
  return NextResponse.json({ ok: true })
}

export const GET = dbGuard(GET_handler)
export const POST = dbGuard(POST_handler)
export const DELETE = dbGuard(DELETE_handler)
