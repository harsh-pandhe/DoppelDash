import crypto from 'crypto'
import { SignJWT } from 'jose'
import RefreshToken, { type RefreshRevokeReason } from '@/models/RefreshToken'
import User from '@/models/User'
import { connectDB } from '@/lib/db'
import { getJwtSecret, assertSessionSubject, type SessionSubject, type TokenType } from './jwt'

// Deliberately much shorter-lived than the web session cookie (7d) — a stolen
// access token only works for 15 minutes; the refresh token is what actually
// needs to stay secret long-term, and it's opaque (never sent to any endpoint
// except /api/auth/refresh and /api/auth/logout).
const ACCESS_EXPIRES = '15m'
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days

/**
 * Two simultaneous refreshes with one token are a benign client race (e.g. a
 * 401-retry colliding with a biometric unlock). Only ONE may succeed, but the
 * loser inside this window must not burn the winner's new token. Replays after
 * the window are treated as token theft and revoke the whole device family.
 */
function reuseGraceMs(): number {
  const raw = Number(process.env.REFRESH_REUSE_GRACE_MS)
  return Number.isFinite(raw) && raw >= 0 ? raw : 10_000
}

export async function signMobileAccessToken(user: Partial<SessionSubject>): Promise<string> {
  assertSessionSubject(user)
  return new SignJWT({
    typ:       'access' satisfies TokenType,
    userId:    user.id,
    orgId:     user.orgId,
    email:     user.email,
    role:      user.role,
    firstName: user.firstName,
    lastName:  user.lastName,
    sessionVersion: user.sessionVersion ?? 1,
    jti:       crypto.randomUUID(),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(ACCESS_EXPIRES)
    .sign(getJwtSecret())
}

function hashToken(raw: string): string {
  return crypto.createHash('sha256').update(raw).digest('hex')
}

export interface IssueRefreshOptions {
  /** The user's current security stamp. Looked up when omitted. */
  sessionVersion?: number
  /** Continue an existing device family (rotation). New logins start a new family. */
  familyId?: string
}

export async function issueMobileRefreshToken(userId: string, opts: IssueRefreshOptions = {}): Promise<string> {
  let sessionVersion = opts.sessionVersion
  if (sessionVersion === undefined) {
    await connectDB()
    const u = await User.findById(userId).select('sessionVersion').lean<{ sessionVersion?: number }>()
    sessionVersion = u?.sessionVersion ?? 1
  }
  const raw = crypto.randomBytes(32).toString('hex')
  await RefreshToken.create({
    userId,
    tokenHash: hashToken(raw),
    familyId: opts.familyId || crypto.randomUUID(),
    sessionVersion,
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
  })
  return raw
}

export type RotateOutcome =
  | { ok: true; userId: string; refreshToken: string; sessionVersion: number }
  | { ok: false; reason: 'invalid' | 'reuse' | 'stale_session' | 'inactive' }

/**
 * Validate + rotate a refresh token ATOMICALLY.
 *
 * The claim is a single findOneAndUpdate guarded by `revokedAt: { $exists: false }`,
 * so of N concurrent presentations of the same token exactly one matches; the
 * rest see it already revoked. Every failure mode is reported to the caller as
 * the same generic 401 — the reason is only for audit/tests.
 */
export async function rotateMobileRefreshToken(rawToken: string): Promise<RotateOutcome> {
  if (typeof rawToken !== 'string' || rawToken.length < 16 || rawToken.length > 256) return { ok: false, reason: 'invalid' }
  await connectDB()
  const tokenHash = hashToken(rawToken)
  const now = new Date()

  const claimed = await RefreshToken.findOneAndUpdate(
    { tokenHash, revokedAt: { $exists: false }, expiresAt: { $gt: now } },
    { $set: { revokedAt: now, revokedReason: 'rotated', rotatedAt: now } },
    { new: false }
  )

  if (!claimed) {
    const existing = await RefreshToken.findOne({ tokenHash }).lean()
    if (existing?.revokedReason === 'rotated' && existing.rotatedAt) {
      const age = now.getTime() - new Date(existing.rotatedAt).getTime()
      if (age > reuseGraceMs() && existing.familyId) {
        // Replay of an old token long after it was rotated: assume theft, kill the device family.
        await RefreshToken.updateMany(
          { familyId: existing.familyId, revokedAt: { $exists: false } },
          { $set: { revokedAt: now, revokedReason: 'reuse_detected' } }
        )
      }
      return { ok: false, reason: 'reuse' }
    }
    return { ok: false, reason: 'invalid' }
  }

  const user = await User.findById(claimed.userId).select('isActive isBanned sessionVersion').lean<{
    isActive?: boolean; isBanned?: boolean; sessionVersion?: number
  }>()
  if (!user || user.isActive === false || user.isBanned === true) {
    await revokeFamily(claimed.familyId, claimed.userId, 'stale_session')
    return { ok: false, reason: 'inactive' }
  }

  const currentVersion = user.sessionVersion ?? 1
  // Tokens minted before the stamp existed are treated as stamp 1.
  const tokenVersion = claimed.sessionVersion ?? 1
  if (tokenVersion !== currentVersion) {
    await revokeFamily(claimed.familyId, claimed.userId, 'stale_session')
    return { ok: false, reason: 'stale_session' }
  }

  const refreshToken = await issueMobileRefreshToken(claimed.userId, {
    sessionVersion: currentVersion,
    familyId: claimed.familyId || String(claimed._id),
  })
  return { ok: true, userId: claimed.userId, refreshToken, sessionVersion: currentVersion }
}

async function revokeFamily(familyId: string | undefined, userId: string, reason: RefreshRevokeReason) {
  const filter = familyId ? { familyId } : { userId }
  await RefreshToken.updateMany({ ...filter, revokedAt: { $exists: false } }, { $set: { revokedAt: new Date(), revokedReason: reason } })
}

/** Logout: revoke exactly the presented token (other devices stay signed in). */
export async function revokeMobileRefreshToken(rawToken: string): Promise<void> {
  if (typeof rawToken !== 'string' || !rawToken) return
  await connectDB()
  await RefreshToken.updateOne(
    { tokenHash: hashToken(rawToken), revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date(), revokedReason: 'logout' } }
  )
}

/**
 * Revoke EVERY outstanding mobile session for a user — password change/reset,
 * admin lock-out, account deletion. Complements the sessionVersion stamp (which
 * already blocks them at refresh time) so nothing is left as a live row.
 */
export async function revokeAllMobileRefreshTokens(userId: string, reason: RefreshRevokeReason = 'password_change'): Promise<number> {
  await connectDB()
  const res = await RefreshToken.updateMany(
    { userId, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date(), revokedReason: reason } }
  )
  return res.modifiedCount ?? 0
}
