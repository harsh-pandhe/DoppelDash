'use client'

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import * as RadixDialog from '@radix-ui/react-dialog'
import * as RadixTooltip from '@radix-ui/react-tooltip'
import * as RadixPopover from '@radix-ui/react-popover'
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { cn } from '@/lib/ds/cn'
import { Button, IconButton } from './button'
import { Icon } from './icon'
import { useDsOptional } from './provider'

const OVERLAY = 'fixed inset-0 z-50 bg-ds-scrim/40 ds-anim-fade'

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children?: React.ReactNode
  footer?: React.ReactNode
  className?: string
}

/** Modal dialog (Radix: focus trap, Esc to close, focus return, aria-labelledby/describedby). */
export function Dialog({ open, onOpenChange, title, description, children, footer, className }: DialogProps) {
  const container = useDsOptional()?.portalContainer ?? undefined
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal container={container}>
        <RadixDialog.Overlay className={OVERLAY} />
        <RadixDialog.Content className={cn('ds-root fixed left-1/2 top-1/2 z-50 w-[calc(100vw-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-ds-dialog bg-ds-surface-container-high p-6 shadow-ds-3 ds-anim-scale', className)}>
          <RadixDialog.Title className="text-ds-headline-small text-ds-on-surface">{title}</RadixDialog.Title>
          {description ? <RadixDialog.Description className="mt-2 text-ds-body-medium text-ds-on-surface-variant">{description}</RadixDialog.Description> : <RadixDialog.Description className="ds-sr-only">{title}</RadixDialog.Description>}
          {children && <div className="mt-4">{children}</div>}
          {footer && <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

/**
 * The one confirmation pattern. `destructive` styles the confirm button as danger. The confirm action may be async:
 * the dialog stays open with the button in a loading state until it settles (no double submit), and closes on success.
 */
export function ConfirmDialog({ open, onOpenChange, title, message, confirmLabel = 'Confirm', cancelLabel = 'Cancel', destructive, onConfirm }: { open: boolean; onOpenChange: (o: boolean) => void; title: string; message: string; confirmLabel?: string; cancelLabel?: string; destructive?: boolean; onConfirm: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false)
  return (
    <Dialog
      open={open}
      onOpenChange={o => { if (!busy) onOpenChange(o) }}
      title={title}
      description={message}
      footer={
        <>
          <Button variant="text" onClick={() => onOpenChange(false)} disabled={busy}>{cancelLabel}</Button>
          <Button variant={destructive ? 'danger' : 'filled'} loading={busy} onClick={async () => { setBusy(true); try { await onConfirm(); onOpenChange(false) } finally { setBusy(false) } }}>{confirmLabel}</Button>
        </>
      }
    />
  )
}

/** Side sheet on wide screens, bottom sheet on narrow ones. Same focus/keyboard behaviour as Dialog. */
export function Sheet({ open, onOpenChange, title, description, children, footer }: Omit<DialogProps, 'className'>) {
  const container = useDsOptional()?.portalContainer ?? undefined
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal container={container}>
        <RadixDialog.Overlay className={OVERLAY} />
        <RadixDialog.Content className="ds-root fixed inset-x-0 bottom-0 z-50 flex max-h-[88vh] flex-col rounded-t-ds-sheet bg-ds-surface-container-low shadow-ds-1 ds-anim-slide-up md:inset-y-0 md:left-auto md:right-0 md:max-h-none md:w-[440px] md:rounded-none md:rounded-l-ds-sheet md:ds-anim-slide-right">
          <div className="flex items-start justify-between gap-3 px-6 pb-2 pt-5">
            <div>
              <RadixDialog.Title className="text-ds-title-large text-ds-on-surface">{title}</RadixDialog.Title>
              {description ? <RadixDialog.Description className="mt-1 text-ds-body-medium text-ds-on-surface-variant">{description}</RadixDialog.Description> : <RadixDialog.Description className="ds-sr-only">{title}</RadixDialog.Description>}
            </div>
            <RadixDialog.Close asChild><IconButton icon={X} label="Close" /></RadixDialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto px-6 py-3">{children}</div>
          {footer && <div className="flex flex-col-reverse gap-2 border-t border-ds-outline-variant px-6 py-4 sm:flex-row sm:justify-end">{footer}</div>}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}

export function Tooltip({ label, children }: { label: string; children: React.ReactElement }) {
  const container = useDsOptional()?.portalContainer ?? undefined
  return (
    <RadixTooltip.Provider delayDuration={400}>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal container={container}>
          <RadixTooltip.Content sideOffset={6} className="ds-root z-50 rounded-ds-tooltip bg-ds-inverse-surface px-2.5 py-1.5 text-ds-body-small text-ds-on-inverse-surface ds-anim-fade">{label}</RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  )
}

/* ── Snackbar / toast ─────────────────────────────────────────────────────────────────────── */
export type ToastType = 'neutral' | 'success' | 'error' | 'info' | 'warning'
interface ToastItem { id: number; type: ToastType; message: string; actionLabel?: string; onAction?: () => void }
interface ToastApi { toast: (t: Omit<ToastItem, 'id'>) => void }
const ToastCtx = createContext<ToastApi | null>(null)

const TOAST_ICON = { success: CheckCircle2, error: XCircle, info: Info, warning: AlertTriangle, neutral: null } as const

/** Transient feedback. Errors persist longer (6s) and are announced assertively; everything else politely (4s). */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const next = useRef(1)
  const dismiss = useCallback((id: number) => setItems(list => list.filter(t => t.id !== id)), [])
  const toast = useCallback((t: Omit<ToastItem, 'id'>) => {
    const id = next.current++
    setItems(list => [...list.slice(-2), { ...t, id }])
    setTimeout(() => dismiss(id), t.type === 'error' ? 6000 : 4000)
  }, [dismiss])
  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4" aria-live="polite" aria-atomic="false">
        {items.map(t => {
          const GlyphIcon = TOAST_ICON[t.type]
          return (
            <div key={t.id} role={t.type === 'error' ? 'alert' : 'status'} className="ds-root ds-anim-rise pointer-events-auto flex w-full max-w-md items-center gap-3 rounded-ds-md bg-ds-inverse-surface px-4 py-3 text-ds-body-medium text-ds-on-inverse-surface shadow-ds-3">
              {GlyphIcon && <Icon icon={GlyphIcon} size="sm" />}
              <span className="flex-1">{t.message}</span>
              {t.actionLabel && <button type="button" onClick={() => { t.onAction?.(); dismiss(t.id) }} className="rounded-ds-sm px-2 py-1 text-ds-label-large text-ds-inverse-primary hover:bg-white/10">{t.actionLabel}</button>}
            </div>
          )
        })}
      </div>
    </ToastCtx.Provider>
  )
}

export function useToast(): ToastApi {
  const v = useContext(ToastCtx)
  if (!v) throw new Error('useToast must be used inside <ToastProvider>')
  return v
}

export function useEscapeKey(onEscape: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onEscape() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [active, onEscape])
}

/**
 * Anchored, non-modal panel (menus, notification list, search results). Focus moves into the panel, Escape and
 * outside-click close it and focus returns to the trigger. `trigger` must be a single focusable element.
 */
export function Popover({ trigger, children, open, onOpenChange, align = 'end', label, className }: { trigger: React.ReactElement; children: React.ReactNode; open?: boolean; onOpenChange?: (open: boolean) => void; align?: 'start' | 'center' | 'end'; label: string; className?: string }) {
  const container = useDsOptional()?.portalContainer ?? undefined
  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal container={container}>
        <RadixPopover.Content aria-label={label} align={align} sideOffset={8} collisionPadding={12} className={cn('ds-anim-rise z-50 w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-ds-card border border-ds-outline-variant bg-ds-card text-ds-on-surface shadow-ds-3', className)}>
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  )
}
