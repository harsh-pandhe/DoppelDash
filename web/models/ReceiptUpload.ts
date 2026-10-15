import mongoose, { Schema, Document, Model } from 'mongoose'

/**
 * Upload manifest for PRIVATE RECEIPT assets only. One row is written when the server issues a receipt upload ticket (the
 * server chose the public id, so this is the trustworthy record of what exists and when it was created). It is the ONLY
 * input of the abandoned-receipt cleanup job: nothing is ever deleted because of a provider listing, a URL or client input.
 *
 * States (transitions are atomic findOneAndUpdate calls — they are what makes attach-vs-cleanup safe):
 *   issued    ticket issued, not yet attached
 *   attached  an attach attempt passed verification (the expense write may or may not have happened — cleanup re-checks)
 *   deleting  claimed by a cleanup run (attach is refused while this holds)
 *   rejected  the stored file failed verification (type/size/format): attach is refused for good; cleanup deletes it
 */
export type ReceiptUploadState = 'issued' | 'attached' | 'deleting' | 'rejected'

export interface IReceiptUpload extends Document {
  orgId: string
  publicId: string
  state: ReceiptUploadState
  issuedAt: Date
  attachedAt?: Date
  /** The job looks at this row again only after this time (issuedAt + 24h; later: retry/backoff or periodic re-check). */
  nextCheckAt: Date
  leaseUntil?: Date
  failures: number
  /** MIME type the uploader declared when the ticket was issued (bound into the signed `allowed_formats`). */
  declaredMime?: string
  /** What this upload was issued FOR. Absent = legacy/expense receipt. A `travel_itinerary` or `leave_medical` file can never be attached to an expense receipt (or to each other), and vice versa. */
  purpose?: 'expense_receipt' | 'travel_itinerary' | 'leave_medical'
  /** The authenticated user the ticket was issued to (travel itinerary files may only be used by that user). */
  userId?: string
  /** Exclusive claim: the id of the record (TravelRequest / Leave) that has taken this file. One file ↔ one claim. */
  claimedBy?: string
  /** Set by the trip→expense conversion: the expense that now ALSO references this file. The trip keeps its claim (nothing is released or deleted). */
  transferredTo?: string
}

const ReceiptUploadSchema = new Schema<IReceiptUpload>({
  orgId: { type: String, required: true },
  publicId: { type: String, required: true, unique: true },
  state: { type: String, enum: ['issued', 'attached', 'deleting', 'rejected'], default: 'issued', required: true },
  issuedAt: { type: Date, required: true },
  attachedAt: { type: Date },
  nextCheckAt: { type: Date, required: true },
  leaseUntil: { type: Date },
  failures: { type: Number, default: 0 },
  declaredMime: { type: String },
  purpose: { type: String, enum: ['expense_receipt', 'travel_itinerary', 'leave_medical'] },
  userId: { type: String },
  claimedBy: { type: String },
  transferredTo: { type: String },
})
ReceiptUploadSchema.index({ state: 1, nextCheckAt: 1 })

const ReceiptUpload: Model<IReceiptUpload> = mongoose.models.ReceiptUpload || mongoose.model('ReceiptUpload', ReceiptUploadSchema)
export default ReceiptUpload
