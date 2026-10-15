import { NextResponse } from 'next/server'

/**
 * Reads a request body that must be a JSON OBJECT. Returns null for invalid JSON, `null`, arrays and scalars — callers answer 400 with
 * `badBody()` instead of letting an unhandled exception become a 500 (found by the malformed-input sweep).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJsonObject<T extends Record<string, any> = Record<string, any>>(req: Request): Promise<T | null> {
  try {
    const v = await req.json()
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as T) : null
  } catch { return null }
}

export const badBody = () => NextResponse.json({ error: 'Invalid request', fields: ['body'] }, { status: 400 })
