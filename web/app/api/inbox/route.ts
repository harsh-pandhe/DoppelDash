import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import InboxMessage from '@/models/InboxMessage'
import { getUser } from '@/lib/auth'
import { syncInbox, imapConfigured } from '@/lib/imap'

// IMAP needs raw TCP/TLS → Node runtime (not edge). Allow extra time for the
// cold connect + fetch on serverless; the default ~10s can truncate a sync.
export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

// Shared org inbox — gated to mail-enabled users (admin/manager always; employees need mailAccess)
function canAccessMail(user: { role?: string; mailAccess?: boolean } | null): boolean {
  if (!user) return false
  if (user.role === 'admin' || user.role === 'manager') return true
  return Boolean(user.mailAccess)
}

// GET — list synced inbox messages (newest first). ?sync=1 polls IMAP first.
export async function GET(req: NextRequest) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canAccessMail(user)) return NextResponse.json({ error: 'Mail access not granted' }, { status: 403 })

  await connectDB()

  let syncInfo = null
  if (req.nextUrl.searchParams.get('sync') === '1') {
    try {
      syncInfo = await syncInbox()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'IMAP sync failed'
      return NextResponse.json({ error: msg, configured: imapConfigured() }, { status: 502 })
    }
  }

  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit')) || 50, 100)
  const skip  = Number(req.nextUrl.searchParams.get('skip')) || 0

  const [messages, total, unread] = await Promise.all([
    InboxMessage.find({ orgId, mailbox: 'INBOX' })
      .sort({ date: -1 })
      .skip(skip).limit(limit)
      .select('-text -html') // list view — bodies fetched in detail
      .lean(),
    InboxMessage.countDocuments({ orgId, mailbox: 'INBOX' }),
    InboxMessage.countDocuments({ orgId, mailbox: 'INBOX', readByApp: false }),
  ])

  return NextResponse.json({
    messages,
    total,
    unread,
    hasMore: skip + messages.length < total,
    configured: imapConfigured(),
    sync: syncInfo,
  })
}
