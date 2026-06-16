'use client'
import * as Dialog from '@radix-ui/react-dialog'
import { X, type LucideIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import React from 'react'

const WIDTHS = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
} as const

interface ModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
  /** Width preset. Forms default to xl per Phase 9A standard. */
  size?: keyof typeof WIDTHS
  /** Block backdrop-click + Escape close (use for destructive confirms mid-edit). */
  dismissible?: boolean
  trigger?: React.ReactNode
  className?: string
}

/**
 * Standard app modal (Phase 9A). Consistent width, padding, overflow, and
 * close behavior across every dialog. Escape + backdrop close by default;
 * pass dismissible={false} to require an explicit action.
 *
 * Compose with <ModalHeader> + <ModalBody> + <ModalFooter>.
 */
export function Modal({
  open,
  onOpenChange,
  children,
  size = 'xl',
  dismissible = true,
  trigger,
  className,
}: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      {trigger && <Dialog.Trigger asChild>{trigger}</Dialog.Trigger>}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          onEscapeKeyDown={dismissible ? undefined : (e) => e.preventDefault()}
          onPointerDownOutside={dismissible ? undefined : (e) => e.preventDefault()}
          onInteractOutside={dismissible ? undefined : (e) => e.preventDefault()}
          className={cn(
            'fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
            'w-[calc(100vw-2rem)] bg-white rounded-2xl shadow-2xl',
            'max-h-[90vh] flex flex-col overflow-hidden',
            'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            WIDTHS[size],
            className
          )}
        >
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

interface ModalHeaderProps {
  title: string
  description?: string
  icon?: LucideIcon
  /** Gradient brand header (matches ScanCard). Default is plain white. */
  variant?: 'plain' | 'brand'
  children?: React.ReactNode
}

export function ModalHeader({ title, description, icon: Icon, variant = 'plain', children }: ModalHeaderProps) {
  if (variant === 'brand') {
    return (
      <div className="relative overflow-hidden bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 px-6 py-5 flex-shrink-0">
        <div className="absolute -top-8 -right-8 w-32 h-32 rounded-full bg-white/10 pointer-events-none" />
        <div className="relative z-10 flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {Icon && (
              <div className="w-10 h-10 rounded-xl bg-white/20 flex items-center justify-center flex-shrink-0">
                <Icon className="w-5 h-5 text-white" />
              </div>
            )}
            <div className="min-w-0">
              <Dialog.Title className="text-base font-extrabold text-white truncate">{title}</Dialog.Title>
              {description && <Dialog.Description className="text-brand-200 text-xs mt-0.5">{description}</Dialog.Description>}
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {children}
            <Dialog.Close asChild>
              <button type="button" aria-label="Close" className="p-1 text-white/60 hover:text-white transition-colors">
                <X className="w-5 h-5" />
              </button>
            </Dialog.Close>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-surface-border flex-shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
            <Icon className="w-5 h-5 text-brand-500" />
          </div>
        )}
        <div className="min-w-0">
          <Dialog.Title className="text-base font-bold text-gray-900 leading-tight truncate">{title}</Dialog.Title>
          {description && <Dialog.Description className="text-sm text-surface-muted mt-0.5">{description}</Dialog.Description>}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {children}
        <Dialog.Close asChild>
          <button type="button" aria-label="Close"
            className="p-1.5 rounded-lg text-surface-muted hover:bg-surface hover:text-gray-700 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </Dialog.Close>
      </div>
    </div>
  )
}

export function ModalBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex-1 overflow-y-auto px-6 py-5 space-y-4', className)}>{children}</div>
}

/** Footer pinned bottom. Submit button should be rightmost, min-w-[120px]. */
export function ModalFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex-shrink-0 px-6 py-4 border-t border-surface-border bg-gray-50/80 flex items-center justify-end gap-3', className)}>
      {children}
    </div>
  )
}
