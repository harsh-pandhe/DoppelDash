import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Contact from '@/models/Contact'
import { rateLimit } from '@/lib/ratelimit'
import { getUser } from '@/lib/auth'
import { geminiText, geminiStream } from '@/lib/gemini'

const enc = new TextEncoder()
const sseToken = (token: string) => enc.encode(`data: ${JSON.stringify({ token })}\n\n`)
const sseDone = () => enc.encode('data: [DONE]\n\n')

/** Gemini fallback as an SSE stream in the same {token} shape the client parses. */
async function geminiSSE(prompt: string): Promise<Response> {
  const upstream = await geminiStream(prompt)
  const readable = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader()
      const decoder = new TextDecoder()
      try {
        let buf = ''
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          buf += decoder.decode(value, { stream: true })
          for (const line of buf.split('\n')) {
            const l = line.trim()
            if (!l.startsWith('data:')) continue
            try {
              const j = JSON.parse(l.slice(5).trim())
              const t = j?.candidates?.[0]?.content?.parts?.[0]?.text || ''
              if (t) controller.enqueue(sseToken(t))
            } catch { /* skip partial */ }
          }
          buf = buf.slice(buf.lastIndexOf('\n') + 1)
        }
      } finally {
        controller.enqueue(sseDone())
        controller.close()
      }
    },
  })
  return new Response(readable, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' } })
}

const MESSAGE_PROMPTS: Record<string, (c: { name: string; company?: string; designation?: string }, context?: string) => string> = {
  birthday: (c, ctx) =>
    `Write a warm, professional birthday greeting for ${c.name}${c.designation ? `, ${c.designation}` : ''}${c.company ? ` at ${c.company}` : ''}.${ctx ? ` Context: ${ctx}.` : ''} Keep it 2-3 sentences, genuine, not overly formal. Output only the message text, no subject line.`,

  'follow-up': (c, ctx) =>
    `Write a professional follow-up email body for ${c.name}${c.designation ? `, ${c.designation}` : ''}${c.company ? ` at ${c.company}` : ''} from Doppelmayr India.${ctx ? ` Context/goal: ${ctx}.` : ''} Keep it concise, 3-4 sentences, end with a clear call to action. Output only the email body, no subject line, no greeting like "Dear".`,

  'meeting-request': (c, ctx) =>
    `Write a brief meeting request email body to ${c.name}${c.designation ? `, ${c.designation}` : ''}${c.company ? ` at ${c.company}` : ''} from Doppelmayr India.${ctx ? ` Purpose: ${ctx}.` : ''} Propose a 30-minute call, keep it under 4 sentences, professional and direct. Output only the email body.`,

  introduction: (c, ctx) =>
    `Write a short professional introduction message to ${c.name}${c.designation ? `, ${c.designation}` : ''}${c.company ? ` at ${c.company}` : ''}. Introduce yourself as a representative from Doppelmayr India.${ctx ? ` Additional context: ${ctx}.` : ''} 3 sentences max. Output only the message text.`,
}

export async function POST(req: NextRequest) {
  const { userId, user } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`generate:${userId}`, 20, 60 * 60_000)) {
    return NextResponse.json({ error: 'Too many requests — try again later' }, { status: 429 })
  }

  const body = await req.json()
  const { contactId, messageType, context, prompt: rawPrompt } = body

  let prompt: string

  if (rawPrompt) {
    // Campaign/direct prompt mode
    prompt = rawPrompt
  } else {
    if (!contactId || !messageType) return NextResponse.json({ error: 'contactId and messageType required' }, { status: 400 })
    await connectDB()

    const role = user?.role || 'employee'
    const visClauses: Record<string, unknown>[] = [
      { createdBy: userId },
      { visibility: 'org' },
      { sharedWith: userId },
    ]
    if (role === 'manager' || role === 'boss') visClauses.push({ visibility: 'team' })
    if (role === 'boss') visClauses.push({ visibility: 'boss_only' })

    const contact = await Contact.findOne({
      _id: contactId,
      $or: visClauses,
    }).lean() as {
      name: string; company?: string; designation?: string
    } | null
    if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })
    const promptFn = MESSAGE_PROMPTS[messageType]
    if (!promptFn) return NextResponse.json({ error: 'Unknown message type' }, { status: 400 })
    prompt = promptFn(contact, context)
  }

  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434'
  const model     = process.env.OLLAMA_MODEL || 'gemma3:4b'

  const stream = req.headers.get('accept')?.includes('text/event-stream')

  // Ollama (local/dev) is primary; if unreachable (e.g. prod on Netlify), fall back to Gemini.
  let res: Response
  try {
    res = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: stream,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(8_000),   // fail fast → fall back to Gemini
    })
    if (!res.ok) throw new Error(`ollama ${res.status}`)
  } catch {
    // Ollama down → Gemini fallback
    try {
      if (stream) return await geminiSSE(prompt)
      const text = await geminiText(prompt)
      return NextResponse.json({ text, message: text })
    } catch (e) {
      return NextResponse.json({ error: `AI unavailable: ${(e as Error).message}` }, { status: 503 })
    }
  }

  try {
    if (stream && res.body) {
      // Stream SSE back to client
      const encoder = new TextEncoder()
      const readable = new ReadableStream({
        async start(controller) {
          const reader = res.body!.getReader()
          const decoder = new TextDecoder()
          try {
            while (true) {
              const { done, value } = await reader.read()
              if (done) break
              const chunk = decoder.decode(value)
              const lines = chunk.split('\n').filter(Boolean)
              for (const line of lines) {
                try {
                  const json = JSON.parse(line)
                  const token = json?.message?.content || ''
                  if (token) {
                    controller.enqueue(encoder.encode(`data: ${JSON.stringify({ token })}\n\n`))
                  }
                  if (json.done) {
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'))
                  }
                } catch { /* skip malformed line */ }
              }
            }
          } finally {
            controller.close()
          }
        }
      })
      return new Response(readable, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        },
      })
    }

    const data = await res.json()
    const text: string = data?.message?.content || ''
    // Return both `text` (legacy campaigns) and `message` (contact profile)
    return NextResponse.json({ text, message: text })
  } catch {
    return NextResponse.json({ error: 'AI generation failed' }, { status: 502 })
  }
}
