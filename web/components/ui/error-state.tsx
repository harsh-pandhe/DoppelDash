import { AlertTriangle, RotateCw } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface ErrorStateProps {
  title?: string
  description?: string
  onRetry?: () => void
  /** 'inline' = compact card in content flow; 'block' = full-height centered. */
  variant?: 'inline' | 'block'
}

/**
 * Standard data-fetch error UI (Phase 9C). Show this when a client fetch
 * fails, with a retry that re-runs the fetch — never leave the page blank.
 */
export function ErrorState({
  title = 'Couldn’t load this',
  description = 'Something went wrong fetching the data. Check your connection and try again.',
  onRetry,
  variant = 'inline',
}: ErrorStateProps) {
  const wrap = variant === 'block' ? 'py-20' : 'py-10'
  return (
    <div className={`flex flex-col items-center justify-center text-center ${wrap}`}>
      <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-red-100 to-rose-200 text-red-500 flex items-center justify-center mb-4 shadow-sm">
        <AlertTriangle className="w-8 h-8" />
      </div>
      <p className="text-base font-bold text-ink mb-1">{title}</p>
      <p className="text-sm text-surface-muted max-w-md mb-5">{description}</p>
      {onRetry && (
        <Button onClick={onRetry} variant="outline" className="gap-2">
          <RotateCw className="w-4 h-4" /> Try again
        </Button>
      )}
    </div>
  )
}
