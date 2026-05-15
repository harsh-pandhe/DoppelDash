import type { Metadata, Viewport } from 'next'
import { Inter, Inter_Tight, JetBrains_Mono } from 'next/font/google'
import './globals.css'

const inter      = Inter({       subsets: ['latin'], variable: '--font-inter',       display: 'swap' })
const interTight = Inter_Tight({ subsets: ['latin'], variable: '--font-inter-tight', display: 'swap' })
const mono       = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono',     display: 'swap' })

export const metadata: Metadata = {
  title: 'DoppelDash — Doppelmayr India',
  description: 'Enterprise management suite for Doppelmayr India',
  manifest: '/manifest.json',
  icons: { apple: '/icon-192.png' },
  appleWebApp: { capable: false, statusBarStyle: 'default', title: 'DoppelDash' },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  themeColor: '#0057A8',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${interTight.variable} ${mono.variable}`}>
      <body className={inter.className}>{children}</body>
    </html>
  )
}
