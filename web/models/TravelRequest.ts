import mongoose, { Schema, Document, Model } from 'mongoose'

export type TravelRequestStatus = 'pending_manager' | 'pending_boss' | 'approved' | 'rejected' | 'cancelled'
export type TravelMode = 'train' | 'flight' | 'bus' | 'taxi' | 'own_vehicle' | 'other'

export interface ITravelLeg {
  from: string
  to: string
  date: Date
  mode: TravelMode
  estimatedCost: number
  notes?: string
}

export interface ITravelRequest extends Document {
  userId: string
  userName: string
  employeeId?: string

  purpose: string
  destination: string
  departureDate: Date
  returnDate: Date
  legs: ITravelLeg[]

  estimatedTotal: number
  advanceRequested: number

  accommodation?: {
    required: boolean
    city?: string
    checkIn?: Date
    checkOut?: Date
    estimatedCost?: number
  }

  status: TravelRequestStatus
  managerNote?: string
  bossNote?: string
  approvedBy?: string
  approvedAt?: Date
  rejectedBy?: string
  rejectedAt?: Date

  // Linked expense claim (filled after travel)
  expenseId?: string

  createdAt: Date
  updatedAt: Date
}

const TravelLegSchema = new Schema<ITravelLeg>({
  from:          { type: String, required: true },
  to:            { type: String, required: true },
  date:          { type: Date, required: true },
  mode:          { type: String, enum: ['train','flight','bus','taxi','own_vehicle','other'], required: true },
  estimatedCost: { type: Number, required: true },
  notes:         { type: String },
}, { _id: true })

const TravelRequestSchema = new Schema<ITravelRequest>(
  {
    userId:     { type: String, required: true, index: true },
    userName:   { type: String, required: true },
    employeeId: { type: String },

    purpose:       { type: String, required: true },
    destination:   { type: String, required: true },
    departureDate: { type: Date, required: true },
    returnDate:    { type: Date, required: true },
    legs:          { type: [TravelLegSchema], default: [] },

    estimatedTotal:    { type: Number, required: true },
    advanceRequested:  { type: Number, default: 0 },

    accommodation: {
      required:      { type: Boolean, default: false },
      city:          { type: String },
      checkIn:       { type: Date },
      checkOut:      { type: Date },
      estimatedCost: { type: Number },
    },

    status:     { type: String, enum: ['pending_manager','pending_boss','approved','rejected','cancelled'], default: 'pending_manager' },
    managerNote: { type: String },
    bossNote:    { type: String },
    approvedBy:  { type: String },
    approvedAt:  { type: Date },
    rejectedBy:  { type: String },
    rejectedAt:  { type: Date },

    expenseId: { type: String },
  },
  { timestamps: true }
)

const TravelRequest: Model<ITravelRequest> = mongoose.models.TravelRequest || mongoose.model('TravelRequest', TravelRequestSchema)
export default TravelRequest
