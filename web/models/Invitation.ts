import mongoose, { Schema, Document, Model } from 'mongoose'
import crypto from 'node:crypto'

export interface IInvitation extends Document {
  orgId: string
  email: string
  role: 'employee' | 'manager'
  firstName?: string
  lastName?: string
  department?: string
  designation?: string
  employeeType?: 'full_time' | 'part_time' | 'intern' | 'contractor'
  tokenHash: string
  expiresAt: Date
  acceptedAt?: Date
  revokedAt?: Date
  invitedBy: string
  createdAt: Date
  updatedAt: Date
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
}

export interface IInvitationModel extends Model<IInvitation> {
  hashToken(rawToken: string): string
  generateRawToken(): string
}

const InvitationSchema = new Schema<IInvitation, IInvitationModel>(
  {
    orgId:        { type: String, required: true, index: true },
    email:        { type: String, required: true, lowercase: true, trim: true, index: true },
    role:         { type: String, required: true, enum: ['employee', 'manager'], default: 'employee' },
    firstName:    { type: String, trim: true },
    lastName:     { type: String, trim: true },
    department:   { type: String, trim: true, default: 'General' },
    designation:  { type: String, trim: true },
    employeeType: {
      type: String,
      enum: ['full_time', 'part_time', 'intern', 'contractor'],
      default: 'full_time',
    },
    tokenHash:    { type: String, required: true, unique: true, index: true },
    expiresAt:    { type: Date, required: true, index: true },
    acceptedAt:   { type: Date },
    revokedAt:    { type: Date },
    invitedBy:    { type: String, required: true, index: true },
  },
  { timestamps: true }
)

// Compound indexes for fast tenant queries
InvitationSchema.index({ orgId: 1, email: 1 })
InvitationSchema.index({ orgId: 1, acceptedAt: 1, revokedAt: 1, expiresAt: 1 })

// Helper to hash raw token
InvitationSchema.statics.hashToken = function (rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex')
}

// Helper to generate high-entropy raw token (256-bit cryptographically secure)
InvitationSchema.statics.generateRawToken = function (): string {
  return crypto.randomBytes(32).toString('hex')
}

// Virtual for invitation status
InvitationSchema.virtual('status').get(function (this: IInvitation): 'pending' | 'accepted' | 'revoked' | 'expired' {
  if (this.acceptedAt) return 'accepted'
  if (this.revokedAt) return 'revoked'
  if (this.expiresAt && new Date(this.expiresAt) < new Date()) return 'expired'
  return 'pending'
})

// Configure toJSON to include virtuals and exclude tokenHash
InvitationSchema.set('toJSON', {
  virtuals: true,
  transform: (_doc, ret) => {
    const r = ret as unknown as Record<string, unknown>
    delete r.tokenHash
    return ret
  },
})

const Invitation: IInvitationModel =
  (mongoose.models.Invitation as IInvitationModel) ||
  mongoose.model<IInvitation, IInvitationModel>('Invitation', InvitationSchema)

export default Invitation
