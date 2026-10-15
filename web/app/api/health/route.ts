import { NextResponse } from 'next/server'

/**
 * Liveness + deployment provenance. Public and deliberately boring: no database access (it must answer when the database is down), no secrets,
 * no tenant data. `commit` is the SHA this bundle was BUILT from (embedded at build time by next.config.mjs), so a smoke test can prove which
 * commit a hostname is serving; `context` is DD_DEPLOY_CONTEXT (production | staging | unset).
 */
const headers = { 'Cache-Control': 'no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' }
const body = () => ({
  status: 'ok',
  commit: (process.env.DD_BUILD_SHA || '').slice(0, 40) || null,
  context: process.env.DD_DEPLOY_CONTEXT === 'production' || process.env.DD_DEPLOY_CONTEXT === 'staging' ? process.env.DD_DEPLOY_CONTEXT : 'unset',
})
export async function GET() { return NextResponse.json(body(), { headers }) }
export async function HEAD() { return new NextResponse(null, { status: 200, headers }) }
