/**
 * Lease-based claims for scheduled jobs (exactly-once-per-attempt with crash recovery and bounded retries).
 *   claim   → atomically takes a record only if it is not already done, not under a LIVE lease, and under today's attempt cap
 *   finish  → marks it done (caller supplies the "sent" fields) and clears the lease
 *   release → clears the lease after a failed attempt (the record is retried by a later run, until the daily cap)
 * A crashed run leaves a lease that EXPIRES (LEASE_MS) — the record is picked up again, so nothing is stranded; two overlapping runs cannot both
 * hold the lease. Attempts are counted per calendar day (UTC) and capped, so a permanently failing record cannot be retried every 5 minutes forever.
 * Native collection calls are used because the claim needs an aggregation-pipeline update (conditional $inc).
 */
import type { Collection, Document, Filter, ObjectId } from 'mongodb'

export const LEASE_MS = 10 * 60_000
export const MAX_ATTEMPTS_PER_DAY = 5
export const dayKey = (d = new Date()) => d.toISOString().slice(0, 10)
const f = (prefix: string, name: 'ClaimUntil' | 'AttemptDay' | 'Attempts') => `${prefix}${name}`

/** Filter fragment: lease free/expired AND attempts under the cap for `now`'s day. */
export function claimableFragment(prefix: string, now = new Date()): Document {
  return {
    $and: [
      { $or: [{ [f(prefix, 'ClaimUntil')]: { $exists: false } }, { [f(prefix, 'ClaimUntil')]: null }, { [f(prefix, 'ClaimUntil')]: { $lte: now } }] },
      { $or: [{ [f(prefix, 'AttemptDay')]: { $ne: dayKey(now) } }, { [f(prefix, 'Attempts')]: { $lt: MAX_ATTEMPTS_PER_DAY } }, { [f(prefix, 'Attempts')]: { $exists: false } }] },
    ],
  }
}

export async function claim(coll: Collection<Document>, id: ObjectId | unknown, baseFilter: Filter<Document>, prefix: string, now = new Date()): Promise<boolean> {
  const today = dayKey(now)
  const r = await coll.findOneAndUpdate(
    { $and: [{ _id: id as ObjectId }, baseFilter, claimableFragment(prefix, now)] } as Filter<Document>,
    [{ $set: {
      [f(prefix, 'ClaimUntil')]: new Date(now.getTime() + LEASE_MS),
      [f(prefix, 'Attempts')]: { $cond: [{ $eq: [`$${f(prefix, 'AttemptDay')}`, today] }, { $add: [{ $ifNull: [`$${f(prefix, 'Attempts')}`, 0] }, 1] }, 1] },
      [f(prefix, 'AttemptDay')]: today,
    } }],
    { returnDocument: 'before', projection: { _id: 1 } },
  )
  return !!r
}

export async function finish(coll: Collection<Document>, id: unknown, prefix: string, setOnSuccess: Document): Promise<void> {
  await coll.updateOne({ _id: id as ObjectId }, { $set: setOnSuccess, $unset: { [f(prefix, 'ClaimUntil')]: '', [f(prefix, 'AttemptDay')]: '', [f(prefix, 'Attempts')]: '' } })
}

export async function release(coll: Collection<Document>, id: unknown, prefix: string): Promise<void> {
  await coll.updateOne({ _id: id as ObjectId }, { $unset: { [f(prefix, 'ClaimUntil')]: '' } })
}
