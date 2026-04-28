import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import OutlookToken from '@/models/OutlookToken'

async function createGraphSubscription(accessToken: string, appUrl: string): Promise<{ id: string; expirationDateTime: string } | null> {
  const expiry = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) // 3 days
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        changeType:         'created',
        notificationUrl:    `${appUrl}/api/webhooks/outlook`,
        resource:           'me/mailFolders/inbox/messages',
        expirationDateTime: expiry.toISOString(),
        clientState:        process.env.OUTLOOK_WEBHOOK_SECRET || 'doppeldash-secret',
      }),
    })
    if (!res.ok) return null
    return await res.json()
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code   = searchParams.get('code')
  const userId = searchParams.get('state')
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || ''

  if (!code || !userId) return NextResponse.redirect(`${appUrl}/settings?outlook=error`)

  const clientId     = process.env.OUTLOOK_CLIENT_ID     || ''
  const clientSecret = process.env.OUTLOOK_CLIENT_SECRET || ''
  const redirectUri  = `${appUrl}/api/auth/outlook/callback`

  // Exchange code for tokens
  const tokenRes = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'authorization_code',
      code,
      redirect_uri:  redirectUri,
      client_id:     clientId,
      client_secret: clientSecret,
      scope:         'openid email profile offline_access Mail.Read',
    }),
  })

  if (!tokenRes.ok) return NextResponse.redirect(`${appUrl}/settings?outlook=error`)

  const tokens = await tokenRes.json()

  // Get user's email from Graph
  const meRes  = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  })
  const me     = await meRes.json()
  const email: string = me?.mail || me?.userPrincipalName || ''

  await connectDB()

  // Create webhook subscription
  const sub = await createGraphSubscription(tokens.access_token, appUrl)

  await OutlookToken.findOneAndUpdate(
    { userId },
    {
      userId,
      email,
      accessToken:        tokens.access_token,
      refreshToken:       tokens.refresh_token,
      expiresAt:          new Date(Date.now() + tokens.expires_in * 1000),
      subscriptionId:     sub?.id,
      subscriptionExpiry: sub?.expirationDateTime ? new Date(sub.expirationDateTime) : undefined,
    },
    { upsert: true, new: true }
  )

  return NextResponse.redirect(`${appUrl}/settings?outlook=connected`)
}
