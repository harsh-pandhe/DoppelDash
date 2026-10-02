import mongoose, { Schema, Document, Model } from 'mongoose'

export interface IOrgSettings extends Document {
  orgId: string
  name: string
  companyName?: string
  timezone?: string
  currency?: string
  workHours?: {
    start?: string
    end?: string
  }
  fiscalYearStart?: string
  address?: string
  website?: string
  phone?: string
  email?: string
  logo?: string
  updatedBy?: string
  createdAt: Date
  updatedAt: Date
}

const OrgSettingsSchema = new Schema<IOrgSettings>(
  {
    orgId:           { type: String, required: true, index: true, unique: true },
    name:            { type: String, required: true, default: 'My Organization', trim: true },
    companyName:     { type: String, trim: true },
    timezone:        { type: String, default: 'Asia/Kolkata', trim: true },
    currency:        { type: String, default: 'INR', trim: true },
    workHours: {
      type: Schema.Types.Mixed,
      default: () => ({ start: '09:00', end: '18:00' }),
    },
    fiscalYearStart: { type: String, default: 'April', trim: true },
    address:         { type: String, trim: true },
    website:         { type: String, trim: true },
    phone:           { type: String, trim: true },
    email:           { type: String, trim: true },
    logo:            { type: String },
    updatedBy:       { type: String },
  },
  { timestamps: true }
)

// Ensure name and companyName stay synchronized
OrgSettingsSchema.pre('validate', function () {
  if (this.companyName && !this.name) {
    this.name = this.companyName
  } else if (this.name && !this.companyName) {
    this.companyName = this.name
  }
})

const OrgSettings: Model<IOrgSettings> =
  mongoose.models.OrgSettings || mongoose.model('OrgSettings', OrgSettingsSchema)
export default OrgSettings
