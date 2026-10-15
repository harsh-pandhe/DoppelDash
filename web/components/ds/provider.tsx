'use client'

import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { brandView } from '@/lib/ds/brand'
import type { BrandView } from '@/lib/ds/brand'
import type { BrandId } from '@/lib/ds/tokens'
import { cn } from '@/lib/ds/cn'

export type ThemePreference = 'light' | 'dark' | 'system'
export type MotionPreference = 'auto' | 'reduced'

interface DsContextValue {
  brand: BrandView
  /** The user's choice. */
  theme: ThemePreference
  /** The theme actually applied (system resolved). */
  resolvedTheme: 'light' | 'dark'
  setTheme: (t: ThemePreference) => void
  /** True when motion is reduced by the OS or forced by `motion="reduced"`. */
  reducedMotion: boolean
  /**
   * The provider's root element. Overlays (dialogs, sheets, popovers, tooltips) must portal INTO it: the brand/theme
   * CSS variables are set on this element, so a portal to <body> would render without any tokens.
   */
  portalContainer: HTMLElement | null
}

const DsContext = createContext<DsContextValue | null>(null)

/**
 * Applies ONE brand layer + a light/dark theme + motion preference to everything inside it. All design-system
 * components read their colours from CSS variables this wrapper activates (see app/design/ds-tokens.css), so
 * brand and theme can change at runtime without re-rendering component code.
 */
export function DsProvider({
  brand,
  theme: initialTheme = 'system',
  motion = 'auto',
  className,
  children,
}: {
  brand: BrandId
  theme?: ThemePreference
  motion?: MotionPreference
  className?: string
  children: React.ReactNode
}) {
  const [theme, setTheme] = useState<ThemePreference>(initialTheme)
  const [systemDark, setSystemDark] = useState(false)
  const [osReduced, setOsReduced] = useState(false)
  const [rootEl, setRootEl] = useState<HTMLElement | null>(null)
  // A parent that controls `theme` (e.g. the showcase toggle) drives the provider.
  useEffect(() => setTheme(initialTheme), [initialTheme])

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const dark = window.matchMedia('(prefers-color-scheme: dark)')
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const sync = () => { setSystemDark(dark.matches); setOsReduced(reduced.matches) }
    sync()
    dark.addEventListener?.('change', sync)
    reduced.addEventListener?.('change', sync)
    return () => { dark.removeEventListener?.('change', sync); reduced.removeEventListener?.('change', sync) }
  }, [])

  const resolvedTheme: 'light' | 'dark' = theme === 'system' ? (systemDark ? 'dark' : 'light') : theme
  const reducedMotion = motion === 'reduced' || osReduced
  const value = useMemo<DsContextValue>(() => ({ brand: brandView(brand), theme, resolvedTheme, setTheme, reducedMotion, portalContainer: rootEl }), [brand, theme, resolvedTheme, reducedMotion, rootEl])

  return (
    <DsContext.Provider value={value}>
      <div ref={setRootEl} className={cn('ds-root min-h-full', className)} data-ds-brand={brand} data-ds-theme={resolvedTheme} data-ds-motion={reducedMotion ? 'reduced' : 'auto'}>
        {children}
      </div>
    </DsContext.Provider>
  )
}

export function useDs(): DsContextValue {
  const v = useContext(DsContext)
  if (!v) throw new Error('useDs must be used inside <DsProvider>')
  return v
}

/** Safe variant for leaf components that may render outside a provider (stories, tests). */
export function useDsOptional(): DsContextValue | null {
  return useContext(DsContext)
}
