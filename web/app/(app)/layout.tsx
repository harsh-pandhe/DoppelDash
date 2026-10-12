import { redirect } from 'next/navigation'
import { getUser, getOrgId, isWebAccessAllowed } from '@/lib/auth'
import Sidebar from '@/components/layout/Sidebar'
import BottomNav from '@/components/layout/BottomNav'
import { ToastProvider } from '@/components/ui/toast'
import OnboardingGuard from '@/components/OnboardingGuard'
import ShortcutsPanel from '@/components/ShortcutsPanel'
import WelcomeTour from '@/components/WelcomeTour'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { userId, user } = await getUser()
  if (!userId || !user) {
    // getUser() refuses web sessions of organisations without web access. Show the
    // explanation page (instead of a sign-in loop) when the token itself is valid.
    const tokenOrg = await getOrgId()
    if (tokenOrg && !(await isWebAccessAllowed(tokenOrg))) redirect('/web-access-restricted')
    redirect('/sign-in')
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
