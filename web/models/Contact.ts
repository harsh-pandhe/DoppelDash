import mongoose, { Schema, Document, Model } from 'mongoose'

export interface ITimelineEntry {
  type: 'email' | 'meeting' | 'note' | 'call'
  title: string
  body?: string
  source: 'manual' | 'outlook'
  date: Date
}

export interface IContact extends Document {
  createdBy: string
  name: string
  email?: string
  phone?: string
  company?: string
  designation?: string
  gender?: string   // stored encrypted
  caste?: string    // stored encrypted (DPDP Act)
  religion?: string // stored encrypted (DPDP Act)
  notes?: string
  tags?: string[]
  projects?: string[]
  photo?: string
  birthday?: Date
  anniversary?: Date
  birthdayGreetingSent?: boolean
  timeline: ITimelineEntry[]
  createdAt: Date
  updatedAt: Date
}

const TimelineEntrySchema = new Schema<ITimelineEntry>(
  {
    type:   { type: String, enum: ['email', 'meeting', 'note', 'call'], required: true },
    title:  { type: String, required: true },
    body:   { type: String },
    source: { type: String, enum: ['manual', 'outlook'], default: 'manual' },
    date:   { type: Date, default: Date.now },
  },
  { _id: true }
)

const ContactSchema = new Schema<IContact>(
  {
    createdBy:            { type: String, required: true, index: true },
    name:                 { type: String, required: true, trim: true },
    email:                { type: String, trim: true, lowercase: true },
    phone:                { type: String, trim: true },
    company:              { type: String, trim: true },
    designation:          { type: String, trim: true },
    gender:               { type: String },  // encrypted at API layer
    caste:                { type: String },  // encrypted at API layer
    religion:             { type: String },  // encrypted at API layer
    notes:                { type: String },
    tags:                 [{ type: String }],
    projects:             [{ type: String }],
    photo:                { type: String },
    birthday:             { type: Date },
    anniversary:          { type: Date },
    birthdayGreetingSent: { type: Boolean, default: false },
    timeline:             [TimelineEntrySchema],
  },
  { timestamps: true }
)

const Contact: Model<IContact> = mongoose.models.Contact || mongoose.model('Contact', ContactSchema)
export default Contact
