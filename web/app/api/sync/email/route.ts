import { NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { connectDB } from '@/lib/db'
import Contact from '@/models/Contact'
import SyncState from '@/models/SyncState'
import { fetchEmailsSince, imapConfigured } from '@/lib/imap'

export async function POST() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!imapConfigured()) {
    return NextResponse.json({ error: 'IMAP not configured. Add IMAP_HOST, IMAP_USER, IMAP_PASS to .env.local' }, { status: 503 })
  }

  await connectDB()

  const state = await SyncState.findOneAndUpdate(
    { type: 'email' },
    { $setOnInsert: { type: 'email' } },
    { upsert: true, new: true }
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

    // Match sender email to any contact owned by any user
    const contact = await Contact.findOne({ email: email.fromEmail })
    if (!contact) continue

    // Avoid duplicate timeline entries
    const alreadyLogged = contact.timeline.some(
      t => t.source === 'imap' as unknown as 'outlook' && t.title === email.subject &&
           Math.abs(new Date(t.date).getTime() - email.date.getTime()) < 60_000
    )
    if (alreadyLogged) continue

    await Contact.findByIdAndUpdate(contact._id, {
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
    { type: 'email' },
    { lastSyncedAt: new Date(), lastUid: maxUid }
  )

  return NextResponse.json({
    fetched: emails.length,
    matched,
    lastSyncedAt: new Date(),
  })
}

export async function GET() {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await connectDB()
  const state = await SyncState.findOne({ type: 'email' }).lean()

  return NextResponse.json({
    configured: imapConfigured(),
    lastSyncedAt: state?.lastSyncedAt || null,
  })
}
