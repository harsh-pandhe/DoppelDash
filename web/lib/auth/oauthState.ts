/**
 * Signed, short-lived OAuth `state` (CSRF protection for the Outlook connect flow). The state used to be the bare user id, so anyone could
 * craft a callback that attached THEIR mailbox to ANOTHER user. Now: HMAC-SHA256 over {userId, orgId, nonce, exp}, verified in constant time,
 * and the callback additionally requires the live session to be that same user.
 */
import crypto from 'node:crypto'

const TTL_MS = 10 * 60_000
const key = (): string => {
  const s = process.env.JWT_SECRET
  if (!s) throw new Error('JWT_SECRET is not set — refusing to sign OAuth state with an insecure key')
  return s
}
const mac = (body: string) => crypto.createHmac('sha256', key()).update('oauth-state:' + body).digest('base64url')

export function signOAuthState(userId: string, orgId: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ u: userId, o: orgId, n: crypto.randomBytes(12).toString('base64url'), e: now + TTL_MS })).toString('base64url')
  return `${body}.${mac(body)}`
}

export function verifyOAuthState(state: string | null | undefined, now = Date.now()): { userId: string; orgId: string } | null {
  if (typeof state !== 'string' || state.length > 600) return null
  const [body, sig, extra] = state.split('.')
  if (!body || !sig || extra !== undefined) return null
  let expected: string
  try { expected = mac(body) } catch { return null }
  const a = Buffer.from(sig), b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
    if (typeof p.u !== 'string' || typeof p.o !== 'string' || typeof p.e !== 'number' || p.e < now) return null
    return { userId: p.u, orgId: p.o }
  } catch { return null }
}
