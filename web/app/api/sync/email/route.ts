import { NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Contact from '@/models/Contact'
import SyncState from '@/models/SyncState'
import { fetchEmailsSince, imapConfigured, canUseSharedImap } from '@/lib/imap'
import { getUser } from '@/lib/auth'

// IMAP raw TCP/TLS → Node runtime, longer timeout for cold connect + fetch.
export const runtime = 'nodejs'
export const maxDuration = 60
export const dynamic = 'force-dynamic'

const notAvailable = () => NextResponse.json({ error: 'The shared mailbox is not available for this organisation.', code: 'imap_not_available' }, { status: 403 })

export async function POST() {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (user?.role !== 'admin' && user?.role !== 'manager') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!canUseSharedImap(orgId)) return notAvailable()   // fail closed: the platform mailbox belongs to IMAP_OWNER_ORG_ID only

  if (!imapConfigured()) {
    return NextResponse.json({ error: 'IMAP not configured. Add IMAP_HOST, IMAP_USER, IMAP_PASS to .env.local' }, { status: 503 })
  }

  await connectDB()

  const state = await SyncState.findOneAndUpdate(
    { type: 'email', orgId },
    { $setOnInsert: { type: 'email', orgId } },
    { upsert: true, returnDocument: 'after' }
  )

  let emails
  try {
    emails = await fetchEmailsSince(state.lastSyncedAt, state.lastUid)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'IMAP connection failed'
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  let matched = 0
  let maxUid  = state.lastUid

  for (const email of emails) {
    if (email.uid > maxUid) maxUid = email.uid

    // Match sender email to any contact owned by any user in this org
    const contact = await Contact.findOne({ orgId, email: email.fromEmail })
    if (!contact) continue

    // Avoid duplicate timeline entries
    const alreadyLogged = contact.timeline.some(
      t => t.source === 'imap' as unknown as 'outlook' && t.title === email.subject &&
           Math.abs(new Date(t.date).getTime() - email.date.getTime()) < 60_000
    )
    if (alreadyLogged) continue

    await Contact.findOneAndUpdate({ _id: contact._id, orgId }, {
      $push: {
        timeline: {
          $each: [{
            type:   'email',
            title:  email.subject,
            body:   email.snippet || undefined,
            source: 'outlook',   // reuse 'outlook' badge in UI for now
            date:   email.date,
          }],
          $position: 0,
        },
      },
    })
    matched++
  }

  await SyncState.updateOne(
    { type: 'email', orgId },
    { lastSyncedAt: new Date(), lastUid: maxUid }
  )

  return NextResponse.json({
    fetched: emails.length,
    matched,
    lastSyncedAt: new Date(),
  })
}

export async function GET() {
  const { userId, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canUseSharedImap(orgId)) return NextResponse.json({ configured: false, lastSyncedAt: null })

  await connectDB()
  const state = await SyncState.findOne({ type: 'email', orgId }).lean()

  return NextResponse.json({
    configured: imapConfigured(),
    lastSyncedAt: state?.lastSyncedAt || null,
  })
}
