import mongoose, { Schema, Document, Model } from 'mongoose'

export interface ISyncState extends Document {
  type: string
  lastSyncedAt: Date
  lastUid: number
}

const SyncStateSchema = new Schema<ISyncState>({
  type:         { type: String, required: true, unique: true },
  lastSyncedAt: { type: Date, default: () => new Date(Date.now() - 24 * 60 * 60 * 1000) },
  lastUid:      { type: Number, default: 0 },
})

const SyncState: Model<ISyncState> =
  mongoose.models.SyncState || mongoose.model('SyncState', SyncStateSchema)
export default SyncState
