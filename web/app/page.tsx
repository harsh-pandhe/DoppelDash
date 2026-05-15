import { redirect } from 'next/navigation'
import { getUserId } from '@/lib/auth'

export default async function RootPage() {
  const userId = await getUserId()
  if (userId) redirect('/dashboard')
  redirect('/sign-in')
}
