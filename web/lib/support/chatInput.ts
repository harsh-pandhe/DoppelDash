/** Input contract of POST /api/support/chat — strict, bounded, and checked before any provider call. */
export const MAX_BODY_BYTES = 64 * 1024          // 12 × (800 + 2000) chars of 4-byte text is < 140 KB only in theory; real chat text is far below this
export const MAX_MESSAGES = 12
export const MAX_USER_CHARS = 800
export const MAX_MODEL_CHARS = 2000              // assistant turns are echoed back by the UI; the provider's own output cap is 400 tokens
export const MAX_REPLY_CHARS = 2000

export type ChatRole = 'user' | 'model'
export type ChatTurn = { role: ChatRole; text: string }
export type ParsedChat = { ok: true; turns: ChatTurn[] } | { ok: false; status: 400 | 413; error: string; code?: string }

const tooLarge = (): ParsedChat => ({ ok: false, status: 413, error: 'Request too large', code: 'payload_too_large' })

/**
 * Reads the request body while enforcing the byte limit AS IT STREAMS: a missing or dishonest Content-Length cannot make the
 * server buffer more than MAX_BODY_BYTES (+ one chunk). Returns null when the limit is exceeded.
 */
export async function readBodyLimited(req: Request, maxBytes = MAX_BODY_BYTES): Promise<string | null> {
  const declared = Number(req.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) return null
  if (!req.body) return ''
  const reader = req.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > maxBytes) { await reader.cancel().catch(() => {}); return null }
      chunks.push(value)
    }
  } catch { return '' }
  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks))
}

export function parseChatBody(raw: string | null): ParsedChat {
  if (raw === null) return tooLarge()
  let body: unknown
  try { body = JSON.parse(raw) } catch { return { ok: false, status: 400, error: 'Invalid JSON body' } }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, status: 400, error: 'Invalid request body' }
  const messages = (body as { messages?: unknown }).messages
  if (!Array.isArray(messages) || messages.length === 0) return { ok: false, status: 400, error: 'messages required' }
  if (messages.length > MAX_MESSAGES) return { ok: false, status: 400, error: `Conversation too long — max ${MAX_MESSAGES} messages.` }

  const turns: ChatTurn[] = []
  for (const m of messages) {
    if (!m || typeof m !== 'object' || Array.isArray(m)) return { ok: false, status: 400, error: 'Invalid message' }
    const { role, text } = m as { role?: unknown; text?: unknown }
    if (role !== 'user' && role !== 'model') return { ok: false, status: 400, error: 'Unsupported message role' }
    if (typeof text !== 'string') return { ok: false, status: 400, error: 'Each message must be text' }
    const max = role === 'user' ? MAX_USER_CHARS : MAX_MODEL_CHARS
    if (Array.from(text).length > max) return { ok: false, status: 400, error: `Each message must be under ${role === 'user' ? MAX_USER_CHARS : MAX_MODEL_CHARS} characters.` }
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)) return { ok: false, status: 400, error: 'Message contains unsupported characters' }
    if (text.trim() === '') return { ok: false, status: 400, error: 'Messages cannot be empty' }
    turns.push({ role, text: text.trim() })   // only role + text are kept: no other caller-supplied field can travel onward
  }
  if (turns[turns.length - 1].role !== 'user') return { ok: false, status: 400, error: 'The last message must be from the user' }
  // The UI opens with an assistant greeting; providers expect a conversation to start with the user.
  while (turns.length > 1 && turns[0].role === 'model') turns.shift()
  return { ok: true, turns }
}
