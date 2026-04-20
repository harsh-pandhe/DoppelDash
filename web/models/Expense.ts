import mongoose, { Schema, Document, Model } from 'mongoose'

export type ExpenseStatus = 'pending_manager' | 'pending_boss' | 'paid' | 'rejected'

export interface IExpense extends Document {
  userId: string             // Clerk userId
  userName: string
  title: string
  reason: string
  amount: number
  travelFrom?: string
  travelTo?: string
  startDate: Date
  endDate?: Date
  receipts: string[]         // file URLs
  status: ExpenseStatus
  managerNote?: string
  bossNote?: string
  paymentProof?: string
  approvedBy?: string
  paidBy?: string
  createdAt: Date
  updatedAt: Date
}

const ExpenseSchema = new Schema<IExpense>(
  {
    userId:       { type: String, required: true, index: true },
    userName:     { type: String, required: true },
    title:        { type: String, required: true },
    reason:       { type: String, required: true },
    amount:       { type: Number, required: true },
    travelFrom:   { type: String },
    travelTo:     { type: String },
    startDate:    { type: Date, required: true },
    endDate:      { type: Date },
    receipts:     [{ type: String }],
    status:       { type: String, enum: ['pending_manager','pending_boss','paid','rejected'], default: 'pending_manager' },
    managerNote:  { type: String },
    bossNote:     { type: String },
    paymentProof: { type: String },
    approvedBy:   { type: String },
    paidBy:       { type: String },
  },
  { timestamps: true }
)

const Expense: Model<IExpense> = mongoose.models.Expense || mongoose.model('Expense', ExpenseSchema)
export default Expense
