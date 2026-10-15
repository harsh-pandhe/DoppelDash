import { connectDB } from '@/lib/db'
import { decrypt } from '@/lib/encrypt'
import OrgMailConfig from '@/models/OrgMailConfig'
import UserEmailConfig from '@/models/UserEmailConfig'
import type { MailTransport } from '../types'
import { SmtpMailTransport, type SmtpSettings } from './smtp'

function displayFrom(name: string | undefined, address: string): string {
  const cleanName = (name || '').replace(/[\r\n"<>]/g, ' ').trim()
  return cleanName ? `"${cleanName}" <${address}>` : address
}

/**
 * The organisation's own provider, if (and only if) one is saved AND verified.
 * Credentials are decrypted here, server-side, and live only inside the returned
 * transport closure — they are never serialised anywhere.
 */
export async function loadOrgTransport(orgId: string, opts: { requireVerified?: boolean } = {}): Promise<MailTransport | null> {
  if (!orgId) return null
  await connectDB()
  const cfg = await OrgMailConfig.findOne({ orgId }).select('+passwordEnc').lean()
  if (!cfg) return null
  if ((opts.requireVerified ?? true) && !cfg.verifiedAt) return null

  const settings: SmtpSettings = {
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    user: cfg.username,
    pass: decrypt(cfg.passwordEnc),
    from: displayFrom(cfg.fromName, cfg.fromEmail),
  }
  return new SmtpMailTransport(`org:${orgId}`, () => settings)
}

/**
 * Compatibility: the pre-existing per-user connected mailbox (UserEmailConfig,
 * AES-encrypted app password). Still honoured for CRM mail when the organisation
 * is entitled to custom mail.
 */
export async function loadUserMailboxTransport(userId: string, orgId: string): Promise<MailTransport | null> {
  if (!userId || !orgId) return null
  await connectDB()
  const cfg = await UserEmailConfig.findOne({ userId, orgId }).lean<{
    emailAddress: string; smtpHost: string; smtpPort: number; appPassword: string; isVerified: boolean
  } | null>()
  if (!cfg || !cfg.isVerified) return null
  const settings: SmtpSettings = {
    host: cfg.smtpHost,
    port: cfg.smtpPort,
    secure: cfg.smtpPort === 465,
    user: cfg.emailAddress,
    pass: decrypt(cfg.appPassword),
    from: `"DoppelDash" <${cfg.emailAddress}>`,
  }
  return new SmtpMailTransport(`user:${userId}`, () => settings, { brandedSender: true })
}
