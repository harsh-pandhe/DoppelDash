'use client'
import * as TogglePrimitive from '@radix-ui/react-toggle'
import { cn } from '@/lib/utils'
import React from 'react'

const Toggle = React.forwardRef<
  React.ElementRef<typeof TogglePrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof TogglePrimitive.Root> & {
    size?: 'sm' | 'md'
  }
>(({ className, size = 'sm', ...props }, ref) => (
  <TogglePrimitive.Root
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors',
      'text-gray-500 hover:bg-gray-100 hover:text-gray-700',
      'data-[state=on]:bg-brand-100 data-[state=on]:text-brand-700',
      'disabled:pointer-events-none disabled:opacity-40',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
      size === 'sm' ? 'h-7 w-7' : 'h-8 w-8',
      className
    )}
    {...props}
  />
))
Toggle.displayName = TogglePrimitive.Root.displayName

export { Toggle }
