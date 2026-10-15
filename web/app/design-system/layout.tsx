import type { Metadata } from 'next'
import '../design/ds-tokens.css'
import '../design/ds-base.css'

export const metadata: Metadata = { title: 'Design system', robots: { index: false, follow: false } }

export default function DesignSystemLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
