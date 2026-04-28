import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { connectDB } from '@/lib/db'
import Contact from '@/models/Contact'
import { rateLimit } from '@/lib/ratelimit'

const MESSAGE_PROMPTS: Record<string, (c: { name: string; company?: string; designation?: string }) => string> = {
  birthday: c =>
    `Write a warm, professional birthday greeting for ${c.name}${c.designation ? `, ${c.designation}` : ''}${c.company ? ` at ${c.company}` : ''}. Keep it 2-3 sentences, genuine, not overly formal.`,

  'follow-up': c =>
    `Write a professional follow-up email for ${c.name}${c.designation ? `, ${c.designation}` : ''}${c.company ? ` at ${c.company}` : ''} after a recent meeting. Keep it concise, 3-4 sentences, end with a call to action.`,

  'meeting-request': c =>
    `Write a brief meeting request email to ${c.name}${c.designation ? `, ${c.designation}` : ''}${c.company ? ` at ${c.company}` : ''}. Propose a 30-minute call, keep it under 4 sentences, professional and direct.`,

  introduction: c =>
    `Write a short professional introduction message to ${c.name}${c.designation ? `, ${c.designation}` : ''}${c.company ? ` at ${c.company}` : ''}. Introduce yourself as a representative from Doppelmayr India. 3 sentences max.`,
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 20 generations per hour per user
  if (!rateLimit(`generate:${userId}`, 20, 60 * 60_000)) {
    return NextResponse.json({ error: 'Too many requests — try again later' }, { status: 429 })
  }

  const { contactId, messageType } = await req.json()
  if (!contactId || !messageType) return NextResponse.json({ error: 'contactId and messageType required' }, { status: 400 })

  await connectDB()
  const contact = await Contact.findOne({ _id: contactId, createdBy: userId }).lean() as {
    name: string; company?: string; designation?: string
  } | null
  if (!contact) return NextResponse.json({ error: 'Contact not found' }, { status: 404 })

  const promptFn = MESSAGE_PROMPTS[messageType]
  if (!promptFn) return NextResponse.json({ error: 'Unknown message type' }, { status: 400 })

  const prompt = promptFn(contact)

  const ollamaUrl = process.env.OLLAMA_URL || 'http://localhost:11434'
  const model     = process.env.OLLAMA_MODEL || 'gemma4:e4b'

  try {
    const res = await fetch(`${ollamaUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [{ role: 'user', content: prompt }],
      }),
      signal: AbortSignal.timeout(90_000),
    })

    if (!res.ok) return NextResponse.json({ error: 'AI request failed' }, { status: 502 })
    const data = await res.json()
    const text: string = data?.message?.content || ''
    return NextResponse.json({ message: text })
  } catch {
    return NextResponse.json({ error: 'Could not reach Ollama. Is it running?' }, { status: 503 })
  }
}
