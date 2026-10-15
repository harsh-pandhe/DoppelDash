import { clsx } from 'clsx'
import type { ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'
import { TYPE_SCALE } from './tokens'

const kebab = (s: string) => s.replace(/([A-Z])/g, m => '-' + m.toLowerCase())

// `text-ds-body-md` etc. are font-size utilities (not colours): teach tailwind-merge so `cn('text-ds-body-md', 'text-ds-on-surface')` keeps both.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: Object.keys(TYPE_SCALE).map(k => `ds-${kebab(k)}`) }],
    },
  },
})

/** Class-name helper for design-system components. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}
