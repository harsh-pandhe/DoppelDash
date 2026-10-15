import React from 'react'
import { Loader2 } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/ds/cn'
import { Icon } from './icon'

export type ButtonVariant = 'filled' | 'tonal' | 'outlined' | 'text' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANT: Record<ButtonVariant, string> = {
  filled: 'bg-ds-primary text-ds-on-primary hover:bg-ds-primary/90 active:bg-ds-primary/80',
  tonal: 'bg-ds-secondary-container text-ds-on-secondary-container hover:bg-ds-secondary-container/80',
  outlined: 'border border-ds-outline text-ds-primary hover:bg-ds-primary/[.08] active:bg-ds-primary/[.12]',
  text: 'text-ds-primary hover:bg-ds-primary/[.08] active:bg-ds-primary/[.12]',
  danger: 'bg-ds-error text-ds-on-error hover:bg-ds-error/90 active:bg-ds-error/80',
}
const SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-8 px-3 text-ds-label-large gap-1.5',
  md: 'min-h-10 px-5 text-ds-label-large gap-2',
  lg: 'min-h-12 px-6 text-ds-label-large gap-2',
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  icon?: LucideIcon
  iconEnd?: LucideIcon
  expand?: boolean
}

/**
 * The one button. Loading keeps the width and disables the control (so a double click can't submit twice) and sets
 * aria-busy; disabled/loading never relies on colour alone. Focus ring comes from the base layer.
 */
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'filled', size = 'md', loading = false, icon, iconEnd, expand, disabled, className, children, onClick, type = 'button', ...rest },
  ref,
) {
  const off = disabled || loading
  return (
    <button
      ref={ref}
      type={type}
      disabled={off}
      aria-busy={loading || undefined}
      onClick={e => { if (!off) onClick?.(e) }}
      className={cn(
        'relative inline-flex select-none items-center justify-center rounded-ds-button font-medium transition-colors duration-ds-fast ease-ds-standard',
        'disabled:cursor-not-allowed disabled:opacity-[0.38]',
        SIZE[size], VARIANT[variant], expand && 'w-full', className,
      )}
      {...rest}
    >
      <span className={cn('inline-flex items-center justify-center gap-[inherit]', loading && 'invisible')}>
        {icon && <Icon icon={icon} size="sm" />}
        {children}
        {iconEnd && <Icon icon={iconEnd} size="sm" />}
      </span>
      {loading && (
        <span className="absolute inset-0 inline-flex items-center justify-center" role="status" aria-label="Loading">
          <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
        </span>
      )}
    </button>
  )
})

export interface IconButtonProps extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'aria-label'> {
  icon: LucideIcon
  /** REQUIRED accessible name (also shown as the tooltip). An unlabeled icon button cannot be written. */
  label: string
  variant?: 'standard' | 'tonal' | 'filled'
  pressed?: boolean
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { icon, label, variant = 'standard', pressed, className, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cn(
        'inline-flex h-10 w-10 items-center justify-center rounded-ds-full transition-colors duration-ds-fast ease-ds-standard disabled:opacity-[0.38] disabled:cursor-not-allowed',
        // 44px+ hit area on pointer devices without growing the visual
        'relative before:absolute before:-inset-1 before:content-[""]',
        variant === 'standard' && 'text-ds-on-surface-variant hover:bg-ds-on-surface/[.08] active:bg-ds-on-surface/[.12]',
        variant === 'tonal' && 'bg-ds-secondary-container text-ds-on-secondary-container hover:bg-ds-secondary-container/80',
        variant === 'filled' && 'bg-ds-primary text-ds-on-primary hover:bg-ds-primary/90',
        pressed && variant === 'standard' && 'bg-ds-secondary-container text-ds-on-secondary-container',
        className,
      )}
      {...rest}
    >
      <Icon icon={icon} size="sm" />
    </button>
  )
})
