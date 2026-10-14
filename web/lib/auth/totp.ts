import { generateSecret, generateURI, verify } from 'otplib'
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import { encrypt, decrypt } from '@/lib/encrypt'
import { rateLimitMark, rateLimitMarked } from '@/lib/ratelimit'

const ISSUER = 'DoppelDash'
// ±30s clock-drift tolerance — typical for phone authenticators
const EPOCH_TOLERANCE = 30
const REPLAY_TTL_MS = 120_000

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

  const replayKey = `totp-replay:${userId}:${token}`
  if (await rateLimitMarked(replayKey)) return false

  const ok = await checkToken(decrypt(user.totpSecret), token)
  if (ok) {
    await rateLimitMark(replayKey, REPLAY_TTL_MS)
    await User.findByIdAndUpdate(userId, { totpEnabled: true })
  }
  return ok
}

/** Verify a login code against an enabled TOTP secret (with anti-replay). */
export async function verifyTotp(userId: string, token: string): Promise<boolean> {
  await connectDB()
  const user = await User.findById(userId)
  if (!user?.totpEnabled || !user.totpSecret) return false

  const replayKey = `totp-replay:${userId}:${token}`
  if (await rateLimitMarked(replayKey)) return false

  const ok = await checkToken(decrypt(user.totpSecret), token)
  if (ok) {
    await rateLimitMark(replayKey, REPLAY_TTL_MS)
  }
  return ok
}

export async function disableTotp(userId: string): Promise<void> {
  await connectDB()
  await User.findByIdAndUpdate(userId, { $unset: { totpSecret: 1 }, totpEnabled: false })
}
