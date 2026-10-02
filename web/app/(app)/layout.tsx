import { redirect } from 'next/navigation'
import { getUser } from '@/lib/auth'
import { getOrganizationEntitlements } from '@/lib/entitlements/entitlementService'
import Sidebar from '@/components/layout/Sidebar'
import BottomNav from '@/components/layout/BottomNav'
import { ToastProvider } from '@/components/ui/toast'
import OnboardingGuard from '@/components/OnboardingGuard'
import ShortcutsPanel from '@/components/ShortcutsPanel'
import WelcomeTour from '@/components/WelcomeTour'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { userId, user } = await getUser()
  if (!userId || !user) redirect('/sign-in')

  const orgId = user.orgId || 'org_doppelmayr'
  const entitlements = await getOrganizationEntitlements(orgId)
  if (!entitlements.webEnabled) {
    redirect('/web-access-restricted')
  }

  return (
    <ToastProvider>
      <OnboardingGuard />
      <div className="flex h-screen overflow-hidden">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0 overflow-y-auto app-bg scrollbar-thin pb-16 md:pb-0">
          {children}
        </div>
      </div>
      <BottomNav />
      <ShortcutsPanel />
      <WelcomeTour />
    </ToastProvider>
  )
}
