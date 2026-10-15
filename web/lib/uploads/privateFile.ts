import { NextResponse } from 'next/server'
import { ALLOWED_MIME, privateDownloadUrl, receiptSizeCeiling, storageConfig } from '@/lib/uploads/attachmentStorage'

const MIME_BY_EXT: Record<string, string> = Object.fromEntries(Object.entries(ALLOWED_MIME).map(([mime, ext]) => [ext, mime]))
MIME_BY_EXT.jpeg = 'image/jpeg'

/**
 * Streams ONE stored private file (a verified `cld:` reference) to an already-authorised caller. Shared by the expense receipt
 * proxy and the travel itinerary proxy so both behave identically: signed private download made server-side, bounded streaming
 * against the canonical size ceiling, content type from the stored extension (never the provider/URL), `no-store`, sandboxed.
 * The CALLER is responsible for authorisation and for passing a reference that came from the authorised record.
 */
export async function servePrivateFile(stored: string, orgId: string, filenameBase: string, logTag: string): Promise<Response> {
  const cfg = storageConfig()
  const downloadUrl = privateDownloadUrl(stored, orgId, cfg)
  if (!downloadUrl) {
    console.error(`[${logTag}] storage not configured — cannot serve file:`, cfg.problem)
    return NextResponse.json({ error: 'Receipts are temporarily unavailable. Please try again later.', code: 'storage_not_configured' }, { status: 503 })
  }

  let upstream: Response
  try {
    upstream = await fetch(downloadUrl, { signal: AbortSignal.timeout(15_000), redirect: 'error' })
  } catch (err) {
    console.error(`[${logTag}] provider fetch failed`, (err as Error)?.name === 'TimeoutError' ? 'timeout' : 'network')
    return NextResponse.json({ error: 'Receipt temporarily unavailable. Please try again.', code: 'provider_unavailable' }, { status: 502 })
  }
  if (upstream.status === 404) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (!upstream.ok || !upstream.body) return NextResponse.json({ error: 'Receipt temporarily unavailable. Please try again.', code: 'provider_unavailable' }, { status: 502 })
  // Bounded streaming: the ceiling is the canonical largest plan limit (never a separate magic number). A declared length over
  // it is refused up front; an undeclared/lying length is cut off the moment it exceeds the ceiling — nothing is buffered.
  const ceiling = receiptSizeCeiling()
  const len = Number(upstream.headers.get('content-length') || 0)
  if (len > ceiling) return NextResponse.json({ error: 'This receipt exceeds the maximum supported size.', code: 'too_large' }, { status: 413 })
  let seen = 0
  const body = upstream.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength
      if (seen > ceiling) { controller.error(new Error('receipt exceeds the size ceiling')); return }
      controller.enqueue(chunk)
    },
  }))

  const ext = stored.slice(stored.lastIndexOf('.') + 1).toLowerCase()
  const isPdf = ext === 'pdf'
  return new Response(body, {
    status: 200,
    headers: {
      // Type comes from the stored extension (checked at upload/verify time), never from the provider's response.
      'Content-Type': MIME_BY_EXT[ext] || 'application/octet-stream',
      // PDFs are downloaded rather than rendered inline: no active content ever runs in our origin, and a `sandbox` CSP
      // would break browser PDF viewers. Images render inline under a locked-down CSP.
      'Content-Disposition': `${isPdf ? 'attachment' : 'inline'}; filename="${filenameBase}.${ext}"`,
      'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'same-origin',
      ...(len ? { 'Content-Length': String(len) } : {}),
    },
  })
}
