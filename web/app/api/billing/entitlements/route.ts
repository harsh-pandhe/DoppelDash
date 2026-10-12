/**
 * DoppelDash — Entitlements & Billing Status API (Batch L)
 *
 * GET /api/billing/entitlements
 * Returns the authenticated organization's plan, features, limits, and client permissions.
 */

import { NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import {
  getOrganizationEntitlements,
  getOrganizationUsage,
} from '@/lib/entitlements/entitlementService'

export async function GET() {
  const { userId, user, orgId } = await getUser()
  if (!userId || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }


  try {
    const entitlements = await getOrganizationEntitlements(orgId)
    const [membersCount, contactsCount] = await Promise.all([
      getOrganizationUsage(orgId, 'members'),
      getOrganizationUsage(orgId, 'contacts'),
    ])

    return NextResponse.json({
      orgId: entitlements.orgId,
      name: entitlements.name,
      plan: entitlements.plan,
      source: entitlements.source,
      lifetime: entitlements.lifetime,
      lifetimeGrant: entitlements.lifetimeGrant,
      webEnabled: entitlements.webEnabled,
      androidEnabled: entitlements.androidEnabled,
      features: entitlements.features,
      limits: entitlements.limits,
      usage: {
        members: membersCount,
        contacts: contactsCount,
      },
      subscription: entitlements.subscription,
      trial: entitlements.trial,
    })
  } catch (error: unknown) {
    console.error('[Entitlements API Error]:', error)
    return NextResponse.json({ error: 'Failed to retrieve entitlements' }, { status: 500 })
  }
}
