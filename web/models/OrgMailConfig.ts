import mongoose, { Schema, Document, Model } from 'mongoose'

/**
 * Organisation-level outbound mail provider (Premium feature `customMail`).
 *
 * Stored per tenant. The SMTP password is AES-256-GCM encrypted at rest
 * (lib/encrypt.ts) and is NEVER returned by any API — responses only ever expose
 * `hasPassword: true`. Clients cannot choose or read credentials; the backend
 * decrypts them only inside the server-side transport.
 */
export interface IOrgMailConfig extends Document {
  orgId: string
  kind: 'smtp'
  host: string
  port: number
  secure: boolean
  username: string
  passwordEnc: string
  fromEmail: string
  fromName: string
  verifiedAt?: Date
  lastTestFailureCode?: string
  updatedBy: string
  createdAt: Date
  updatedAt: Date
}

const OrgMailConfigSchema = new Schema<IOrgMailConfig>(
  {
    orgId:       { type: String, required: true, unique: true, index: true },
    kind:        { type: String, enum: ['smtp'], default: 'smtp' },
    host:        { type: String, required: true, trim: true },
    port:        { type: Number, required: true, default: 587 },
    secure:      { type: Boolean, default: false },
    username:    { type: String, required: true, trim: true },
    passwordEnc: { type: String, required: true, select: false },
    fromEmail:   { type: String, required: true, trim: true, lowercase: true },
    fromName:    { type: String, trim: true, default: '' },
    verifiedAt:  { type: Date },
    lastTestFailureCode: { type: String },
    updatedBy:   { type: String, required: true },
  },
  { timestamps: true }
)

const OrgMailConfig: Model<IOrgMailConfig> =
  (mongoose.models.OrgMailConfig as Model<IOrgMailConfig>) ||
  mongoose.model<IOrgMailConfig>('OrgMailConfig', OrgMailConfigSchema)

export default OrgMailConfig
