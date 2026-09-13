import mongoose, { Schema, Document, Model } from 'mongoose'

/**
 * A single inbound email synced from the shared IMAP mailbox (Gmail).
 *
 * Sync is poll-on-demand (serverless-safe — no persistent IMAP listener on
 * Netlify). `uid` + `mailbox` are unique per account so re-syncing is idempotent.
 * Bodies stored inline (text + sanitized html) so the list/detail UI never
 * re-hits IMAP. Attachments stored as metadata only (no binary) to stay small.
 */
export interface IInboxAttachment {
  filename: string
  contentType: string
  size: number
}

export interface IInboxMessage extends Document {
  orgId: string
  uid: number                 // IMAP UID within the mailbox
  mailbox: string             // e.g. 'INBOX'
  messageId?: string          // RFC Message-ID header
  fromName?: string
  fromAddress: string
  toAddresses: string[]
  subject: string
  snippet: string             // first ~200 chars of text body
  text?: string               // plaintext body
  html?: string               // sanitized HTML body
  date: Date                  // email Date header
  seen: boolean               // IMAP \Seen flag at sync time
  readByApp: boolean          // marked read inside DoppelDash
  attachments: IInboxAttachment[]
  syncedAt: Date
  createdAt: Date
  updatedAt: Date
}

const AttachmentSchema = new Schema<IInboxAttachment>({
  filename:    { type: String, default: '' },
  contentType: { type: String, default: '' },
  size:        { type: Number, default: 0 },
}, { _id: false })

const InboxMessageSchema = new Schema<IInboxMessage>(
  {
    orgId: { type: String, required: true, default: 'org_doppelmayr', index: true },
    uid:         { type: Number, required: true },
    mailbox:     { type: String, required: true, default: 'INBOX' },
    messageId:   { type: String },
    fromName:    { type: String },
    fromAddress: { type: String, required: true, index: true },
    toAddresses: { type: [String], default: [] },
    subject:     { type: String, default: '(no subject)' },
    snippet:     { type: String, default: '' },
    text:        { type: String },
    html:        { type: String },
    date:        { type: Date, required: true, index: true },
    seen:        { type: Boolean, default: false },
    readByApp:   { type: Boolean, default: false },
    attachments: { type: [AttachmentSchema], default: [] },
    syncedAt:    { type: Date, default: Date.now },
  },
  { timestamps: true }
)

// idempotent sync: one row per (mailbox, uid)
InboxMessageSchema.index({ mailbox: 1, uid: 1 }, { unique: true })
InboxMessageSchema.index({ date: -1 })

const InboxMessage: Model<IInboxMessage> =
  mongoose.models.InboxMessage || mongoose.model('InboxMessage', InboxMessageSchema)
export default InboxMessage
