'use client'
import { useEffect, useRef } from 'react'

/**
 * Keep list pages fresh without manual reload.
 * - Polls every `intervalMs` (default 20s)
 * - Refetches when tab visibility returns to visible
 * - Refetches on window focus
 * - Skips if document is hidden (saves bandwidth)
 *
 * Usage:
 *   useAutoRefresh(fetchLeaves)
 *   useAutoRefresh(fetchExpenses, { intervalMs: 30_000 })
 */
export function useAutoRefresh(
  refetch: () => void | Promise<void>,
  opts: { intervalMs?: number; enabled?: boolean } = {}
) {
  const { intervalMs = 20_000, enabled = true } = opts
  const refetchRef = useRef(refetch)
  refetchRef.current = refetch

  useEffect(() => {
    if (!enabled) return

    const safeFetch = () => {
      if (document.visibilityState === 'visible') refetchRef.current()
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') refetchRef.current()
    }
    const onFocus = () => refetchRef.current()

    const id = setInterval(safeFetch, intervalMs)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('focus', onFocus)

    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('focus', onFocus)
    }
  }, [intervalMs, enabled])
}
