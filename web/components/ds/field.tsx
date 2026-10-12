'use client'

import React, { useId, useState } from 'react'
import { CalendarDays, Clock, Eye, EyeOff, Search, X, ChevronDown } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/ds/cn'
import { Icon } from './icon'

interface FieldChrome {
  label: string
  helper?: string
  error?: string
  required?: boolean
  className?: string
}

const CONTROL = 'w-full min-h-12 rounded-ds-input border bg-ds-card px-4 text-ds-body-large text-ds-on-surface placeholder:text-ds-on-surface-variant/70 transition-colors duration-ds-fast ease-ds-standard disabled:cursor-not-allowed disabled:opacity-[0.38]'
const BORDER_OK = 'border-ds-outline-variant hover:border-ds-outline focus:border-ds-primary'
const BORDER_ERR = 'border-ds-error focus:border-ds-error'

/**
 * Label + control + helper/error wiring shared by every field. The label is always visible; the error is a
 * live region (role="alert") announced when it appears, and the control gets aria-invalid + aria-describedby.
 * Helper/error live below the control in a reserved slot so showing an error never shifts the layout.
 */
export function Field({ label, helper, error, required, className, children }: FieldChrome & { children: (a: { id: string; describedBy?: string; invalid: boolean }) => React.ReactNode }) {
  const id = useId()
  const hid = `${id}-help`
  const invalid = Boolean(error)
  const describedBy = helper || error ? hid : undefined
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-ds-label-large text-ds-on-surface">
        {label}{required && <span aria-hidden className="ml-0.5 text-ds-error">*</span>}
        {required && <span className="ds-sr-only"> (required)</span>}
      </label>
      {children({ id, describedBy, invalid })}
      <div id={hid} className="min-h-4">
        {error ? <p role="alert" className="text-ds-body-small text-ds-error">{error}</p> : helper ? <p className="text-ds-body-small text-ds-on-surface-variant">{helper}</p> : null}
      </div>
    </div>
  )
}

export interface TextFieldProps extends FieldChrome, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'className'> {
  icon?: LucideIcon
}

export const TextField = React.forwardRef<HTMLInputElement, TextFieldProps>(function TextField({ label, helper, error, required, className, icon, ...rest }, ref) {
  return (
    <Field label={label} helper={helper} error={error} required={required} className={className}>
      {({ id, describedBy, invalid }) => (
        <div className="relative">
          {icon && <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ds-on-surface-variant"><Icon icon={icon} size="sm" /></span>}
          <input ref={ref} id={id} required={required} aria-invalid={invalid || undefined} aria-describedby={describedBy} className={cn(CONTROL, invalid ? BORDER_ERR : BORDER_OK, icon && 'pl-11')} {...rest} />
        </div>
      )}
    </Field>
  )
})

export const PasswordField = React.forwardRef<HTMLInputElement, Omit<TextFieldProps, 'type' | 'icon'>>(function PasswordField({ label, helper, error, required, className, ...rest }, ref) {
  const [shown, setShown] = useState(false)
  return (
    <Field label={label} helper={helper} error={error} required={required} className={className}>
      {({ id, describedBy, invalid }) => (
        <div className="relative">
          <input ref={ref} id={id} type={shown ? 'text' : 'password'} required={required} aria-invalid={invalid || undefined} aria-describedby={describedBy} autoComplete="current-password" className={cn(CONTROL, 'pr-12', invalid ? BORDER_ERR : BORDER_OK)} {...rest} />
          <button type="button" aria-label={shown ? 'Hide password' : 'Show password'} aria-pressed={shown} onClick={() => setShown(s => !s)} className="absolute right-1.5 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-ds-full text-ds-on-surface-variant hover:bg-ds-on-surface/[.08]">
            <Icon icon={shown ? EyeOff : Eye} size="sm" />
          </button>
        </div>
      )}
    </Field>
  )
})

export interface TextAreaProps extends FieldChrome, Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> {}

export const TextArea = React.forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea({ label, helper, error, required, className, rows = 4, ...rest }, ref) {
  return (
    <Field label={label} helper={helper} error={error} required={required} className={className}>
      {({ id, describedBy, invalid }) => <textarea ref={ref} id={id} rows={rows} required={required} aria-invalid={invalid || undefined} aria-describedby={describedBy} className={cn(CONTROL, 'py-3', invalid ? BORDER_ERR : BORDER_OK)} {...rest} />}
    </Field>
  )
})

export interface SelectOption { value: string; label: string; disabled?: boolean }
export interface SelectProps extends FieldChrome, Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'className'> {
  options: SelectOption[]
  placeholder?: string
}

