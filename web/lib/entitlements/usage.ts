import { connectDB } from '@/lib/db'
import UsageCounter from '@/models/UsageCounter'

export const monthPeriod = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
export const nextPeriodStart = (d = new Date()) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))

export interface QuotaState { ok: boolean; used: number; limit: number; remaining: number; resetsAt: string }
const state = (ok: boolean, used: number, limit: number): QuotaState => ({ ok, used, limit, remaining: Math.max(0, limit - used), resetsAt: nextPeriodStart().toISOString() })

export async function currentUsage(orgId: string, key: string, limit: number): Promise<QuotaState> {
  await connectDB()
  const doc = await UsageCounter.findOne({ orgId, key, period: monthPeriod() }).lean()
  return state(true, doc?.count ?? 0, limit)
}

/**
 * Atomically takes ONE unit of a monthly quota. Safe under concurrency: the increment only matches while
 * `count < limit`, so N parallel callers at the boundary get exactly the remaining units — never more.
 * (The unique index turns "document exists but is at the limit" into a duplicate-key error → exhausted.)
 */
export async function consumeMonthlyQuota(orgId: string, key: string, limit: number): Promise<QuotaState> {
  await connectDB()
  const period = monthPeriod()
  if (!(limit > 0)) return state(false, 0, Math.max(0, limit))
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const doc = await UsageCounter.findOneAndUpdate(
        { orgId, key, period, count: { $lt: limit } },
        { $inc: { count: 1 } },
        { upsert: true, returnDocument: 'after' },
      )
      return state(true, doc.count, limit)
    } catch (err) {
      if ((err as { code?: number }).code !== 11000) throw err
      const existing = await UsageCounter.findOne({ orgId, key, period }).lean()
      if (existing && existing.count >= limit) return state(false, existing.count, limit)
      // lost a first-insert race (document now exists below the limit) → retry the conditional increment
    }
  }
  const existing = await UsageCounter.findOne({ orgId, key, period }).lean()
  return state(false, existing?.count ?? limit, limit)
}

/** Gives a unit back (e.g. the scan produced nothing). Never goes below zero. */
export async function refundMonthlyQuota(orgId: string, key: string): Promise<void> {
  await connectDB()
  await UsageCounter.updateOne({ orgId, key, period: monthPeriod(), count: { $gt: 0 } }, { $inc: { count: -1 } })
}
