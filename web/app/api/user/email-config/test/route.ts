import { NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { rateLimit } from '@/lib/ratelimit'
import { resolvePublicSmtpTarget, checkSmtpHostSyntax, smtpHostPolicyEnforced, SmtpPolicyError, SMTP_POLICY_MESSAGES } from '@/lib/mail/smtpHostPolicy'
import { connectDB } from '@/lib/db'
import UserEmailConfig from '@/models/UserEmailConfig'
import { decrypt } from '@/lib/encrypt'
import nodemailer from 'nodemailer'
import { getUser } from '@/lib/auth'

async function POST_handler() {
  const { userId, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const effectiveOrgId = orgId

  await connectDB()
  const config = await UserEmailConfig.findOne({ userId, orgId: effectiveOrgId }).lean() as Record<string, unknown> | null
  if (!config) return NextResponse.json({ error: 'No email configured' }, { status: 400 })

  // At most a handful of connection tests per user (each one opens an outbound connection and may send a message).
  if (!(await rateLimit(`email-test:${userId}`, 5, 10 * 60_000))) return NextResponse.json({ error: 'Too many tests — wait a few minutes.' }, { status: 429 })

  const appPassword = decrypt(config.appPassword as string)

  try {
    // SSRF guard: the host must resolve to public addresses only (enforced on deployed hosts).
    // Resolve once, validate, then CONNECT TO THAT ADDRESS (TLS still verifies the name): no DNS-rebinding window between check and connect.
    let target: { address: string; servername: string | undefined } | undefined
    if (smtpHostPolicyEnforced()) target = await resolvePublicSmtpTarget(config.smtpHost as string)
    else if (!(process.env.ALLOW_PRIVATE_SMTP_HOSTS === 'true')) checkSmtpHostSyntax(config.smtpHost as string)
    const transporter = nodemailer.createTransport({
      host:   target ? target.address : (config.smtpHost as string),
      ...(target?.servername ? { tls: { servername: target.servername }, name: target.servername } : {}),
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
      port:   config.smtpPort as number,
      secure: (config.smtpPort as number) === 465,
      auth: {
        user: config.emailAddress as string,
        pass: appPassword,
      },
    })

    await transporter.verify()

    // Send test email to themselves
    await transporter.sendMail({
      from:    `"DoppelDash" <${config.emailAddress}>`,
      to:      config.emailAddress as string,
      subject: 'DoppelDash — Email linked successfully',
      text:    'Your email is now linked to DoppelDash. You can send CRM campaigns from this address.',
    })

    // Mark as verified
    await UserEmailConfig.updateOne({ userId, orgId: effectiveOrgId }, { isVerified: true })

    return NextResponse.json({ ok: true })
  } catch (err: unknown) {
    // Never echo the provider/network error text (it names hosts, ports and usernames): a stable message + code only.
    const code = err instanceof SmtpPolicyError ? err.code : 'connection_failed'
    const message = err instanceof SmtpPolicyError ? SMTP_POLICY_MESSAGES[err.code] : 'Could not connect to the mail server. Check the host, port and app password.'
    return NextResponse.json({ error: message, code }, { status: 400 })
  }
}

export const POST = dbGuard(POST_handler)
