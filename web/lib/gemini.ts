// Overridable (non-secret) so CI / local tests can point at a protocol-faithful fake instead of the real API.
// A base-URL override exists ONLY so tests can point at a local fake; it is ignored in production, so no environment
// mistake can route OCR traffic (or the API key) to anything but Google.
export function geminiBase() {
  const override = process.env.NODE_ENV !== 'production' ? process.env.GEMINI_API_BASE : ''
  return (override || 'https://generativelanguage.googleapis.com').replace(/\/+$/, '') + '/v1beta/models'
}
// Google retires model versions for NEW keys ("no longer available to new users" -> HTTP 404, found by the live staging OCR check with a newly created key),
// so the default is the stable alias that Google keeps pointing at the current Flash model. A specific model can be pinned with GEMINI_MODEL
// (restricted to a safe name shape, so the environment can never inject path segments or another host).
export function geminiModel(env: NodeJS.ProcessEnv = process.env): string {
  const m = (env.GEMINI_MODEL || '').trim()
  return /^[a-z0-9][a-z0-9.\-]{2,60}$/.test(m) ? m : 'gemini-flash-latest'
}

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
    `${geminiBase()}/${geminiModel()}:generateContent?key=${key()}`,
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
    `${geminiBase()}/${geminiModel()}:streamGenerateContent?alt=sse&key=${key()}`,
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
