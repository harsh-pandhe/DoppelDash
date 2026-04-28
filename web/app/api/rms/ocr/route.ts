import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { rateLimit } from '@/lib/ratelimit'

const OLLAMA_URL   = process.env.OLLAMA_URL   || 'http://localhost:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma4:e4b'

const RECEIPT_PROMPT = `You are a receipt and invoice OCR assistant. Look at this bill/receipt/invoice image carefully.
Extract the key expense information and return ONLY a valid JSON object — no explanation, no markdown.
Use null for any field you cannot find.

Required format:
{
  "title": "short expense title (e.g. 'Hotel Stay - Taj Mumbai', 'Air ticket Mumbai to Delhi', 'Client dinner at Trident')",
  "vendor": "vendor or merchant name",
  "amount": number or null (total amount as a number, no currency symbol, e.g. 4500 not '₹4,500'),
  "date": "YYYY-MM-DD format if found, else null",
  "description": "brief one-line description of what was purchased"
}`

async function extractWithGemma(base64Image: string): Promise<Record<string, string | number | null>> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:  OLLAMA_MODEL,
      stream: false,
      messages: [{
        role:    'user',
        content: RECEIPT_PROMPT,
        images:  [base64Image],
      }],
    }),
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) throw new Error(`Ollama ${res.status}`)
  const data  = await res.json()
  const text: string = data?.message?.content || ''
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) throw new Error('No JSON in response')
  return JSON.parse(match[0])
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`rms-ocr:${userId}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
  }

  let body: { imageBase64?: string; mimeType?: string }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400 }) }

  if (!body.imageBase64) {
    return NextResponse.json({ error: 'imageBase64 required' }, { status: 400 })
  }

  let parsed: Record<string, string | number | null>
  let source: 'gemma' | 'fallback' = 'gemma'

  try {
    parsed = await extractWithGemma(body.imageBase64)
  } catch (err) {
    console.error('[RMS OCR] Gemma failed:', err)
    source = 'fallback'
    parsed = { title: null, vendor: null, amount: null, date: null, description: null }
  }

  return NextResponse.json({ parsed, source })
}
