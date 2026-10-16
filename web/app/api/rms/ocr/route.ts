import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { rateLimit } from '@/lib/ratelimit'
import { getUser } from '@/lib/auth'
import { checkOcrImage } from '@/lib/ocr/image'
import { runReceiptOcr } from '@/lib/ocr/receiptOcr'
import { canUseFeature, getOrganizationLimit } from '@/lib/entitlements/entitlementService'
import { consumeMonthlyQuota, currentUsage, refundMonthlyQuota } from '@/lib/entitlements/usage'

const QUOTA_KEY = 'receiptScans'
const quotaView = (q: { used: number; limit: number; remaining: number; resetsAt: string }) => ({ used: q.used, limit: q.limit, remaining: q.remaining, resetsAt: q.resetsAt })

/** Remaining receipt scans this month for the caller's organisation (read-only; consumes nothing). */
async function GET_handler() {
  const { userId, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const [enabled, limit] = await Promise.all([canUseFeature(orgId, 'ocrReceipts'), getOrganizationLimit(orgId, 'maxMonthlyReceiptScans')])
  return NextResponse.json({ enabled, quota: quotaView(await currentUsage(orgId, QUOTA_KEY, limit)) })
}

/**
 * Scan a receipt photo. Order matters: authenticate → rate limit → entitlement → VALIDATE the image (nothing is
 * charged for bad input) → take one quota unit atomically → run OCR → give the unit back if nothing was read.
 * Always returns a usable response: when OCR cannot read the image the client gets `source: 'fallback'` with empty
 * fields and fills the form by hand — OCR trouble never blocks the expense flow.
 */
async function POST_handler(req: NextRequest) {
  const { userId, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!(await rateLimit(`rms-ocr:${userId}`, 20, 60_000))) {
    return NextResponse.json({ error: 'Too many requests', code: 'rate_limited' }, { status: 429 })
  }

  let body: { imageBase64?: unknown; mimeType?: unknown }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid body', code: 'invalid_body' }, { status: 400 }) }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid body', code: 'invalid_body' }, { status: 400 })

  if (!(await canUseFeature(orgId, 'ocrReceipts'))) {
    return NextResponse.json({ error: 'Receipt scanning is not available on your plan. Upgrade to Premium.', code: 'feature_unavailable' }, { status: 403 })
  }

  const img = checkOcrImage(body)
  if (!img.ok) return NextResponse.json({ error: img.error, code: img.code }, { status: img.status })

  const limit = await getOrganizationLimit(orgId, 'maxMonthlyReceiptScans')
  const quota = await consumeMonthlyQuota(orgId, QUOTA_KEY, limit)
  if (!quota.ok) {
    return NextResponse.json({
      error: `Monthly receipt scan limit reached (${limit}). Upgrade to Premium for more scans, or enter the details by hand.`,
      code: 'quota_exceeded', quota: quotaView(quota),
    }, { status: 403 })
  }

  const result = await runReceiptOcr(img.base64, img.mime)
  let used = quota.used
  if (result.provider === 'fallback') { await refundMonthlyQuota(orgId, QUOTA_KEY); used = Math.max(0, used - 1) }

  return NextResponse.json({
    parsed: result.parsed,
    // `source` keeps the legacy two-value contract the Web form reads ('gemma' = AI-read, 'fallback' = nothing read);
    // `provider` says which provider actually answered.
    source: result.provider === 'fallback' ? 'fallback' : 'gemma',
    provider: result.provider,
    quota: quotaView({ used, limit, remaining: Math.max(0, limit - used), resetsAt: quota.resetsAt }),
  })
}

export const GET = dbGuard(GET_handler)
export const POST = dbGuard(POST_handler)
