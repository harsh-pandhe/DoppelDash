import mongoose, { Schema, Document, Model } from 'mongoose'

/** Per-organisation, per-period usage counter (e.g. monthly receipt scans). Atomically incremented under a limit. */
export interface IUsageCounter extends Document {
  orgId: string
  key: string      // e.g. 'receiptScans'
  period: string   // 'YYYY-MM' (UTC)
  count: number
}

const UsageCounterSchema = new Schema<IUsageCounter>(
  {
    orgId: { type: String, required: true },
    key: { type: String, required: true },
    period: { type: String, required: true },
    count: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true },
)
UsageCounterSchema.index({ orgId: 1, key: 1, period: 1 }, { unique: true })

const UsageCounter: Model<IUsageCounter> = mongoose.models.UsageCounter || mongoose.model('UsageCounter', UsageCounterSchema)
export default UsageCounter
