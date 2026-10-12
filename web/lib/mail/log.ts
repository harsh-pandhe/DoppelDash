import { MailTransportError, type MailChannel, type MailPurpose } from './types'

/**
 * Mail logging that cannot leak. We record WHAT failed (purpose, channel,
 * provider-level code) — never the message body, the recipient, an SMTP error
 * string (those can echo usernames/hosts) or anything resembling a credential.
 */
export function describeMailError(err: unknown): { code: string; responseCode?: number } {
  if (err instanceof MailTransportError) return { code: err.code, responseCode: err.responseCode }
  const e = err as { code?: unknown; responseCode?: unknown } | null
  return {
    code: typeof e?.code === 'string' ? e.code.slice(0, 40) : 'unknown',
    responseCode: typeof e?.responseCode === 'number' ? e.responseCode : undefined,
  }
}

export function logMailFailure(purpose: MailPurpose, channel: MailChannel, err: unknown): void {
  const { code, responseCode } = describeMailError(err)
  console.error('[mail] delivery failed', { purpose, channel, code, responseCode })
}
