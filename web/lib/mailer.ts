/**
 * Legacy mail entry point — kept so existing callers (lib/email.ts notifications,
 * cron jobs, …) keep working unchanged. It no longer owns any SMTP code: every
 * message is handed to the platform transport (the SupportDash Mail adapter),
 * see lib/mail/transports/supportDashAdapter.ts.
 *
 * Auth / account / CRM mail should use lib/mail (MailService) instead, which adds
 * provider resolution, escaping templates and safe failures.
 *
 * Env (platform transport, unchanged):
 *   SMTP_HOST (default smtp.gmail.com) · SMTP_PORT (587) · SMTP_SECURE (false)
 *   SMTP_USER · SMTP_PASS (app password) · SMTP_FROM
 */
import { getPlatformTransport, platformFrom } from '@/lib/mail/transports/supportDashAdapter'
import { logMailFailure } from '@/lib/mail/log'
import { isSendableAddress } from '@/lib/mail/escape'

export function defaultFrom(): string {
  return platformFrom()
}

export interface MailerDiagnostics {
  configured: boolean
  host: string
  port: number
  secure: boolean
  hasUser: boolean
  hasPass: boolean
  from: string
  missing: string[]
  canDeliverAuthEmails: boolean
}

/** Never exposes credentials — only whether they are present. */
export function getMailerDiagnostics(): MailerDiagnostics {
  const missing: string[] = []
  if (!process.env.SMTP_USER) missing.push('SMTP_USER')
  if (!process.env.SMTP_PASS) missing.push('SMTP_PASS')
  const configured = missing.length === 0
  return {
    configured,
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    hasUser: !!process.env.SMTP_USER,
    hasPass: !!process.env.SMTP_PASS,
    from: defaultFrom(),
    missing,
    canDeliverAuthEmails: configured,
  }
}

export function canDeliverAuthEmails(): boolean {
  return getPlatformTransport().isConfigured()
}

export interface SendOptions {
  to:       string | string[]
  subject:  string
  html:     string
  text?:    string
  from?:    string
  headers?: Record<string, string>
}

/** Send one message through the platform transport. Returns true if accepted. Never throws. */
export async function sendMail(opts: SendOptions): Promise<boolean> {
  const recipients = (Array.isArray(opts.to) ? opts.to : [opts.to]).filter(isSendableAddress)
  if (recipients.length === 0) return false
  const transport = getPlatformTransport()
  if (!transport.isConfigured()) return false
  try {
    await transport.deliver({ ...opts, to: recipients })
    return true
  } catch (err) {
    logMailFailure('notification', 'platform', err)
    return false
  }
}

/** Fan-out to many recipients (one envelope per recipient). */
export async function sendMailBulk(
  recipients: string[],
  build: (to: string) => Omit<SendOptions, 'to'>,
): Promise<{ sent: number; failed: number }> {
  let sent = 0, failed = 0
  await Promise.allSettled(
    recipients.map(async to => {
      const ok = await sendMail({ ...build(to), to })
      if (ok) sent++; else failed++
    }),
  )
  return { sent, failed }
}
