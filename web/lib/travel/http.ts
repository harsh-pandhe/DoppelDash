import { NextRequest, NextResponse } from 'next/server'
import { MAX_BODY_BYTES } from '@/lib/travel/validation'

/** Reads and parses the JSON body with a size cap; any problem is a clean 4xx, never an unhandled error. */
export async function readJson(req: NextRequest): Promise<{ body: unknown } | { response: NextResponse }> {
  let raw = ''
  try { raw = await req.text() } catch { return { response: NextResponse.json({ error: 'Invalid request body', fields: ['body'], code: 'invalid_json' }, { status: 400 }) } }
  if (raw.length > MAX_BODY_BYTES) return { response: NextResponse.json({ error: 'Request too large', fields: ['body'], code: 'body_too_large' }, { status: 413 }) }
  try { return { body: JSON.parse(raw) } } catch { return { response: NextResponse.json({ error: 'Invalid request body', fields: ['body'], code: 'invalid_json' }, { status: 400 }) } }
}

/**
 * THE Travel error envelope: `{ error: <human message>, code: <stable machine code>, fields?: [...], ...extra }` with the HTTP status that
 * existing clients rely on. `error` is safe to show to users; nothing internal (stack, driver text, ids of other tenants) is ever put in it.
 */
export function apiError(status: number, error: string, code: string, extra: Record<string, unknown> = {}, headers?: Record<string, string>) {
  return NextResponse.json({ error, code, ...extra }, { status, headers })
}
