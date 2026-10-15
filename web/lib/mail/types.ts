/**
 * DoppelDash mail architecture — shared types.
 *
 * SERVER-ONLY. Nothing in lib/mail may be imported from a client component, and
 * no function here ever returns credentials. Clients never choose a provider:
 * the backend resolves one per message (see resolver.ts).
 */

/** Why an email is being sent. Drives provider resolution and template choice. */
export type MailPurpose =
  | 'otp'
  | 'verification'
  | 'password_reset'
  | 'security_notification'
  | 'account_notification'
  | 'invitation'
  | 'notification'
  | 'crm_email'

/** Which provider ultimately carried (or would carry) the message. */
export type MailChannel = 'platform' | 'organization' | 'user_mailbox'

export interface MailEnvelope {
  to: string | string[]
  subject: string
  html: string
  text?: string
  /** Display-name / address override. Honoured only by transports that own their sender identity. */
  from?: string
  /**
   * Brand display name for the From header. Applied ONLY by transports that send from a
   * shared / personal address (platform relay, connected mailbox) and keep their own
   * sender ADDRESS; an organisation provider already owns its full identity and ignores it.
   */
  fromName?: string
  replyTo?: string
  headers?: Record<string, string>
}

/**
 * The adapter boundary. A transport knows HOW to move bytes (SMTP, an HTTP API,
 * an SDK…) and nothing about tenants, purposes or entitlements.
 */
export interface MailTransport {
  readonly id: string
  isConfigured(): boolean
  /** Throws MailTransportError on failure. Must never put credentials in the error. */
  deliver(envelope: MailEnvelope): Promise<void>
}

export type MailFailureCode =
  | 'not_configured'      // no usable transport for this message
  | 'provider_error'      // the transport rejected / could not deliver
  | 'invalid_recipient'   // nothing sendable in `to`
  | 'feature_unavailable' // organisation is not entitled to the selected provider

/** Caller-safe description of a failure: stable code + generic message, no internals. */
export interface MailFailure {
  code: MailFailureCode
  message: string
}

export interface MailResult {
  delivered: boolean
  channel: MailChannel
  failure?: MailFailure
}

export class MailTransportError extends Error {
  /** Provider-level classification only (e.g. SMTP response code) — never credentials. */
  readonly code: string
  readonly responseCode?: number
  constructor(message: string, code = 'provider_error', responseCode?: number) {
    super(message)
    this.name = 'MailTransportError'
    this.code = code
    this.responseCode = responseCode
  }
}

export const SAFE_FAILURE_MESSAGES: Record<MailFailureCode, string> = {
  not_configured: 'Email delivery is not available right now.',
  provider_error: 'We couldn’t deliver the email. Please try again shortly.',
  invalid_recipient: 'That email address can’t receive messages.',
  feature_unavailable: 'Your plan doesn’t include this email option.',
}

export function failure(code: MailFailureCode): MailFailure {
  return { code, message: SAFE_FAILURE_MESSAGES[code] }
}
