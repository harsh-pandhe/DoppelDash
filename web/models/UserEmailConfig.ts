import mongoose, { Schema, Document, models } from 'mongoose'

export interface IUserEmailConfig extends Document {
  userId:       string
  emailAddress: string
  smtpHost:     string
  smtpPort:     number
  appPassword:  string   // AES-256-GCM encrypted
  isVerified:   boolean
  createdAt:    Date
  updatedAt:    Date
}

const UserEmailConfigSchema = new Schema<IUserEmailConfig>(
  {
    userId:       { type: String, required: true, unique: true, index: true },
    emailAddress: { type: String, required: true },
    smtpHost:     { type: String, required: true },
    smtpPort:     { type: Number, required: true, default: 587 },
    appPassword:  { type: String, required: true },
    isVerified:   { type: Boolean, default: false },
  },
  { timestamps: true }
)

export default models.UserEmailConfig ||
  mongoose.model<IUserEmailConfig>('UserEmailConfig', UserEmailConfigSchema)
