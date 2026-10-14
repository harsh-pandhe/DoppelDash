import mongoose, { Schema, Document, Model } from 'mongoose'

export interface IAuditLog extends Document {
  orgId: string
  action: string
  performedBy: string
  performedByName: string
  targetId: string
  targetType: 'leave' | 'expense' | 'contact' | 'announcement' | 'user' | 'balance' | 'travel_request' | 'travel' | 'invitation' | 'organization'
  metadata: Record<string, unknown>
  /** Optional exactly-once key (`<action>|<targetId>`), enforced by a unique index; see writeAuditOnce. Internal. */
  dedupeKey?: string
  createdAt: Date
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    orgId: { type: String, required: true, index: true },
    action:          { type: String, required: true },
    performedBy:     { type: String, required: true, index: true },
    performedByName: { type: String, required: true },
    targetId:        { type: String, required: true },
    targetType:      { type: String, enum: ['leave','expense','contact','announcement','user','balance','travel_request','travel','invitation','organization'], required: true },
    metadata:        { type: Schema.Types.Mixed, default: {} },
    dedupeKey:       { type: String },
  },
  { timestamps: true }
)

AuditLogSchema.index({ createdAt: -1 })
AuditLogSchema.index({ targetType: 1, createdAt: -1 })
// A trip is SUBMITTED exactly once: the database refuses a second `travel.submitted` entry for the same record (concurrent retries, healing replays).
AuditLogSchema.index({ orgId: 1, targetType: 1, targetId: 1, action: 1 }, { unique: true, partialFilterExpression: { action: 'travel.submitted' } })

// Exactly-once events (e.g. `travel.expense_created`): the database refuses a second entry with the same key, however many retries/recoveries run.
AuditLogSchema.index({ orgId: 1, dedupeKey: 1 }, { unique: true, partialFilterExpression: { dedupeKey: { $type: 'string' } } })

const AuditLog: Model<IAuditLog> = mongoose.models.AuditLog || mongoose.model('AuditLog', AuditLogSchema)
export default AuditLog
