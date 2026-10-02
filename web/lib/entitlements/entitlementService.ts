/**
 * DoppelDash — Centralized Entitlement Service (Batch L)
 *
 * Single source of truth for organization plans, feature gates, limits, and client access.
 * Prevents scattering plan checks or client-side trust across business routes.
 */

import { connectDB } from '@/lib/db'
import Organization, { EntitlementSource, SubscriptionStatus, TrialStatus } from '@/models/Organization'
import User from '@/models/User'
import Contact from '@/models/Contact'
import Expense from '@/models/Expense'
import { FeatureKey, LimitKey, PLAN_CONFIGS, PlanConfig } from './plans'

export interface OrganizationEntitlements {
  orgId: string
  name: string
  plan: 'free' | 'premium'
  source: EntitlementSource
  lifetime: boolean
  lifetimeGrant: boolean
  features: Record<FeatureKey, boolean>
  limits: Record<LimitKey, number>
  webEnabled: boolean
  androidEnabled: boolean
  subscription: {
    status: SubscriptionStatus
    subscriptionId?: string
    currentPeriodStart?: Date
    currentPeriodEnd?: Date
    cancelAtPeriodEnd?: boolean
  }
  trial: {
    status: TrialStatus
    trialStart?: Date
    trialEnd?: Date
  }
}

/**
 * Resolves the full authorized entitlement state for an organization.
 */
export async function getOrganizationEntitlements(orgId: string): Promise<OrganizationEntitlements> {
  await connectDB()

  const org = await Organization.findOne({
    $or: [{ orgId }, { slug: orgId }],
  }).lean()

  const now = new Date()
  const periodEnd = org?.currentPeriodEnd ? new Date(org.currentPeriodEnd) : null
  const isPeriodActive = periodEnd ? periodEnd.getTime() >= now.getTime() : true
  let resolvedSubStatus: SubscriptionStatus = (org?.subscriptionStatus as SubscriptionStatus) || 'none'
  let plan: 'free' | 'premium' = 'free'
  let source: EntitlementSource = (org?.entitlementSource as EntitlementSource) || 'none'
  let lifetime = !!org?.lifetimeGrant
  let cancelAtPeriodEnd = Boolean(org?.cancelAtPeriodEnd)

  if (lifetime || source === 'lifetime_grant') {
    plan = 'premium'
    source = 'lifetime_grant'
    lifetime = true
  } else if (org?.subscriptionStatus === 'active' || org?.subscriptionStatus === 'trialing') {
    if (periodEnd && !isPeriodActive) {
      // Subscription period has passed -> falls back to Free
      plan = 'free'
      source = 'subscription'
      resolvedSubStatus = 'expired'
    } else {
      plan = 'premium'
      source = 'subscription'
    }
  } else if (org?.subscriptionStatus === 'canceled') {
    if (periodEnd && isPeriodActive) {
      // Canceled auto-renew but still within paid period -> remains Premium until expiry
      plan = 'premium'
      source = 'subscription'
      cancelAtPeriodEnd = true
    } else {
      plan = 'free'
      source = 'subscription'
      resolvedSubStatus = 'expired'
    }
  } else if (org?.subscriptionStatus === 'expired' || org?.subscriptionStatus === 'revoked') {
    plan = 'free'
    source = (org?.entitlementSource as EntitlementSource) || 'subscription'
    resolvedSubStatus = org.subscriptionStatus as SubscriptionStatus
  } else if (org?.plan === 'premium') {
    plan = 'premium'
    source = (org?.entitlementSource as EntitlementSource) || 'subscription'
  } else {
    plan = 'free'
    source = 'none'
    lifetime = false
  }

  // Derive client access purely from persisted organization fields
  const webEnabled = org?.webEnabled === true
  const androidEnabled = org?.androidEnabled ?? true

  const config: PlanConfig = PLAN_CONFIGS[plan]

  return {
    orgId: org?.orgId || orgId,
    name: org?.name || 'Organization',
    plan,
    source,
    lifetime,
    lifetimeGrant: lifetime,
    features: { ...config.features },
    limits: { ...config.limits },
    webEnabled,
    androidEnabled,
    subscription: {
      status: resolvedSubStatus,
      subscriptionId: org?.subscriptionId,
      currentPeriodStart: org?.currentPeriodStart,
      currentPeriodEnd: org?.currentPeriodEnd,
      cancelAtPeriodEnd,
    },
    trial: {
      status: (org?.trialStatus as TrialStatus) || 'none',
      trialStart: org?.trialStart,
      trialEnd: org?.trialEnd,
    },
  }
}

/**
 * Evaluates whether an organization is authorized to use a given feature.
 */
export async function canUseFeature(orgId: string, feature: FeatureKey): Promise<boolean> {
  const entitlements = await getOrganizationEntitlements(orgId)
  return entitlements.features[feature] ?? false
}

/**
 * Retrieves the maximum limit allowed for an organization.
 */
export async function getOrganizationLimit(orgId: string, limit: LimitKey): Promise<number> {
  const entitlements = await getOrganizationEntitlements(orgId)
  return entitlements.limits[limit] ?? 0
}

/**
 * Computes current resource usage for an organization.
 */
export async function getOrganizationUsage(
  orgId: string,
  metric: 'members' | 'contacts' | 'receiptScans'
): Promise<number> {
  await connectDB()

  if (metric === 'members') {
    return await User.countDocuments({
      orgId,
      isActive: { $ne: false },
      isBanned: { $ne: true },
    })
  }

  if (metric === 'contacts') {
    return await Contact.countDocuments({ orgId })
  }

  if (metric === 'receiptScans') {
    const startOfMonth = new Date()
    startOfMonth.setDate(1)
    startOfMonth.setHours(0, 0, 0, 0)
    return await Expense.countDocuments({
      orgId,
      createdAt: { $gte: startOfMonth },
      receiptUrl: { $exists: true, $ne: '' },
    })
  }

  return 0
}
