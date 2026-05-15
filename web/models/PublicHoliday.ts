import mongoose, { Schema, Document, Model } from 'mongoose'

export type HolidayType = 'national' | 'regional' | 'restricted' | 'optional'

export interface IPublicHoliday extends Document {
  orgId?: string        // null = default India holidays, set = org-specific overrides
  name: string
  date: Date
  type: HolidayType
  description?: string
  isRecurringYearly: boolean
  state?: string        // for regional holidays
  createdBy?: string    // clerkUserId of manager who added/edited
  year: number
}

const PublicHolidaySchema = new Schema<IPublicHoliday>(
  {
    orgId:              { type: String, index: true },
    name:               { type: String, required: true },
    date:               { type: Date, required: true },
    type:               { type: String, enum: ['national','regional','restricted','optional'], default: 'national' },
    description:        { type: String },
    isRecurringYearly:  { type: Boolean, default: true },
    state:              { type: String },
    createdBy:          { type: String },
    year:               { type: Number, required: true, index: true },
  },
  { timestamps: true }
)

PublicHolidaySchema.index({ date: 1, orgId: 1 })

const PublicHoliday: Model<IPublicHoliday> = mongoose.models.PublicHoliday || mongoose.model('PublicHoliday', PublicHolidaySchema)
export default PublicHoliday
