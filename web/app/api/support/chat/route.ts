/**
 * Public IT-support chat (no auth required — anyone on /sign-in can use it).
 * Routes to Gemini with a system instruction that scopes it to login/VPN/access help.
 */
import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/ratelimit'

const SYSTEM_INSTRUCTION = `You are the IT support AI for DoppelDash, Doppelmayr India's internal enterprise platform. Help employees with login, OTP, VPN, password reset, or access issues.

Rules:
- Be professional, concise, tech-savvy. 1-3 short paragraphs max.
- Common issues: forgot password (manager/HR can reset), OTP not arriving (check spam, request resend after 60s, account may be new), locked out (5 failed OTPs → 1 min wait), wrong email (use work email like name@doppelmayr.in).
- If they need a password reset or are completely locked out, advise them to contact their manager or email IT-NaviMumbai@doppelmayr.com.
- NEVER give out actual passwords, OTPs, or any credentials.
- If asked about something unrelated to IT support (politics, code, etc.), politely redirect: "I'm here for DoppelDash login and access help only."`

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || 'unknown'
  if (!rateLimit(`support:${ip}`, 15, 60_000)) {
    return NextResponse.json({ error: 'Too many messages — wait a minute.' }, { status: 429 })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return NextResponse.json({ text: "AI assistant is not configured. Please email IT-NaviMumbai@doppelmayr.com for help." })

  const { messages } = await req.json() as { messages: { role: 'user' | 'model'; text: string }[] }
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'messages required' }, { status: 400 })
  }

  // Cap context to last 12 turns and strip any unsupported fields.
  // Gemini expects `contents` to be an array of objects with `parts` only.
  const trimmed = messages.slice(-12).map(m => ({
    parts: [{ text: `${m.role === 'user' ? 'User:' : 'Assistant:'} ${m.text.slice(0, 800)}` }],
  }))

  try {
    const res  = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          contents: trimmed,
          systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
          generationConfig:  { temperature: 0.7, maxOutputTokens: 400 },
        }),
        signal: AbortSignal.timeout(20_000),
      }
    )
    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      console.error('[support/chat] Gemini error:', res.status, errText)
      return NextResponse.json({ text: "I'm having trouble connecting right now. Please try again in a moment, or email IT-NaviMumbai@doppelmayr.com if it's urgent." })
    }
    const data = await res.json()
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I couldn't generate a response. Try rephrasing your question."
    return NextResponse.json({ text })
  } catch (e) {
    console.error('[support/chat] exception:', e)
    return NextResponse.json({ text: "Network hiccup. Try again, or email IT-NaviMumbai@doppelmayr.com." })
  }
}
