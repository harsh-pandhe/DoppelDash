import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'

export async function GET() {
  const { userId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clientId    = process.env.OUTLOOK_CLIENT_ID
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/outlook/callback`

  if (!clientId) return NextResponse.json({ error: 'Outlook not configured' }, { status: 503 })

  const params = new URLSearchParams({
    client_id:     clientId,
    response_type: 'code',
    redirect_uri:  redirectUri,
    scope:         'openid email profile offline_access Mail.Read',
    state:         userId,
    response_mode: 'query',
  })

  return NextResponse.redirect(
    `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`
  )
}
