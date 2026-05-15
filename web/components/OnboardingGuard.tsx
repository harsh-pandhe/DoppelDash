'use client'
import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'

export default function OnboardingGuard() {
  const router   = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (pathname === '/onboarding') return
    fetch('/api/employees/me')
      .then(r => r.json())
      .then(emp => {
        if (emp && emp.onboardingComplete === false) {
          router.replace('/onboarding')
        }
      })
      .catch(() => {})
  }, [pathname, router])

  return null
}
