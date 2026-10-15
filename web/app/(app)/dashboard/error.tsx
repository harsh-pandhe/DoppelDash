'use client'
import { useEffect } from 'react'
import { AlertOctagon, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

/**
 * Dashboard failure state. Renders inside the application shell (navigation stays usable) and offers a retry.
 * The raw error message is deliberately NOT shown: it can contain internal details. Only the opaque digest is
 * displayed so support can correlate it with server logs.
 */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('[Dashboard]', error) }, [error])
  return (
    <div className="max-w-xl mx-auto px-4 py-16 text-center" role="alert">
      <div className="w-12 h-12 rounded-2xl bg-red-50 border border-red-100 text-red-500 flex items-center justify-center mx-auto mb-4">
        <AlertOctagon className="w-6 h-6" />
      </div>
      <h2 className="text-lg font-bold text-ink">We couldn’t load your dashboard</h2>
      <p className="text-sm text-ink-muted mt-1">Your data is safe. Check your connection and try again.</p>
      {error.digest && <p className="text-[11px] text-surface-muted mt-2">Reference: {error.digest}</p>}
      <Button onClick={reset} className="mt-5 gap-1.5"><RotateCw className="w-4 h-4" /> Try again</Button>
    </div>
  )
}
