/**
 * Shared SMTP mailer for DoppelDash.
 *
 * All outbound mail (OTP, announcements, leave/expense notifications, CRM
 * campaigns, birthdays) flows through this single transporter so there is one
 * configuration surface — typically Gmail SMTP relay with an app password.
 *
 * Env:
 *   SMTP_HOST   (default smtp.gmail.com)
 *   SMTP_PORT   (default 587)
 *   SMTP_SECURE (default false)
 *   SMTP_USER   (required)
 *   SMTP_PASS   (required — app password)
 *   SMTP_FROM   (default `"DoppelDash · Doppelmayr India" <SMTP_USER>`)
 */
import type { Transporter, SendMailOptions } from 'nodemailer'

let cached: Transporter | null = null

async function getTransporter(): Promise<Transporter | null> {
  if (cached) return cached
  if (!process.env.SMTP_USER || !process.env.SMTP_PASS) return null
  const nodemailer = await import('nodemailer')
  cached = nodemailer.default.createTransport({
    host:   process.env.SMTP_HOST || 'smtp.gmail.com',
    port:   Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    auth:   { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  })
  return cached
}

export function defaultFrom(): string {
  const fromAddress = process.env.SMTP_USER || process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'unconfigured'
  return process.env.SMTP_FROM || `"DoppelDash" <${fromAddress}>`
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
    hasPass: !!process.env.SMTP_PASS, // Never exposes the password itself
    from: defaultFrom(),
    missing,
    canDeliverAuthEmails: configured,
  }
}

export function canDeliverAuthEmails(): boolean {
  return !process.env.SMTP_USER || !process.env.SMTP_PASS ? false : true
}

export interface SendOptions {
  to:       string | string[]
  subject:  string
  html:     string
  text?:    string
  from?:    string
  headers?: Record<string, string>
}

/**
 * Send a single mail. Returns true if delivered to the SMTP server.
 * Fire-and-forget callers can ignore the return value.
 */
export async function sendMail(opts: SendOptions): Promise<boolean> {
  const recipients = Array.isArray(opts.to) ? opts.to : [opts.to]
  const validRecipients = recipients.filter(r => r && r.includes('@') && !r.includes('__REQUIRED_SET_SUPPORT_GMAIL_IN_ENV__') && !r.includes('DoppelDash support Gmail'))
  if (validRecipients.length === 0) {
    console.warn('[mailer] No valid email recipients specified — skipping send')
    return false
  }
  const t = await getTransporter()
  if (!t) {
    console.warn('[mailer] SMTP not configured — skipping send to', validRecipients)
    return false
  }
  const msg: SendMailOptions = {
    from:    opts.from || defaultFrom(),
    to:      opts.to,
    subject: opts.subject,
    html:    opts.html,
    text:    opts.text,
    headers: opts.headers,
  }
  try {
    await t.sendMail(msg)
    return true
  } catch (e) {
    console.error('[mailer] send failed:', e instanceof Error ? e.message : e)
    return false
  }
}

/** Convenience for fan-out to many recipients (one envelope per recipient). */
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
