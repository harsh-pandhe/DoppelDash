/** @type {import('next').NextConfig} */

// Cloudinary is the only cross-origin host the browser talks to directly
// (unsigned uploads go straight from the client, bypassing the function).
const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob: https://res.cloudinary.com https://images.unsplash.com https://upload.wikimedia.org",
  "media-src 'self' data: blob:",
  "connect-src 'self' https://api.cloudinary.com",
  // 'unsafe-inline' is currently required: the no-flash theme script is inlined
  // in app/layout.tsx, and Tailwind, Recharts and Tiptap all set inline styles.
  // Removing it needs nonce plumbing through middleware — tracked separately.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ')

const SECURITY_HEADERS = [
  { key: 'X-Frame-Options',        value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy',        value: 'strict-origin-when-cross-origin' },
  // Camera stays enabled — the CRM scan-card flow uses it.
  { key: 'Permissions-Policy',     value: 'camera=(self), microphone=(), geolocation=(), interest-cohort=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  // Walked every page (sign-in 3D scene, dashboard, CRM + scan-card, RMS,
  // LMS, inbox, reports, settings, analytics, mail compose/preview) under
  // Report-Only with zero violations logged — enforcing now.
  { key: 'Content-Security-Policy', value: CSP },
]

const nextConfig = {
  output: process.env.BUILD_STANDALONE === '1' ? 'standalone' : undefined,
  poweredByHeader: false,
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: 'upload.wikimedia.org' },
      { protocol: 'https', hostname: 'res.cloudinary.com' },
    ],
  },
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }]
  },
}

export default nextConfig
