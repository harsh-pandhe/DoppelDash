import { connectDB } from '@/lib/db'
import RateLimit from '@/models/RateLimit'

// Mongo-backed — an in-memory Map doesn't work on serverless (Netlify):
// every lambda instance gets its own, so limits are effectively disabled
// across concurrent instances / cold starts.
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<boolean> {
  await connectDB()
  const now = new Date()

  const doc = await RateLimit.findOneAndUpdate(
    { key },
    { $inc: { count: 1 }, $setOnInsert: { resetAt: new Date(now.getTime() + windowMs) } },
    { upsert: true, new: true }
  )

  if (doc.resetAt <= now) {
    const reset = await RateLimit.findOneAndUpdate(
      { key },
      { count: 1, resetAt: new Date(now.getTime() + windowMs) },
      { new: true }
    )
    return (reset?.count ?? 1) <= limit
  }

  return doc.count <= limit
}

/**
 * Read-only check: is `key` still under `limit` in its current window?
 * Does NOT count the call. Pair with rateLimitHit() to count only FAILURES
 * (e.g. wrong passwords), so a legitimate success never burns the budget.
 */
export async function rateLimitPeek(key: string, limit: number): Promise<boolean> {
  await connectDB()
  const doc = await RateLimit.findOne({ key }).lean()
  if (!doc || doc.resetAt <= new Date()) return true
  return doc.count < limit
}

/** Count one event against `key` (fixed window). */
export async function rateLimitHit(key: string, windowMs: number): Promise<void> {
  await connectDB()
  const now = new Date()
  const doc = await RateLimit.findOneAndUpdate(
    { key },
    { $inc: { count: 1 }, $setOnInsert: { resetAt: new Date(now.getTime() + windowMs) } },
    { upsert: true, new: true }
  )
  if (doc.resetAt <= now) {
    await RateLimit.updateOne({ key }, { count: 1, resetAt: new Date(now.getTime() + windowMs) })
  }
}

export async function rateLimitClear(key: string): Promise<void> {
  await connectDB()
  await RateLimit.deleteOne({ key })
}

/** Remember that `key` was seen (e.g. an IP that completed a login) for `ttlMs`. */
export async function rateLimitMark(key: string, ttlMs: number): Promise<void> {
  await connectDB()
  await RateLimit.updateOne({ key }, { $set: { count: 1, resetAt: new Date(Date.now() + ttlMs) } }, { upsert: true })
}

export async function rateLimitMarked(key: string): Promise<boolean> {
  await connectDB()
  const doc = await RateLimit.findOne({ key }).lean()
  return Boolean(doc && doc.resetAt > new Date())
}
