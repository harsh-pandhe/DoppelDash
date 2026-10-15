import { createHmac } from 'crypto'
import { connectDB } from '@/lib/db'
import AuthReplayClaim from '@/models/AuthReplayClaim'

function claimKey(purpose: string, userId: string, value: string): string {
  // HMAC (not a bare hash): a 6-digit code is trivially reversible from an unkeyed digest, so the raw value is never recoverable from the database.
  const secret = process.env.ENCRYPTION_SECRET || process.env.JWT_SECRET
  if (!secret) throw new Error('No server secret configured for replay claims')
  return `${purpose}:${userId}:${createHmac('sha256', secret).update(`${purpose}\0${userId}\0${value}`).digest('hex')}`
}

/**
 * Atomically claim a single-use artefact (e.g. an already-verified TOTP code). Returns true for exactly one caller.
 *
 *   1. insert — the unique index on `key` lets one concurrent writer win; E11000 means "already claimed".
 *   2. on E11000, take over the claim only if it has expired but the TTL monitor has not purged it yet
 *      (conditional update on `expiresAt <= now`, so two racing takers still cannot both succeed).
 *
 * Fails closed: any other error (connectivity, validation, timeout) returns false — never "not claimed, so allow".
 */
export async function claimAuthArtifact(purpose: string, userId: string, value: string, ttlMs: number): Promise<boolean> {
  try {
    await connectDB()
    await AuthReplayClaim.init()   // the unique index must exist before the first insert, or two writers could both succeed
    const key = claimKey(purpose, userId, value)
    const now = new Date()
    const expiresAt = new Date(now.getTime() + ttlMs)
    try {
      await AuthReplayClaim.collection.insertOne({ key, userId, purpose, expiresAt, createdAt: now })
      return true
    } catch (e) {
      if ((e as { code?: number })?.code !== 11000) throw e
    }
    const res = await AuthReplayClaim.collection.updateOne({ key, expiresAt: { $lte: now } }, { $set: { expiresAt, createdAt: now } })
    return res.modifiedCount === 1
  } catch (e) {
    console.error('[auth] replay claim failed — denying', (e as { code?: unknown })?.code ?? (e as Error)?.name)
    return false
  }
}
