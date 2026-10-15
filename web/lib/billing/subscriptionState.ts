/**
 * The ONE place that turns an authoritative (Google-verified) subscription state into stored Subscription + Organization fields.
 * Used by the purchase-verify route and by the RTDN reconciler so both always agree.
 * Organisations with a persisted lifetime grant never have their plan/entitlement source rewritten by a subscription event.
 */
import Organization from '@/models/Organization'
import type { SubscriptionStatus } from '@/models/Subscription'

export function grantsPremium(status: SubscriptionStatus, periodEnd: Date | undefined, now = new Date()): boolean {
  const active = periodEnd ? periodEnd.getTime() > now.getTime() : true
  return (status === 'active' || status === 'trialing' || status === 'canceled' || status === 'grace_period') && active
}

export async function applySubscriptionToOrg(orgId: string, sub: { _id: unknown; status: SubscriptionStatus; currentPeriodEnd: Date; autoRenewing: boolean }): Promise<{ lifetimeProtected: boolean }> {
  const org = await Organization.findOne({ orgId }).select('lifetimeGrant').lean()
  const lifetimeProtected = !!org?.lifetimeGrant
  const common = { subscriptionStatus: sub.status, subscriptionId: String(sub._id), currentPeriodEnd: sub.currentPeriodEnd, cancelAtPeriodEnd: !sub.autoRenewing }
  await Organization.updateOne({ orgId }, { $set: lifetimeProtected ? common : { ...common, plan: grantsPremium(sub.status, sub.currentPeriodEnd) ? 'premium' : 'free', entitlementSource: 'subscription' } })
  return { lifetimeProtected }
}
