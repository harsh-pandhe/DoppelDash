import mongoose, { Schema, Document, Model } from 'mongoose'

export interface IAuditLog extends Document {
  action: string
  performedBy: string
  performedByName: string
  targetId: string
  targetType: 'leave' | 'expense' | 'contact' | 'announcement' | 'user' | 'balance'
  metadata: Record<string, unknown>
  createdAt: Date
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    action:          { type: String, required: true },
    performedBy:     { type: String, required: true, index: true },
    performedByName: { type: String, required: true },
    targetId:        { type: String, required: true },
    targetType:      { type: String, enum: ['leave','expense','contact','announcement','user','balance'], required: true },
    metadata:        { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
)

AuditLogSchema.index({ createdAt: -1 })
AuditLogSchema.index({ targetType: 1, createdAt: -1 })

const AuditLog: Model<IAuditLog> = mongoose.models.AuditLog || mongoose.model('AuditLog', AuditLogSchema)
export default AuditLog
