import mongoose, { Schema, Document, Model } from 'mongoose'

export interface IContact extends Document {
  createdBy: string        // Clerk userId
  name: string
  email?: string
  phone?: string
  company?: string
  designation?: string
  gender?: string
  notes?: string
  tags?: string[]
  projects?: string[]
  photo?: string
  birthday?: Date
  createdAt: Date
  updatedAt: Date
}

const ContactSchema = new Schema<IContact>(
  {
    createdBy:   { type: String, required: true, index: true },
    name:        { type: String, required: true, trim: true },
    email:       { type: String, trim: true, lowercase: true },
    phone:       { type: String, trim: true },
    company:     { type: String, trim: true },
    designation: { type: String, trim: true },
    gender:      { type: String, enum: ['male', 'female', 'other', ''] },
    notes:       { type: String },
    tags:        [{ type: String }],
    projects:    [{ type: String }],
    photo:       { type: String },
    birthday:    { type: Date },
  },
  { timestamps: true }
)

const Contact: Model<IContact> = mongoose.models.Contact || mongoose.model('Contact', ContactSchema)
export default Contact
