import { cn } from '@/lib/utils'

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-lg bg-surface-border', className)} />
}

export function CardSkeleton() {
  return (
    <div className="bg-surface-1 rounded-2xl border border-surface-border p-4 space-y-3">
      <div className="flex items-center gap-3">
        <Skeleton className="w-10 h-10 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-4/5" />
    </div>
  )
}

export function StatSkeleton() {
  return (
    <div className="bg-surface-1 rounded-2xl border border-surface-border p-5 flex items-center gap-4">
      <Skeleton className="w-12 h-12 rounded-xl" />
      <div className="space-y-2">
        <Skeleton className="h-7 w-12" />
        <Skeleton className="h-3 w-24" />
      </div>
    </div>
  )
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="bg-surface-1 rounded-2xl border border-surface-border p-4 flex items-start gap-4">
          <Skeleton className="w-10 h-10 rounded-xl flex-shrink-0" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="bg-surface-1 rounded-2xl border border-surface-border overflow-hidden">
      <div className="border-b border-surface-border p-4 flex gap-4">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="border-b border-surface-border last:border-0 p-4 flex gap-4 items-center">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} className={cn('h-4 flex-1', c === 0 && 'max-w-[40%]')} />
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * Full route-segment loading skeleton. Mirrors the in-page Header + content
 * layout so navigating to a segment shows structure, not a blank flash.
 * Use inside app/(group)/<seg>/loading.tsx.
 */
export function PageSkeleton({
  variant = 'list',
  rows = 6,
}: {
  variant?: 'list' | 'cards' | 'stats' | 'table' | 'detail'
  rows?: number
}) {
  return (
    <>
      {/* Header bar mirror */}
      <div className="sticky top-0 z-10 bg-surface-1/80 backdrop-blur-xl border-b border-surface-border px-4 md:px-8 py-4 flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
        <Skeleton className="h-10 w-10 rounded-xl" />
      </div>

      <div className="px-4 md:px-8 py-6 space-y-6">
        {(variant === 'stats' || variant === 'cards') && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => <StatSkeleton key={i} />)}
          </div>
        )}

        {variant === 'cards' && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: rows }).map((_, i) => <CardSkeleton key={i} />)}
          </div>
        )}

        {variant === 'list' && <ListSkeleton rows={rows} />}

        {variant === 'table' && <TableSkeleton rows={rows} />}

        {variant === 'detail' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <div className="bg-surface-1 rounded-2xl border border-surface-border p-6 space-y-4">
                <Skeleton className="h-6 w-1/2" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-4 w-3/4" />
              </div>
              <CardSkeleton />
            </div>
            <div className="space-y-4">
              <CardSkeleton />
              <CardSkeleton />
            </div>
          </div>
        )}
      </div>
    </>
  )
}
