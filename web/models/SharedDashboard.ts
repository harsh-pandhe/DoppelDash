import mongoose, { Schema, Document, Model } from 'mongoose'

export interface ISharedDashboard extends Document {
  token:     string
  ownerId:   string
  ownerName: string
  ownerRole: 'employee' | 'manager' | 'admin'   // snapshot of role at share time (scopes data)
  layout:    unknown                            // LayoutEntry[] snapshot
  filters:   { from: string; to: string; dept: string; employee: string; status: string }
  expiresAt: Date | null                        // null = never
  viewCount: number
  createdAt: Date
}

const SharedDashboardSchema = new Schema<ISharedDashboard>(
  {
    token:     { type: String, required: true, unique: true, index: true },
    ownerId:   { type: String, required: true, index: true },
    ownerName: { type: String, required: true },
    ownerRole: { type: String, enum: ['employee', 'manager', 'admin'], required: true },
    layout:    { type: Schema.Types.Mixed, required: true },
    filters:   { type: Schema.Types.Mixed, default: {} },
    expiresAt: { type: Date, default: null },
    viewCount: { type: Number, default: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
)

const SharedDashboard: Model<ISharedDashboard> =
  mongoose.models.SharedDashboard || mongoose.model<ISharedDashboard>('SharedDashboard', SharedDashboardSchema)

export default SharedDashboard
