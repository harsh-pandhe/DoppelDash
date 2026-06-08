import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Employee from '@/models/Employee'
import { emailOnboardingNudge } from '@/lib/email'

// Called by system cron, e.g. daily: 0 9 * * * curl http://localhost:3000/api/cron/onboarding?secret=<CRON_SECRET>
// Emails a nudge to employees who joined 7+ days ago but haven't finished onboarding.
// Re-nudges at most once every 7 days (idempotent within the week).
export async function GET(req: NextRequest) {
  const secret = req.nextUrl.searchParams.get('secret')
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await connectDB()
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  const candidates = await Employee.find({
    isActive: true,
    onboardingComplete: { $ne: true },
    joiningDate: { $lte: sevenDaysAgo },
    $or: [
      { onboardingNudgeSentAt: { $exists: false } },
      { onboardingNudgeSentAt: { $lte: sevenDaysAgo } },
    ],
  }, 'clerkUserId firstName lastName email joiningDate onboardingStep').lean()

  let sent = 0
  for (const e of candidates) {
    if (!e.email) continue
    const daysSinceJoining = Math.floor((now.getTime() - new Date(e.joiningDate).getTime()) / 86400000)
    try {
      await emailOnboardingNudge({
        employeeEmail: e.email,
        employeeName: e.firstName || 'there',
        daysSinceJoining,
        step: e.onboardingStep || 0,
      })
      await Employee.updateOne({ clerkUserId: e.clerkUserId }, { onboardingNudgeSentAt: now })
      sent++
    } catch { /* best-effort, retry next run */ }
  }

  return NextResponse.json({ sent, candidates: candidates.length })
}
