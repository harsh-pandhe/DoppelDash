import { connectDB } from '@/lib/db'
import AuditLog from '@/models/AuditLog'

export async function writeAudit(opts: {
  action: string
  performedBy: string
  performedByName: string
  targetId: string
  targetType: 'leave' | 'expense' | 'contact' | 'announcement' | 'user' | 'balance' | 'travel_request' | 'travel' | 'invitation' | 'organization'
  orgId: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  // An audit entry without a tenant would be misfiled — refuse rather than guess.
  if (!opts.orgId) {
    console.error('[audit] refused to write an entry without an organization', { action: opts.action })
    return
  }
  try {
    await connectDB()
    await AuditLog.create({
      ...opts,
      metadata: opts.metadata || {},
    })
  } catch (err) {
    // Non-critical by convention (a request is never failed for audit) — but a lost entry must be OBSERVABLE: name the action and error class only.
    console.error('[audit] write failed', opts.action, (err as Error)?.name)
  }
}

/**
 * Like writeAudit, but for events that MUST NOT be lost: it does not swallow failures, and it is idempotent — a duplicate-key error
 * (the unique index on `travel.submitted`, or on `dedupeKey` for other exactly-once events) means the entry already exists and counts as success. Throws on any other failure so the
 * caller can surface it instead of leaving an unaudited record.
 */
export async function writeAuditOnce(opts: Parameters<typeof writeAudit>[0] & { dedupeKey?: string }): Promise<void> {
  if (!opts.orgId) throw new Error('audit entry without an organization')
  await connectDB()
  try {
    await AuditLog.create({ ...opts, metadata: opts.metadata || {} })
  } catch (err) {
    if ((err as { code?: number })?.code === 11000) return
    throw err
  }
}
