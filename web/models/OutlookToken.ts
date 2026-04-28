import mongoose, { Schema, Document, Model } from 'mongoose'

export interface IOutlookToken extends Document {
  userId: string       // Clerk userId
  email: string        // Outlook email address
  accessToken: string
  refreshToken: string
  expiresAt: Date
  subscriptionId?: string
  subscriptionExpiry?: Date
}

const OutlookTokenSchema = new Schema<IOutlookToken>(
  {
    userId:              { type: String, required: true, unique: true, index: true },
    email:               { type: String, required: true },
    accessToken:         { type: String, required: true },
    refreshToken:        { type: String, required: true },
    expiresAt:           { type: Date, required: true },
    subscriptionId:      { type: String },
    subscriptionExpiry:  { type: Date },
  },
  { timestamps: true }
)

const OutlookToken: Model<IOutlookToken> =
  mongoose.models.OutlookToken || mongoose.model('OutlookToken', OutlookTokenSchema)
export default OutlookToken
