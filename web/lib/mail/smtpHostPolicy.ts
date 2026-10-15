/**
 * Outbound SMTP destination policy for USER- and ADMIN-SUPPLIED mail servers (SSRF guard). The server connects to whatever host a user types into
 * "connect my mailbox"; without a policy that is a port scanner / internal-service probe (loopback, cloud metadata 169.254.169.254, private ranges),
 * and nodemailer's error text echoed the target. The platform's own env-configured SMTP is trusted and does not go through this.
 */
import dns from 'node:dns/promises'
import net from 'node:net'
import { isProductionLike } from '@/lib/auth/devShortcuts'

export const ALLOWED_SMTP_PORTS = [25, 465, 587, 2525] as const

export class SmtpPolicyError extends Error {
  constructor(readonly code: 'invalid_host' | 'private_host' | 'unresolvable_host' | 'invalid_port') { super(code) }
}

const v4 = (ip: string) => ip.split('.').map(Number)
export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b, c] = v4(ip)
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) || (a === 192 && b === 168) || (a === 198 && (b === 18 || b === 19)) || a >= 224
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase()
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(l)
    if (mapped) return isPrivateAddress(mapped[1])
    return l === '::' || l === '::1' || /^f[cd]/.test(l) || /^fe[89ab]/.test(l) || l.startsWith('ff')
  }
  return true   // not an IP at all: treat as unsafe when asked about an address
}

/** Syntax + literal checks (no DNS). Rejects IP literals in private ranges, `localhost`, single-label names and odd characters. */
export function checkSmtpHostSyntax(raw: string): void {
  const host = raw.trim().toLowerCase()
  if (!host || host.length > 253) throw new SmtpPolicyError('invalid_host')
  const bare = host.replace(/^\[|\]$/g, '')
  if (net.isIP(bare)) { if (isPrivateAddress(bare)) throw new SmtpPolicyError('private_host'); return }
  if (/[\s/@:]/.test(host)) throw new SmtpPolicyError('invalid_host')
  if (host === 'localhost' || !host.includes('.')) throw new SmtpPolicyError('private_host')
  if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/.test(host)) throw new SmtpPolicyError('invalid_host')
  if (/\.(local|localhost|internal|lan|home|corp|intranet)$/.test(host)) throw new SmtpPolicyError('private_host')
}

export function checkSmtpPort(port: unknown): number {
  const p = Number(port)
  if (!Number.isInteger(p) || !(ALLOWED_SMTP_PORTS as readonly number[]).includes(p)) throw new SmtpPolicyError('invalid_port')
  return p
}

type Resolver = (host: string) => Promise<string[]>
const defaultResolver: Resolver = async host => (await dns.lookup(host, { all: true })).map(a => a.address)

/** Enforced on deployed/production-like hosts (or SMTP_HOST_POLICY=enforce); a developer machine may point at a local mail catcher. */
export function smtpHostPolicyEnforced(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.ALLOW_PRIVATE_SMTP_HOSTS === 'true' && !isProductionLike(env)) return false
  return env.SMTP_HOST_POLICY === 'enforce' || isProductionLike(env)
}

/** Resolves the host and refuses it if ANY address is private/loopback/link-local (also guards DNS names that point inward). */
export async function assertPublicSmtpHost(host: string, resolve: Resolver = defaultResolver): Promise<void> {
  checkSmtpHostSyntax(host)
  const bare = host.trim().toLowerCase().replace(/^\[|\]$/g, '')
  if (net.isIP(bare)) return
  let addrs: string[]
  try { addrs = await resolve(bare) } catch { throw new SmtpPolicyError('unresolvable_host') }
  if (!addrs.length || addrs.some(isPrivateAddress)) throw new SmtpPolicyError(addrs.length ? 'private_host' : 'unresolvable_host')
}

export const SMTP_POLICY_MESSAGES: Record<SmtpPolicyError['code'], string> = {
  invalid_host: 'Enter a valid public SMTP server name.',
  private_host: 'SMTP host must be a public mail server.',
  unresolvable_host: 'We could not find that SMTP server.',
  invalid_port: 'Use a standard SMTP port (25, 465, 587 or 2525).',
}
