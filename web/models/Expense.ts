import mongoose, { Schema, Document, Model } from 'mongoose'

export type ExpenseStatus = 'pending_manager' | 'pending_boss' | 'paid' | 'rejected' | 'returned'
export type PaymentMethod = 'cash' | 'card' | 'upi' | 'bank_transfer' | 'advance_adjusted' | 'na'

export interface IExpenseLineItem {
  _id?: unknown
  description: string
  amount: number
  date: Date
  receiptUrl?: string
  category?: string   // e.g. "food", "taxi", "hotel", "flight", "misc"
  status: 'pending' | 'approved' | 'rejected'
  reviewNote?: string
}

export interface IExpense extends Document {
  userId: string
  userName: string
  title: string
  reason: string
  amount: number          // total (sum of line items or manual)
  travelFrom?: string
  travelTo?: string
  startDate: Date
  endDate?: Date

  // Line items (new table format)
  lineItems: IExpenseLineItem[]
  hasLineItems: boolean   // true when table mode used

  // Linked travel request
  travelRequestId?: string

  receipts: string[]      // legacy top-level receipts
  status: ExpenseStatus
  managerNote?: string
  bossNote?: string

  // Payment details
  paymentMethod?: PaymentMethod
  paymentProof?: string
  paymentNote?: string
  paidAt?: Date

  approvedBy?: string
  paidBy?: string
  createdAt: Date
  updatedAt: Date
}

const LineItemSchema = new Schema<IExpenseLineItem>({
  description: { type: String, required: true },
  amount:      { type: Number, required: true },
  date:        { type: Date, required: true },
  receiptUrl:  { type: String },
  category:    { type: String },
  status:      { type: String, enum: ['pending','approved','rejected'], default: 'pending' },
  reviewNote:  { type: String },
}, { _id: true })

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

    lineItems:    { type: [LineItemSchema], default: [] },
    hasLineItems: { type: Boolean, default: false },

    travelRequestId: { type: String },

    receipts:     [{ type: String }],
    status:       { type: String, enum: ['pending_manager','pending_boss','paid','rejected','returned'], default: 'pending_manager' },
    managerNote:  { type: String },
    bossNote:     { type: String },

    paymentMethod: { type: String, enum: ['cash','card','upi','bank_transfer','advance_adjusted','na'] },
    paymentProof:  { type: String },
    paymentNote:   { type: String },
    paidAt:        { type: Date },

    approvedBy:   { type: String },
    paidBy:       { type: String },
  },
  { timestamps: true }
)

const Expense: Model<IExpense> = mongoose.models.Expense || mongoose.model('Expense', ExpenseSchema)
export default Expense
