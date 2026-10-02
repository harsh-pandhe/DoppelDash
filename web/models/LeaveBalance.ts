import mongoose, { Schema, Document, Model } from 'mongoose'

export interface ILeaveBalance extends Document {
  orgId: string
  userId: string
  year: number
  casual:    number
  sick:      number   // renamed from medical
  earned:    number
  privilege: number   // company-granted privilege leaves
  restricted: number  // restricted holiday entitlement
  lwpDays:   number   // informational: LWP days taken (no balance limit)
}

const LeaveBalanceSchema = new Schema<ILeaveBalance>(
  {
    orgId: { type: String, required: true, default: 'org_doppelmayr', index: true },
    userId:    { type: String, required: true, index: true },
    year:      { type: Number, required: true },
    casual:    { type: Number, default: 12 },
    sick:      { type: Number, default: 6 },
    earned:    { type: Number, default: 15 },
    privilege: { type: Number, default: 2 },
    restricted:{ type: Number, default: 2 },
    lwpDays:   { type: Number, default: 0 },
  },
  { timestamps: true }
)

LeaveBalanceSchema.index({ userId: 1, year: 1 }, { unique: true })
LeaveBalanceSchema.index({ orgId: 1, userId: 1, year: 1 }, { unique: true })
LeaveBalanceSchema.index({ orgId: 1, year: 1 })

const LeaveBalance: Model<ILeaveBalance> =
  mongoose.models.LeaveBalance || mongoose.model('LeaveBalance', LeaveBalanceSchema)
export default LeaveBalance
