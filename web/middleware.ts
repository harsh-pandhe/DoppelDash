import { NextRequest, NextResponse } from 'next/server'
import { verifyToken, COOKIE_NAME } from '@/lib/auth/jwt'

const PUBLIC_PATHS = [
  '/sign-in',
  '/sign-up',
  '/contact/',           // public shared contact cards (QR / link)
  '/api/auth/login',
  '/api/auth/verify-otp',
  '/api/auth/logout',
  '/api/auth/setup',
  '/api/webhooks',
  '/api/support/chat',
]

// Public API patterns (regex). Anything under /api/crm/<id>/share is public.
const PUBLIC_API_PATTERNS: RegExp[] = [
  /^\/api\/crm\/[^/]+\/share\/?$/,
]

function isPublic(pathname: string) {
  if (pathname === '/') return true
  if (PUBLIC_PATHS.some(p => pathname.startsWith(p))) return true
  return PUBLIC_API_PATTERNS.some(rx => rx.test(pathname))
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Always allow public routes, static files, Next internals
  if (isPublic(pathname) || pathname.startsWith('/_next') || pathname.includes('.')) {
    return NextResponse.next()
  }

  const token = req.cookies.get(COOKIE_NAME)?.value
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

  // Inject user info into headers for use in route handlers (optional optimisation)
  const headers = new Headers(req.headers)
  headers.set('x-user-id',   payload.userId)
  headers.set('x-user-role', payload.role)
  headers.set('x-user-name', `${payload.firstName} ${payload.lastName}`)

  return NextResponse.next({ request: { headers } })
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)).*)',
  ],
}
