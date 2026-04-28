import { connectDB } from '@/lib/db'
import AuditLog from '@/models/AuditLog'

export async function writeAudit(opts: {
  action: string
  performedBy: string
  performedByName: string
  targetId: string
  targetType: 'leave' | 'expense' | 'contact' | 'announcement' | 'user' | 'balance'
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    await connectDB()
    await AuditLog.create({ ...opts, metadata: opts.metadata || {} })
  } catch { /* non-critical — never fail a request for audit */ }
}
