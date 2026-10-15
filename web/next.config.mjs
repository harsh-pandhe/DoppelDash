/** @type {import('next').NextConfig} */

// Cloudinary is the only cross-origin host the browser talks to directly
// (unsigned uploads go straight from the client, bypassing the function).
// Local/CI fakes only: when CLOUDINARY_UPLOAD_BASE / CLOUDINARY_DELIVERY_BASE point somewhere other than Cloudinary
// (never set in production) their origins are allowed too, so browser uploads can be tested against a local fake.
const originOf = v => { try { return v ? new URL(v).origin : '' } catch { return '' } }
// (ignored entirely in production builds)
const IS_PROD = process.env.NODE_ENV === 'production'
const FAKE_UPLOAD = IS_PROD ? '' : originOf(process.env.CLOUDINARY_UPLOAD_BASE)
const FAKE_DELIVERY = IS_PROD ? '' : originOf(process.env.CLOUDINARY_DELIVERY_BASE)

const CSP = [
  "default-src 'self'",
  `img-src 'self' data: blob: https://res.cloudinary.com https://images.unsplash.com https://upload.wikimedia.org ${FAKE_DELIVERY}`.trim(),
  "media-src 'self' data: blob:",
  `connect-src 'self' https://api.cloudinary.com ${FAKE_UPLOAD}`.trim(),
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

// Deployment provenance: the commit this bundle was built from (non-secret; Netlify sets COMMIT_REF at build, GitHub Actions GITHUB_SHA).
const BUILD_SHA = (process.env.COMMIT_REF || process.env.GITHUB_SHA || process.env.DD_BUILD_SHA || '').slice(0, 40)

const nextConfig = {
  env: { DD_BUILD_SHA: BUILD_SHA },
  // Lets a second, isolated production build exist next to the dev build (used by the production-config test).
  distDir: process.env.NEXT_DIST_DIR || '.next',
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
