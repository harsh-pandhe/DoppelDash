import mongoose, { Schema, Document, Model } from 'mongoose'

export type TravelRequestStatus = 'pending_manager' | 'pending_admin' | 'approved' | 'rejected' | 'cancelled'
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
  orgId: string
  userId: string
  userName: string
  employeeId?: string

  purpose: string
  destination: string
  departureDate: Date
  returnDate: Date
  legs: ITravelLeg[]
  itineraryDocs: string[]

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
  adminNote?: string
  approvedBy?: string
  approvedAt?: Date
  rejectedBy?: string
  rejectedAt?: Date

  // Linked expense claim (filled after travel)
  expenseId?: string

  /** Optional client idempotency key (per organisation + user) and the hash of the validated request it was first used with. */
  clientRequestId?: string
  requestHash?: string

  /**
   * Trip → expense conversion protocol state (Slice 4). Internal: never returned by the API (presentTravel strips it).
   *   reserved  one request holds the lease and is creating the expense (crash-safe: the lease expires)
   *   linked    `expenseId` is set and the revision was bumped; attachment marking + the audit entries may still be pending
   *   complete  everything is recorded
   * Absent on trips with no conversion in flight, and on trips converted before Slice 4 (those have `expenseId` only).
   */
  conversion?: { state: 'reserved' | 'linked' | 'complete'; token?: string; leaseUntil?: Date; startedAt?: Date; completedAt?: Date }

  /** Optimistic-concurrency token: +1 on every state-changing write; absent on records that predate it (= 0). */
  revision?: number

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
    orgId: { type: String, required: true, index: true },
    userId:     { type: String, required: true, index: true },
    userName:   { type: String, required: true },
    employeeId: { type: String },

    purpose:       { type: String, required: true },
    destination:   { type: String, required: true },
    departureDate: { type: Date, required: true },
    returnDate:    { type: Date, required: true },
    legs:          { type: [TravelLegSchema], default: [] },
    itineraryDocs: { type: [String], default: [] },

    estimatedTotal:    { type: Number, required: true },
    advanceRequested:  { type: Number, default: 0 },

    accommodation: {
      required:      { type: Boolean, default: false },
      city:          { type: String },
      checkIn:       { type: Date },
      checkOut:      { type: Date },
      estimatedCost: { type: Number },
    },

    status:     { type: String, enum: ['pending_manager','pending_admin','approved','rejected','cancelled'], default: 'pending_manager' },
    managerNote: { type: String },
    adminNote:    { type: String },
    approvedBy:  { type: String },
    approvedAt:  { type: Date },
    rejectedBy:  { type: String },
    rejectedAt:  { type: Date },

    expenseId: { type: String },

    clientRequestId: { type: String },
    requestHash:     { type: String },
    revision:        { type: Number, default: 0 },
    conversion: {
      type: new Schema({
        state:       { type: String, enum: ['reserved', 'linked', 'complete'], required: true },
        token:       { type: String },
        leaseUntil:  { type: Date },
        startedAt:   { type: Date },
        completedAt: { type: Date },
      }, { _id: false }),
    },
  },
  { timestamps: true }
)

TravelRequestSchema.index({ userId: 1, status: 1 })
// List pagination (Slice 5): equality prefix (tenant [+ visibility | status]) then the sort keys, so every page is an index range scan with no in-memory sort.
TravelRequestSchema.index({ orgId: 1, createdAt: -1, _id: -1 })                  // manager/admin list
TravelRequestSchema.index({ orgId: 1, status: 1, createdAt: -1, _id: -1 })       // manager/admin list filtered by status
TravelRequestSchema.index({ orgId: 1, userId: 1, createdAt: -1, _id: -1 })       // employee list (status is a cheap residual filter on one user's rows)
// Idempotent create: at most ONE request per (organisation, user, key) — enforced by the database, so concurrent retries cannot both insert.
TravelRequestSchema.index({ orgId: 1, userId: 1, clientRequestId: 1 }, { unique: true, partialFilterExpression: { clientRequestId: { $type: 'string' } } })

const TravelRequest: Model<ITravelRequest> = mongoose.models.TravelRequest || mongoose.model('TravelRequest', TravelRequestSchema)
export default TravelRequest
