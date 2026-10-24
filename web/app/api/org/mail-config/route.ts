import { readJsonObject } from '@/lib/http/body'
import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { getUser } from '@/lib/auth'
import { connectDB } from '@/lib/db'
import { encrypt } from '@/lib/encrypt'
import { canUseFeature } from '@/lib/entitlements/entitlementService'
import { isProductionLike } from '@/lib/auth/devShortcuts'
import { writeAudit } from '@/lib/audit'
import OrgMailConfig from '@/models/OrgMailConfig'
import { loadOrgTransport } from '@/lib/mail/transports/orgTransport'
import { isSendableAddress, singleLine } from '@/lib/mail/escape'
import { SAFE_FAILURE_MESSAGES, MailTransportError } from '@/lib/mail/types'

/**
 * Organisation mail provider (Premium `customMail`).
 *
 *   GET     current config summary — NEVER the password (only `hasPassword`)
 *   PUT     save + verify with a test message to the calling admin
 *   DELETE  remove; the org falls back to the platform mail service
 *
 * Admin only. The plan is checked server-side on every write: a Free org gets
 * 403 `feature_unavailable` and nothing is stored. Clients never pick a provider;
 * the backend resolves one per message (lib/mail/resolver.ts).
 */

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\..*|10\..*|192\.168\..*|169\.254\..*|172\.(1[6-9]|2\d|3[01])\..*|\[?::1\]?|\[?f[cd][0-9a-f]{2}:.*)$/i

type Summary = {
  configured: boolean
  host?: string; port?: number; secure?: boolean; username?: string
  fromEmail?: string; fromName?: string
  hasPassword?: boolean; verified?: boolean; verifiedAt?: Date | null
  lastTestFailureCode?: string | null
}

async function admin(req: NextRequest) {
  const { userId, user, orgId } = await getUser(req)
  if (!userId || !user || !orgId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  if (user.role !== 'admin') return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  return { userId, user, orgId }
}

function summarize(cfg: { host: string; port: number; secure: boolean; username: string; fromEmail: string; fromName?: string; verifiedAt?: Date; lastTestFailureCode?: string } | null): Summary {
  if (!cfg) return { configured: false }
  return {
    configured: true,
    host: cfg.host, port: cfg.port, secure: cfg.secure, username: cfg.username,
    fromEmail: cfg.fromEmail, fromName: cfg.fromName || '',
    hasPassword: true,
    verified: Boolean(cfg.verifiedAt), verifiedAt: cfg.verifiedAt ?? null,
    lastTestFailureCode: cfg.lastTestFailureCode ?? null,
  }
}

async function GET_handler(req: NextRequest) {
  const a = await admin(req)
  if (a.error) return a.error
  await connectDB()
  const [cfg, entitled] = await Promise.all([
    OrgMailConfig.findOne({ orgId: a.orgId }).lean(),
    canUseFeature(a.orgId, 'customMail'),
  ])
  return NextResponse.json({ entitled, provider: summarize(cfg) })
}

async function PUT_handler(req: NextRequest) {
  const a = await admin(req)
  if (a.error) return a.error

  if (!(await canUseFeature(a.orgId, 'customMail'))) {
    return NextResponse.json({ error: SAFE_FAILURE_MESSAGES.feature_unavailable, code: 'feature_unavailable' }, { status: 403 })
  }

  const body = await readJsonObject(req)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const host = singleLine(String(body.host ?? '')).toLowerCase()
  const port = Number(body.port)
  const secure = body.secure === true
  const username = singleLine(String(body.username ?? ''))
  const fromEmail = singleLine(String(body.fromEmail ?? '')).toLowerCase()
  const fromName = singleLine(String(body.fromName ?? '')).slice(0, 80)
  const password = typeof body.password === 'string' ? body.password : ''

  if (!host || host.length > 253 || /[\s/@]/.test(host)) return NextResponse.json({ error: 'Enter a valid SMTP host' }, { status: 400 })
  if (isProductionLike() && PRIVATE_HOST.test(host)) return NextResponse.json({ error: 'SMTP host must be a public server' }, { status: 400 })
  if (!Number.isInteger(port) || port < 1 || port > 65535) return NextResponse.json({ error: 'Enter a valid port' }, { status: 400 })
  if (!username || username.length > 254) return NextResponse.json({ error: 'Username is required' }, { status: 400 })
  if (!isSendableAddress(fromEmail)) return NextResponse.json({ error: 'Enter a valid sender address' }, { status: 400 })

  await connectDB()
  const existing = await OrgMailConfig.findOne({ orgId: a.orgId }).select('+passwordEnc')
  if (!password && !existing) return NextResponse.json({ error: 'Password is required' }, { status: 400 })
  if (password.length > 512) return NextResponse.json({ error: 'Password is too long' }, { status: 400 })

  // Any change invalidates verification until the test message succeeds.
  await OrgMailConfig.findOneAndUpdate(
    { orgId: a.orgId },
    {
      $set: {
        kind: 'smtp', host, port, secure, username, fromEmail, fromName, updatedBy: a.userId,
        passwordEnc: password ? encrypt(password) : existing!.passwordEnc,
      },
      $unset: { verifiedAt: '', lastTestFailureCode: '' },
    },
    { upsert: true, setDefaultsOnInsert: true }
  )

  // Verify by sending a real message to the admin who saved it.
  let failureCode: string | null = null
  try {
    const transport = await loadOrgTransport(a.orgId, { requireVerified: false })
    if (!transport?.isConfigured()) throw new MailTransportError('not configured', 'not_configured')
    await transport.deliver({
      to: a.user.email,
      subject: 'DoppelDash — your organisation mail provider is connected',
      html: '<p>This test message confirms your organisation’s mail provider works. Invitations and CRM email will now be sent through it.</p>',
      text: 'This test message confirms your organisation’s mail provider works.',
    })
  } catch (err) {
    failureCode = err instanceof MailTransportError ? err.code : 'provider_error'
  }

  if (failureCode) {
    await OrgMailConfig.updateOne({ orgId: a.orgId }, { $set: { lastTestFailureCode: failureCode } })
  } else {
    await OrgMailConfig.updateOne({ orgId: a.orgId }, { $set: { verifiedAt: new Date() } })
  }

  await writeAudit({
    action: failureCode ? 'org_mail.verify_failed' : 'org_mail.configured',
    performedBy: a.userId, performedByName: a.user.fullName || 'Admin',
    targetId: a.orgId, targetType: 'user', orgId: a.orgId,
    metadata: { host, port, failureCode },
  })

  const cfg = await OrgMailConfig.findOne({ orgId: a.orgId }).lean()
  return NextResponse.json(
    failureCode
      ? { error: 'We saved your settings but couldn’t send a test message. Check the host, port and credentials.', code: failureCode, provider: summarize(cfg) }
      : { ok: true, provider: summarize(cfg) },
    { status: failureCode ? 422 : 200 }
  )
}

async function DELETE_handler(req: NextRequest) {
  const a = await admin(req)
  if (a.error) return a.error
  await connectDB()
  await OrgMailConfig.deleteOne({ orgId: a.orgId })
  await writeAudit({
    action: 'org_mail.removed', performedBy: a.userId, performedByName: a.user.fullName || 'Admin',
    targetId: a.orgId, targetType: 'user', orgId: a.orgId,
  })
  return NextResponse.json({ ok: true, provider: { configured: false } })
}

export const GET = dbGuard(GET_handler)
export const PUT = dbGuard(PUT_handler)
export const DELETE = dbGuard(DELETE_handler)
