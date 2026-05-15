'use client'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { useCallback } from 'react'

/**
 * Two-way bind a query param to a state value.
 * Refreshes preserve the value; updates push to URL without scroll.
 *
 * Usage:
 *   const [filter, setFilter] = useUrlState('filter', 'all')
 */
export function useUrlState(key: string, defaultValue: string = ''): [string, (v: string) => void] {
  const router       = useRouter()
  const pathname     = usePathname()
  const searchParams = useSearchParams()
  const value = searchParams.get(key) ?? defaultValue

  const setValue = useCallback((v: string) => {
    const params = new URLSearchParams(searchParams.toString())
    if (!v || v === defaultValue) params.delete(key)
    else params.set(key, v)
    const qs = params.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [key, defaultValue, pathname, router, searchParams])

  return [value, setValue]
}
