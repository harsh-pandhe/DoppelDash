'use client'
import { useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

/**
 * Drop into server-component pages to re-fetch their server data when:
 * - Tab regains focus
 * - Every `intervalMs` (default 30s)
 *
 * Triggers Next's `router.refresh()` (server roundtrip, server components re-render).
 */
export default function RouterAutoRefresh({ intervalMs = 30_000 }: { intervalMs?: number }) {
  const router  = useRouter()
  const routerRef = useRef(router)
  routerRef.current = router

  useEffect(() => {
    const refresh = () => routerRef.current.refresh()
    const onVis   = () => { if (document.visibilityState === 'visible') refresh() }
    const onFocus = () => refresh()
    const id = setInterval(() => { if (document.visibilityState === 'visible') refresh() }, intervalMs)
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('focus', onFocus)
    }
  }, [intervalMs])
  return null
}
