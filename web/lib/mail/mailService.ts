import { isProductionLike } from '@/lib/auth/devShortcuts'
import { isSendableAddress } from './escape'
import { logMailFailure } from './log'
import { resolveMailBrand, type MailBrand } from './brand'
import { resolveMailRoute, defaultResolverDeps, type ResolverDeps, type MailRoute } from './resolver'
import {
  renderAccountWelcomeEmail, renderInvitationEmail, renderOtpEmail,
  renderPasswordResetEmail, renderVerificationEmail,
} from './templates'
import { failure, type MailChannel, type MailEnvelope, type MailPurpose, type MailResult } from './types'

export interface SendContext {
  orgId?: string
  userId?: string
}

/**
 * The server-side mail provider facade. Every outbound DoppelDash e-mail goes
 * through exactly one of these methods; none of them throws — callers get a
 * `MailResult` with a stable, caller-safe failure and decide what to tell the user.
 */
export class MailService {
  /** `brandFor` resolves an organisation's e-mail brand; injectable so tests need no database. */
  constructor(
    private readonly deps: ResolverDeps = defaultResolverDeps,
    private readonly brandFor: (orgId?: string) => Promise<MailBrand> = resolveMailBrand,
  ) {}

  /** Low-level: resolve a provider for `purpose`, deliver, fall back only where policy allows. */
  async send(purpose: MailPurpose, ctx: SendContext, envelope: MailEnvelope): Promise<MailResult> {
    const recipients = (Array.isArray(envelope.to) ? envelope.to : [envelope.to]).filter(isSendableAddress)
    if (recipients.length === 0) return { delivered: false, channel: 'platform', failure: failure('invalid_recipient') }

    const outcome = await resolveMailRoute({ purpose, orgId: ctx.orgId, userId: ctx.userId }, this.deps)
    if (!outcome.route) return { delivered: false, channel: 'platform', failure: outcome.failure }
    return this.deliverVia(purpose, outcome.route, { ...envelope, to: recipients })
  }

  private async deliverVia(purpose: MailPurpose, route: MailRoute, envelope: MailEnvelope): Promise<MailResult> {
    try {
      await route.transport.deliver(envelope)
      return { delivered: true, channel: route.channel }
    } catch (err) {
      logMailFailure(purpose, route.channel, err)
      if (route.fallback) {
        try {
          await route.fallback.transport.deliver(envelope)
          return { delivered: true, channel: route.fallback.channel }
        } catch (fallbackErr) {
          logMailFailure(purpose, route.fallback.channel, fallbackErr)
        }
      }
      return { delivered: false, channel: route.channel, failure: failure('provider_error') }
    }
  }

  /** Resolve once, send many (campaigns): avoids a DB lookup per recipient. */
  async createSender(purpose: MailPurpose, ctx: SendContext): Promise<{ channel: MailChannel; send(e: MailEnvelope): Promise<MailResult> } | { failure: NonNullable<MailResult['failure']> }> {
    const outcome = await resolveMailRoute({ purpose, orgId: ctx.orgId, userId: ctx.userId }, this.deps)
    if (!outcome.route) return { failure: outcome.failure }
    const route = outcome.route
    return {
      channel: route.channel,
      send: async envelope => {
        const recipients = (Array.isArray(envelope.to) ? envelope.to : [envelope.to]).filter(isSendableAddress)
        if (recipients.length === 0) return { delivered: false, channel: route.channel, failure: failure('invalid_recipient') }
        return this.deliverVia(purpose, route, { ...envelope, to: recipients })
      },
    }
  }

  /* ───────── the six provider methods ───────── */

  // Security mail always travels over the PLATFORM provider (see resolver.ts); only its
  // presentation (name/colour) follows the recipient's organisation.
  async sendOtp(p: { to: string; code: string; orgId?: string }): Promise<MailResult> {
    const brand = await this.brandFor(p.orgId)
    const mail = renderOtpEmail({ code: p.code, brand })
    return this.send('otp', {}, { to: p.to, fromName: fromNameOf(brand), ...mail, headers: { 'X-Auto-Response-Suppress': 'All' } })
  }

  async sendEmailVerification(p: { to: string; firstName?: string; code: string; orgId?: string }): Promise<MailResult> {
    const brand = await this.brandFor(p.orgId)
    const mail = renderVerificationEmail({ firstName: p.firstName, code: p.code, brand })
    return this.send('verification', {}, { to: p.to, fromName: fromNameOf(brand), ...mail, headers: { 'X-Auto-Response-Suppress': 'All' } })
  }

  async sendPasswordReset(p: { to: string; firstName?: string; resetUrl: string; orgId?: string }): Promise<MailResult> {
    const brand = await this.brandFor(p.orgId)
    const mail = renderPasswordResetEmail({ firstName: p.firstName, resetUrl: p.resetUrl, brand })
    return this.send('password_reset', {}, { to: p.to, fromName: fromNameOf(brand), ...mail, headers: { 'X-Auto-Response-Suppress': 'All' } })
  }

  async sendInvitation(p: { to: string; orgId: string; organizationName: string; role: string; inviterName: string; inviteUrl: string }): Promise<MailResult> {
    const brand = await this.brandFor(p.orgId)
    const mail = renderInvitationEmail({ ...p, brand })
    return this.send('invitation', { orgId: p.orgId }, { to: p.to, fromName: fromNameOf(brand), ...mail })
  }

  async sendAccountWelcome(p: { to: string; orgId: string; firstName: string; tempPassword: string; signInUrl: string }): Promise<MailResult> {
    const brand = await this.brandFor(p.orgId)
    const mail = renderAccountWelcomeEmail({ firstName: p.firstName, email: p.to, tempPassword: p.tempPassword, signInUrl: p.signInUrl, brand })
    return this.send('account_notification', { orgId: p.orgId }, { to: p.to, fromName: fromNameOf(brand), ...mail })
  }

  /** Product notifications (leave/expense/announcements). Body is pre-rendered by lib/email.ts. */
  async sendNotification(p: { to: string | string[]; orgId?: string; subject: string; html: string; text?: string; headers?: Record<string, string> }): Promise<MailResult> {
    const brand = await this.brandFor(p.orgId)
    return this.send('notification', { orgId: p.orgId }, { to: p.to, fromName: fromNameOf(brand), subject: p.subject, html: p.html, text: p.text, headers: p.headers })
  }

  /** CRM e-mail to external recipients (campaigns). */
  async sendCrmEmail(p: { to: string; orgId: string; userId: string; subject: string; html: string; text?: string }): Promise<MailResult> {
    const brand = await this.brandFor(p.orgId)
    return this.send('crm_email', { orgId: p.orgId, userId: p.userId }, { to: p.to, fromName: fromNameOf(brand), subject: p.subject, html: p.html, text: p.text })
  }
}

/** The platform brand keeps the transport's default sender name; organisation brands set the display name. */
function fromNameOf(brand: MailBrand): string | undefined {
  return brand.isPlatform ? undefined : brand.name
}

let shared: MailService | null = null
let override: MailService | null = null

/** The process-wide service. Tests may substitute one via __setMailServiceForTests (ignored in production). */
export function getMailService(): MailService {
  return override ?? (shared ??= new MailService())
}

export function __setMailServiceForTests(service: MailService | null): void {
  if (isProductionLike()) return
  override = service
}
