import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { readJsonObject, badBody } from '@/lib/http/body'
import { connectDB } from '@/lib/db'
import Contact from '@/models/Contact'
import { getUser } from '@/lib/auth'
import { getMailService, escapeHtml, resolveMailBrand } from '@/lib/mail'
import CampaignLog from '@/models/CampaignLog'
import { canUseFeature } from '@/lib/entitlements/entitlementService'

// GET — preview contacts for a tag, OR ?history=1 for the caller's sent-campaign log
async function GET_handler(req: NextRequest) {
  const { userId, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
async function POST_handler(req: NextRequest) {
  const { userId, user, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

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
  const body = await readJsonObject<{
    tag?: string; contactIds?: string[]; subject: string; bodyTemplate: string; previewOnly?: boolean
    // Communications module: explicit recipient list + pre-built rich HTML body
    recipients?: { name?: string; email: string; company?: string }[]
    isHtml?: boolean
    // Test send: deliver one copy to this address with sample personalization
    testEmail?: string; sampleName?: string; sampleCompany?: string
  }>(req)
  if (!body) return badBody()

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
    let query: Record<string, unknown> = { orgId, createdBy: userId, email: { $exists: true, $ne: '' } }
    if (body.contactIds?.length) query = { ...query, _id: { $in: body.contactIds } }
    else if (body.tag)           query = { ...query, tags: body.tag }
    contacts = await Contact.find(query, 'name email company').lean()
  }
  if (!contacts.length) return NextResponse.json({ error: 'No contacts with email found' }, { status: 400 })

  if (body.previewOnly) return NextResponse.json({ contacts, count: contacts.length })

  // The BACKEND picks the provider (lib/mail/resolver.ts): the organisation's own
  // provider or the sender's connected mailbox when the plan allows custom mail,
  // otherwise the platform mail service. Credentials never leave the server.
  const sender = await getMailService().createSender('crm_email', { orgId, userId })
  if ('failure' in sender) {
    return NextResponse.json({ error: sender.failure.message }, { status: 503 })
  }
  const channel = sender.channel === 'user_mailbox' ? 'user_smtp' : sender.channel === 'organization' ? 'org_smtp' : 'smtp'

  const brand = await resolveMailBrand(orgId)
  let sent = 0; let failed = 0
  // Send in small batches with a short pause between them so a large tag segment
  // doesn't hit the provider with hundreds of simultaneous connections.
  const BATCH = 20
  for (let i = 0; i < contacts.length; i += BATCH) {
    await Promise.allSettled(
      contacts.slice(i, i + BATCH).map(async c => {
        // Contact fields are user-supplied data → escaped before they enter HTML.
        const nameValue = escapeHtml(c.name || 'there')
        const companyValue = escapeHtml(c.company || 'your team')
        const substitute = (t: string) => t
          .replace(/\{\{name\}\}/gi, () => nameValue)
          .replace(/\{\{company\}\}/gi, () => companyValue)

        // isHtml: body is already rich HTML from the mail editor — embed as-is (only the
        // personalised values are escaped). Legacy plaintext: escape the whole template.
        const inner = body.isHtml
          ? substitute(body.bodyTemplate)
          : `<p>${substitute(escapeHtml(body.bodyTemplate)).replace(/\n/g, '<br>')}</p>`

        const html = `
          <div style="font-family:Calibri,'Segoe UI',Inter,system-ui,sans-serif; max-width:640px; margin:0 auto; padding:32px 24px">
            ${inner}
            <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">
            <p style="font-size:11px;color:#9ca3af">Sent via ${escapeHtml(brand.name)}</p>
          </div>`

        const result = await sender.send({ to: c.email!, subject: body.subject, html, fromName: brand.isPlatform ? undefined : brand.name })
        if (result.delivered) sent++; else failed++
      })
    )
    if (i + BATCH < contacts.length) await new Promise(r => setTimeout(r, 250))
  }

  // Log non-test campaigns for history
  if (!body.testEmail) {
    try {
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

export const GET = dbGuard(GET_handler)
export const POST = dbGuard(POST_handler)
