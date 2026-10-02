import crypto from 'crypto'
import { SignJWT } from 'jose'
import type { IUserPublic } from '@/models/User'
import RefreshToken from '@/models/RefreshToken'

function getSecret(): Uint8Array {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET is not set — refusing to use an insecure fallback key')
    }
    return new TextEncoder().encode('change-me-in-production-32-chars!!')
  }
  return new TextEncoder().encode(secret)
}

// Deliberately much shorter-lived than the web session cookie (7d) — a
// stolen access token only works for 15 minutes; the refresh token is what
// actually needs to stay secret long-term, and it's opaque (never sent to
// any endpoint except /api/auth/refresh).
const ACCESS_EXPIRES = '15m'
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

export async function signMobileAccessToken(user: Partial<IUserPublic> & { id?: string; sessionVersion?: number }): Promise<string> {
  const jti = crypto.randomUUID()
  const sessionVersion = user.sessionVersion ?? 1
  return new SignJWT({
    userId:    user.id,
    orgId:     user.orgId || 'org_doppelmayr',
    email:     user.email,
    role:      user.role,
    firstName: user.firstName,
    lastName:  user.lastName,
    sessionVersion,
    jti,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ACCESS_EXPIRES)
    .sign(getSecret())
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

export async function issueMobileRefreshToken(userId: string): Promise<string> {
  const raw = crypto.randomBytes(32).toString('hex')
  await RefreshToken.create({
    userId,
    tokenHash: hashToken(raw),
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
  })
  return raw
}

/**
 * Validates + rotates a presented refresh token. Returns the userId and a
 * brand-new raw refresh token on success, or null if the token is missing,
 * expired, already revoked, or unknown (all treated the same to avoid
 * leaking which case it was).
 */
export async function rotateMobileRefreshToken(rawToken: string): Promise<{ userId: string; refreshToken: string } | null> {
  const tokenHash = hashToken(rawToken)
  const existing = await RefreshToken.findOne({ tokenHash })
  if (!existing || existing.revokedAt || existing.expiresAt < new Date()) return null

  existing.revokedAt = new Date()
  await existing.save()

  const refreshToken = await issueMobileRefreshToken(existing.userId)
  return { userId: existing.userId, refreshToken }
}

export async function revokeMobileRefreshToken(rawToken: string): Promise<void> {
  await RefreshToken.updateOne({ tokenHash: hashToken(rawToken) }, { revokedAt: new Date() })
}
