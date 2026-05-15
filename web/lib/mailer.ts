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
  return process.env.SMTP_FROM || `"DoppelDash · Doppelmayr India" <${process.env.SMTP_USER}>`
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
  const t = await getTransporter()
  if (!t) {
    console.warn('[mailer] SMTP not configured — skipping send to', opts.to)
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
