/**
 * DoppelDash — Entitlement & Plan Configuration Matrix (Batch L)
 *
 * Central definition of all tiers, feature flags, and resource limits.
 * Business logic references these central definitions rather than hardcoding constants.
 */

export type FeatureKey =
  | 'campaigns'
  | 'aiMessageGeneration'
  | 'advancedAnalytics'
  | 'bulkExport'
  | 'ocrReceipts'
  | 'ocrBusinessCards'

export type LimitKey =
  | 'maxMembers'
  | 'maxContacts'
  | 'maxMonthlyReceiptScans'
  | 'maxUploadSizeBytes'

export interface PlanConfig {
  id: 'free' | 'premium'
  name: string
  description: string
  features: Record<FeatureKey, boolean>
  limits: Record<LimitKey, number>
}

export const PLAN_CONFIGS: Record<'free' | 'premium', PlanConfig> = {
  free: {
    id: 'free',
    name: 'Free',
    description: 'Essential field operations and team management for small teams',
    features: {
      campaigns: false,
      aiMessageGeneration: false,
      advancedAnalytics: false,
      bulkExport: false,
      ocrReceipts: true,
      ocrBusinessCards: true,
    },
    limits: {
      maxMembers: 10,
      maxContacts: 50,
      maxMonthlyReceiptScans: 20,
      maxUploadSizeBytes: 5 * 1024 * 1024, // 5MB
    },
  },
  premium: {
    id: 'premium',
    name: 'Premium',
    description: 'Full-featured enterprise mobility & CRM suite with unlimited capacity',
    features: {
      campaigns: true,
      aiMessageGeneration: true,
      advancedAnalytics: true,
      bulkExport: true,
      ocrReceipts: true,
      ocrBusinessCards: true,
    },
    limits: {
      maxMembers: 1000,
      maxContacts: 100000,
      maxMonthlyReceiptScans: 5000,
      maxUploadSizeBytes: 25 * 1024 * 1024, // 25MB
    },
  },
}
