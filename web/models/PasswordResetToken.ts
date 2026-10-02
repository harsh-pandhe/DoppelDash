import mongoose, { Schema, Document, Model } from 'mongoose'
import crypto from 'node:crypto'

export interface IPasswordResetToken extends Document {
  userId: mongoose.Types.ObjectId
  email: string
  orgId: string
  tokenHash: string
  expiresAt: Date
  usedAt?: Date
  createdAt: Date
}

export interface IPasswordResetTokenModel extends Model<IPasswordResetToken> {
  hashToken(rawToken: string): string
  generateRawToken(): string
}

const PasswordResetTokenSchema = new Schema<IPasswordResetToken, IPasswordResetTokenModel>(
  {
    userId:    { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    email:     { type: String, required: true, lowercase: true, trim: true, index: true },
    orgId:     { type: String, required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true, index: true },
    usedAt:    { type: Date },
    createdAt: { type: Date, default: Date.now, expires: 86400 }, // TTL cleanup after 24 hours
  },
  { timestamps: false }
)

// Helper to hash raw token (SHA-256)
PasswordResetTokenSchema.statics.hashToken = function (rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex')
}

// Helper to generate cryptographically secure high-entropy token (256-bit)
PasswordResetTokenSchema.statics.generateRawToken = function (): string {
  return crypto.randomBytes(32).toString('hex')
}

export default (mongoose.models.PasswordResetToken as IPasswordResetTokenModel) ||
  mongoose.model<IPasswordResetToken, IPasswordResetTokenModel>('PasswordResetToken', PasswordResetTokenSchema)
