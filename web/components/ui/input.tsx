import * as React from 'react'
import { cn } from '@/lib/utils'

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    className={cn(
      'flex h-10 w-full rounded-lg border border-surface-border bg-white px-3.5 py-2 text-sm text-gray-900 placeholder:text-surface-muted',
      'transition-colors focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20',
      'disabled:cursor-not-allowed disabled:bg-surface disabled:opacity-60',
      'file:border-0 file:bg-transparent file:text-sm file:font-medium',
      className
    )}
    ref={ref}
    {...props}
  />
))
Input.displayName = 'Input'

export { Input }
