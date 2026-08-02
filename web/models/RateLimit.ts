import mongoose, { Schema, Document } from 'mongoose'

// Backs lib/ratelimit.ts. An in-memory Map doesn't work on serverless —
// each lambda instance gets its own, so limits reset on every cold start
// and don't share state across concurrent instances.
export interface IRateLimit extends Document {
  key: string
  count: number
  resetAt: Date
}

const RateLimitSchema = new Schema<IRateLimit>({
  key:     { type: String, required: true, unique: true },
  count:   { type: Number, required: true, default: 0 },
  resetAt: { type: Date, required: true },
})

// TTL index — Mongo auto-purges expired windows, no manual cleanup needed.
RateLimitSchema.index({ resetAt: 1 }, { expireAfterSeconds: 0 })

const RateLimit = (mongoose.models.RateLimit as mongoose.Model<IRateLimit>) || mongoose.model<IRateLimit>('RateLimit', RateLimitSchema)
export default RateLimit
