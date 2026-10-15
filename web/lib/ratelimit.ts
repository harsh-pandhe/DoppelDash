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

/**
 * Atomic fixed-window consume: ONE conditional pipeline update that (a) starts a fresh window when the stored one has
 * expired and (b) otherwise increments — so concurrent callers can neither exceed `limit` nor double-reset an expired
 * window. `allowed` is true for exactly the first `limit` calls in a window.
 *
 * Unlike [rateLimit], storage errors are NOT swallowed into an answer: they propagate, and callers that guard a paid
 * or abusable resource must treat a throw as "deny" (fail closed). A first-insert race (E11000) is retried once.
 */
export async function rateLimitConsume(key: string, limit: number, windowMs: number): Promise<{ allowed: boolean; count: number }> {
  await connectDB()
  const run = async () => {
    const now = new Date()
    const expired = { $lte: [{ $ifNull: ['$resetAt', new Date(0)] }, now] }
    const doc = await RateLimit.collection.findOneAndUpdate(
      { key },
      [{ $set: {
        count: { $cond: [expired, 1, { $add: [{ $ifNull: ['$count', 0] }, 1] }] },
        resetAt: { $cond: [expired, new Date(now.getTime() + windowMs), '$resetAt'] },
      } }],
      { upsert: true, returnDocument: 'after' },
    )
    const count = Number((doc as { count?: unknown } | null)?.count)
    if (!Number.isFinite(count)) throw new Error('rate-limit store returned no counter')
    return { allowed: count <= limit, count }
  }
  try {
    return await run()
  } catch (e) {
    if ((e as { code?: number })?.code === 11000) return run()
    throw e
  }
}
