'use client'
import { Drawer } from 'vaul'
import { cn } from '@/lib/utils'
import { X } from 'lucide-react'
import React from 'react'

interface SheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
  side?: 'right' | 'left' | 'bottom'
  className?: string
}

export function Sheet({ open, onOpenChange, children, side = 'right', className }: SheetProps) {
  return (
    <Drawer.Root
      open={open}
      onOpenChange={onOpenChange}
      direction={side}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Drawer.Content
          className={cn(
            'fixed z-50 bg-white flex flex-col',
            'shadow-2xl outline-none',
            side === 'right'  && 'right-0 top-0 bottom-0 w-full max-w-lg',
            side === 'left'   && 'left-0 top-0 bottom-0 w-full max-w-lg',
            side === 'bottom' && 'bottom-0 left-0 right-0 max-h-[90vh] rounded-t-2xl',
            className
          )}
          aria-describedby={undefined}
        >
          {children}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  )
}

interface SheetHeaderProps {
  title: string
  description?: string
  onClose: () => void
  children?: React.ReactNode
}

export function SheetHeader({ title, description, onClose, children }: SheetHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-surface-border flex-shrink-0">
      <div className="flex-1 min-w-0">
        <Drawer.Title className="text-base font-bold text-gray-900 leading-tight">{title}</Drawer.Title>
        {description && <p className="text-sm text-surface-muted mt-0.5">{description}</p>}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {children}
        <button type="button" onClick={onClose} aria-label="Close"
          className="p-1.5 rounded-lg text-surface-muted hover:bg-surface hover:text-gray-700 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}

export function SheetBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex-1 overflow-y-auto px-6 py-5 space-y-5', className)}>
      {children}
    </div>
  )
}

export function SheetFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex-shrink-0 px-6 py-4 border-t border-surface-border bg-gray-50/80', className)}>
      {children}
    </div>
  )
}
