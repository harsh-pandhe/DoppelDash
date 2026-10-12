'use client'

import React, { useId, useRef } from 'react'
import * as RadixTabs from '@radix-ui/react-tabs'
import { Check } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/ds/cn'
import { STATUS_ROLE } from '@/lib/ds/tokens'
import type { StatusRole } from '@/lib/ds/tokens'
import { Icon } from './icon'

/** Toggle chip. Selection is shown by tone AND a check mark — never colour alone. */
export function Chip({ label, selected = false, onSelectedChange, icon, count, disabled, className }: { label: string; selected?: boolean; onSelectedChange?: (v: boolean) => void; icon?: LucideIcon; count?: number; disabled?: boolean; className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={() => onSelectedChange?.(!selected)}
      className={cn(
        'relative inline-flex min-h-8 items-center gap-1.5 rounded-ds-chip border px-3 text-ds-label-large transition-colors duration-ds-fast ease-ds-standard before:absolute before:-inset-x-0.5 before:-inset-y-2 before:content-[""] disabled:opacity-[0.38] disabled:cursor-not-allowed',
        selected ? 'border-transparent bg-ds-secondary-container text-ds-on-secondary-container' : 'border-ds-outline-variant text-ds-on-surface hover:bg-ds-on-surface/[.08]',
        className,
      )}
    >
      {selected ? <Icon icon={Check} size="xs" /> : icon ? <Icon icon={icon} size="xs" /> : null}
      <span>{label}</span>
      {count !== undefined && <span className="ds-tabular text-ds-label-medium opacity-80" aria-label={`${count} items`}>{count}</span>}
    </button>
  )
}

/** Row of filter chips. `multi` toggles independently; otherwise it is single-select. `allLabel` adds a leading "all". */
export function FilterBar<T extends string>({ options, selected, onChange, multi = false, allLabel, ariaLabel = 'Filters', className }: { options: Record<T, string>; selected: T[]; onChange: (next: T[]) => void; multi?: boolean; allLabel?: string; ariaLabel?: string; className?: string }) {
  const toggle = (v: T, on: boolean) => {
    if (multi) onChange(on ? [...selected, v] : selected.filter(x => x !== v))
    else onChange(on ? [v] : [])
  }
  return (
    <div role="group" aria-label={ariaLabel} className={cn('flex flex-wrap items-center gap-2', className)}>
      {allLabel && <Chip label={allLabel} selected={selected.length === 0} onSelectedChange={() => onChange([])} />}
      {(Object.keys(options) as T[]).map(k => <Chip key={k} label={options[k]} selected={selected.includes(k)} onSelectedChange={on => toggle(k, on)} />)}
    </div>
  )
}

const ROLE_STYLE: Record<StatusRole, { box: string; dot: string }> = {
  success: { box: 'bg-ds-success-container text-ds-on-success-container', dot: 'bg-ds-success' },
  warning: { box: 'bg-ds-warning-container text-ds-on-warning-container', dot: 'bg-ds-warning' },
  info: { box: 'bg-ds-info-container text-ds-on-info-container', dot: 'bg-ds-info' },
  error: { box: 'bg-ds-error-container text-ds-on-error-container', dot: 'bg-ds-error' },
  tertiary: { box: 'bg-ds-tertiary-container text-ds-on-tertiary-container', dot: 'bg-ds-tertiary' },
  neutral: { box: 'bg-ds-surface-container-highest text-ds-on-surface-variant', dot: 'bg-ds-outline' },
}

/** Status pill. `status` maps a domain key (pending_manager, paid…) through the shared status→role table used by BOTH clients. */
export function StatusBadge({ label, status, role, className }: { label: string; status?: string; role?: StatusRole; className?: string }) {
  const resolved: StatusRole = role ?? ((status && (STATUS_ROLE as Record<string, string>)[status]) as StatusRole | undefined) ?? 'neutral'
  const s = ROLE_STYLE[resolved]
  return (
    <span className={cn('inline-flex max-w-full items-center gap-1.5 rounded-ds-badge px-2.5 py-1 text-ds-label-medium font-semibold', s.box, className)} data-role={resolved}>
      <span aria-hidden className={cn('h-1.5 w-1.5 shrink-0 rounded-ds-full', s.dot)} />
      <span className="ds-sr-only">Status: </span>
      <span className="truncate">{label}</span>
    </span>
  )
}

export function CountBadge({ count, max = 99, className }: { count: number; max?: number; className?: string }) {
  if (count <= 0) return null
  return <span aria-label={`${count} pending`} className={cn('inline-flex min-h-5 min-w-5 items-center justify-center rounded-ds-badge bg-ds-primary px-1.5 text-ds-label-small font-bold text-ds-on-primary ds-tabular', className)}>{count > max ? `${max}+` : count}</span>
}

/** Segmented control (2–4 exclusive views): a radiogroup with arrow-key navigation (roving focus). */
export function Segmented<T extends string>({ options, value, onChange, ariaLabel, className }: { options: Record<T, string>; value: T; onChange: (v: T) => void; ariaLabel: string; className?: string }) {
  const keys = Object.keys(options) as T[]
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (i + 1) % keys.length : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (i - 1 + keys.length) % keys.length : -1
    if (next >= 0) { e.preventDefault(); onChange(keys[next]); refs.current[keys[next]]?.focus() }
  }
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn('inline-flex max-w-full overflow-x-auto rounded-ds-button border border-ds-outline-variant', className)}>
      {keys.map((k, i) => {
        const on = k === value
        return (
          <button
            key={k}
            ref={el => { refs.current[k] = el }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(k)}
            onKeyDown={e => onKey(e, i)}
            className={cn('inline-flex min-h-10 items-center gap-1.5 whitespace-nowrap px-4 text-ds-label-large transition-colors duration-ds-fast', i > 0 && 'border-l border-ds-outline-variant', on ? 'bg-ds-secondary-container text-ds-on-secondary-container' : 'text-ds-on-surface hover:bg-ds-on-surface/[.08]')}
          >
            {on && <Icon icon={Check} size="xs" />}{options[k]}
          </button>
        )
      })}
    </div>
  )
}

/** Tabs (Radix: roving tabindex, arrow keys, aria-selected). Bodies fade in. */
export function Tabs({ tabs, defaultValue, ariaLabel, className }: { tabs: { value: string; label: string; content: React.ReactNode }[]; defaultValue?: string; ariaLabel: string; className?: string }) {
  return (
    <RadixTabs.Root defaultValue={defaultValue ?? tabs[0]?.value} className={className}>
      <RadixTabs.List aria-label={ariaLabel} className="flex gap-1 overflow-x-auto border-b border-ds-outline-variant">
        {tabs.map(t => (
          <RadixTabs.Trigger key={t.value} value={t.value} className="relative min-h-12 whitespace-nowrap px-4 text-ds-label-large text-ds-on-surface-variant transition-colors duration-ds-fast hover:text-ds-on-surface data-[state=active]:text-ds-primary data-[state=active]:after:absolute data-[state=active]:after:inset-x-3 data-[state=active]:after:bottom-0 data-[state=active]:after:h-0.5 data-[state=active]:after:rounded-ds-full data-[state=active]:after:bg-ds-primary data-[state=active]:after:content-['']">
            {t.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
      {tabs.map(t => <RadixTabs.Content key={t.value} value={t.value} className="ds-anim-fade pt-4 outline-none">{t.content}</RadixTabs.Content>)}
    </RadixTabs.Root>
  )
}

export function useStableId(prefix: string) { return `${prefix}-${useId()}` }
