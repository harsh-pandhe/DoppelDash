import mongoose, { Schema, Document, Model } from 'mongoose'

export type ExpenseStatus = 'pending_manager' | 'pending_admin' | 'paid' | 'rejected' | 'returned' | 'void'
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
  orgId: string
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
  /** Set ONLY by the trip→expense conversion protocol (never from client input): the trip this expense was generated from. Unique per (organisation, trip). */
  travelConversionOf?: string

  receipts: string[]      // legacy top-level receipts
  /** Optional client-generated idempotency key: a retried/double-tapped submit returns the same expense. */
  clientRequestId?: string
  status: ExpenseStatus
  managerNote?: string
  adminNote?: string

  // Payment details
  paymentMethod?: PaymentMethod
  paymentProof?: string
  paymentNote?: string
  paidAt?: Date

  /** Owner decision D-03.2: a settled (paid) claim is never deleted; an admin voids it with a reason. The amount, line items and receipts are KEPT (retention). */
  voidedAt?: Date
  voidedBy?: string
  /** Optional pointer from a replacement claim to the voided claim it corrects. */
  correctionOf?: string

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
    orgId: { type: String, required: true, index: true },
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
    travelConversionOf: { type: String },
    clientRequestId: { type: String },

    receipts:     [{ type: String }],
    status:       { type: String, enum: ['pending_manager','pending_admin','paid','rejected','returned','void'], default: 'pending_manager' },
    managerNote:  { type: String },
    adminNote:     { type: String },

    paymentMethod: { type: String, enum: ['cash','card','upi','bank_transfer','advance_adjusted','na'] },
    paymentProof:  { type: String },
    paymentNote:   { type: String },
    paidAt:        { type: Date },
    voidedAt:      { type: Date },
    voidedBy:      { type: String },
    correctionOf:  { type: String },

    approvedBy:   { type: String },
    paidBy:       { type: String },
  },
  { timestamps: true }
)

ExpenseSchema.index({ userId: 1, status: 1 })
ExpenseSchema.index({ orgId: 1, userId: 1, clientRequestId: 1 }, { unique: true, partialFilterExpression: { clientRequestId: { $type: 'string' } } })

// ONE generated expense per trip, enforced by the database: concurrent conversions cannot both insert (the loser gets E11000 and adopts the winner's row).
ExpenseSchema.index({ orgId: 1, travelConversionOf: 1 }, { unique: true, partialFilterExpression: { travelConversionOf: { $type: 'string' } } })

const Expense: Model<IExpense> = mongoose.models.Expense || mongoose.model('Expense', ExpenseSchema)
export default Expense
