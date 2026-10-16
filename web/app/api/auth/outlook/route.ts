import { NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { getUser } from '@/lib/auth'
import { signOAuthState } from '@/lib/auth/oauthState'

async function GET_handler() {
  const { userId, orgId } = await getUser()
  if (!userId || !orgId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const clientId    = process.env.OUTLOOK_CLIENT_ID
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/auth/outlook/callback`

  if (!clientId) return NextResponse.json({ error: 'Outlook not configured' }, { status: 503 })

  const params = new URLSearchParams({
    client_id:     clientId,
    response_type: 'code',
    redirect_uri:  redirectUri,
    scope:         'openid email profile offline_access Mail.Read',
    state:         signOAuthState(userId, orgId),
    response_mode: 'query',
  })

  return NextResponse.redirect(
    `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`
  )
}

export const GET = dbGuard(GET_handler)
