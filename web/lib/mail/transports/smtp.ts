import { MailTransportError, type MailEnvelope, type MailTransport } from '../types'
import { isSendableAddress, singleLine } from '../escape'

export interface SmtpSettings {
  host: string
  port: number
  secure: boolean
  user: string
  pass: string
  /** Default RFC-5322 From used when the envelope does not carry one. */
  from: string
}

type CreateTransport = (options: unknown) => Transporter
type Transporter = { sendMail(msg: Record<string, unknown>): Promise<unknown> }
const cache = new Map<string, Transporter>()

async function createTransporter(s: SmtpSettings): Promise<Transporter> {
  // Under webpack `import('nodemailer')` exposes `.default`; under plain Node/jiti it may not.
  const mod = (await import('nodemailer')) as unknown as { default?: { createTransport: CreateTransport }; createTransport?: CreateTransport }
  const create = (mod.default?.createTransport ?? mod.createTransport) as CreateTransport | undefined
  if (!create) throw new MailTransportError('SMTP library unavailable', 'library_unavailable')
  return create({
    host: s.host,
    port: s.port,
    secure: s.secure,
    auth: { user: s.user, pass: s.pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  })
}

/** Cache key deliberately includes a hash-free fingerprint only of non-secret parts + pass length. */
function cacheKey(id: string, s: SmtpSettings): string {
  return `${id}|${s.host}|${s.port}|${s.secure}|${s.user}|${s.pass.length}|${s.from}`
}

/**
 * Generic SMTP transport. Settings are resolved lazily on every call so rotated
 * environment values / re-saved organisation credentials take effect immediately.
 * Errors are reduced to provider-level codes — SMTP error strings can echo hosts
 * and usernames, so they never leave this class.
 */
/** `"Name" <addr>` → `addr` (or the bare value). */
function addressOf(from: string): string {
  return /<([^>]+)>/.exec(from)?.[1]?.trim() || from.trim()
}

export class SmtpMailTransport implements MailTransport {
  /** `brandedSender`: apply `envelope.fromName` as the From display name (address stays this transport's own). */
  constructor(readonly id: string, private readonly settings: () => SmtpSettings | null, private readonly opts: { brandedSender?: boolean } = {}) {}

  isConfigured(): boolean {
    const s = this.settings()
    return Boolean(s && s.host && s.user && s.pass)
  }

  async deliver(envelope: MailEnvelope): Promise<void> {
    const s = this.settings()
    if (!s || !s.host || !s.user || !s.pass) throw new MailTransportError('Transport not configured', 'not_configured')

    const recipients = (Array.isArray(envelope.to) ? envelope.to : [envelope.to]).filter(isSendableAddress)
    if (recipients.length === 0) throw new MailTransportError('No sendable recipient', 'invalid_recipient')

    const key = cacheKey(this.id, s)
    let transporter = cache.get(key)
    if (!transporter) {
      transporter = await createTransporter(s)
      cache.set(key, transporter)
    }

    const headers: Record<string, string> = {}
    for (const [k, v] of Object.entries(envelope.headers ?? {})) {
      if (/^[A-Za-z0-9-]{1,60}$/.test(k)) headers[k] = singleLine(v, 300)
    }

    try {
      await transporter.sendMail({
        from: envelope.from
          ? singleLine(envelope.from, 320)
          : this.opts.brandedSender && envelope.fromName
            ? `"${singleLine(envelope.fromName, 60).replace(/["<>\\]/g, '')}" <${addressOf(s.from)}>`
            : s.from,
        to: recipients,
        subject: singleLine(envelope.subject, 250),
        html: envelope.html,
        text: envelope.text,
        replyTo: envelope.replyTo ? singleLine(envelope.replyTo, 320) : undefined,
        headers,
      })
    } catch (e) {
      cache.delete(key)
      const err = e as { code?: unknown; responseCode?: unknown }
      throw new MailTransportError(
        'SMTP delivery failed',
        typeof err.code === 'string' ? err.code.slice(0, 40) : 'provider_error',
        typeof err.responseCode === 'number' ? err.responseCode : undefined
      )
    }
  }
}
