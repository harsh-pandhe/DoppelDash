/**
 * Rate-limit policy for authentication-adjacent endpoints. One module so the
 * numbers are documented, reviewable and testable in one place.
 *
 * Design rule: counters are keyed by (account | recipient | inviter) — never by
 * organisation — so one abusive actor can throttle only themselves or the single
 * address they are targeting, never lock out a whole tenant.
 */

/** Login (counting FAILED attempts only; see app/api/auth/login/route.ts). */
export const LOGIN_LIMITS = {
  /** Pre-existing IP burst limit: attempts per minute per IP. */
  ipPerMinute: 10,
  /** Failures per account+IP per window before that IP is blocked for that account. */
  accountIpFailures: 5,
  /** Failures per account (all IPs) per window; waived for IPs with a recent successful login. */
  accountFailures: 20,
  windowMs: 15 * 60_000,
  knownIpTtlMs: 30 * 24 * 60 * 60_000,
} as const

/** Invitation creation / resend (counts every attempt, successful or not). */
export const INVITE_LIMITS = {
  /** Invitations one inviter may send per hour (any recipients). */
  perInviterPerHour: 30,
  /** Times one org may invite the SAME address per day (re-invites included). */
  perOrgRecipientPerDay: 3,
  /** Invitations to the same address per day across ALL orgs — stops mail-bombing a third party. */
  perRecipientPerDay: 5,
  hourMs: 60 * 60_000,
  dayMs: 24 * 60 * 60_000,
} as const

/** Refresh endpoint abuse guard (opaque 256-bit tokens, so this is hygiene, not the primary defence). */
export const REFRESH_LIMITS = { perIpPerMinute: 120 } as const
