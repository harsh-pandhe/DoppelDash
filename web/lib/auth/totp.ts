import { generateSecret, generateURI, verify } from 'otplib'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import { encrypt, decrypt } from '@/lib/encrypt'
import { claimAuthArtifact } from '@/lib/auth/replay'

const ISSUER = 'DoppelDash'
// ±30s clock-drift tolerance — typical for phone authenticators
const EPOCH_TOLERANCE = 30
// A code is acceptable for at most ±30 s around its 30 s step (≈90 s); the claim outlives that window.
const REPLAY_TTL_MS = 120_000
const CLAIM_PURPOSE = 'totp'

// Setup and login share one claim space: a code used to enable TOTP cannot be replayed as a login code.
const claimTotpCode = (userId: string, token: string) => claimAuthArtifact(CLAIM_PURPOSE, userId, token, REPLAY_TTL_MS)

async function checkToken(secret: string, token: string): Promise<boolean> {
  try {
    const result = await verify({ secret, token, epochTolerance: EPOCH_TOLERANCE })
    return result.valid
  } catch {
    return false
  }
}

/** Generate a new TOTP secret for a user (pending until verified). Returns otpauth URL for QR. */
export async function beginTotpSetup(userId: string, email: string): Promise<{ secret: string; otpauthUrl: string }> {
  await connectDB()
  const secret = generateSecret()
  await User.findByIdAndUpdate(userId, { totpSecret: encrypt(secret), totpEnabled: false })
  return { secret, otpauthUrl: generateURI({ issuer: ISSUER, label: email, secret }) }
}

/** Verify a setup code and flip totpEnabled on success (with anti-replay). */
export async function confirmTotpSetup(userId: string, token: string): Promise<boolean> {
  await connectDB()
  const user = await User.findById(userId)
  if (!user?.totpSecret) return false

  // Verify first (an invalid code must never consume anything), then claim atomically: only one caller can win.
  if (!(await checkToken(decrypt(user.totpSecret), token))) return false
  if (!(await claimTotpCode(userId, token))) return false

  // Conditional on the secret we verified against, so a concurrent re-enrolment cannot be enabled with a stale code.
  const res = await User.updateOne({ _id: userId, totpSecret: user.totpSecret }, { totpEnabled: true })
  return res.matchedCount === 1
}

/** Verify a login code against an enabled TOTP secret (with anti-replay). */
export async function verifyTotp(userId: string, token: string): Promise<boolean> {
  await connectDB()
  const user = await User.findById(userId)
  if (!user?.totpEnabled || !user.totpSecret) return false

  if (!(await checkToken(decrypt(user.totpSecret), token))) return false
  return claimTotpCode(userId, token)
}

export async function disableTotp(userId: string): Promise<void> {
  await connectDB()
  await User.findByIdAndUpdate(userId, { $unset: { totpSecret: 1 }, totpEnabled: false })
}
