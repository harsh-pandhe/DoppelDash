import mongoose, { Schema, Document, Model } from 'mongoose'

export interface ITimelineEntry {
  type: 'email' | 'meeting' | 'note' | 'call'
  title: string
  body?: string
  source: 'manual' | 'outlook'
  date: Date
}

export type ContactVisibility = 'private' | 'team' | 'org' | 'boss_only'

export interface IColorLabel {
  color: string   // hex e.g. "#ef4444"
  label: string   // user-defined e.g. "Hot Lead"
}

export interface IContact extends Document {
  createdBy: string
  name: string
  email?: string
  phone?: string
  company?: string
  designation?: string
  gender?: string
  caste?: string
  religion?: string
  notes?: string
  tags?: string[]
  projects?: string[]
  photo?: string
  birthday?: Date
  anniversary?: Date
  birthdayGreetingSent?: boolean
  reminderDate?: Date
  reminderNote?: string
  timeline: ITimelineEntry[]

  // Sharing
  visibility: ContactVisibility
  sharedWith?: string[]   // explicit clerkUserIds if visibility='private' but shared 1:1

  // Color label
  colorLabel?: IColorLabel

  // Contact type (client vs internal employee)
  isEmployee: boolean
  employeeClerkId?: string

  createdAt: Date
  updatedAt: Date
}

const TimelineEntrySchema = new Schema<ITimelineEntry>(
  {
    type:   { type: String, enum: ['email','meeting','note','call'], required: true },
    title:  { type: String, required: true },
    body:   { type: String },
    source: { type: String, enum: ['manual','outlook'], default: 'manual' },
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
    gender:               { type: String },
    caste:                { type: String },
    religion:             { type: String },
    notes:                { type: String },
    tags:                 [{ type: String }],
    projects:             [{ type: String }],
    photo:                { type: String },
    birthday:             { type: Date },
    anniversary:          { type: Date },
    birthdayGreetingSent: { type: Boolean, default: false },
    reminderDate:         { type: Date },
    reminderNote:         { type: String },
    timeline:             [TimelineEntrySchema],

    visibility:  { type: String, enum: ['private','team','org','boss_only'], default: 'private' },
    sharedWith:  [{ type: String }],

    colorLabel: {
      color: { type: String },
      label: { type: String },
    },

    isEmployee:       { type: Boolean, default: false },
    employeeClerkId:  { type: String },
  },
  { timestamps: true }
)

ContactSchema.index({ createdBy: 1, visibility: 1 })
ContactSchema.index({ sharedWith: 1 })

const Contact: Model<IContact> = mongoose.models.Contact || mongoose.model('Contact', ContactSchema)
export default Contact
