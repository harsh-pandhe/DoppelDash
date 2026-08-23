import mongoose, { Schema, Document } from 'mongoose'

// Mobile-only Bearer-auth layer. Web uses the httpOnly session cookie;
// the mobile app has no cookie jar, so it exchanges this opaque token for
// a fresh short-lived access token via /api/auth/refresh. Rotated on every
// use — the presented token is revoked as soon as its replacement issues,
// so a stolen-and-replayed old token fails instead of silently succeeding.
export interface IRefreshToken extends Document {
  userId: string
  tokenHash: string
  expiresAt: Date
  revokedAt?: Date
  createdAt: Date
}

const RefreshTokenSchema = new Schema<IRefreshToken>(
  {
    userId:    { type: String, required: true },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

// TTL index — Mongo auto-purges long after expiry (grace window for clock skew).
RefreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 })

const RefreshToken =
  (mongoose.models.RefreshToken as mongoose.Model<IRefreshToken>) ||
  mongoose.model<IRefreshToken>('RefreshToken', RefreshTokenSchema)
export default RefreshToken
