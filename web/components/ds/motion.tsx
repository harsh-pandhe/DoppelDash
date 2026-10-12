'use client'

import React, { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/ds/cn'
import { Icon } from './icon'

export type RevealKind = 'rise' | 'fade' | 'scale' | 'slide-right' | 'slide-left' | 'slide-up'

/**
 * First-appearance animation (fade + small movement). `index` staggers siblings by 40ms (capped at 6 so a long
 * list never delays content). Under reduced motion the base layer degrades it to a 90ms fade.
 */
export function Reveal({ children, kind = 'rise', index = 0, className, as: Tag = 'div' }: { children: React.ReactNode; kind?: RevealKind; index?: number; className?: string; as?: React.ElementType }) {
  const delay = Math.min(Math.max(index, 0), 6) * 40
  return <Tag className={cn(`ds-anim-${kind}`, className)} style={delay ? { animationDelay: `${delay}ms` } : undefined}>{children}</Tag>
}

/** Mount/unmount with an exit animation (banners, list rows, inline validation). Children are removed after the exit. */
export function Presence({ show, children, className }: { show: boolean; children: React.ReactNode; className?: string }) {
  const [mounted, setMounted] = useState(show)
  useEffect(() => { if (show) setMounted(true) }, [show])
  if (!mounted) return null
  return (
    <div className={cn('ds-collapse', className)} data-open={show ? 'true' : 'false'} onTransitionEnd={e => { if (!show && e.target === e.currentTarget) setMounted(false) }}>
      <div>{children}</div>
    </div>
  )
}

/** Expandable section: header button (aria-expanded) + animated body. */
export function Expandable({ title, subtitle, children, defaultOpen = false, className }: { title: string; subtitle?: string; children: React.ReactNode; defaultOpen?: boolean; className?: string }) {
  const [open, setOpen] = useState(defaultOpen)
  const id = React.useId()
  return (
    <div className={className}>
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)} className="flex min-h-12 w-full items-center justify-between gap-3 rounded-ds-md py-2 text-left">
        <span>
          <span className="block text-ds-title-medium text-ds-on-surface">{title}</span>
          {subtitle && <span className="block text-ds-body-small text-ds-on-surface-variant">{subtitle}</span>}
        </span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden className={cn('shrink-0 text-ds-on-surface-variant transition-transform duration-ds-base ease-ds-standard', open && 'rotate-180')}><path d="m6 9 6 6 6-6" /></svg>
      </button>
      <div id={id} role="region" className="ds-collapse" data-open={open ? 'true' : 'false'}><div>{open && <div className="pb-2 pt-1">{children}</div>}</div></div>
    </div>
  )
}

/** Success feedback: a tonal disc that pops in with a check. Static under reduced motion. */
export function SuccessMark({ size = 56, label = 'Success' }: { size?: number; label?: string }) {
  return (
    <span role="img" aria-label={label} className="ds-anim-pop inline-flex items-center justify-center rounded-ds-full bg-ds-success-container text-ds-on-success-container" style={{ width: size, height: size }}>
      <Icon icon={Check} size={size >= 48 ? 'lg' : 'md'} />
    </span>
  )
}
