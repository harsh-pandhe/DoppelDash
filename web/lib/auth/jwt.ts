import { SignJWT, jwtVerify } from 'jose'
import type { IUserPublic } from '@/models/User'
import { isProductionLike } from './devShortcuts'

/** Shared signing key. The insecure dev fallback exists ONLY on a developer machine. */
export function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    if (isProductionLike()) {
      throw new Error('JWT_SECRET is not set — refusing to use an insecure fallback key')
    }
    return new TextEncoder().encode('change-me-in-production-32-chars!!')
  }
  return new TextEncoder().encode(secret)
}
const getSecret = getJwtSecret

const EXPIRES = '7d'

/**
 * Token model — authentication state is EXPLICIT, never inferred:
 *
 *   typ 'preauth'  password step passed, second factor still pending.
 *                  Authorises ONLY send-otp / verify-otp. Never a session.
 *   typ 'session'  fully authenticated web session (cookie).
 *   typ 'access'   fully authenticated short-lived mobile Bearer token.
 *
 * `verifyToken()` below only ever returns session/access tokens, so every caller
 * (middleware, getUser, logout…) is automatically incapable of accepting a
 * pre-auth token as a login.
 */
export type TokenType = 'session' | 'access' | 'preauth'

export interface JWTPayload {
  typ?:   TokenType
  userId: string
  orgId:  string
  email:  string
  role:   string
  firstName: string
  lastName:  string
  sessionVersion?: number
  jti?: string
  exp?: number
  iat?: number
}

export interface SessionSubject {
  id: string
  orgId: string
  email: string
  role: string
  firstName: string
  lastName: string
  sessionVersion?: number
  jti?: string
}

/** Tenant context is mandatory: a token is never minted without a real orgId. */
export function assertSessionSubject(user: Partial<SessionSubject>): asserts user is SessionSubject {
  if (!user.id || typeof user.id !== 'string') throw new Error('Cannot issue a session token without a user id')
  if (!user.orgId || typeof user.orgId !== 'string') throw new Error('Cannot issue a session token without an organisation')
}

export async function signToken(user: Partial<SessionSubject> | Partial<IUserPublic>): Promise<string> {
  const subject = { ...user } as Partial<SessionSubject>
  assertSessionSubject(subject)
  return new SignJWT({
    typ:       'session' satisfies TokenType,
    userId:    subject.id,
    orgId:     subject.orgId,
    email:     subject.email,
    role:      subject.role,
    firstName: subject.firstName,
    lastName:  subject.lastName,
    sessionVersion: subject.sessionVersion ?? 1,
    jti:       subject.jti || crypto.randomUUID(),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(EXPIRES)
    .sign(getSecret())
}

/**
 * Verify a SESSION-class token (web session or mobile access token).
 * Returns null for pre-auth tokens, tokens with a `purpose`, tokens missing a
 * user or organisation, and anything not signed by us.
 */
export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] })
    const p = payload as unknown as Record<string, unknown>

    // Pre-auth (and any other purpose-bound token) is NEVER a session.
    if (p.typ === 'preauth' || p.purpose !== undefined) return null

    const explicit = p.typ === 'session' || p.typ === 'access'
    // Legacy sessions minted before `typ` existed always carried identity claims;
    // a pre-auth token never did. Accept only that exact legacy shape.
    const legacyShape = p.typ === undefined && typeof p.email === 'string' && typeof p.role === 'string'
    if (!explicit && !legacyShape) return null

    if (typeof p.userId !== 'string' || !p.userId) return null
    // Fail closed on tenant: a token without an organisation is not a session.
    if (typeof p.orgId !== 'string' || !p.orgId) return null

    return payload as unknown as JWTPayload
  } catch {
    return null
  }
}

// Short-lived token proving the password (or passkey) step already
// succeeded for this userId. send-otp/verify-otp require this instead of
// trusting a client-supplied userId — otherwise anyone who knows a
// colleague's ObjectId could request/verify an OTP for them directly.
const PREAUTH_EXPIRES = '10m'

export async function signPreAuthToken(userId: string): Promise<string> {
  return new SignJWT({ userId, purpose: 'preauth', typ: 'preauth' satisfies TokenType })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(PREAUTH_EXPIRES)
    .sign(getSecret())
}

export async function verifyPreAuthToken(token: string): Promise<string | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ['HS256'] })
    if (payload.purpose !== 'preauth' || typeof payload.userId !== 'string') return null
    return payload.userId
  } catch {
    return null
  }
}

export const COOKIE_NAME = 'dd_session'
export const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure:   isProductionLike(),
  path:     '/',
  maxAge:   7 * 24 * 60 * 60,
}
