'use client'
import { useEffect, useRef } from 'react'

/**
 * Keep list pages fresh without manual reload.
 * - Polls every `intervalMs` (default 20s)
 * - Refetches when tab visibility returns to visible — ONLY if data is stale
 *   (last fetch older than `minStaleMs`). This stops a full refetch every time
 *   the user switches back to the tab.
 * - Skips if document is hidden (saves bandwidth)
 *
 * The redundant `window focus` listener was removed: `visibilitychange` already
 * covers tab return, and `focus` also fires on in-page window clicks → spurious
 * refetches.
 *
 * Usage:
 *   useAutoRefresh(fetchLeaves)
 *   useAutoRefresh(fetchExpenses, { intervalMs: 30_000 })
 */
export function useAutoRefresh(
  refetch: () => void | Promise<void>,
  opts: { intervalMs?: number; enabled?: boolean; minStaleMs?: number } = {}
) {
  const { intervalMs = 20_000, enabled = true, minStaleMs = 15_000 } = opts
  const refetchRef = useRef(refetch)
  refetchRef.current = refetch
  const lastRef = useRef(Date.now())

  useEffect(() => {
    if (!enabled) return

    const run = () => { lastRef.current = Date.now(); refetchRef.current() }

    const safeFetch = () => {
      if (document.visibilityState === 'visible') run()
    }
    const onVisibility = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastRef.current < minStaleMs) return // recently fetched, skip
      run()
    }

    const id = setInterval(safeFetch, intervalMs)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [intervalMs, enabled, minStaleMs])
}
