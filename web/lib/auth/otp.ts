import { randomInt, createHmac, timingSafeEqual } from 'crypto'
import { connectDB } from '@/lib/db'
import User from '@/models/User'

const OTP_EXPIRY_MINUTES = 10
const MAX_ATTEMPTS = 5

function otpSecret(): string {
  return process.env.JWT_SECRET || 'dev-only-insecure-key'
}

// Peppered hash — a 6-digit code has too small a keyspace for salting to
// matter, but this still stops anyone with raw DB read access from reading
// live 2FA codes without also holding JWT_SECRET.
function hashOTP(otp: string): string {
  return createHmac('sha256', otpSecret()).update(otp).digest('hex')
}

function hashesMatch(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex')
  const bufB = Buffer.from(b, 'hex')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/** Generate a 6-digit OTP, save hashed copy to user, return plain OTP */
export async function generateOTP(userId: string): Promise<string> {
  await connectDB()
  const user   = await User.findById(userId)
  const otp    = String(randomInt(100000, 1000000))
  const expiry = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60_000)

  // Resending while the previous OTP is still valid must not reset the
  // attempt counter, or resend becomes a lockout-bypass for brute-forcing.
  const stillValid = !!(user?.otp && user?.otpExpiry && new Date() <= user.otpExpiry)

  await User.findByIdAndUpdate(userId, {
    otp: hashOTP(otp),
    otpExpiry: expiry,
    ...(stillValid ? {} : { otpAttempts: 0 }),
  })
  return otp
}

/** Verify OTP. Returns true on match, false on wrong/expired/exceeded */
export async function verifyOTP(userId: string, candidate: string): Promise<{ ok: boolean; reason?: string }> {
  await connectDB()
  const user = await User.findById(userId)
  if (!user) return { ok: false, reason: 'User not found' }

  if (!user.otp || !user.otpExpiry) return { ok: false, reason: 'No OTP pending' }
  if (new Date() > user.otpExpiry) {
    await User.findByIdAndUpdate(userId, { $unset: { otp: 1, otpExpiry: 1 }, otpAttempts: 0 })
    return { ok: false, reason: 'OTP expired' }
  }
  if (user.otpAttempts >= MAX_ATTEMPTS) {
    return { ok: false, reason: 'Too many attempts — request a new OTP' }
  }

  if (!hashesMatch(user.otp, hashOTP(candidate))) {
    await User.findByIdAndUpdate(userId, { $inc: { otpAttempts: 1 } })
    return { ok: false, reason: 'Incorrect OTP' }
  }

  // Clear OTP
  await User.findByIdAndUpdate(userId, {
    $unset: { otp: 1, otpExpiry: 1 },
    otpAttempts: 0,
    lastLoginAt:  new Date(),
    lastActiveAt: new Date(),
    $inc: { loginCount: 1 },
  })
  return { ok: true }
}
