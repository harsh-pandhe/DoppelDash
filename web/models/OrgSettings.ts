import mongoose, { Schema, Document, Model } from 'mongoose'

export interface IOrgSettings extends Document {
  orgId: string
  name: string
  address?: string
  website?: string
  phone?: string
  email?: string
  logo?: string
  updatedBy: string
  updatedAt: Date
}

const OrgSettingsSchema = new Schema<IOrgSettings>(
  {
    orgId: { type: String, required: true, default: 'org_doppelmayr', index: true, unique: true },
    name:      { type: String, required: true, default: 'My Organization' },
    address:   { type: String },
    website:   { type: String },
    phone:     { type: String },
    email:     { type: String },
    logo:      { type: String },
    updatedBy: { type: String },
  },
  { timestamps: true }
)

const OrgSettings: Model<IOrgSettings> =
  mongoose.models.OrgSettings || mongoose.model('OrgSettings', OrgSettingsSchema)
export default OrgSettings
