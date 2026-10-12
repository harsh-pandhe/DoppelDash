import { NextRequest, NextResponse } from 'next/server'
import { getUser } from '@/lib/auth'
import { connectDB } from '@/lib/db'
import Organization from '@/models/Organization'
import Employee from '@/models/Employee'
import { getOrganizationEntitlements } from '@/lib/entitlements/entitlementService'

/**
 * Session bootstrap — the single call a client makes to learn who it is and what
 * it may do. Everything here is resolved SERVER-SIDE from the verified session;
 * clients consume it and never re-derive plan / access rules themselves.
 *
 * Response shape (backwards compatible: the flat user fields clients already read
 * are still present at the top level):
 *   { …user, user, organization, entitlements, onboarding }
 */
export async function GET(req: NextRequest) {
  const { userId, user, orgId } = await getUser(req)
  if (!userId || !user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  await connectDB()
  const [org, entitlements, employee] = await Promise.all([
    Organization.findOne({ orgId }).select('orgId name slug setupRequired').lean<{ orgId: string; name: string; slug: string; setupRequired?: boolean } | null>(),
    getOrganizationEntitlements(orgId),
    Employee.findOne({ clerkUserId: userId, orgId }).select('onboardingComplete onboardingStep').lean<{ onboardingComplete?: boolean; onboardingStep?: number } | null>(),
  ])

  return NextResponse.json({
    ...user,
    user,
    organization: {
      orgId,
      name: org?.name || entitlements.name,
      slug: org?.slug || null,
    },
    entitlements: {
      plan: entitlements.plan,
      source: entitlements.source,
      lifetimeGrant: entitlements.lifetimeGrant,
      webEnabled: entitlements.webEnabled,
      androidEnabled: entitlements.androidEnabled,
      features: entitlements.features,
      limits: entitlements.limits,
      subscription: {
        status: entitlements.subscription.status,
        currentPeriodEnd: entitlements.subscription.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: Boolean(entitlements.subscription.cancelAtPeriodEnd),
      },
      trial: { status: entitlements.trial.status },
    },
    onboarding: {
      tourSeen: user.tourSeen,
      profileComplete: employee?.onboardingComplete ?? false,
      profileStep: employee?.onboardingStep ?? 0,
      // Only an admin of a freshly self-registered org is asked to finish org setup.
      orgSetupRequired: user.role === 'admin' && org?.setupRequired === true,
    },
  })
}
