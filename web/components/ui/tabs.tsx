'use client'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'
import React from 'react'

const TabsRoot    = TabsPrimitive.Root
const TabsContent = TabsPrimitive.Content

const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      'inline-flex items-center gap-0.5 rounded-xl bg-gray-100/80 p-1',
      className
    )}
    {...props}
  />
))
TabsList.displayName = TabsPrimitive.List.displayName

const TabItem = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger> & {
    badge?: number | string
  }
>(({ className, children, badge, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all',
      'text-gray-500 hover:text-gray-700',
      'data-[state=active]:bg-white data-[state=active]:text-gray-900 data-[state=active]:shadow-sm',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500/40',
      'disabled:pointer-events-none disabled:opacity-50',
      className
    )}
    {...props}
  >
    {children}
    {badge !== undefined && badge !== 0 && (
      <span className="min-w-[18px] h-[18px] rounded-full bg-brand-500 text-white text-[9px] font-bold flex items-center justify-center px-1 leading-none">
        {badge}
      </span>
    )}
  </TabsPrimitive.Trigger>
))
TabItem.displayName = TabsPrimitive.Trigger.displayName

export { TabsRoot, TabsList, TabItem, TabsContent }
