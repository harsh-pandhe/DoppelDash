/**
 * Send a login OTP through the platform mail provider (lib/mail).
 *
 * Returns whether the message was accepted for delivery. It never throws and
 * never exposes provider errors — callers decide what to tell the user
 * (login/send-otp answer with `emailSent: false` / a generic 503).
 *
 * The code is NOT logged. A developer can opt in locally with
 * AUTH_DEV_LOG_SECRETS=true; that switch is ignored in production and on any
 * deploy platform (see devShortcuts.ts).
 */
import { getMailService } from '@/lib/mail'
import { shouldLogAuthSecrets } from './devShortcuts'

export async function sendOTP(to: string, otp: string, orgId?: string): Promise<boolean> {
  if (shouldLogAuthSecrets()) {
    console.log(`\n🔐 [dev] OTP for ${to}: ${otp}\n`)
  }
  const result = await getMailService().sendOtp({ to, code: otp, orgId })
  return result.delivered
}
