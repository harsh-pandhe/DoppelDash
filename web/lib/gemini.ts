// Overridable (non-secret) so CI / local tests can point at a protocol-faithful fake instead of the real API.
// A base-URL override exists ONLY so tests can point at a local fake; it is ignored in production, so no environment
// mistake can route OCR traffic (or the API key) to anything but Google.
export function geminiBase() {
  const override = process.env.NODE_ENV !== 'production' ? process.env.GEMINI_API_BASE : ''
  return (override || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '') + '/v1beta/models'
}
const MODEL_FLASH = 'gemini-2.5-flash'

function key() {
  const k = process.env.GEMINI_API_KEY
  if (!k) throw new Error('GEMINI_API_KEY not set')
  return k
}

interface GeminiPart {
  text?: string
  inlineData?: { mimeType: string; data: string }
}

async function generate(parts: GeminiPart[], timeoutMs = 30_000): Promise<string> {
  const res = await fetch(
    `${geminiBase()}/${MODEL_FLASH}:generateContent?key=${key()}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] }),
      signal: AbortSignal.timeout(timeoutMs),
    }
  )
  // Never echo the provider's body (it can contain request fragments) — status only.
  if (!res.ok) throw new Error(`Gemini ${res.status}`)
  const data = await res.json()
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
}

/** Vision: extract text from image + prompt */
export async function geminiVision(prompt: string, base64: string, mimeType: string, timeoutMs?: number): Promise<string> {
  return generate([
    { text: prompt },
    { inlineData: { mimeType, data: base64 } },
  ], timeoutMs)
}

/** Text only: generate from prompt */
export async function geminiText(prompt: string): Promise<string> {
  return generate([{ text: prompt }])
}

/** Streaming text — yields tokens as they arrive */
export async function geminiStream(prompt: string): Promise<Response> {
  const res = await fetch(
    `${geminiBase()}/${MODEL_FLASH}:streamGenerateContent?alt=sse&key=${key()}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
      signal: AbortSignal.timeout(60_000),
    }
  )
  if (!res.ok) throw new Error(`Gemini stream ${res.status}`)
  return res
}
