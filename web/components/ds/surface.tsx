import React from 'react'
import * as RadixAvatar from '@radix-ui/react-avatar'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/ds/cn'
import { Icon } from './icon'

/** Flat tonal surface (no shadow). Elevation tokens are reserved for floating layers (menus, dialogs, sheets, toasts). */
export function Card({ children, className, padded = true, as: Tag = 'div', ...rest }: { children: React.ReactNode; className?: string; padded?: boolean; as?: React.ElementType } & React.HTMLAttributes<HTMLElement>) {
  return <Tag className={cn('rounded-ds-card border border-ds-outline-variant/70 bg-ds-card', padded && 'p-4 sm:p-5', className)} {...rest}>{children}</Tag>
}

const TONE = {
  primary: 'bg-ds-primary-container text-ds-on-primary-container',
  success: 'bg-ds-success-container text-ds-on-success-container',
  warning: 'bg-ds-warning-container text-ds-on-warning-container',
  info: 'bg-ds-info-container text-ds-on-info-container',
  error: 'bg-ds-error-container text-ds-on-error-container',
  neutral: 'bg-ds-surface-container-high text-ds-on-surface-variant',
} as const
export type MetricTone = keyof typeof TONE

/** KPI tile: label, a tabular headline number, optional caption and tone icon. Linkable (renders an <a> when `href`). */
export function MetricCard({ label, value, caption, icon, tone = 'primary', href, emphasis, className }: { label: string; value: string; caption?: string; icon?: LucideIcon; tone?: MetricTone; href?: string; emphasis?: boolean; className?: string }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <span className="text-ds-label-large text-ds-on-surface-variant">{label}</span>
        {icon && <span className={cn('inline-flex h-9 w-9 items-center justify-center rounded-ds-md', TONE[tone])}><Icon icon={icon} size="sm" /></span>}
      </div>
      <div className="ds-tabular mt-3 text-ds-metric-medium text-ds-on-surface">{value}</div>
      {caption && <div className="mt-1 text-ds-body-small text-ds-on-surface-variant">{caption}</div>}
    </>
  )
  const cls = cn('block rounded-ds-card border p-4 transition-colors duration-ds-fast', emphasis ? 'border-ds-primary/40 bg-ds-primary-container/40' : 'border-ds-outline-variant/70 bg-ds-card', href && 'hover:bg-ds-on-surface/[.04]', className)
  return href ? <a href={href} className={cls}>{body}</a> : <div className={cls}>{body}</div>
}

const AVATAR_TINTS = ['bg-ds-chart-1/20', 'bg-ds-chart-2/20', 'bg-ds-chart-3/20', 'bg-ds-chart-4/20', 'bg-ds-chart-5/20', 'bg-ds-chart-6/20']
function tintFor(name: string) { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AVATAR_TINTS[h % AVATAR_TINTS.length] }
export function initialsOf(name: string) { const p = name.trim().split(/\s+/).filter(Boolean); return ((p[0]?.[0] ?? '') + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase() || '?' }

/** Deterministic initials avatar (same name → same tint on every render and platform). */
export function Avatar({ name, src, size = 40, className }: { name: string; src?: string; size?: number; className?: string }) {
  return (
    <RadixAvatar.Root className={cn('inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-ds-full align-middle', className)} style={{ width: size, height: size }}>
      {src && <RadixAvatar.Image src={src} alt={name} className="h-full w-full object-cover" />}
      <RadixAvatar.Fallback delayMs={src ? 300 : 0} aria-label={name} role="img" className={cn('flex h-full w-full items-center justify-center font-semibold text-ds-on-surface', tintFor(name))} style={{ fontSize: Math.max(11, Math.round(size * 0.38)) }}>
        {initialsOf(name)}
      </RadixAvatar.Fallback>
    </RadixAvatar.Root>
  )
}

/** One consistent list row: leading, title/subtitle/meta, trailing; becomes a button/link when interactive. */
export function ListRow({ title, subtitle, meta, leading, trailing, href, onClick, className }: { title: string; subtitle?: string; meta?: string; leading?: React.ReactNode; trailing?: React.ReactNode; href?: string; onClick?: () => void; className?: string }) {
  const inner = (
    <>
      {leading}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ds-title-small text-ds-on-surface">{title}</span>
        {subtitle && <span className="block truncate text-ds-body-medium text-ds-on-surface-variant">{subtitle}</span>}
        {meta && <span className="block truncate text-ds-body-small text-ds-on-surface-variant/80">{meta}</span>}
      </span>
      {trailing}
    </>
  )
  const cls = cn('flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left', (href || onClick) && 'transition-colors duration-ds-fast hover:bg-ds-on-surface/[.04]', className)
  if (href) return <a href={href} className={cls}>{inner}</a>
  if (onClick) return <button type="button" onClick={onClick} className={cls}>{inner}</button>
  return <div className={cls}>{inner}</div>
}

export function List({ children, className, ariaLabel }: { children: React.ReactNode; className?: string; ariaLabel?: string }) {
  return <div role="list" aria-label={ariaLabel} className={cn('divide-y divide-ds-outline-variant/60', className)}>{React.Children.map(children, c => <div role="listitem">{c}</div>)}</div>
}
