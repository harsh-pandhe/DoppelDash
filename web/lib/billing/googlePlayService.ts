/**
 * DoppelDash — Google Play Verification Service (Batch M)
 *
 * Verifies purchase tokens with the Google Play Developer API (Android Publisher).
 * Strictly refuses to activate Premium on unverified tokens.
 * In development and test environments, provides deterministic verification vectors
 * while explicitly labeling live credential availability per Section 12.
 */

import { PLAY_CONFIG, isValidPlayProduct } from './playConfig'
import { SubscriptionStatus, AcknowledgementState, BillingEnvironment } from '@/models/Subscription'

export interface VerifiedPurchaseResult {
  verified: boolean
  error?: string
  status?: SubscriptionStatus
  startTime?: Date
  currentPeriodEnd?: Date
  autoRenewing?: boolean
  acknowledgementState?: AcknowledgementState
  orderId?: string
  environment?: BillingEnvironment
}

/**
 * Generates an OAuth2 access token for Google API calls when service account credentials are provided.
 */
async function getGoogleApiAccessToken(): Promise<string | null> {
  if (!PLAY_CONFIG.hasRealCredentials()) return null

  try {
    // If service account JSON is supplied
    let creds: { client_email?: string; private_key?: string } = {}
    if (PLAY_CONFIG.serviceAccountJson) {
      creds = JSON.parse(PLAY_CONFIG.serviceAccountJson)
    } else {
      creds = {
        client_email: PLAY_CONFIG.serviceAccountEmail,
        private_key: PLAY_CONFIG.serviceAccountKey.replace(/\\n/g, '\n'),
      }
    }

    if (!creds.client_email || !creds.private_key) return null

    // Lightweight Google Service Account JWT bearer assertion
    const now = Math.floor(Date.now() / 1000)
    const header = { alg: 'RS256', typ: 'JWT' }
    const claim = {
      iss: creds.client_email,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    }

    const crypto = await import('crypto')
    const encode = (obj: unknown) => Buffer.from(JSON.stringify(obj)).toString('base64url')
    const unsignedToken = `${encode(header)}.${encode(claim)}`

    const signer = crypto.createSign('RSA-SHA256')
    signer.update(unsignedToken)
    signer.end()
    const signature = signer.sign(creds.private_key, 'base64url')
    const assertion = `${unsignedToken}.${signature}`

    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    })

    if (!res.ok) {
      console.error('[GooglePlayService] Failed to obtain OAuth2 token:', await res.text())
      return null
    }

    const data = await res.json()
    return data.access_token || null
  } catch (err) {
    console.error('[GooglePlayService] OAuth2 error:', err)
    return null
  }
}

/**
 * Authoritatively verifies a Google Play purchase token.
 */
