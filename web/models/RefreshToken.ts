import mongoose, { Schema, Document } from 'mongoose'

/**
 * Mobile Bearer-auth layer. Web uses the httpOnly session cookie; the mobile app
 * has no cookie jar, so it exchanges this opaque token for a fresh short-lived
 * access token via /api/auth/refresh.
 *
 * Rotation model (see lib/auth/mobileTokens.ts):
 *   - every use atomically revokes the presented token ('rotated') and issues a
 *     successor in the same `familyId` (one family == one device login)
 *   - presenting an already-rotated token after the short grace window is treated
 *     as theft: the whole family is revoked ('reuse_detected')
 *   - `sessionVersion` pins the token to the user's security stamp, so a password
 *     change / reset (which bumps the stamp) kills every outstanding token
 */
export type RefreshRevokeReason =
  | 'rotated' | 'logout' | 'password_change' | 'password_reset' | 'reuse_detected' | 'stale_session' | 'admin'

export interface IRefreshToken extends Document {
  userId: string
  tokenHash: string
  familyId?: string
  sessionVersion?: number
  expiresAt: Date
  revokedAt?: Date
  revokedReason?: RefreshRevokeReason
  rotatedAt?: Date
  createdAt: Date
}

const RefreshTokenSchema = new Schema<IRefreshToken>(
  {
    userId:         { type: String, required: true, index: true },
    tokenHash:      { type: String, required: true, unique: true },
    familyId:       { type: String, index: true },
    sessionVersion: { type: Number },
    expiresAt:      { type: Date, required: true },
    revokedAt:      { type: Date },
    revokedReason:  { type: String, enum: ['rotated', 'logout', 'password_change', 'password_reset', 'reuse_detected', 'stale_session', 'admin'] },
    rotatedAt:      { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

// TTL index — Mongo auto-purges long after expiry (grace window for clock skew).
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 })

const RefreshToken =
  (mongoose.models.RefreshToken as mongoose.Model<IRefreshToken>) ||
  mongoose.model<IRefreshToken>('RefreshToken', RefreshTokenSchema)
export default RefreshToken
