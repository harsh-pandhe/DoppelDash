import mongoose, { Schema, Document, Model } from 'mongoose'

export interface ILeave extends Document {
  userId: string             // Clerk userId
  userName: string
  type: 'casual' | 'medical' | 'earned'
  startDate: Date
  endDate: Date
  days: number
  reason: string
  status: 'pending' | 'approved' | 'rejected'
  medicalDocs?: string[]     // file URLs
  managerNote?: string
  approvedBy?: string        // Clerk userId of manager/boss
  createdAt: Date
  updatedAt: Date
}

const LeaveSchema = new Schema<ILeave>(
  {
    userId:      { type: String, required: true, index: true },
    userName:    { type: String, required: true },
    type:        { type: String, enum: ['casual', 'medical', 'earned'], required: true },
    startDate:   { type: Date, required: true },
    endDate:     { type: Date, required: true },
    days:        { type: Number, required: true },
    reason:      { type: String, required: true },
    status:      { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
    medicalDocs: [{ type: String }],
    managerNote: { type: String },
    approvedBy:  { type: String },
  },
  { timestamps: true }
)

const Leave: Model<ILeave> = mongoose.models.Leave || mongoose.model('Leave', LeaveSchema)
export default Leave
