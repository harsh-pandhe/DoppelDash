import mongoose, { Schema, Document, Model } from 'mongoose'

export interface IPasskeyCredential extends Document {
  orgId: string
  _id: mongoose.Types.ObjectId
  userId: string
  credentialId: string        // base64url
  publicKey: string           // base64url-encoded COSE public key
  counter: number
  transports: string[]
  deviceType: 'singleDevice' | 'multiDevice'
  backedUp: boolean
  nickname?: string           // "Chrome on Windows", user-editable
  lastUsedAt?: Date
  createdAt: Date
  updatedAt: Date
}

const PasskeyCredentialSchema = new Schema<IPasskeyCredential>(
  {
    orgId: { type: String, required: true, default: 'org_doppelmayr', index: true },
    userId:       { type: String, required: true, index: true },
    credentialId: { type: String, required: true, unique: true },
    publicKey:    { type: String, required: true },
    counter:      { type: Number, required: true, default: 0 },
    transports:   [{ type: String }],
    deviceType:   { type: String, enum: ['singleDevice', 'multiDevice'], default: 'multiDevice' },
    backedUp:     { type: Boolean, default: false },
    nickname:     { type: String },
    lastUsedAt:   { type: Date },
  },
  { timestamps: true }
)

const PasskeyCredential =
  (mongoose.models.PasskeyCredential as Model<IPasskeyCredential>) ||
  mongoose.model<IPasskeyCredential>('PasskeyCredential', PasskeyCredentialSchema)
export default PasskeyCredential
