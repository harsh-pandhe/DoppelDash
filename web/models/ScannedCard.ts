import mongoose, { Schema, Document, Model } from 'mongoose'

export interface IScannedCardFields {
  name?: string
  email?: string
  phone?: string
  company?: string
  designation?: string
  address?: string
  website?: string
  linkedin?: string
}

export interface IScannedCard extends Document {
  orgId: string
  uploadedBy: string          // userId of scanner
  uploadedByName: string
  imageData: string           // compressed base64 data-URI (works on Netlify; /api/upload local-FS is broken there)
  ocrSource: 'gemini' | 'ollama' | 'fallback'
  rawText?: string            // raw OCR text if available
  parsedFields: IScannedCardFields
  contactId?: string          // set once imported into CRM
  createdAt: Date
  updatedAt: Date
}

const FieldsSchema = new Schema<IScannedCardFields>({
  name:        { type: String },
  email:       { type: String },
  phone:       { type: String },
  company:     { type: String },
  designation: { type: String },
  address:     { type: String },
  website:     { type: String },
  linkedin:    { type: String },
}, { _id: false })

const ScannedCardSchema = new Schema<IScannedCard>(
  {
    orgId: { type: String, required: true, index: true },
    uploadedBy:     { type: String, required: true, index: true },
    uploadedByName: { type: String, required: true },
    imageData:      { type: String, required: true },
    ocrSource:      { type: String, enum: ['gemini', 'ollama', 'fallback'], default: 'fallback' },
    rawText:        { type: String },
    parsedFields:   { type: FieldsSchema, default: {} },
    contactId:      { type: String },
  },
  { timestamps: true }
)

ScannedCardSchema.index({ uploadedBy: 1, createdAt: -1 })

const ScannedCard: Model<IScannedCard> =
  mongoose.models.ScannedCard || mongoose.model('ScannedCard', ScannedCardSchema)
export default ScannedCard
