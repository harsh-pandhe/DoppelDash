import { NextRequest, NextResponse } from 'next/server'
import { readJsonObject } from '@/lib/http/body'
import { connectDB } from '@/lib/db'
import Contact from '@/models/Contact'
import OutlookToken from '@/models/OutlookToken'

import crypto from 'node:crypto'

/** Constant-time comparison of the notification's clientState with our secret. */
function secretMatches(got: unknown, expected: string): boolean {
  if (typeof got !== 'string') return false
  const a = Buffer.from(got), b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

// Graph API sends a GET with validationToken on subscription creation
export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get('validationToken')
  // Graph's subscription handshake: echo the token as inert text (never HTML), bounded in size.
  if (token) {
    if (token.length > 1024) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    return new NextResponse(token, { headers: { 'Content-Type': 'text/plain; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' } })
  }
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}

export async function POST(req: NextRequest) {
  const body = await readJsonObject<{ value?: unknown }>(req)
  if (!body) return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  const notifications = body?.value as Array<{
    clientState?: string
    subscriptionId?: string
    resourceData?: { id?: string }
    changeType?: string
  }> | undefined

  if (!Array.isArray(notifications) || !notifications.length) return NextResponse.json({ ok: true })
  if (notifications.length > 100) return NextResponse.json({ error: 'Too many notifications' }, { status: 413 })

  // No fallback — clientState is this endpoint's only auth. A hardcoded
  // default (present in the public repo) would let anyone forge notifications.
  const expectedSecret = process.env.OUTLOOK_WEBHOOK_SECRET
  if (!expectedSecret) return NextResponse.json({ ok: true })

  await connectDB()

  for (const n of notifications) {
    if (!secretMatches(n.clientState, expectedSecret)) continue
    if (!n.subscriptionId || !n.resourceData?.id) continue

    // Find which user this subscription belongs to
    const tokenDoc = await OutlookToken.findOne({ subscriptionId: n.subscriptionId }).lean() as {
      userId: string; orgId?: string; accessToken: string; expiresAt: Date; refreshToken: string
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
    const orgId = tokenDoc.orgId
    if (!orgId) continue // never guess a tenant for a stored token
    const contact = await Contact.findOne({ orgId, createdBy: tokenDoc.userId, email: senderEmail })
    if (!contact) continue

    // Add to timeline
    await Contact.findOneAndUpdate({ _id: contact._id, orgId }, {
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
