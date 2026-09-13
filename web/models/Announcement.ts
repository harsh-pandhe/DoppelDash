import mongoose, { Schema, Document, Model } from 'mongoose'

export interface IAnnouncement extends Document {
  orgId: string
  authorId:   string
  authorName: string
  title:      string
  body:       string
  pinned:     boolean
  priority:   'normal' | 'important' | 'urgent'
  scheduledFor?: Date
  urgentEmailSent?: boolean
  createdAt:  Date
  updatedAt:  Date
}

const AnnouncementSchema = new Schema<IAnnouncement>(
  {
    orgId: { type: String, required: true, default: 'org_doppelmayr', index: true },
    authorId:   { type: String, required: true },
    authorName: { type: String, required: true },
    title:      { type: String, required: true, trim: true },
    body:       { type: String, required: true },
    pinned:     { type: Boolean, default: false },
    priority:   { type: String, enum: ['normal', 'important', 'urgent'], default: 'normal' },
    scheduledFor: { type: Date, default: null },
    urgentEmailSent: { type: Boolean, default: false },
  },
  { timestamps: true }
)

const Announcement: Model<IAnnouncement> =
  mongoose.models.Announcement || mongoose.model('Announcement', AnnouncementSchema)
export default Announcement
