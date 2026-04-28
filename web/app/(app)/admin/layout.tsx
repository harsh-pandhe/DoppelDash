import { auth, currentUser } from '@clerk/nextjs/server'
import { redirect } from 'next/navigation'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { userId } = await auth()
  if (!userId) redirect('/sign-in')
  const user = await currentUser().catch(() => null)
  const role = (user?.unsafeMetadata?.role as string) || 'employee'
  if (role !== 'boss') redirect('/dashboard')
  return <>{children}</>
}
