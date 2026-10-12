'use client'

import React, { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Info, WifiOff, X, XCircle } from 'lucide-react'
import { cn } from '@/lib/ds/cn'
import { Button } from './button'
import { Icon } from './icon'
import { IconButton } from './button'
import { Illustration } from './illustration'
import type { Art } from './illustration'

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('ds-skeleton', className)} />
}

/** Lines of placeholder text. Announced once as "Loading" for assistive tech (not once per line). */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn('space-y-2', className)}>
      {Array.from({ length: lines }, (_, i) => <Skeleton key={i} className={cn('h-3', i === lines - 1 ? 'w-2/3' : 'w-full')} />)}
    </div>
  )
}

export function SkeletonCard({ className }: { className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn('rounded-ds-card border border-ds-outline-variant/70 bg-ds-card p-4', className)}>
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-4 h-8 w-32" />
      <Skeleton className="mt-3 h-3 w-20" />
    </div>
  )
}

/** Empty state: one restrained illustration, one title, one sentence, optional action. */
export function EmptyState({ art = 'empty', title, message, action, compact, className }: { art?: Art; title: string; message: string; action?: React.ReactNode; compact?: boolean; className?: string }) {
  return (
    <div className={cn('mx-auto flex max-w-sm flex-col items-center text-center', compact ? 'px-6 py-6' : 'px-6 py-12', className)}>
      <Illustration art={art} size={compact ? 104 : 144} />
      <h3 className={cn('text-ds-title-medium text-ds-on-surface', compact ? 'mt-3' : 'mt-5')}>{title}</h3>
      <p className="mt-1.5 text-ds-body-medium text-ds-on-surface-variant">{message}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

export function ErrorState({ title, message, onRetry, offline, compact }: { title?: string; message?: string; onRetry?: () => void | Promise<void>; offline?: boolean; compact?: boolean }) {
  const [busy, setBusy] = useState(false)
  return (
    <EmptyState
      art={offline ? 'offline' : 'error'}
      compact={compact}
      title={title ?? (offline ? 'You’re offline' : 'Couldn’t load this')}
      message={message ?? (offline ? 'Check your connection and try again. Your data is safe.' : 'Something went wrong on our side. Try again in a moment.')}
      action={onRetry ? <Button variant="tonal" loading={busy} onClick={async () => { setBusy(true); try { await onRetry() } finally { setBusy(false) } }}>Try again</Button> : undefined}
    />
  )
}

/** Access denied (role, plan or client): says WHAT is unavailable and what to do — never a blank page. */
export function ForbiddenState({ title = 'You don’t have access', message = 'Your role doesn’t include this area. Ask an administrator if you need it.', action, compact }: { title?: string; message?: string; action?: React.ReactNode; compact?: boolean }) {
  return <EmptyState art="forbidden" title={title} message={message} action={action} compact={compact} />
}

export type BannerRole = 'error' | 'warning' | 'info' | 'success'
const BANNER: Record<BannerRole, { box: string; icon: typeof Info }> = {
  error: { box: 'bg-ds-error-container text-ds-on-error-container', icon: XCircle },
  warning: { box: 'bg-ds-warning-container text-ds-on-warning-container', icon: AlertTriangle },
  info: { box: 'bg-ds-info-container text-ds-on-info-container', icon: Info },
  success: { box: 'bg-ds-success-container text-ds-on-success-container', icon: CheckCircle2 },
}

/** Inline banner above still-useful content. Errors are announced assertively (role=alert); others politely (role=status). */
export function Banner({ role = 'info', children, action, onDismiss, className }: { role?: BannerRole; children: React.ReactNode; action?: React.ReactNode; onDismiss?: () => void; className?: string }) {
  const s = BANNER[role]
  return (
    <div role={role === 'error' ? 'alert' : 'status'} className={cn('flex items-start gap-3 rounded-ds-md px-4 py-3 text-ds-body-medium', s.box, className)}>
      <Icon icon={s.icon} size="sm" className="mt-0.5" />
      <div className="min-w-0 flex-1">{children}</div>
      {action}
      {onDismiss && <IconButton icon={X} label="Dismiss" onClick={onDismiss} className="-my-1 -mr-2 h-8 w-8 text-current" />}
    </div>
  )
}

/** Shows itself only while the browser reports no connection. */
export function OfflineBanner({ className }: { className?: string }) {
  const [online, setOnline] = useState(true)
  useEffect(() => {
    const sync = () => setOnline(navigator.onLine)
    sync()
    window.addEventListener('online', sync); window.addEventListener('offline', sync)
    return () => { window.removeEventListener('online', sync); window.removeEventListener('offline', sync) }
  }, [])
  if (online) return null
  return (
    <div role="status" className={cn('flex items-center gap-3 rounded-ds-md bg-ds-inverse-surface px-4 py-3 text-ds-body-medium text-ds-on-inverse-surface', className)}>
      <Icon icon={WifiOff} size="sm" /> You’re offline — changes will sync when you’re back.
    </div>
  )
}
