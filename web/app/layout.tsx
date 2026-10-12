import type { Metadata, Viewport } from 'next'
import { Inter, Inter_Tight, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import './design/ds-tokens.css'
import './design/ds-base.css'

const inter      = Inter({       subsets: ['latin'], variable: '--font-inter',       display: 'swap' })
const interTight = Inter_Tight({ subsets: ['latin'], variable: '--font-inter-tight', display: 'swap' })
const mono       = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono',     display: 'swap' })

export const metadata: Metadata = {
  title: { default: 'Doppelmayr India — Employee workspace', template: '%s · Doppelmayr India' },
  description: 'Doppelmayr India employee workspace: leave, expenses, travel and CRM.',
  manifest: '/manifest.json',
  icons: { apple: '/icon-192.png' },
  appleWebApp: { capable: false, statusBarStyle: 'default', title: 'Doppelmayr India' },
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  themeColor: '#070B16',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${interTight.variable} ${mono.variable}`}>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.theme;if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme:dark)').matches)){document.documentElement.classList.add('dark')}}catch(e){}})();`,
          }}
        />
      </head>
      <body className={inter.className}>{children}</body>
    </html>
  )
}
