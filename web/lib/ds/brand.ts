import { BRANDS, DEFAULT_BRAND } from './tokens'
import type { BrandId } from './tokens'

export interface BrandView {
  id: BrandId
  name: string
  shortName: string
  tagline: string
  tone: string
  /** Real brand artwork the owning client ships (the Doppelmayr logo belongs to the web client). */
  logoSrc?: string
}

/**
 * The brand layer is chosen per CLIENT BUILD (web = Doppelmayr, Android = DoppelDash) via NEXT_PUBLIC_DS_BRAND —
 * never from an organisation id or slug. Components receive the brand through <DsProvider>.
 */
export function resolveBrandId(value: string | undefined | null): BrandId {
  return value && value in BRANDS ? (value as BrandId) : DEFAULT_BRAND_FOR_WEB
}

/** The web client is the Doppelmayr India internal application. */
export const DEFAULT_BRAND_FOR_WEB: BrandId = 'doppelmayr'

export function brandView(id: BrandId): BrandView {
  const b = BRANDS[id]
  return { id, name: b.name, shortName: b.shortName, tagline: b.tagline, tone: b.tone, logoSrc: id === 'doppelmayr' ? '/doppelmayr-logo.svg' : undefined }
}

export { DEFAULT_BRAND }
