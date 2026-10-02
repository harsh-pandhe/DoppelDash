import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Subscription from '@/models/Subscription'
import Organization from '@/models/Organization'
import { PLAY_CONFIG, RTDN_NOTIFICATION_TYPES } from '@/lib/billing/playConfig'
import { getOrganizationEntitlements } from '@/lib/entitlements/entitlementService'

/**
 * POST /api/billing/play/rtdn
 *
 * Ingests and idempotently processes Google Play Real-Time Developer Notifications (RTDN).
 * Supports standard Cloud Pub/Sub push messages and direct payloads.
 */
export async function POST(req: NextRequest) {
  // 1. Authenticate incoming webhook if secret is configured
  if (PLAY_CONFIG.rtdnSecret) {
    const url = new URL(req.url)
    const token = url.searchParams.get('token') || req.headers.get('x-rtdn-secret')
    if (token !== PLAY_CONFIG.rtdnSecret) {
      return NextResponse.json({ error: 'Unauthorized notification source' }, { status: 401 })
    }
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request' }, { status: 400 })
  }

  // 2. Decode Pub/Sub push message if wrapped
  let eventPayload = body
  let messageId = typeof body.messageId === 'string' ? body.messageId : undefined

  if (body.message && typeof body.message === 'object') {
    const pubSubMsg = body.message as { data?: string; messageId?: string }
    messageId = pubSubMsg.messageId
    if (pubSubMsg.data && typeof pubSubMsg.data === 'string') {
      try {
        const decoded = Buffer.from(pubSubMsg.data, 'base64').toString('utf8')
        eventPayload = JSON.parse(decoded)
      } catch {
        return NextResponse.json({ error: 'Failed to decode Pub/Sub data payload' }, { status: 400 })
      }
    }
  }

  // 3. Handle Google Play Pub/Sub connectivity test notification
  if (eventPayload.testNotification) {
    return NextResponse.json({ status: 'ok', type: 'testNotification' }, { status: 200 })
  }

  const subNotif = eventPayload.subscriptionNotification as
    | {
        version?: string
        notificationType?: number
        purchaseToken?: string
        subscriptionId?: string
      }
    | undefined

  if (!subNotif || typeof subNotif.purchaseToken !== 'string') {
    return NextResponse.json({ error: 'Missing subscriptionNotification or purchaseToken' }, { status: 400 })
  }

  const purchaseToken = subNotif.purchaseToken.trim()
  const notificationType = Number(subNotif.notificationType)
  const eventId = messageId || `${purchaseToken}_${notificationType}_${eventPayload.eventTimeMillis || Date.now()}`

  await connectDB()

  // 4. Resolve existing subscription
  const sub = await Subscription.findByPurchaseToken(purchaseToken)
  if (!sub) {
    // If not found in our DB, acknowledge successfully so Google does not endlessly retry
    return NextResponse.json(
      { status: 'ignored', reason: 'Subscription token not found in local tenant records' },
      { status: 200 }
    )
  }

  // 5. Idempotency check: if rawEventId matches, this exact event was already processed
  if (sub.rawEventId === eventId) {
    return NextResponse.json({ status: 'ok', message: 'Event already processed' }, { status: 200 })
  }

  const orgId = sub.orgId
  const now = new Date()

  switch (notificationType) {
    case RTDN_NOTIFICATION_TYPES.SUBSCRIPTION_RECOVERED:
    case RTDN_NOTIFICATION_TYPES.SUBSCRIPTION_RENEWED:
    case RTDN_NOTIFICATION_TYPES.SUBSCRIPTION_PURCHASED:
    case RTDN_NOTIFICATION_TYPES.SUBSCRIPTION_RESTARTED: {
      sub.status = 'active'
      sub.autoRenewing = true
      // Extend currentPeriodEnd by 30 days from now or existing end
      const baseDate = sub.currentPeriodEnd > now ? sub.currentPeriodEnd : now
      sub.currentPeriodEnd = new Date(baseDate.getTime() + 30 * 86400000)
      sub.rawEventId = eventId
      sub.lastVerifiedAt = now
      await sub.save()

      await Organization.updateOne(
        { orgId },
        {
          $set: {
            plan: 'premium',
            subscriptionStatus: 'active',
            currentPeriodEnd: sub.currentPeriodEnd,
            cancelAtPeriodEnd: false,
          },
        }
      )
      break
    }

    case RTDN_NOTIFICATION_TYPES.SUBSCRIPTION_CANCELED: {
      // User canceled auto-renew, access continues until period end
      sub.status = 'canceled'
      sub.autoRenewing = false
      sub.canceledAt = now
      sub.rawEventId = eventId
      sub.lastVerifiedAt = now
      await sub.save()

      await Organization.updateOne(
        { orgId },
        {
          $set: {
            subscriptionStatus: 'canceled',
            cancelAtPeriodEnd: true,
          },
        }
      )
      break
    }

    case RTDN_NOTIFICATION_TYPES.SUBSCRIPTION_ON_HOLD:
    case RTDN_NOTIFICATION_TYPES.SUBSCRIPTION_IN_GRACE_PERIOD:
    case RTDN_NOTIFICATION_TYPES.SUBSCRIPTION_PAUSED: {
      sub.status = notificationType === RTDN_NOTIFICATION_TYPES.SUBSCRIPTION_PAUSED ? 'on_hold' : 'grace_period'
      sub.rawEventId = eventId
      sub.lastVerifiedAt = now
      await sub.save()

      await Organization.updateOne(
        { orgId },
        {
          $set: {
            subscriptionStatus: sub.status,
          },
        }
      )
      break
    }

    case RTDN_NOTIFICATION_TYPES.SUBSCRIPTION_REVOKED: {
      // Immediate revocation (refund, chargeback, or administrative revoke)
      sub.status = 'revoked'
      sub.currentPeriodEnd = now
      sub.rawEventId = eventId
      sub.lastVerifiedAt = now
      await sub.save()

      await Organization.updateOne(
        { orgId },
        {
          $set: {
            plan: 'free',
            subscriptionStatus: 'revoked',
            currentPeriodEnd: now,
          },
        }
      )
      break
    }

    case RTDN_NOTIFICATION_TYPES.SUBSCRIPTION_EXPIRED: {
      // Natural expiration
      sub.status = 'expired'
      sub.currentPeriodEnd = now
      sub.rawEventId = eventId
      sub.lastVerifiedAt = now
      await sub.save()

      await Organization.updateOne(
        { orgId },
        {
          $set: {
            plan: 'free',
            subscriptionStatus: 'expired',
            currentPeriodEnd: now,
          },
        }
      )
      break
    }

    default: {
      // Known notification without status modification
      sub.rawEventId = eventId
      sub.lastVerifiedAt = now
      await sub.save()
      break
    }
  }

  // Recompute authoritative entitlements
  const updatedEntitlements = await getOrganizationEntitlements(orgId)

  return NextResponse.json({
    status: 'ok',
    notificationType,
    orgId,
    plan: updatedEntitlements.plan,
    subscriptionStatus: sub.status,
  })
}
