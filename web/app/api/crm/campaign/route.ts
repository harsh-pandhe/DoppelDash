import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Contact from '@/models/Contact'
import { getUser } from '@/lib/auth'
import { getUserTransporter } from '@/lib/userEmail'
import { sendMail } from '@/lib/mailer'
import CampaignLog from '@/models/CampaignLog'
import { canUseFeature } from '@/lib/entitlements/entitlementService'

// GET — preview contacts for a tag, OR ?history=1 for the caller's sent-campaign log
export async function GET(req: NextRequest) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId = user?.orgId || 'org_doppelmayr'

  if (!(await canUseFeature(orgId, 'campaigns'))) {
    return NextResponse.json(
      { error: 'Email campaigns require a Premium plan subscription.' },
      { status: 403 }
    )
  }

  await connectDB()
  const url = new URL(req.url)

  if (url.searchParams.get('history')) {
    const logs = await CampaignLog.find({ orgId, sentBy: userId }).sort({ createdAt: -1 }).limit(50).lean()
    return NextResponse.json({ history: logs })
  }

  const tag   = url.searchParams.get('tag') || ''
  const query = tag ? { orgId, createdBy: userId, tags: tag, email: { $exists: true, $ne: '' } }
                    : { orgId, createdBy: userId, email: { $exists: true, $ne: '' } }

  const contacts = await Contact.find(query, 'name email company designation tags').lean()
  return NextResponse.json({ contacts, count: contacts.length })
}

// POST — send the campaign
export async function POST(req: NextRequest) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const orgId = user?.orgId || 'org_doppelmayr'

  if (!(await canUseFeature(orgId, 'campaigns'))) {
    return NextResponse.json(
      { error: 'Email campaigns require a Premium plan subscription.' },
      { status: 403 }
    )
  }

  // 10B: mass mail = admin + manager by default; employees only if granted mailAccess
  const role = user?.role || 'employee'
  const canPost = role === 'admin' || role === 'manager' || user?.mailAccess === true
  if (!canPost) return NextResponse.json({ error: 'Mail access not granted — contact your administrator.' }, { status: 403 })

  await connectDB()
  const body = await req.json() as {
    tag?: string; contactIds?: string[]; subject: string; bodyTemplate: string; previewOnly?: boolean
    // Communications module: explicit recipient list + pre-built rich HTML body
    recipients?: { name?: string; email: string; company?: string }[]
    isHtml?: boolean
    // Test send: deliver one copy to this address with sample personalization
    testEmail?: string; sampleName?: string; sampleCompany?: string
  }

  if (!body.subject?.trim() || !body.bodyTemplate?.trim()) {
    return NextResponse.json({ error: 'Subject and body required' }, { status: 400 })
  }

  let contacts: { name?: string; email?: string; company?: string }[]
  // Test send — deliver a single copy to the requester's own address, sample-personalized.
  if (body.testEmail && typeof body.testEmail === 'string') {
    contacts = [{ name: body.sampleName || 'there', email: body.testEmail, company: body.sampleCompany || 'your team' }]
  } else if (body.recipients?.length) {
    contacts = body.recipients.filter(r => typeof r.email === 'string' && r.email.includes('@'))
  } else {
    const effectiveOrgId = user?.orgId || 'org_doppelmayr'
    let query: Record<string, unknown> = { orgId: effectiveOrgId, createdBy: userId, email: { $exists: true, $ne: '' } }
    if (body.contactIds?.length) query = { ...query, _id: { $in: body.contactIds } }
    else if (body.tag)           query = { ...query, tags: body.tag }
    contacts = await Contact.find(query, 'name email company').lean()
  }
  if (!contacts.length) return NextResponse.json({ error: 'No contacts with email found' }, { status: 400 })

  if (body.previewOnly) return NextResponse.json({ contacts, count: contacts.length })

  // Prefer sender's connected SMTP (e.g. Outlook OAuth); fall back to platform SMTP relay.
  const userSmtp = await getUserTransporter(userId)
  const channel  = userSmtp ? 'user_smtp' : 'smtp'

  let sent = 0; let failed = 0
  // Send in small batches with a short pause between them so a large tag segment
  // doesn't hit the SMTP relay with hundreds of simultaneous connections.
  const BATCH = 20
  for (let i = 0; i < contacts.length; i += BATCH) {
    await Promise.allSettled(
      contacts.slice(i, i + BATCH).map(async c => {
        const personalized = body.bodyTemplate
          .replace(/\{\{name\}\}/gi, c.name || 'there')
          .replace(/\{\{company\}\}/gi, c.company || 'your team')

        // isHtml: body is already rich HTML from the mail editor — embed as-is.
        // Legacy plaintext campaigns: convert newlines and wrap in a paragraph.
        const inner = body.isHtml ? personalized : `<p>${personalized.replace(/\n/g, '<br>')}</p>`

        const html = `
          <div style="font-family:Calibri,'Segoe UI',Inter,system-ui,sans-serif; max-width:640px; margin:0 auto; padding:32px 24px">
            ${inner}
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
            <p style="font-size:11px;color:#9ca3af">Sent via DoppelDash</p>
          </div>`

        try {
          if (userSmtp) {
            await userSmtp.transporter.sendMail({ from: userSmtp.from, to: c.email!, subject: body.subject, html })
            sent++
          } else {
            const ok = await sendMail({ to: c.email!, subject: body.subject, html })
            if (ok) sent++; else failed++
          }
        } catch { failed++ }
      })
    )
    if (i + BATCH < contacts.length) await new Promise(r => setTimeout(r, 250))
  }

  // Log non-test campaigns for history
  if (!body.testEmail) {
    try {
      const orgId = user?.orgId || 'org_doppelmayr'
      await CampaignLog.create({
        orgId,
        sentBy: userId, sentByName: user?.fullName || user?.firstName || 'User',
        subject: body.subject, tag: body.tag,
        recipientCount: contacts.length, sent, failed, channel,
      })
    } catch { /* best-effort */ }
  }

  return NextResponse.json({ sent, failed, total: contacts.length, channel, test: !!body.testEmail })
}
