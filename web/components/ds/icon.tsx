import React from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@/lib/ds/cn'

const SIZE = { xs: 16, sm: 20, md: 24, lg: 32, xl: 48 } as const
export type IconSize = keyof typeof SIZE

/**
 * Every icon in the product goes through this wrapper: one stroke weight (1.75), one size scale
 * (xs 16 · sm 20 · md 24 · lg 32 · xl 48), decorative by default. Pass `label` only when the icon alone
 * carries meaning (then it becomes role="img"); icon-only controls must use <IconButton label="…">.
 */
export function Icon({ icon: Glyph, size = 'sm', label, className }: { icon: LucideIcon; size?: IconSize; label?: string; className?: string }) {
  const px = SIZE[size]
  return (
    <Glyph
      width={px}
      height={px}
      strokeWidth={1.75}
      className={cn('shrink-0', className)}
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
    />
  )
}
