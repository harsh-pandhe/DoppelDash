import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { connectDB } from '@/lib/db'
import Subscription from '@/models/Subscription'
import { PLAY_CONFIG } from '@/lib/billing/playConfig'
import { authenticateRtdn } from '@/lib/billing/rtdnAuth'
import { verifySubscriptionPurchase } from '@/lib/billing/googlePlayService'
import { applySubscriptionToOrg } from '@/lib/billing/subscriptionState'
import { getOrganizationEntitlements } from '@/lib/entitlements/entitlementService'
import { apiError, readJson } from '@/lib/travel/http'

/**
 * Google Play Real-time Developer Notifications (Pub/Sub push).
 *
 *  1. AUTHENTICATION FIRST, fail closed: a valid Pub/Sub OIDC token (issuer, audience, service-account identity) is required; with the
 *     audience / service account unconfigured every request is refused (503). Nothing is accepted from the query string.
 *  2. The notification is only a HINT. Entitlements are never derived from its type: for a known purchase token the current state is
 *     fetched from the Google Play Developer API and THAT is stored (so out-of-order, replayed or forged-content messages cannot
 *     change what Google says). If Google cannot be reached we answer 503 so Pub/Sub retries — nothing is changed.
 *  3. Duplicate deliveries are acknowledged without work: the message id is claimed with an atomic conditional update.
 *  4. Unknown tokens / other packages are acknowledged (200) so Google does not retry forever; they change nothing.
 */
async function POST_handler(req: NextRequest) {
  const auth = await authenticateRtdn(req.headers.get('authorization'))
  if (!auth.ok) return apiError(auth.status, auth.code === 'rtdn_not_configured' ? 'Notification endpoint is not configured.' : 'Unauthorized notification source.', auth.code)

  const parsed = await readJson(req)
  if ('response' in parsed) return parsed.response
  const body = parsed.body as Record<string, unknown> | null
  if (!body || typeof body !== 'object' || Array.isArray(body)) return apiError(400, 'Invalid notification', 'invalid_notification')

  let event: Record<string, unknown> = body
  let messageId = typeof body.messageId === 'string' ? body.messageId : undefined
  if (body.message && typeof body.message === 'object') {
    const msg = body.message as { data?: string; messageId?: string }
    messageId = typeof msg.messageId === 'string' ? msg.messageId : undefined
    if (typeof msg.data === 'string') {
      try { event = JSON.parse(Buffer.from(msg.data, 'base64').toString('utf8')) } catch { return apiError(400, 'Invalid notification payload', 'invalid_notification') }
    }
  }
  if (!event || typeof event !== 'object') return apiError(400, 'Invalid notification payload', 'invalid_notification')
  if (event.testNotification) return NextResponse.json({ status: 'ok', type: 'testNotification' })
  if (typeof event.packageName === 'string' && event.packageName !== PLAY_CONFIG.packageName) return NextResponse.json({ status: 'ignored', reason: 'other_package' })

  const sub = (event.subscriptionNotification ?? null) as { purchaseToken?: unknown; notificationType?: unknown } | null
  const voided = (event.voidedPurchaseNotification ?? null) as { purchaseToken?: unknown } | null
  const rawToken = sub?.purchaseToken ?? voided?.purchaseToken
  if (typeof rawToken !== 'string' || !rawToken.trim() || rawToken.length > 2048) return apiError(400, 'Missing subscriptionNotification or purchaseToken', 'invalid_notification')
  const purchaseToken = rawToken.trim()
  const notificationType = Number(sub?.notificationType ?? 0)
  const eventTime = Number(event.eventTimeMillis) || 0
  const eventId = (messageId && messageId.slice(0, 200)) || `${purchaseToken.slice(-24)}_${notificationType}_${eventTime}`

  await connectDB()
  const known = await Subscription.findByPurchaseToken(purchaseToken)
  if (!known) return NextResponse.json({ status: 'ignored', reason: 'Subscription token not found in local tenant records' })

  // Atomic duplicate guard: only one delivery of a message id proceeds.
  const claimed = await Subscription.findOneAndUpdate(
    { _id: known._id, processedEventIds: { $ne: eventId } },
    { $push: { processedEventIds: { $each: [eventId], $slice: -25 } } },
    { returnDocument: 'after' },
  )
  if (!claimed) return NextResponse.json({ status: 'ok', message: 'Event already processed' })

  const verification = await verifySubscriptionPurchase({ purchaseToken, productId: claimed.productId })
  if (!verification.verified) {
    await Subscription.updateOne({ _id: known._id }, { $pull: { processedEventIds: eventId } })     // let the retry do the work
    console.error('[rtdn] authoritative verification unavailable')
    return apiError(503, 'Could not verify the subscription with Google Play; please retry.', 'play_verification_unavailable', {}, { 'Retry-After': '30' })
  }

  const updated = await Subscription.findOneAndUpdate(
    { _id: known._id },
    {
      $set: {
        status: verification.status || claimed.status,
        currentPeriodEnd: verification.currentPeriodEnd || claimed.currentPeriodEnd,
        autoRenewing: verification.autoRenewing ?? claimed.autoRenewing,
        acknowledgementState: verification.acknowledgementState || claimed.acknowledgementState,
        ...(verification.orderId ? { orderId: verification.orderId } : {}),
        ...(verification.status === 'canceled' && !claimed.canceledAt ? { canceledAt: new Date() } : {}),
        lastVerifiedAt: new Date(),
        rawEventId: eventId,
      },
      ...(eventTime ? { $max: { lastEventTimeMillis: eventTime } } : {}),
    },
    { returnDocument: 'after' },
  )
  if (!updated) return NextResponse.json({ status: 'ignored', reason: 'subscription_removed' })
  await applySubscriptionToOrg(updated.orgId, updated)
  const entitlements = await getOrganizationEntitlements(updated.orgId)
  return NextResponse.json({ status: 'ok', notificationType, orgId: updated.orgId, plan: entitlements.plan, subscriptionStatus: updated.status })
}

export const POST = dbGuard(POST_handler)
