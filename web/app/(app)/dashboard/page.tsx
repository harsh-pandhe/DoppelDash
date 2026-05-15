export const dynamic = 'force-dynamic'
import { redirect } from 'next/navigation'
import { getUser } from '@/lib/auth'
import Header from '@/components/layout/Header'
import RouterAutoRefresh from '@/components/RouterAutoRefresh'
import ManagerDashboard  from './_components/ManagerDashboard'
import EmployeeDashboard from './_components/EmployeeDashboard'
import BossDashboard     from './_components/BossDashboard'

export default async function DashboardPage() {
  const { userId, user } = await getUser()
  if (!userId) redirect('/sign-in')

  const role      = user?.role || 'employee'
  const firstName = user?.firstName || 'there'

  // Role-specific dashboards
  return (
    <>
      <Header title="Dashboard" />
      <RouterAutoRefresh intervalMs={30_000} />
      {role === 'boss'    && <BossDashboard     firstName={firstName} />}
      {role === 'manager' && <ManagerDashboard  userId={userId} firstName={firstName} isBoss={false} />}
      {role === 'employee'&& <EmployeeDashboard userId={userId} firstName={firstName} />}
    </>
  )
}
