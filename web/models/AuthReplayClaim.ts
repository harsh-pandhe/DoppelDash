import mongoose, { Schema, Document } from 'mongoose'

// Single-use claims for authentication artefacts (verified TOTP codes). The unique index on `key` is what makes a
// claim atomic across concurrent requests and serverless instances; the TTL index only garbage-collects.
// Deliberately separate from RateLimit: a rate-limit "mark" is an upsert and cannot express "first writer wins".
export interface IAuthReplayClaim extends Document {
  key: string
  userId: string
  purpose: string
  expiresAt: Date
  createdAt: Date
}

const AuthReplayClaimSchema = new Schema<IAuthReplayClaim>({
  key:       { type: String, required: true, unique: true },
  userId:    { type: String, required: true, index: true },
  purpose:   { type: String, required: true },
  expiresAt: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now },
})

// Mongo removes expired claims in the background (up to ~60 s late; claimAuthArtifact treats a late-purged expired claim as free).
AuthReplayClaimSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

const AuthReplayClaim = (mongoose.models.AuthReplayClaim as mongoose.Model<IAuthReplayClaim>) || mongoose.model<IAuthReplayClaim>('AuthReplayClaim', AuthReplayClaimSchema)
export default AuthReplayClaim
