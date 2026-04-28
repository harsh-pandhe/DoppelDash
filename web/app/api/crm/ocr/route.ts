import { NextRequest, NextResponse } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { connectDB } from '@/lib/db'
import Contact from '@/models/Contact'
import { rateLimit } from '@/lib/ratelimit'

const OLLAMA_URL   = process.env.OLLAMA_URL   || 'http://localhost:11434'
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'gemma4:e4b'

const OCR_PROMPT = `You are a business card OCR assistant. Look at this business card image carefully.
Extract all contact information and return ONLY a valid JSON object — no explanation, no markdown.
Use null for any field you cannot find.

Required format:
{
  "name": "full name of the person",
  "email": "email address",
  "phone": "phone number with country code if present",
  "company": "company or organisation name",
  "designation": "job title or designation",
  "address": "full address if present",
  "website": "website URL if present",
  "linkedin": "linkedin profile URL if present"
}`

async function extractWithGemma(base64Image: string, mimeType: string) {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: false,
      messages: [{
        role: 'user',
        content: OCR_PROMPT,
        images: [base64Image],
      }],
    }),
    signal: AbortSignal.timeout(120_000),
  })

  if (!res.ok) throw new Error(`Ollama ${res.status}`)
  const data = await res.json()
  const text: string = data?.message?.content || ''

  // Extract JSON from response (model may wrap in ```json ... ```)
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('No JSON in response')
  return JSON.parse(jsonMatch[0]) as Record<string, string | null>
}

function fallbackParse(text: string): Record<string, string | null> {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  const emailMatch = text.match(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/i)
  const phoneMatch = text.match(/(?:\+91[\s\-]?)?(?:\(?\d{3,5}\)?[\s\-]?)?\d{3}[\s\-]?\d{4}/g)
  const urlMatch   = text.match(/(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9\-]+\.[a-zA-Z]{2,}(?:\/\S*)?/i)
  const ignored    = new Set(['phone','mobile','email','tel','fax','www','http','https','address','pvt','ltd','inc'])
  const candidates = lines.filter(l =>
    l.length > 3 && l.length < 50 &&
    !l.includes('@') && !/\d{4,}/.test(l) &&
    l.split(' ').every(w => !ignored.has(w.toLowerCase()))
  )
  return {
    name: candidates[0] || null,
    email: emailMatch?.[0] || null,
    phone: phoneMatch?.[0]?.replace(/\s/g, '') || null,
    company: candidates[1] || null,
    designation: null,
    address: null,
    website: urlMatch?.[0] || null,
    linkedin: null,
  }
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`ocr:${userId}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests — wait a minute' }, { status: 429 })
  }

  let body: { imageBase64?: string; mimeType?: string; imageUrl?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  // Accept either base64 (new flow) or imageUrl (legacy scan page)
  let base64Image: string | null = body.imageBase64 || null
  let mimeType = body.mimeType || 'image/jpeg'

  // Legacy: if only imageUrl sent, read file from disk and convert to base64
  if (!base64Image && body.imageUrl) {
    try {
      const { readFile } = await import('fs/promises')
      const { join } = await import('path')
      const filePath = join(process.cwd(), 'public', body.imageUrl)
      const fileBuffer = await readFile(filePath)
      base64Image = fileBuffer.toString('base64')
      if (body.imageUrl.endsWith('.png')) mimeType = 'image/png'
    } catch {
      return NextResponse.json({ error: 'Image not found' }, { status: 400 })
    }
  }

  if (!base64Image) {
    return NextResponse.json({ error: 'imageBase64 or imageUrl required' }, { status: 400 })
  }

  let parsed: Record<string, string | null>
  let source: 'gemma' | 'fallback' = 'gemma'

  try {
    parsed = await extractWithGemma(base64Image, mimeType)
  } catch (err) {
    console.error('[OCR] Gemma vision failed, using fallback:', err)
    source = 'fallback'
    // Fallback: empty result so user fills manually
    parsed = { name: null, email: null, phone: null, company: null, designation: null, address: null, website: null, linkedin: null }
  }

  // Deduplication check
  await connectDB()
  let existing = null
  if (parsed.email) existing = await Contact.findOne({ createdBy: userId, email: parsed.email }).lean()
  if (!existing && parsed.phone) existing = await Contact.findOne({ createdBy: userId, phone: parsed.phone }).lean()

  return NextResponse.json({
    parsed,
    source,
    existingId: existing ? String((existing as { _id: unknown })._id) : null,
  })
}
