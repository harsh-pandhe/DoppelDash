/**
 * Public IT-support chat (no auth required — anyone on /sign-in can use it).
 * Routes to Gemini with a system instruction that scopes it to login/VPN/access help.
 */
import { NextRequest, NextResponse } from 'next/server'
import { rateLimit } from '@/lib/ratelimit'

import { SUPPORT_CONFIG } from '@/lib/config/support'

const SYSTEM_INSTRUCTION = `You are the IT support AI for DoppelDash. Help users with sign-in, verification codes, passkeys, authenticator apps, password reset, or access issues.

Rules:
- Be professional, concise, tech-savvy. 1-3 short paragraphs max.
- Common issues: forgot password (use the forgot password link or contact manager), email code not arriving (check spam/junk, press "Resend code" after 60s, or switch to the Authenticator tab if set up), locked out (5 failed codes → 1 min wait), passkey prompt dismissed (just click the passkey button again), lost phone with authenticator (use email code, then re-set up in Profile → Security).
- Recommend setting up a passkey or authenticator app in Profile → Security to anyone who reports email/OTP delivery problems.
- If they need a password reset or are completely locked out, advise them to contact their manager or email ${SUPPORT_CONFIG.supportEmail}.
- NEVER give out actual passwords, verification codes, or any credentials.
- If asked about something unrelated to IT support (politics, code, etc.), politely redirect: "I'm here for DoppelDash login and access help only."`

const MAX_TURNS = 12
const MAX_CHARS = 800
const IT_FALLBACK = `Our assistant is busy right now. Please email ${SUPPORT_CONFIG.supportEmail} and the team will help you sign in.`

export async function POST(req: NextRequest) {
  const ip = req.headers.get('x-forwarded-for') || 'unknown'
  if (!(await rateLimit(`support:${ip}`, 8, 60_000))) {
    return NextResponse.json({ error: 'Too many messages — wait a minute.' }, { status: 429 })
  }

  // This endpoint is unauthenticated by design (pre-login IT help), so per-IP
  // limits alone don't bound spend — a distributed caller trivially sidesteps
  // them. A global daily ceiling caps worst-case Gemini cost.
  if (!(await rateLimit('support:global', 2000, 24 * 60 * 60_000))) {
    return NextResponse.json({ text: IT_FALLBACK })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) return NextResponse.json({ text: `AI assistant is not configured. Please email ${SUPPORT_CONFIG.supportEmail} for help.` })

  const { messages } = await req.json() as { messages: { role: 'user' | 'model'; text: string }[] }
  if (!Array.isArray(messages) || messages.length === 0) {
    return NextResponse.json({ error: 'messages required' }, { status: 400 })
  }

  // Reject oversized input rather than silently truncating it — validate before
  // spending an API call, not after.
  if (messages.length > MAX_TURNS) {
    return NextResponse.json({ error: `Conversation too long — max ${MAX_TURNS} messages.` }, { status: 400 })
  }
  if (messages.some(m => typeof m?.text !== 'string' || m.text.length > MAX_CHARS)) {
    return NextResponse.json({ error: `Each message must be text under ${MAX_CHARS} characters.` }, { status: 400 })
  }

  // Gemini expects `contents` to be an array of objects with `parts` only.
  const trimmed = messages.map(m => ({
    parts: [{ text: `${m.role === 'user' ? 'User:' : 'Assistant:'} ${m.text}` }],
  }))

  try {
    const res  = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent',
      {
        method:  'POST',
        // Key in a header, not the query string — URLs land in proxy/CDN logs.
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
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
      return NextResponse.json({ text: `I'm having trouble connecting right now. Please try again in a moment, or email ${SUPPORT_CONFIG.supportEmail} if it's urgent.` })
    }
    const data = await res.json()
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "Sorry, I couldn't generate a response. Try rephrasing your question."
    return NextResponse.json({ text })
  } catch (e) {
    console.error('[support/chat] exception:', e)
    return NextResponse.json({ text: `Network hiccup. Try again, or email ${SUPPORT_CONFIG.supportEmail}.` })
  }
}
