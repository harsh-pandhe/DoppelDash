import type { MailEnvelope, MailTransport } from '../types'
import { SmtpMailTransport, type SmtpSettings } from './smtp'

/**
 * ─────────────────────────────  SUPPORTDASH MAIL  ─────────────────────────────
 * ADAPTER BOUNDARY — the platform-default mail transport.
 *
 * SupportDash Mail is DoppelDash's intended default sender for OTPs, verification,
 * password reset, invitations, security/account notifications and CRM mail.
 * No SupportDash Mail contract (endpoint, auth scheme, SDK) exists in this repo or
 * environment, so NOTHING about it is invented here. Until the real contract is
 * supplied, this adapter keeps the EXISTING platform transport — the SMTP relay
 * configured by SMTP_HOST / SMTP_PORT / SMTP_SECURE / SMTP_USER / SMTP_PASS /
 * SMTP_FROM — behind the same `MailTransport` interface.
 *
 * WHERE THE REAL SERVICE PLUGS IN (the only file that must change):
 *   1. Implement the real delivery inside `SupportDashMailAdapter.deliver()`
 *      (HTTP API call, SDK, or a different SMTP endpoint).
 *   2. Update `isConfigured()` to check the real service's configuration.
 *   3. Done. Templates, provider resolution, rate limiting, entitlement checks,
 *      safe-error handling and every caller stay untouched.
 * ───────────────────────────────────────────────────────────────────────────────
 */

function platformSmtpSettings(): SmtpSettings | null {
  const user = process.env.SMTP_USER
  const pass = process.env.SMTP_PASS
  if (!user || !pass) return null
  return {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === 'true',
    user,
    pass,
    from: platformFrom(),
  }
}

/** The platform sender identity. Never organisation-specific. */
export function platformFrom(): string {
  const address = process.env.SMTP_USER || process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'unconfigured'
  return process.env.SMTP_FROM || `"DoppelDash" <${address}>`
}

export class SupportDashMailAdapter implements MailTransport {
  readonly id = 'supportdash'
  // Current backing transport: the pre-existing platform SMTP relay.
  private readonly backing = new SmtpMailTransport('supportdash-smtp', platformSmtpSettings, { brandedSender: true })

  isConfigured(): boolean {
    return this.backing.isConfigured()
  }

  async deliver(envelope: MailEnvelope): Promise<void> {
    return this.backing.deliver(envelope)
  }
}

let singleton: SupportDashMailAdapter | null = null
export function getPlatformTransport(): SupportDashMailAdapter {
  return (singleton ??= new SupportDashMailAdapter())
}
