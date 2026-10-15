import { NextRequest, NextResponse } from 'next/server'
import { applySubscriptionToOrg } from '@/lib/billing/subscriptionState'
import { connectDB } from '@/lib/db'
import { getUser } from '@/lib/auth'
import Subscription from '@/models/Subscription'
import { isValidPlayProduct } from '@/lib/billing/playConfig'
import { verifySubscriptionPurchase } from '@/lib/billing/googlePlayService'
import { getOrganizationEntitlements } from '@/lib/entitlements/entitlementService'
import { rateLimit } from '@/lib/ratelimit'

/**
 * POST /api/billing/play/verify
 *
 * Verifies a Google Play subscription purchase token server-side.
 * Associates the verified subscription with the authenticated tenant.
 * Updates the organization's subscription status and recomputes authoritative entitlements.
 */
export async function POST(req: NextRequest) {
  const { userId, user } = await getUser()
  if (!userId || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Rate limit: 20 verification requests per minute per user
  if (!(await rateLimit(`play-verify:${userId}`, 20, 60_000))) {
    return NextResponse.json({ error: 'Too many verification attempts. Please wait a moment.' }, { status: 429 })
  }

  // Derive organization ID strictly from authenticated session (NEVER from client request body)
  const orgId = user.orgId
  if (!orgId) {
    return NextResponse.json({ error: 'User does not belong to an organization' }, { status: 400 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON request body' }, { status: 400 })
  }

  const purchaseToken = typeof body.purchaseToken === 'string' ? body.purchaseToken.trim() : ''
  const productId = typeof body.productId === 'string' ? body.productId.trim() : ''
  const orderId = typeof body.orderId === 'string' ? body.orderId.trim() : undefined

  if (!purchaseToken || !productId) {
    return NextResponse.json({ error: 'purchaseToken and productId are required' }, { status: 400 })
  }

  // Validate configured product identity
  if (!isValidPlayProduct(productId)) {
    return NextResponse.json({ error: `Invalid product ID '${productId}'` }, { status: 400 })
  }

  await connectDB()

  // Cross-tenant guard: verify this token is not already bound to another tenant
  const existingSub = await Subscription.findByPurchaseToken(purchaseToken)
  if (existingSub && existingSub.orgId !== orgId) {
    return NextResponse.json(
      { error: 'This Google Play purchase token is already associated with another organization' },
      { status: 409 }
    )
  }

  // Server-side verification with Google Play Developer API
  const verification = await verifySubscriptionPurchase({
    purchaseToken,
    productId,
  })

  if (!verification.verified) {
    return NextResponse.json(
      { error: verification.error || 'Google Play purchase verification failed' },
      { status: 400 }
    )
  }

  const effectiveStatus = verification.status || 'active'

  // Idempotently upsert Subscription record
  const subDoc = await Subscription.findOneAndUpdate(
    { purchaseToken },
    {
      $set: {
        orgId,
        provider: 'google_play',
        productId,
        orderId: verification.orderId || orderId,
        status: effectiveStatus,
        acknowledgementState: verification.acknowledgementState || 'acknowledged',
        autoRenewing: verification.autoRenewing ?? true,
        startTime: verification.startTime || new Date(),
        currentPeriodEnd: verification.currentPeriodEnd || new Date(Date.now() + 30 * 86400000),
        linkedUserId: userId,
        lastVerifiedAt: new Date(),
        environment: verification.environment || 'production',
      },
    },
    { upsert: true, returnDocument: 'after' }
  )

  // Update the Organization through the shared mapper (never rewrites a lifetime-granted organisation's plan; webEnabled untouched)
  await applySubscriptionToOrg(orgId, subDoc)

  // Return authoritative entitlement state
  const entitlements = await getOrganizationEntitlements(orgId)

  return NextResponse.json({
    success: true,
    subscription: {
      id: subDoc._id.toString(),
      status: subDoc.status,
      currentPeriodEnd: subDoc.currentPeriodEnd,
      autoRenewing: subDoc.autoRenewing,
      orderId: subDoc.orderId,
    },
    entitlements,
  })
}
