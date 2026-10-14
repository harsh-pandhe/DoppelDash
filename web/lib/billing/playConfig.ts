/**
 * DoppelDash — Google Play Subscription Configuration (Batch M)
 *
 * Central definition of Google Play product IDs, package identity,
 * and service credentials. Avoids hardcoding product identifiers across codebase.
 */

export interface PlaySubscriptionProduct {
  productId: string
  basePlanId: string
  name: string
  description: string
  plan: 'premium'
  billingPeriodDays: number
  priceAmountMicros?: number
  currency?: string
}

import { isProductionLike } from '@/lib/auth/devShortcuts'

/** Endpoint overrides exist ONLY so tests can point the real code paths at local fakes; they are ignored on any production-like or hosted process. */
const override = (name: string, fallback: string) => (!isProductionLike() && process.env[name]) || fallback

export const PLAY_CONFIG = {
  packageName: process.env.GOOGLE_PLAY_PACKAGE_NAME || 'com.doppeldash.app',
  premiumProductId: process.env.GOOGLE_PLAY_PREMIUM_PRODUCT_ID || 'doppeldash_premium_monthly',
  serviceAccountJson: process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON || '',
  serviceAccountEmail: process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL || '',
  serviceAccountKey: process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY || '',
  /** Pub/Sub push authentication (RTDN). BOTH must be configured or the endpoint rejects everything (fail closed). */
  rtdnAudience: process.env.GOOGLE_PLAY_RTDN_AUDIENCE || '',
  rtdnPushServiceAccount: process.env.GOOGLE_PLAY_RTDN_PUSH_SA_EMAIL || '',
  oidcJwksUrl: override('GOOGLE_PLAY_OIDC_JWKS_URL', 'https://www.googleapis.com/oauth2/v3/certs'),
  oauthTokenUrl: override('GOOGLE_PLAY_OAUTH_TOKEN_URL', 'https://oauth2.googleapis.com/token'),
  publisherApiBase: override('GOOGLE_PLAY_PUBLISHER_API_BASE', 'https://androidpublisher.googleapis.com'),

  hasRealCredentials(): boolean {
    return Boolean(
      this.serviceAccountJson ||
      (this.serviceAccountEmail && this.serviceAccountKey)
    )
  },
}

export const PLAY_PRODUCTS: Record<string, PlaySubscriptionProduct> = {
  [PLAY_CONFIG.premiumProductId]: {
    productId: PLAY_CONFIG.premiumProductId,
    basePlanId: 'monthly',
    name: 'DoppelDash Premium Monthly',
    description: 'Full-featured enterprise mobility & CRM suite with unlimited capacity',
    plan: 'premium',
    billingPeriodDays: 30,
    priceAmountMicros: 499000000, // ₹499 INR / $5.99 USD nominal
    currency: 'INR',
  },
}

export function isValidPlayProduct(productId: string): boolean {
  return productId === PLAY_CONFIG.premiumProductId
}

/**
 * Standard Google Play Real-Time Developer Notification (RTDN) types
 * https://developer.android.com/google/play/billing/rtdn-reference
 */
export const RTDN_NOTIFICATION_TYPES = {
  SUBSCRIPTION_RECOVERED: 1,
  SUBSCRIPTION_RENEWED: 2,
  SUBSCRIPTION_CANCELED: 3,
  SUBSCRIPTION_PURCHASED: 4,
  SUBSCRIPTION_ON_HOLD: 5,
  SUBSCRIPTION_IN_GRACE_PERIOD: 6,
  SUBSCRIPTION_RESTARTED: 7,
  SUBSCRIPTION_PRICE_CHANGE_CONFIRMED: 8,
  SUBSCRIPTION_DEFERRED: 9,
  SUBSCRIPTION_PAUSED: 10,
  SUBSCRIPTION_PAUSE_SCHEDULE_CHANGED: 11,
  SUBSCRIPTION_REVOKED: 12,
  SUBSCRIPTION_EXPIRED: 13,
} as const
