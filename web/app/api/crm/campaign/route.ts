import { NextRequest, NextResponse } from 'next/server'
import { auth, currentUser } from '@clerk/nextjs/server'
import { connectDB } from '@/lib/db'
import Contact from '@/models/Contact'

async function sendEmail(to: string, subject: string, html: string) {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return false
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        from: process.env.RESEND_FROM_EMAIL || 'DoppelDash <no-reply@doppeldash.in>',
        to: [to], subject, html,
      }),
    })
    return res.ok
  } catch { return false }
}

// GET — preview contacts that would receive the campaign
export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await connectDB()
  const url   = new URL(req.url)
  const tag   = url.searchParams.get('tag') || ''
  const query = tag ? { createdBy: userId, tags: tag, email: { $exists: true, $ne: '' } }
                    : { createdBy: userId, email: { $exists: true, $ne: '' } }

  const contacts = await Contact.find(query, 'name email company designation tags').lean()
  return NextResponse.json({ contacts, count: contacts.length })
}

// POST — send the campaign
export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const user = await currentUser().catch(() => null)
  const role = (user?.unsafeMetadata?.role as string) || 'employee'
  const perms = (user?.unsafeMetadata?.permissions as string[]) || []
  const canPost = role === 'manager' || role === 'boss' || perms.includes('post_announcements')
  if (!canPost) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  await connectDB()
  const body = await req.json() as {
    tag?: string; contactIds?: string[]; subject: string; bodyTemplate: string; previewOnly?: boolean
  }

  if (!body.subject?.trim() || !body.bodyTemplate?.trim()) {
    return NextResponse.json({ error: 'Subject and body required' }, { status: 400 })
  }

  // Fetch target contacts
  let query: Record<string, unknown> = { createdBy: userId, email: { $exists: true, $ne: '' } }
  if (body.contactIds?.length) query = { ...query, _id: { $in: body.contactIds } }
  else if (body.tag)           query = { ...query, tags: body.tag }

  const contacts = await Contact.find(query, 'name email company').lean()
  if (!contacts.length) return NextResponse.json({ error: 'No contacts with email found' }, { status: 400 })

  if (body.previewOnly) return NextResponse.json({ contacts, count: contacts.length })

  // Send emails — replace {{name}}, {{company}} placeholders
  let sent = 0; let failed = 0
  await Promise.allSettled(
    contacts.map(async c => {
      const personalBody = body.bodyTemplate
        .replace(/\{\{name\}\}/gi, c.name)
        .replace(/\{\{company\}\}/gi, c.company || '')
        .replace(/\n/g, '<br>')

      const html = `
        <div style="font-family:Inter,system-ui,sans-serif; max-width:600px; margin:0 auto; padding:32px 24px">
          <p>${personalBody}</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
          <p style="font-size:11px;color:#9ca3af">Sent via DoppelDash — Doppelmayr India</p>
        </div>`

      const ok = await sendEmail(c.email!, body.subject, html)
      if (ok) sent++; else failed++
    })
  )

  return NextResponse.json({ sent, failed, total: contacts.length })
}
