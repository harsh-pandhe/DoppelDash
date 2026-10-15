import React from 'react'
import { cn } from '@/lib/ds/cn'

export interface BarDatum { label: string; value: number; /** Short label under the bar (e.g. "Mon 6"). */ short?: string; highlight?: boolean }

/**
 * Accessible column chart for small, real series (e.g. people on leave per day).
 *  - role="img" with a text summary; the same numbers are in a visually hidden table
 *  - every bar carries its VALUE as text, and "today" is outlined — meaning never depends on colour alone
 *  - bars grow subtly from the baseline (token duration; reduced motion → fade)
 *  - renders an explicit empty state instead of an empty frame
 */
export function BarChart({ data, ariaLabel, valueNoun = 'items', height = 120, emptyMessage = 'Nothing to show for this period.', className }: { data: BarDatum[]; ariaLabel: string; valueNoun?: string; height?: number; emptyMessage?: string; className?: string }) {
  const max = Math.max(1, ...data.map(d => d.value))
  const total = data.reduce((s, d) => s + d.value, 0)
  if (data.length === 0 || total === 0) {
    return <p role="status" className={cn('rounded-ds-md bg-ds-surface-container-low px-4 py-6 text-center text-ds-body-medium text-ds-on-surface-variant', className)}>{emptyMessage}</p>
  }
  const peak = data.reduce((a, b) => (b.value > a.value ? b : a), data[0])
  const summary = `${ariaLabel}. ${total} ${valueNoun} in total; highest on ${peak.label} with ${peak.value}.`
  return (
    <figure className={className}>
      <div role="img" aria-label={summary} className="flex items-end gap-1.5" style={{ height }}>
        {data.map(d => (
          <div key={d.label} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" aria-hidden>
            <span className="ds-tabular text-ds-label-small text-ds-on-surface-variant">{d.value > 0 ? d.value : ''}</span>
            <div
              className={cn('ds-anim-grow-y w-full rounded-t-ds-xs', d.highlight ? 'bg-ds-primary ring-2 ring-ds-primary/40' : d.value > 0 ? 'bg-ds-primary/70' : 'bg-ds-surface-container-high')}
              style={{ height: `${Math.max(4, (d.value / max) * (height - 36))}px` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5" aria-hidden>{data.map(d => <span key={d.label} className={cn('min-w-0 flex-1 truncate text-center text-ds-label-small', d.highlight ? 'font-semibold text-ds-on-surface' : 'text-ds-on-surface-variant')}>{d.short ?? d.label}</span>)}</div>
      <figcaption className="ds-sr-only">
        <table><caption>{ariaLabel}</caption><thead><tr><th>Period</th><th>{valueNoun}</th></tr></thead><tbody>{data.map(d => <tr key={d.label}><td>{d.label}</td><td>{d.value}</td></tr>)}</tbody></table>
      </figcaption>
    </figure>
  )
}

/** Labelled meter (used / total). Text always states the numbers; the bar is supporting visual. */
export function Meter({ label, value, max, valueText, tone = 'primary', className }: { label: string; value: number; max: number; valueText?: string; tone?: 'primary' | 'success' | 'warning' | 'error'; className?: string }) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100))
  const fill = { primary: 'bg-ds-primary', success: 'bg-ds-success', warning: 'bg-ds-warning', error: 'bg-ds-error' }[tone]
  return (
    <div className={className}>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="text-ds-label-large text-ds-on-surface">{label}</span>
        <span className="ds-tabular text-ds-label-large text-ds-on-surface-variant">{valueText ?? `${value} of ${max}`}</span>
      </div>
      <div role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={max} aria-valuenow={Math.min(value, max)} aria-valuetext={valueText ?? `${value} of ${max}`} className="h-2 overflow-hidden rounded-ds-full bg-ds-surface-container-highest">
        <div className={cn('ds-anim-grow-x h-full rounded-ds-full', fill)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}
