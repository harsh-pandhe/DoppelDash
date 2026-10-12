/**
 * DoppelDash — server-side WEB client access boundary.
 *
 * One backend serves two clients: the Doppelmayr India internal web portal and
 * the public Android app. Which organisations may use the WEB client is decided
 * by ONE persisted field — `Organization.webEnabled` — as resolved by the
 * entitlement service. There is no organisation-id or slug special case here:
 * Doppelmayr is allowed because its stored entitlement says so, and any other
 * organisation holding the same stored value is treated identically.
 *
 * Token classes (see jwt.ts):
 *   typ 'access'                       mobile Bearer token  → not web, never gated here
 *   typ 'session' (or legacy, no typ)  web session token    → requires webEnabled === true
 *
 * The check runs on every authenticated request (getUser) and when a login
 * would mint the web cookie — hiding routes or buttons is never the boundary.
 */
import type { NextResponse } from 'next/server'
import { getOrganizationEntitlements } from '@/lib/entitlements/entitlementService'
import { COOKIE_NAME, COOKIE_OPTS, type JWTPayload } from './jwt'

/** True when the organisation's persisted entitlement allows the web client. */
export async function isWebAccessAllowed(orgId: string): Promise<boolean> {
  if (!orgId) return false
  return (await getOrganizationEntitlements(orgId)).webEnabled === true
}

/** Web sessions are every session-class token that is not an explicit mobile access token. */
export function isWebSessionToken(payload: Pick<JWTPayload, 'typ'>): boolean {
  return payload.typ !== 'access'
}

/**
 * Attach the web session cookie. Callers MUST have established web access first
 * (`isWebAccessAllowed`) and report it to the client (`webAccess`); mobile ignores
 * the cookie and uses the Bearer tokens in the response body.
 */
export function setWebSessionCookie(res: NextResponse, token: string): void {
  res.cookies.set(COOKIE_NAME, token, COOKIE_OPTS)
}
