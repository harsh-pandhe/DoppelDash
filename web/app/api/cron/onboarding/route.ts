import { NextRequest, NextResponse } from 'next/server'
import { dbGuard } from '@/lib/http/dbGuard'
import { isCronAuthorized } from '@/lib/cron/auth'
import { connectDB } from '@/lib/db'
import Employee from '@/models/Employee'
import { claim, finish, release, claimableFragment } from '@/lib/cron/claim'
import { emailOnboardingNudge } from '@/lib/email'

// Called by system cron, e.g. daily: 0 9 * * * curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:3000/api/cron/onboarding
// Emails a nudge to employees who joined 7+ days ago but haven't finished onboarding.
// Re-nudges at most once every 7 days (idempotent within the week).
async function GET_handler(req: NextRequest) {
  if (!isCronAuthorized(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  await connectDB()
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

  const candidates = await Employee.find({
    isActive: true,
    onboardingComplete: { $ne: true },
    joiningDate: { $lte: sevenDaysAgo },
    $and: [
      { $or: [{ onboardingNudgeSentAt: { $exists: false } }, { onboardingNudgeSentAt: { $lte: sevenDaysAgo } }] },
      claimableFragment('onboardingNudge', now),
    ],
  }, '_id clerkUserId orgId firstName lastName email joiningDate onboardingStep').lean()
  const coll = Employee.collection as unknown as import('mongodb').Collection<import('mongodb').Document>

  let sent = 0
  for (const e of candidates) {
    if (!e.email) continue
    const daysSinceJoining = Math.floor((now.getTime() - new Date(e.joiningDate).getTime()) / 86400000)
    // ATOMIC LEASE (still due: never nudged, or last nudged 7+ days ago) before sending; the marker is set only after a successful send.
    const claimed = await claim(coll, (e as unknown as { _id: unknown })._id, {
      orgId: e.orgId, onboardingComplete: { $ne: true },
      $or: [{ onboardingNudgeSentAt: { $exists: false } }, { onboardingNudgeSentAt: { $lte: sevenDaysAgo } }],
    }, 'onboardingNudge', now)
    if (!claimed) continue
    try {
      await emailOnboardingNudge({ orgId: e.orgId, employeeEmail: e.email, employeeName: e.firstName || 'there', daysSinceJoining, step: e.onboardingStep || 0 })
      await finish(coll, (e as unknown as { _id: unknown })._id, 'onboardingNudge', { onboardingNudgeSentAt: now })
      sent++
    } catch {
      await release(coll, (e as unknown as { _id: unknown })._id, 'onboardingNudge').catch(() => undefined)
    }
  }

  return NextResponse.json({ sent, candidates: candidates.length })
}

export const GET = dbGuard(GET_handler)
