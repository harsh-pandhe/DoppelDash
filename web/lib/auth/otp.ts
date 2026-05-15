import { connectDB } from '@/lib/db'
import User from '@/models/User'

const OTP_EXPIRY_MINUTES = 10
const MAX_ATTEMPTS = 5

/** Generate a 6-digit OTP, save hashed copy to user, return plain OTP */
export async function generateOTP(userId: string): Promise<string> {
  await connectDB()
  const otp    = String(Math.floor(100000 + Math.random() * 900000))
  const expiry = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60_000)

  await User.findByIdAndUpdate(userId, {
    otp,
    otpExpiry:   expiry,
    otpAttempts: 0,
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

  if (user.otp !== candidate) {
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