/** Native `<select>` styled with the field chrome: fully keyboard/screen-reader accessible on every platform. */
export const Select = React.forwardRef<HTMLSelectElement, SelectProps>(function Select({ label, helper, error, required, className, options, placeholder, ...rest }, ref) {
  return (
    <Field label={label} helper={helper} error={error} required={required} className={className}>
      {({ id, describedBy, invalid }) => (
        <div className="relative">
          <select ref={ref} id={id} required={required} aria-invalid={invalid || undefined} aria-describedby={describedBy} className={cn(CONTROL, 'appearance-none pr-11', invalid ? BORDER_ERR : BORDER_OK)} {...rest}>
            {placeholder && <option value="">{placeholder}</option>}
            {options.map(o => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
          </select>
          <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-ds-on-surface-variant"><Icon icon={ChevronDown} size="sm" /></span>
        </div>
      )}
    </Field>
  )
})

export interface SearchFieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'onChange' | 'value' | 'className'> {
  value: string
  onValueChange: (v: string) => void
  /** Accessible name (there is no visible label on a search field). */
  label?: string
  className?: string
}

export function SearchField({ value, onValueChange, label = 'Search', placeholder = 'Search', className, ...rest }: SearchFieldProps) {
  return (
    <div role="search" className={cn('relative', className)}>
      <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-ds-on-surface-variant"><Icon icon={Search} size="sm" /></span>
      <input type="search" aria-label={label} placeholder={placeholder} value={value} onChange={e => onValueChange(e.target.value)} className="min-h-12 w-full rounded-ds-full border border-transparent bg-ds-sunken pl-11 pr-11 text-ds-body-large text-ds-on-surface placeholder:text-ds-on-surface-variant/70 focus:border-ds-primary [&::-webkit-search-cancel-button]:hidden" {...rest} />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => onValueChange('')} className="absolute right-1.5 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-ds-full text-ds-on-surface-variant hover:bg-ds-on-surface/[.08]">
          <Icon icon={X} size="sm" />
        </button>
      )}
    </div>
  )
}

export const DateField = React.forwardRef<HTMLInputElement, Omit<TextFieldProps, 'type' | 'icon'>>(function DateField(props, ref) {
  return <TextField ref={ref} type="date" icon={CalendarDays} {...props} />
})
export const TimeField = React.forwardRef<HTMLInputElement, Omit<TextFieldProps, 'type' | 'icon'>>(function TimeField(props, ref) {
  return <TextField ref={ref} type="time" icon={Clock} {...props} />
})

export function Checkbox({ label, description, className, ...rest }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type' | 'className'> & { label: string; description?: string; className?: string }) {
  const id = useId()
  return (
    <div className={cn('flex min-h-10 items-start gap-3', className)}>
      <input id={id} type="checkbox" className="mt-1 h-5 w-5 shrink-0 rounded-ds-xs border-ds-outline accent-[rgb(var(--ds-primary))]" aria-describedby={description ? `${id}-d` : undefined} {...rest} />
      <label htmlFor={id} className="text-ds-body-large text-ds-on-surface">{label}{description && <span id={`${id}-d`} className="block text-ds-body-small text-ds-on-surface-variant">{description}</span>}</label>
    </div>
  )
}

export function Switch({ label, checked, onCheckedChange, disabled, className }: { label: string; checked: boolean; onCheckedChange: (v: boolean) => void; disabled?: boolean; className?: string }) {
  return (
    <label className={cn('flex min-h-12 cursor-pointer items-center justify-between gap-4', disabled && 'cursor-not-allowed opacity-[0.38]', className)}>
      <span className="text-ds-body-large text-ds-on-surface">{label}</span>
      <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={() => onCheckedChange(!checked)} className={cn('relative h-8 w-[52px] shrink-0 rounded-ds-full border transition-colors duration-ds-fast', checked ? 'border-transparent bg-ds-primary' : 'border-ds-outline bg-ds-surface-container-highest')}>
        <span className={cn('absolute top-1/2 h-6 w-6 -translate-y-1/2 rounded-ds-full transition-all duration-ds-fast ease-ds-standard', checked ? 'left-[26px] bg-ds-on-primary' : 'left-1 bg-ds-outline')} />
      </button>
    </label>
  )
}

export function FormSection({ title, description, children, className }: { title: string; description?: string; children: React.ReactNode; className?: string }) {
  const id = useId()
  return (
    <section aria-labelledby={id} className={cn('flex flex-col gap-4', className)}>
      <div>
        <h3 id={id} className="text-ds-title-medium text-ds-on-surface">{title}</h3>
        {description && <p className="mt-1 text-ds-body-medium text-ds-on-surface-variant">{description}</p>}
      </div>
      <div className="flex flex-col gap-4">{children}</div>
    </section>
  )
}

export function FormActions({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}>{children}</div>
}
