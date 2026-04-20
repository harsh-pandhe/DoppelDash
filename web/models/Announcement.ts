import mongoose, { Schema, Document, Model } from 'mongoose'

export interface IAnnouncement extends Document {
  authorId:   string
  authorName: string
  title:      string
  body:       string
  pinned:     boolean
  priority:   'normal' | 'important' | 'urgent'
  createdAt:  Date
  updatedAt:  Date
}

const AnnouncementSchema = new Schema<IAnnouncement>(
  {
    authorId:   { type: String, required: true },
    authorName: { type: String, required: true },
    title:      { type: String, required: true, trim: true },
    body:       { type: String, required: true },
    pinned:     { type: Boolean, default: false },
    priority:   { type: String, enum: ['normal', 'important', 'urgent'], default: 'normal' },
  },
  { timestamps: true }
)

const Announcement: Model<IAnnouncement> =
  mongoose.models.Announcement || mongoose.model('Announcement', AnnouncementSchema)
export default Announcement
