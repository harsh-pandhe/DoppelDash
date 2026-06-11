import mongoose, { Schema, Document, Model } from 'mongoose'

export interface IMailRecipient {
  name: string
  email: string
  company?: string
  field: 'to' | 'cc' | 'bcc'
  source: 'contact' | 'directory' | 'manual'
}

export interface IMailDraftVersion {
  subject: string
  bodyHtml: string
  savedAt: Date
}

export interface IMailDraft extends Document {
  ownerId: string
  subject: string
  bodyHtml: string
  recipients: IMailRecipient[]
  versions: IMailDraftVersion[]   // prior snapshots, newest first
  createdAt: Date
  updatedAt: Date
}

const RecipientSchema = new Schema<IMailRecipient>({
  name:    { type: String, default: '' },
  email:   { type: String, required: true },
  company: { type: String },
  field:   { type: String, enum: ['to', 'cc', 'bcc'], default: 'to' },
  source:  { type: String, enum: ['contact', 'directory', 'manual'], default: 'manual' },
}, { _id: false })

const VersionSchema = new Schema<IMailDraftVersion>({
  subject:  { type: String, default: '' },
  bodyHtml: { type: String, default: '' },
  savedAt:  { type: Date, default: Date.now },
}, { _id: false })

const MailDraftSchema = new Schema<IMailDraft>(
  {
    ownerId:    { type: String, required: true, index: true },
    subject:    { type: String, default: '' },
    bodyHtml:   { type: String, default: '' },
    recipients: { type: [RecipientSchema], default: [] },
    versions:   { type: [VersionSchema], default: [] },
  },
  { timestamps: true }
)

const MailDraft: Model<IMailDraft> = mongoose.models.MailDraft || mongoose.model('MailDraft', MailDraftSchema)
export default MailDraft
