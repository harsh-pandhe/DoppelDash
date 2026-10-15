import { NextResponse } from 'next/server'

/**
 * REMOVED: `GET /api/auth/invitations/<token>`.
 *
 * An invitation token in a URL path is written to access logs, proxies and Referer
 * headers. Previews now use `POST /api/auth/invitations/verify` with the token in
 * the body. This stub exists only so a client built against the old contract gets
 * an explicit answer; it never reads, validates or echoes the path segment.
 */
const GONE = () =>
  NextResponse.json(
    { error: 'This endpoint was removed. Update the app — invitation previews use POST /api/auth/invitations/verify.', code: 'endpoint_removed' },
    { status: 405, headers: { Allow: 'POST', 'Cache-Control': 'no-store' } },
  )

export const GET = GONE
export const HEAD = GONE
