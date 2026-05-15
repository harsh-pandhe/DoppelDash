const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'
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

async function generate(parts: GeminiPart[]): Promise<string> {
  const res = await fetch(
    `${GEMINI_BASE}/${MODEL_FLASH}:generateContent?key=${key()}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts }] }),
      signal: AbortSignal.timeout(30_000),
    }
  )
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? ''
}

/** Vision: extract text from image + prompt */
export async function geminiVision(prompt: string, base64: string, mimeType: string): Promise<string> {
  return generate([
    { text: prompt },
    { inlineData: { mimeType, data: base64 } },
  ])
}

/** Text only: generate from prompt */
export async function geminiText(prompt: string): Promise<string> {
  return generate([{ text: prompt }])
}

/** Streaming text — yields tokens as they arrive */
export async function geminiStream(prompt: string): Promise<Response> {
  const res = await fetch(
    `${GEMINI_BASE}/${MODEL_FLASH}:streamGenerateContent?alt=sse&key=${key()}`,
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
