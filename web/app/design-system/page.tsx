import { notFound } from 'next/navigation'
import Showcase from './Showcase'

export const dynamic = 'force-dynamic'

/**
 * Design-system showcase. Development/preview only: it 404s in production unless DD_DESIGN_SHOWCASE=true,
 * so the internal Doppelmayr portal never exposes it to employees.
 */
export default async function DesignSystemPage(props: { searchParams?: Promise<{ brand?: string; theme?: string; motion?: string }> }) {
  const searchParams = await props.searchParams
  if (process.env.NODE_ENV === 'production' && process.env.DD_DESIGN_SHOWCASE !== 'true') notFound()
  // Optional deep-link state so every brand × theme can be captured reproducibly: ?brand=doppeldash&theme=dark&motion=reduced
  const brand = searchParams?.brand === 'doppeldash' || searchParams?.brand === 'doppelmayr' ? searchParams.brand : undefined
  const theme = searchParams?.theme === 'dark' || searchParams?.theme === 'light' || searchParams?.theme === 'system' ? searchParams.theme : undefined
  return <Showcase initialBrand={brand} initialTheme={theme} initialReduced={searchParams?.motion === 'reduced'} />
}
