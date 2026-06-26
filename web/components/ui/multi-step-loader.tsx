'use client'
import { useEffect, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Multi-step loader (Aceternity-style). Shows an ordered checklist that advances
 * automatically on a timer while a real async task runs underneath. Use to make
 * long, otherwise-blank transitions (sign-in → dashboard) feel responsive.
 *
 * It is purely visual: it does NOT gate the real work. When `loading` flips to
 * false the parent unmounts it. `durationMs` is the per-step dwell time.
 */
export interface LoaderStep { text: string }

export function MultiStepLoader({
  steps,
  loading,
  durationMs = 900,
  loop = false,
}: {
  steps: LoaderStep[]
  loading: boolean
  durationMs?: number
  loop?: boolean
}) {
  const [current, setCurrent] = useState(0)

  useEffect(() => {
    if (!loading) { setCurrent(0); return }
    if (current >= steps.length - 1 && !loop) return
    const id = setTimeout(() => {
      setCurrent((c) => (loop ? (c + 1) % steps.length : Math.min(c + 1, steps.length - 1)))
    }, durationMs)
    return () => clearTimeout(id)
  }, [current, loading, steps.length, durationMs, loop])

  if (!loading) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-bg/80 backdrop-blur-md">
      <div className="w-full max-w-sm px-8">
        <ul className="space-y-3">
          {steps.map((step, i) => {
            const done = i < current
            const active = i === current
            return (
              <li
                key={i}
                className={cn(
                  'flex items-center gap-3 rounded-xl px-4 py-3 transition-all duration-300',
                  active && 'bg-surface-1 border border-surface-border shadow-sm scale-[1.02]',
                  !active && 'opacity-50',
                )}
              >
                <span
                  className={cn(
                    'flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full transition-colors',
                    done && 'bg-emerald-500 text-white',
                    active && 'bg-primary text-white',
                    !done && !active && 'bg-surface-border text-muted',
                  )}
                >
                  {done ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : active ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                  )}
                </span>
                <span
                  className={cn(
                    'text-sm font-medium transition-colors',
                    active ? 'text-ink' : done ? 'text-muted' : 'text-muted',
                  )}
                >
                  {step.text}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}
