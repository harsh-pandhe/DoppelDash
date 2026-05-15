import mongoose, { Schema, Document, Model } from 'mongoose'

export type LeaveType = 'casual' | 'sick' | 'earned' | 'lwp' | 'privilege' | 'restricted'

export interface ILeave extends Document {
  userId: string
  userName: string
  type: LeaveType
  startDate: Date
  endDate: Date
  days: number
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  medicalDocs?: string[]
  managerNote?: string
  approvedBy?: string
  isLWP: boolean
  isHalfDay: boolean
  halfDayPeriod?: 'morning' | 'afternoon'
  createdAt: Date
  updatedAt: Date
}

const LeaveSchema = new Schema<ILeave>(
  {
    userId:      { type: String, required: true, index: true },
    userName:    { type: String, required: true },
    type:        { type: String, enum: ['casual','sick','earned','lwp','privilege','restricted'], required: true },
    startDate:   { type: Date, required: true },
    endDate:     { type: Date, required: true },
    days:        { type: Number, required: true },
    reason:      { type: String, required: true },
    status:      { type: String, enum: ['pending','approved','rejected'], default: 'pending' },
    medicalDocs: [{ type: String }],
    managerNote: { type: String },
    approvedBy:  { type: String },
    isLWP:       { type: Boolean, default: false },
    isHalfDay:   { type: Boolean, default: false },
    halfDayPeriod: { type: String, enum: ['morning','afternoon'] },
  },
  { timestamps: true }
)

const Leave: Model<ILeave> = mongoose.models.Leave || mongoose.model('Leave', LeaveSchema)
export default Leave
