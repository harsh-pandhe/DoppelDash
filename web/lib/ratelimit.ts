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
