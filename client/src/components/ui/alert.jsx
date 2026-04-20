import * as React from 'react'
import { cn } from '@/lib/utils'

const Alert = React.forwardRef(({ className, variant = 'default', ...props }, ref) => (
  <div
    ref={ref}
    role="alert"
    className={cn(
      'relative w-full rounded-lg border px-4 py-3 text-sm flex items-start gap-3',
      variant === 'destructive' && 'border-red-200 bg-red-50 text-red-700',
      variant === 'success'     && 'border-green-200 bg-green-50 text-green-700',
      variant === 'default'     && 'border-surface-border bg-surface text-gray-700',
      className
    )}
    {...props}
  />
))
Alert.displayName = 'Alert'

const AlertDescription = React.forwardRef(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('text-sm leading-relaxed', className)} {...props} />
))
AlertDescription.displayName = 'AlertDescription'

export { Alert, AlertDescription }
