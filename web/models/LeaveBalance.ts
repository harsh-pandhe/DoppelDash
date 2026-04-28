import mongoose, { Schema, Document, Model } from 'mongoose'

export interface ILeaveBalance extends Document {
  userId: string
  year: number
  casual: number
  medical: number
  earned: number
}

const LeaveBalanceSchema = new Schema<ILeaveBalance>(
  {
    userId:  { type: String, required: true, index: true },
    year:    { type: Number, required: true },
    casual:  { type: Number, default: 12 },
    medical: { type: Number, default: 6 },
    earned:  { type: Number, default: 15 },
  },
  { timestamps: true }
)

LeaveBalanceSchema.index({ userId: 1, year: 1 }, { unique: true })

const LeaveBalance: Model<ILeaveBalance> =
  mongoose.models.LeaveBalance || mongoose.model('LeaveBalance', LeaveBalanceSchema)
export default LeaveBalance
