import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'

// Exact-match public routes. Matched exactly (or with a trailing slash) so that
// e.g. /api/support/chatty or /api/auth/loginXYZ are NOT treated as public.
const PUBLIC_EXACT = [
  '/sign-in',
  '/sign-up',
  '/privacy',
  '/terms',
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
]

// Genuine prefixes — everything beneath these is public by design.
const PUBLIC_PREFIXES = [
  '/contact/',           // public shared contact cards (QR / link)
  '/shared/',            // public read-only shared analytics dashboards
  '/api/analytics/shared/',
  '/api/webhooks/',
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

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

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
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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
