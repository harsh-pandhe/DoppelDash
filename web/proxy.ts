import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'

// Exact-match public routes. Matched exactly (or with a trailing slash) so that
// e.g. /api/support/chatty or /api/auth/loginXYZ are NOT treated as public.
const PUBLIC_EXACT = [
  '/sign-in',
  '/sign-up',
  '/forgot-password',
  '/privacy',
  '/terms',
  '/support',
  '/delete-account',
  '/web-access-restricted',
  '/design-system',      // design-system showcase: the page itself 404s in production (see app/design-system/page.tsx)
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/verify-otp',
  '/api/auth/send-otp',
  '/api/auth/passkey/login',
  '/api/auth/logout',
  '/api/auth/setup',
  '/api/auth/refresh', // mobile-only: authenticated by the refresh token in the body, not a cookie
  '/api/support/chat',
  '/api/dev/seed',       // secret-gated inside route (DEV_SEED_SECRET)
  '/api/dev/migrate',    // secret-gated inside route (DEV_SEED_SECRET) — non-destructive data migration
  '/api/health',         // deployment provenance + liveness (no data, no secrets)
  '/api/billing/play/rtdn', // Google Play RTDN webhook (secret/signature authenticated inside route)
]

// Genuine prefixes — everything beneath these is public by design.
const PUBLIC_PREFIXES = [
  '/contact/',           // public shared contact cards (QR / link)
  '/shared/',            // public read-only shared analytics dashboards
  '/invite',             // public invitation acceptance UI
  '/reset-password',     // public password reset UI
  '/api/auth/invitations/',    // public invitation verification and acceptance APIs
  '/api/auth/password-reset/', // public password reset request and confirm APIs
  '/api/analytics/shared/',
  '/api/webhooks/',
  '/api/cron/',          // secret-gated inside route (CRON_SECRET)
]

// Public API patterns (regex). Anything under /api/crm/<id>/share is public.
const PUBLIC_API_PATTERNS: RegExp[] = [
  /^\/api\/crm\/[^/]+\/share\/?$/,
]

// Real static assets only — anchored at the end of the path. A bare
// `pathname.includes('.')` would let any URL with a dot skip auth entirely.
const STATIC_FILE = /\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|mjs|map|woff2?|ttf|eot|txt|xml|json|pdf)$/i

function isPublic(pathname: string) {
  if (pathname === '/') return true
  if (PUBLIC_EXACT.some(p => pathname === p || pathname === `${p}/`)) return true
  if (PUBLIC_PREFIXES.some(p => pathname.startsWith(p))) return true
  return PUBLIC_API_PATTERNS.some(rx => rx.test(pathname))
}

// Legacy e-mailed links carried their token in the query string (`/invite?token=…`, `/reset-password?token=…`).
// New links use the URL fragment, which browsers never send to a server. Next embeds the request URL and
// searchParams in every page's HTML payload, so a legacy link is NOT rendered by the app at all: this static
// bridge (its HTML never contains the token) moves the token into the fragment client-side and navigates to the
// clean URL. (The first request of a legacy link was sent by the browser and cannot be un-sent; those links
// expire — invitations after 7 days, reset links after 1 hour.)
const LEGACY_LINK_BRIDGE = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex"><title>Opening…</title></head><body><script>(function(){var p=new URLSearchParams(location.search).get('token');location.replace(location.pathname+(p?'#token='+encodeURIComponent(p):''));})();</script><noscript>JavaScript is required to open this link.</noscript></body></html>`
const TOKEN_PAGES = new Set(['/invite', '/reset-password'])

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  const legacyToken = TOKEN_PAGES.has(pathname) ? req.nextUrl.searchParams.get('token') : null
  if (legacyToken) {
    return new NextResponse(LEGACY_LINK_BRIDGE, {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' },
    })
  }

  // Always allow public routes, static files, Next internals
  // An /api/* path is never a static asset — exempting it on extension would
  // let /api/admin/users.json skip auth.
  const isStaticAsset = !pathname.startsWith('/api/') && STATIC_FILE.test(pathname)
  if (isPublic(pathname) || pathname.startsWith('/_next') || isStaticAsset) {
    return NextResponse.next()
  }

  // Mobile has no cookie jar — it authenticates with a short-lived Bearer
  // access token instead (minted by /api/auth/verify-otp and renewed by
  // /api/auth/refresh). Cookie takes priority since only the web client
  // can send one.
  const bearer = req.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1]
  const token = req.cookies.get(COOKIE_NAME)?.value || bearer
  if (!token) {
    // API routes → 401 JSON
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized', code: 'unauthorized' }, { status: 401 })
    }
    // App pages → redirect to sign-in
    const url = req.nextUrl.clone()
    url.pathname = '/sign-in'
    url.searchParams.set('redirect', pathname)
    return NextResponse.redirect(url)
  }

  const payload = await verifyToken(token)
  if (!payload) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Session expired' }, { status: 401 })
    }
    const url = req.nextUrl.clone()
    url.pathname = '/sign-in'
    url.search = ''
    url.searchParams.set('reason', 'session')   // the sign-in page explains that the session ended
    return NextResponse.redirect(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    // The extension group is anchored with $ — unanchored, "users.json" matches
    // the ".js" alternative mid-string and skips middleware entirely.
    '/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)',
  ],
}
