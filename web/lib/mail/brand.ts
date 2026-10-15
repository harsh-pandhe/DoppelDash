import { connectDB } from '@/lib/db'
import Organization from '@/models/Organization'
import OrgSettings from '@/models/OrgSettings'
import { singleLine } from './escape'

/**
 * Outbound-mail branding.
 *
 * The visual identity of an e-mail is derived ONLY from the sending
 * organisation's stored configuration (OrgSettings.brandName / brandColor, falling back to
 * OrgSettings.companyName, then Organization.name). There is no organisation-id or slug
 * check anywhere: Doppelmayr mail is Doppelmayr-branded because its stored
 * settings say so, and any other organisation configured the same way looks
 * the same. An organisation with no usable configuration — or no organisation
 * at all — gets the neutral platform brand.
 */
export interface MailBrand {
  /** Display name used in headers, footers and subjects. */
  name: string
  /** Header / button colour, always a validated #RRGGBB. */
  color: string
  /** Darker companion used for emphasis text. */
  darkColor: string
  /** True only for the neutral platform fallback. */
  isPlatform: boolean
  /** Optional small label beside the name (platform only). */
  tagline?: string
}

const HEX = /^#[0-9a-f]{6}$/i

export const PLATFORM_BRAND: MailBrand = {
  name: 'DoppelDash',
  color: '#0369A1',
  darkColor: '#075985',
  isPlatform: true,
  tagline: 'Enterprise Platform',
}

function darken(hex: string, factor = 0.72): string {
  const n = parseInt(hex.slice(1), 16)
  const ch = (shift: number) => Math.round(((n >> shift) & 255) * factor).toString(16).padStart(2, '0')
  return `#${ch(16)}${ch(8)}${ch(0)}`
}

/** Pure: turn (untrusted) stored organisation values into a safe brand. */
export function makeBrand(input: { name?: unknown; color?: unknown } | null | undefined): MailBrand {
  const name = singleLine(input?.name, 60).replace(/[<>]/g, '').trim()
  if (!name) return PLATFORM_BRAND
  const color = typeof input?.color === 'string' && HEX.test(input.color.trim()) ? input.color.trim() : PLATFORM_BRAND.color
  return { name, color, darkColor: darken(color), isPlatform: false }
}

/** Resolve the brand for an organisation from persisted configuration. Never throws. */
export async function resolveMailBrand(orgId?: string | null): Promise<MailBrand> {
  if (!orgId) return PLATFORM_BRAND
  try {
    await connectDB()
    const [settings, org] = await Promise.all([
      OrgSettings.findOne({ orgId }).select('brandName companyName name brandColor').lean<{ brandName?: string; companyName?: string; name?: string; brandColor?: string } | null>(),
      Organization.findOne({ orgId }).select('name').lean<{ name?: string } | null>(),
    ])
    // 'My Organization' is the schema placeholder, not a configured name.
    const configured = [settings?.brandName, settings?.companyName, org?.name, settings?.name].find(n => n && n.trim() && n.trim() !== 'My Organization')
    return makeBrand({ name: configured, color: settings?.brandColor })
  } catch {
    return PLATFORM_BRAND
  }
}
