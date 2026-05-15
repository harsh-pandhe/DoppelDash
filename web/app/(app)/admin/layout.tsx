import { redirect } from 'next/navigation'
import { getUser } from '@/lib/auth'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { userId, user } = await getUser()
  if (!userId) redirect('/sign-in')
  if (user?.role !== 'boss') redirect('/dashboard')
  return <>{children}</>
}
