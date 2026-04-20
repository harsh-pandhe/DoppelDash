import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva(
  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors',
  {
    variants: {
      variant: {
        default:     'bg-brand-100 text-brand-700',
        secondary:   'bg-surface text-gray-600 border border-surface-border',
        destructive: 'bg-red-100 text-red-700',
        success:     'bg-green-100 text-green-700',
        warning:     'bg-orange-100 text-orange-700',
        outline:     'border border-surface-border text-gray-600',
      },
    },
    defaultVariants: { variant: 'default' },
  }
)

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}

export { Badge, badgeVariants }