export async function verifySubscriptionPurchase(params: {
  purchaseToken: string
  productId: string
  packageName?: string
}): Promise<VerifiedPurchaseResult> {
  const { purchaseToken, productId, packageName = PLAY_CONFIG.packageName } = params

  // 1. Validate product identifier against configured subscription
  if (!isValidPlayProduct(productId)) {
    return {
      verified: false,
      error: `Invalid product ID '${productId}'. Only configured Google Play products are supported.`,
    }
  }

  // 2. Validate application package name
  if (packageName !== PLAY_CONFIG.packageName) {
    return {
      verified: false,
      error: `Package name mismatch. Expected '${PLAY_CONFIG.packageName}', received '${packageName}'.`,
    }
  }

  // 3. Real Google Play API verification path
  if (PLAY_CONFIG.hasRealCredentials()) {
    const accessToken = await getGoogleApiAccessToken()
    if (!accessToken) {
      return {
        verified: false,
        error: 'Failed to authenticate with Google Play Android Publisher API.',
      }
    }

    try {
      // Modern Google Play Android Publisher subscriptionsv2 API
      const v2Url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(
        packageName
      )}/purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`

      let res = await fetch(v2Url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (res.ok) {
        const data = await res.json()
        const subState = data.subscriptionState
        let status: SubscriptionStatus = 'active'
        if (subState === 'SUBSCRIPTION_STATE_PENDING') {
          status = 'pending'
        } else if (subState === 'SUBSCRIPTION_STATE_EXPIRED') {
          status = 'expired'
        } else if (subState === 'SUBSCRIPTION_STATE_CANCELED') {
          status = 'canceled'
        } else if (subState === 'SUBSCRIPTION_STATE_ON_HOLD' || subState === 'SUBSCRIPTION_STATE_PAUSED') {
          status = 'on_hold'
        } else if (subState === 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD') {
          status = 'grace_period'
        }

        const lineItem = data.lineItems?.[0]
        const expiryTime = lineItem?.expiryTime ? new Date(lineItem.expiryTime) : new Date(Date.now() + 30 * 86400000)
        const autoRenewing = Boolean(lineItem?.autoRenewingPlan)
        const isAcknowledged = data.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED'

        if (status !== 'pending' && !isAcknowledged) {
          const ackUrl = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(
            packageName
          )}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`
          await fetch(ackUrl, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ developerPayload: 'doppeldash_ack' }),
          }).catch(err => console.error('[GooglePlayService] Acknowledgement failed:', err))
        }

        return {
          verified: true,
          status,
          startTime: data.startTime ? new Date(data.startTime) : new Date(),
          currentPeriodEnd: expiryTime,
          autoRenewing,
          acknowledgementState: isAcknowledged ? 'acknowledged' : 'to_be_acknowledged',
          orderId: data.latestOrderId,
          environment: data.testPurchase ? 'sandbox' : 'production',
        }
      }

      // Fallback to classic v1 subscription endpoint
      const v1Url = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${encodeURIComponent(
        packageName
      )}/purchases/subscriptions/${encodeURIComponent(productId)}/tokens/${encodeURIComponent(purchaseToken)}`

      res = await fetch(v1Url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      })

      if (!res.ok) {
        const errBody = await res.text()
        return {
          verified: false,
          error: `Google Play API returned HTTP ${res.status}: ${errBody}`,
        }
      }

      const data = await res.json()
      const startTimeMillis = parseInt(data.startTimeMillis || Date.now().toString(), 10)
      const expiryTimeMillis = parseInt(data.expiryTimeMillis || '0', 10)
      const autoRenewing = Boolean(data.autoRenewing)
      const acknowledgementState: AcknowledgementState =
        data.acknowledgementState === 1 ? 'acknowledged' : 'to_be_acknowledged'
      const orderId = data.orderId

      const now = Date.now()
      let status: SubscriptionStatus = 'active'
      if (expiryTimeMillis <= now) {
        status = 'expired'
      } else if (!autoRenewing) {
        status = 'canceled'
      }

      // Acknowledge subscription if needed
      if (acknowledgementState === 'to_be_acknowledged') {
        const ackUrl = `${v1Url}:acknowledge`
        await fetch(ackUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ developerPayload: 'doppeldash_ack' }),
        }).catch(err => console.error('[GooglePlayService] Acknowledgement failed:', err))
      }

      return {
        verified: true,
        status,
        startTime: new Date(startTimeMillis),
        currentPeriodEnd: new Date(expiryTimeMillis),
        autoRenewing,
        acknowledgementState: 'acknowledged',
        orderId,
        environment: 'production',
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { verified: false, error: `Google Play verification error: ${msg}` }
    }
  }

  // 4. Boundary behavior when real credentials are not present (Section 12 of spec):
  // Never fabricate live credentials. In production, fail safely.
  if (process.env.NODE_ENV === 'production') {
    return {
      verified: false,
      error: 'Google Play Developer API service account credentials are not configured on this server.',
    }
  }

  // 5. Explicit Test Harness Vectors (only active in non-production/test environments)
  const now = Date.now()
  if (purchaseToken.startsWith('test_play_active_') || purchaseToken.startsWith('mock_token_active_')) {
    return {
      verified: true,
      status: 'active',
      startTime: new Date(now - 86400000), // started 1 day ago
      currentPeriodEnd: new Date(now + 30 * 86400000), // 30 days remaining
      autoRenewing: true,
      acknowledgementState: 'acknowledged',
      orderId: `GPA.${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}-${Math.floor(1000 + Math.random() * 9000)}`,
      environment: 'test',
    }
  }

  if (purchaseToken.startsWith('test_play_expired_') || purchaseToken.startsWith('mock_token_expired_')) {
    return {
      verified: true,
      status: 'expired',
      startTime: new Date(now - 60 * 86400000),
      currentPeriodEnd: new Date(now - 1 * 86400000), // expired yesterday
      autoRenewing: false,
      acknowledgementState: 'acknowledged',
      orderId: `GPA.EXPIRED-${Math.floor(1000 + Math.random() * 9000)}`,
      environment: 'test',
    }
  }

  if (purchaseToken.startsWith('test_play_canceled_') || purchaseToken.startsWith('mock_token_canceled_')) {
    return {
      verified: true,
      status: 'canceled',
      startTime: new Date(now - 10 * 86400000),
      currentPeriodEnd: new Date(now + 20 * 86400000), // canceled auto-renew but 20 days left
      autoRenewing: false,
      acknowledgementState: 'acknowledged',
      orderId: `GPA.CANCELED-${Math.floor(1000 + Math.random() * 9000)}`,
      environment: 'test',
    }
  }

  if (purchaseToken.startsWith('test_play_revoked_') || purchaseToken.startsWith('mock_token_revoked_')) {
    return {
      verified: true,
      status: 'revoked',
      startTime: new Date(now - 5 * 86400000),
      currentPeriodEnd: new Date(now), // revoked immediately
      autoRenewing: false,
      acknowledgementState: 'acknowledged',
      orderId: `GPA.REVOKED-${Math.floor(1000 + Math.random() * 9000)}`,
      environment: 'test',
    }
  }

  if (purchaseToken.startsWith('test_play_pending_') || purchaseToken.startsWith('mock_token_pending_')) {
    return {
      verified: true,
      status: 'pending',
      startTime: new Date(),
      currentPeriodEnd: new Date(now + 30 * 86400000),
      autoRenewing: false,
      acknowledgementState: 'to_be_acknowledged',
      orderId: `GPA.PENDING-${Math.floor(1000 + Math.random() * 9000)}`,
      environment: 'test',
    }
  }

  // Any unverified or fake token is strictly rejected
  return {
    verified: false,
    error: 'Unverified purchase token. Signature and token could not be verified by Google Play.',
  }
}
