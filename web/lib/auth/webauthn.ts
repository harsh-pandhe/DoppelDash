/**
 * WebAuthn (passkeys) helpers — SimpleWebAuthn v14.
 * rpID/origin derive from NEXT_PUBLIC_APP_URL (falls back to localhost dev).
 */
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server'
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransport,
} from '@simplewebauthn/server'
import { isoBase64URL, isoUint8Array } from '@simplewebauthn/server/helpers'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import PasskeyCredential from '@/models/PasskeyCredential'

const RP_NAME = 'DoppelDash'
const CHALLENGE_TTL_MS = 5 * 60_000

function rpConfig(): { rpID: string; origin: string } {
  const url = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const u = new URL(url)
  return { rpID: u.hostname, origin: u.origin }
}

async function saveChallenge(userId: string, challenge: string) {
  await User.findByIdAndUpdate(userId, {
    webauthnChallenge: challenge,
    webauthnChallengeExpiry: new Date(Date.now() + CHALLENGE_TTL_MS),
  })
}

/**
 * Atomically consume the pending challenge. A single conditional findOneAndUpdate both checks (exists, unexpired) and
 * unsets it, so of any number of concurrent callers at most one receives the challenge; everyone else gets null.
 * Missing, expired, half-written or already-consumed challenges all fail closed.
 */
async function consumeChallenge(userId: string): Promise<string | null> {
  try {
    const prior = await User.findOneAndUpdate(
      {
        _id: userId,
        webauthnChallenge: { $type: 'string', $ne: '' },
        webauthnChallengeExpiry: { $gt: new Date() },
      },
      { $unset: { webauthnChallenge: 1, webauthnChallengeExpiry: 1 } },
      { new: false, projection: { webauthnChallenge: 1 } },
    ).lean()
    return prior?.webauthnChallenge || null
  } catch {
    return null
  }
}

/** Registration options for an authenticated user adding a passkey. */
export async function passkeyRegistrationOptions(userId: string, email: string, fullName: string) {
  await connectDB()
  const { rpID } = rpConfig()
  const existing = await PasskeyCredential.find({ userId }).lean()
  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID,
    userID: isoUint8Array.fromUTF8String(userId),
    userName: email,
    userDisplayName: fullName,
    attestationType: 'none',
    excludeCredentials: existing.map(c => ({
      id: c.credentialId,
      transports: c.transports as AuthenticatorTransport[],
    })),
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
  })
  await saveChallenge(userId, options.challenge)
  return options
}

/** Verify a registration response and persist the credential. */
export async function passkeyRegistrationVerify(userId: string, response: RegistrationResponseJSON, nickname?: string, orgId?: string) {
  await connectDB()
  const { rpID, origin } = rpConfig()
  const expectedChallenge = await consumeChallenge(userId)
  if (!expectedChallenge) return { ok: false as const, reason: 'Challenge expired — try again' }

  let verification
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
    })
  } catch (e) {
    return { ok: false as const, reason: e instanceof Error ? e.message : 'Verification error' }
  }
  if (!verification.verified || !verification.registrationInfo) {
    return { ok: false as const, reason: 'Verification failed' }
  }

  let targetOrgId = orgId
  if (!targetOrgId) {
    const userDoc = await User.findById(userId).select('orgId').lean()
    targetOrgId = userDoc?.orgId
    if (!targetOrgId) return { ok: false as const, reason: 'Account is not assigned to an organization' }
  }

  const info = verification.registrationInfo
  try {
    await PasskeyCredential.create({
      userId,
      orgId: targetOrgId,
      credentialId: info.credential.id,
      publicKey: isoBase64URL.fromBuffer(info.credential.publicKey),
      counter: info.credential.counter,
      transports: response.response.transports || [],
      deviceType: info.credentialDeviceType,
      backedUp: info.credentialBackedUp,
      nickname,
    })
  } catch (e) {
    if ((e as { code?: number })?.code === 11000) return { ok: false as const, reason: 'Passkey already registered' }
    return { ok: false as const, reason: e instanceof Error ? e.message : 'Save failed' }
  }
  return { ok: true as const }
}

/** Authentication options for a user signing in with a passkey (by email). */
export async function passkeyLoginOptions(email: string) {
  await connectDB()
  const user = await User.findOne({ email: email.toLowerCase().trim() })
  // Don't reveal account existence — return generic error upstream
  if (!user || !user.isActive || user.isBanned) return null
  const creds = await PasskeyCredential.find({ userId: user._id.toString() }).lean()
  if (creds.length === 0) return null

  const { rpID } = rpConfig()
  const options = await generateAuthenticationOptions({
    rpID,
    allowCredentials: creds.map(c => ({
      id: c.credentialId,
      transports: c.transports as AuthenticatorTransport[],
    })),
    userVerification: 'preferred',
  })
  await saveChallenge(user._id.toString(), options.challenge)
  return { options, userId: user._id.toString() }
}

/** Verify a passkey login. Returns the user on success. */
export async function passkeyLoginVerify(userId: string, response: AuthenticationResponseJSON) {
  await connectDB()
  const { rpID, origin } = rpConfig()
  const cred = await PasskeyCredential.findOne({ userId, credentialId: response.id })
  if (!cred) return { ok: false as const, reason: 'Unknown passkey' }

  const expectedChallenge = await consumeChallenge(userId)
  if (!expectedChallenge) return { ok: false as const, reason: 'Challenge expired — try again' }

  let verification
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: origin,
      expectedRPID: rpID,
      requireUserVerification: false,
      credential: {
        id: cred.credentialId,
        publicKey: isoBase64URL.toBuffer(cred.publicKey),
        counter: cred.counter,
        transports: cred.transports as AuthenticatorTransport[],
      },
    })
  } catch (e) {
    return { ok: false as const, reason: e instanceof Error ? e.message : 'Verification error' }
  }
  if (!verification.verified) return { ok: false as const, reason: 'Verification failed' }

  const existingUser = await User.findById(userId)
  if (!existingUser) return { ok: false as const, reason: 'User not found' }
  if (!existingUser.isActive || existingUser.isBanned) return { ok: false as const, reason: 'Account suspended' }

  cred.counter = verification.authenticationInfo.newCounter
  cred.lastUsedAt = new Date()
  await cred.save()

  existingUser.lastLoginAt = new Date()
  existingUser.lastActiveAt = new Date()
  existingUser.loginCount = (existingUser.loginCount || 0) + 1
  await existingUser.save()
  return { ok: true as const, user: existingUser }
}
