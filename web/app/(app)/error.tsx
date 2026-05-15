'use client'
import { useEffect } from 'react'
import { AlertOctagon, RotateCw, Home } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[App Error]', error)
  }, [error])

  return (
    <div className="min-h-screen flex items-center justify-center p-6 bg-gradient-to-br from-red-50 via-white to-orange-50">
      <div className="max-w-md w-full bg-white rounded-3xl shadow-xl border border-red-100 overflow-hidden">
        <div className="bg-gradient-to-r from-red-500 to-rose-600 px-6 py-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
            <AlertOctagon className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Something broke</h2>
            <p className="text-xs text-red-100">We hit an unexpected error.</p>
          </div>
        </div>

        <div className="p-6 space-y-4">
          <div className="text-sm text-gray-700 leading-relaxed">
            <p>The page couldn&apos;t finish loading. Try refreshing — if it keeps happening, sign out and back in.</p>
          </div>

          {error.message && (
            <details className="text-[10px] text-surface-muted bg-surface p-3 rounded-xl border border-surface-border">
              <summary className="cursor-pointer font-semibold text-gray-700 mb-1">Technical details</summary>
              <code className="block mt-2 font-mono break-all">{error.message}</code>
              {error.digest && <p className="mt-1 text-surface-muted">Digest: {error.digest}</p>}
            </details>
          )}

          <div className="flex gap-2">
            <Button onClick={reset} className="flex-1 gap-1.5">
              <RotateCw className="w-4 h-4" /> Try again
            </Button>
            <Link href="/dashboard" className="flex-1">
              <Button variant="outline" className="w-full gap-1.5">
                <Home className="w-4 h-4" /> Dashboard
              </Button>
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
