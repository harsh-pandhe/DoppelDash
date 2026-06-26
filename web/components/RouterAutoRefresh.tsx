'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

/**
 * Drop into server-component pages to re-fetch their server data when:
 * - Tab becomes visible again (only if data is stale — see `minStaleMs`)
 * - Every `intervalMs` (default 30s)
 *
 * Triggers Next's `router.refresh()` (server roundtrip, server components re-render).
 *
 * `minStaleMs` (default 20s) suppresses a refresh on tab re-focus when the last
 * refresh happened recently. This is what stops "the whole page reloads every
 * time I switch back to the tab". The redundant `window focus` listener was
 * removed for the same reason — `visibilitychange` already covers tab return,
 * while `focus` also fires on trivial in-page window clicks.
 */
export default function RouterAutoRefresh({
  intervalMs = 30_000,
  minStaleMs = 20_000,
}: { intervalMs?: number; minStaleMs?: number }) {
  const router  = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router
  const lastRef = useRef(Date.now())

  useEffect(() => {
    const refresh = () => { lastRef.current = Date.now(); routerRef.current.refresh() }
    const onVis = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastRef.current < minStaleMs) return // recently refreshed, skip
      refresh()
    }
    const id = setInterval(() => { if (document.visibilityState === 'visible') refresh() }, intervalMs)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [intervalMs, minStaleMs])
  return null
}
