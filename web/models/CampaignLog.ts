import mongoose, { Schema, Document, Model } from 'mongoose'

export interface ICampaignLog extends Document {
  sentBy: string
  sentByName: string
  subject: string
  tag?: string
  recipientCount: number
  sent: number
  failed: number
  channel: string          // user_smtp | smtp | outlook | test
  scheduledFor?: Date       // set if it was a scheduled send
  createdAt: Date
}

const CampaignLogSchema = new Schema<ICampaignLog>(
  {
    sentBy:         { type: String, required: true, index: true },
    sentByName:     { type: String, required: true },
    subject:        { type: String, required: true },
    tag:            { type: String },
    recipientCount: { type: Number, default: 0 },
    sent:           { type: Number, default: 0 },
    failed:         { type: Number, default: 0 },
    channel:        { type: String, default: 'smtp' },
    scheduledFor:   { type: Date },
  },
  { timestamps: true }
)

CampaignLogSchema.index({ sentBy: 1, createdAt: -1 })

const CampaignLog: Model<ICampaignLog> =
  mongoose.models.CampaignLog || mongoose.model('CampaignLog', CampaignLogSchema)
export default CampaignLog
