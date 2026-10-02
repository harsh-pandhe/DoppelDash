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

export const PLAY_CONFIG = {
  packageName: process.env.GOOGLE_PLAY_PACKAGE_NAME || 'com.doppeldash.app',
  premiumProductId: process.env.GOOGLE_PLAY_PREMIUM_PRODUCT_ID || 'doppeldash_premium_monthly',
  serviceAccountJson: process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON || '',
  serviceAccountEmail: process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_EMAIL || '',
  serviceAccountKey: process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_KEY || '',
  rtdnSecret: process.env.GOOGLE_PLAY_RTDN_SECRET || '',

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
