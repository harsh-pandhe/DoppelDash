import { canUseFeature } from '@/lib/entitlements/entitlementService'
import { getPlatformTransport } from './transports/supportDashAdapter'
import { loadOrgTransport, loadUserMailboxTransport } from './transports/orgTransport'
import { failure, type MailChannel, type MailFailure, type MailPurpose, type MailTransport } from './types'

/**
 * PROVIDER RESOLUTION — the single place that decides which provider sends what.
 * The backend decides; no client input (header, query, body) can influence it.
 *
 *   purpose                                                   resolution
 *   ───────────────────────────────────────────────────────   ──────────────────────────────────────────────
 *   otp, verification, password_reset,
 *   security_notification, account_notification               PLATFORM only. Security mail must never depend
 *                                                             on (or be spoofable through) a tenant's server.
 *   invitation, notification                                  organisation provider (Premium + verified),
 *                                                             falling back to PLATFORM if it is absent/fails.
 *   crm_email                                                 organisation provider → the user's connected
 *                                                             mailbox (both require Premium `customMail`)
 *                                                             → PLATFORM. A failing CUSTOM provider is reported,
 *                                                             not silently replaced by the platform sender.
 *
 * Free organisations never reach a custom provider: the entitlement is checked
 * server-side on every resolution, and saving a config is separately gated.
 */
export const PLATFORM_ONLY_PURPOSES: ReadonlySet<MailPurpose> = new Set<MailPurpose>([
  'otp', 'verification', 'password_reset', 'security_notification', 'account_notification',
])

export interface ResolveInput {
  purpose: MailPurpose
  orgId?: string
  userId?: string
}

export interface MailRoute {
  channel: MailChannel
  transport: MailTransport
  /** Used only when the primary fails AND the policy allows silent fallback. */
  fallback?: { channel: MailChannel; transport: MailTransport }
}

export type ResolveOutcome = { route: MailRoute; failure?: undefined } | { route?: undefined; failure: MailFailure }

export interface ResolverDeps {
  platform(): MailTransport
  org(orgId: string): Promise<MailTransport | null>
  userMailbox(userId: string, orgId: string): Promise<MailTransport | null>
  canUseCustomMail(orgId: string): Promise<boolean>
}

export const defaultResolverDeps: ResolverDeps = {
  platform: () => getPlatformTransport(),
  org: orgId => loadOrgTransport(orgId),
  userMailbox: (userId, orgId) => loadUserMailboxTransport(userId, orgId),
  canUseCustomMail: orgId => canUseFeature(orgId, 'customMail'),
}

export async function resolveMailRoute(input: ResolveInput, deps: ResolverDeps = defaultResolverDeps): Promise<ResolveOutcome> {
  const platform = deps.platform()
  const platformRoute: MailRoute = { channel: 'platform', transport: platform }
  const platformOrFail = (): ResolveOutcome =>
    platform.isConfigured() ? { route: platformRoute } : { failure: failure('not_configured') }

  if (PLATFORM_ONLY_PURPOSES.has(input.purpose) || !input.orgId) return platformOrFail()

  // Entitlement gate — evaluated server-side on every send, never cached from a client.
  const entitled = await deps.canUseCustomMail(input.orgId).catch(() => false)
  if (!entitled) return platformOrFail()

  const org = await deps.org(input.orgId)
  if (org?.isConfigured()) {
    return {
      route: {
        channel: 'organization',
        transport: org,
        fallback: input.purpose === 'crm_email' || !platform.isConfigured() ? undefined : { channel: 'platform', transport: platform },
      },
    }
  }

  if (input.purpose === 'crm_email' && input.userId) {
    const mailbox = await deps.userMailbox(input.userId, input.orgId)
    if (mailbox?.isConfigured()) return { route: { channel: 'user_mailbox', transport: mailbox } }
  }

  return platformOrFail()
}
