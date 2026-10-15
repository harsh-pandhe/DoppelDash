import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import { verifyInvitationToken } from '@/lib/invitations/invitationService'
import { rateLimit } from '@/lib/ratelimit'

/**
 * POST /api/auth/invitations/verify   { "token": "<invitation token>" }
 *
 * Read-only preview of an invitation (organisation, invited e-mail, role…) so the
 * invitee can confirm before choosing a password. Everything returned is derived
 * from the stored invitation — nothing here is accepted from the client.
 *
 * The token travels ONLY in the request body. It is never accepted in a path or
 * query string (those land in access logs, proxies and Referer headers), never
 * echoed back, and the response is `no-store`.
 */
const NO_STORE = { 'Cache-Control': 'no-store' }
const json = (body: Record<string, unknown>, status: number) => NextResponse.json(body, { status, headers: NO_STORE })

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || 'unknown'
  if (!(await rateLimit(`invite-verify-ip:${ip}`, 30, 60_000))) {
    return json({ valid: false, reason: 'rate_limited', error: 'Too many attempts — please wait 1 minute' }, 429)
  }

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch {
    return json({ valid: false, reason: 'missing_token', error: 'Invalid JSON body' }, 400)
  }
  const token = typeof body.token === 'string' ? body.token.trim() : ''
  if (!token) return json({ valid: false, reason: 'missing_token', error: 'Invitation token is required' }, 400)

  await connectDB()
  const result = await verifyInvitationToken(token)
  if (!result.valid) return json({ ...result }, result.reason === 'invalid_token' ? 404 : 410)
  return json({ ...result }, 200)
}
