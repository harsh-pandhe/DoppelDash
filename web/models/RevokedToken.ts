import mongoose, { Schema, Document, Model } from 'mongoose'

export interface IRevokedToken extends Document {
  tokenIdentifier: string // JTI or SHA-256 hash of token
  userId?: string
  expiresAt: Date
  revokedAt: Date
  reason?: string
}

const RevokedTokenSchema = new Schema<IRevokedToken>(
  {
    tokenIdentifier: { type: String, required: true, unique: true, index: true },
    userId:          { type: String, index: true },
    expiresAt:       { type: Date, required: true, index: { expires: 0 } }, // MongoDB TTL auto-deletes expired records
    revokedAt:       { type: Date, default: () => new Date() },
    reason:          { type: String, default: 'logout' },
  },
  { timestamps: true }
)

const RevokedToken: Model<IRevokedToken> =
  (mongoose.models.RevokedToken as Model<IRevokedToken>) ||
  mongoose.model<IRevokedToken>('RevokedToken', RevokedTokenSchema)

export default RevokedToken
