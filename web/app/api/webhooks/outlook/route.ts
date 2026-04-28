import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Contact from '@/models/Contact'
import OutlookToken from '@/models/OutlookToken'

// Graph API sends a GET with validationToken on subscription creation
export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get('validationToken')
  if (token) return new NextResponse(token, { headers: { 'Content-Type': 'text/plain' } })
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const notifications = body?.value as Array<{
    clientState?: string
    subscriptionId?: string
    resourceData?: { id?: string }
    changeType?: string
  }> | undefined

  if (!notifications?.length) return NextResponse.json({ ok: true })

  const expectedSecret = process.env.OUTLOOK_WEBHOOK_SECRET || 'doppeldash-secret'

  await connectDB()

  for (const n of notifications) {
    if (n.clientState !== expectedSecret) continue
    if (!n.subscriptionId || !n.resourceData?.id) continue

    // Find which user this subscription belongs to
    const tokenDoc = await OutlookToken.findOne({ subscriptionId: n.subscriptionId }).lean() as {
      userId: string; accessToken: string; expiresAt: Date; refreshToken: string
    } | null
    if (!tokenDoc) continue

    // Refresh token if needed
    let accessToken = tokenDoc.accessToken
    if (new Date(tokenDoc.expiresAt) < new Date()) {
      const refreshRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:    'refresh_token',
          refresh_token: tokenDoc.refreshToken,
          client_id:     process.env.OUTLOOK_CLIENT_ID     || '',
          client_secret: process.env.OUTLOOK_CLIENT_SECRET || '',
        }),
      })
      if (refreshRes.ok) {
        const refreshed = await refreshRes.json()
        accessToken = refreshed.access_token
        await OutlookToken.findOneAndUpdate(
          { subscriptionId: n.subscriptionId },
          { accessToken, expiresAt: new Date(Date.now() + refreshed.expires_in * 1000) }
        )
      }
    }

    // Fetch the email
    const msgRes = await fetch(
      `https://graph.microsoft.com/v1.0/me/messages/${n.resourceData.id}?$select=subject,from,bodyPreview,receivedDateTime`,
      { headers: { Authorization: `Bearer ${accessToken}` } }
    )
    if (!msgRes.ok) continue
    const msg = await msgRes.json()

    const senderEmail: string = msg?.from?.emailAddress?.address?.toLowerCase() || ''
    if (!senderEmail) continue

    // Find matching contact by sender email (deduplication-aware lookup)
    const contact = await Contact.findOne({ createdBy: tokenDoc.userId, email: senderEmail })
    if (!contact) continue

    // Add to timeline
    await Contact.findByIdAndUpdate(contact._id, {
      $push: {
        timeline: {
          $each: [{
            type:   'email',
            title:  msg.subject || '(no subject)',
            body:   msg.bodyPreview || '',
            source: 'outlook',
            date:   new Date(msg.receivedDateTime),
          }],
          $position: 0,
        },
      },
    })
  }

  return NextResponse.json({ ok: true })
}
