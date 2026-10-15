import { NextRequest, NextResponse } from 'next/server'
import { connectDB } from '@/lib/db'
import Contact from '@/models/Contact'
import { rateLimit } from '@/lib/ratelimit'
import { geminiVision } from '@/lib/gemini'
import { getUser } from '@/lib/auth'
import { canUseFeature } from '@/lib/entitlements/entitlementService'
import { checkOcrImage, MAX_OCR_IMAGE_BYTES } from '@/lib/ocr/image'
import { extractJson, ollamaConfigured, OCR_DEADLINE_MS } from '@/lib/ocr/receiptOcr'
import { sanitizeCard, EMPTY_CARD } from '@/lib/ocr/card'

const OCR_PROMPT = `You are a business card OCR assistant. Look at this business card image carefully.
Extract all contact information and return ONLY a valid JSON object — no explanation, no markdown, no code fences.
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

async function extractWithGemini(base64Image: string, mimeType: string, timeoutMs: number) {
  if (!process.env.GEMINI_API_KEY) throw new Error('gemini not configured')
  const parsed = extractJson(await geminiVision(OCR_PROMPT, base64Image, mimeType, timeoutMs))
  if (!parsed) throw new Error('No JSON in Gemini response')
  return parsed
}

async function extractWithOllama(base64Image: string, timeoutMs: number) {
  const url = (process.env.OLLAMA_URL || '').trim().replace(/\/+$/, '')
  if (!url) throw new Error('ollama not configured')
  const res = await fetch(`${url}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OLLAMA_MODEL || 'gemma3:4b', stream: false,
      messages: [{ role: 'user', content: OCR_PROMPT, images: [base64Image] }],
    }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`Ollama ${res.status}`)
  const data = await res.json()
  const parsed = extractJson(typeof data?.message?.content === 'string' ? data.message.content : '')
  if (!parsed) throw new Error('No JSON in response')
  return parsed
}

export async function POST(req: NextRequest) {
  const { userId, orgId } = await getUser()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!(await rateLimit(`ocr:${userId}`, 10, 60_000))) {
    return NextResponse.json({ error: 'Too many requests — wait a minute', code: 'rate_limited' }, { status: 429 })
  }

  let body: { imageBase64?: unknown; mimeType?: unknown; imageUrl?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body', code: 'invalid_body' }, { status: 400 })
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Invalid request body', code: 'invalid_body' }, { status: 400 })

  if (!(await canUseFeature(orgId, 'ocrBusinessCards'))) {
    return NextResponse.json({ error: 'Business-card scanning is not available on your plan. Upgrade to Premium.', code: 'feature_unavailable' }, { status: 403 })
  }

  // Accept either base64 (current flow) or imageUrl (legacy scan page: a file under /public)
  let imageBase64: unknown = body.imageBase64
  if (!imageBase64 && typeof body.imageUrl === 'string') {
    try {
      const path = await import('path')
      const publicDir = path.resolve(process.cwd(), 'public')
      const filePath = path.resolve(publicDir, body.imageUrl.replace(/^\/+/, ''))
      // path.relative (not startsWith): '/x/public-secrets' must not pass as being inside '/x/public'
      const rel = path.relative(publicDir, filePath)
      if (!rel || rel.startsWith('..') || path.isAbsolute(rel) || !/\.(png|jpe?g|webp)$/i.test(filePath)) {
        return NextResponse.json({ error: 'Invalid image path', code: 'invalid_path' }, { status: 400 })
      }
      const { readFile, stat } = await import('fs/promises')
      if ((await stat(filePath)).size > MAX_OCR_IMAGE_BYTES) return NextResponse.json({ error: 'Image is too large to scan.', code: 'image_too_large' }, { status: 413 })
      imageBase64 = (await readFile(filePath)).toString('base64')
    } catch {
      return NextResponse.json({ error: 'Image not found', code: 'image_not_found' }, { status: 400 })
    }
  }

  const img = checkOcrImage({ imageBase64, mimeType: body.mimeType })
  if (!img.ok) return NextResponse.json({ error: img.error, code: img.code }, { status: img.status })

  // gemini → ollama (only if configured) → empty fallback, under one deadline; output is validated field by field.
  const t0 = Date.now()
  const left = () => Math.max(1000, OCR_DEADLINE_MS - (Date.now() - t0))
  let parsed = EMPTY_CARD()
  let source: 'gemini' | 'ollama' | 'fallback' = 'fallback'
  for (const [name, run] of [
    ['gemini', () => extractWithGemini(img.base64, img.mime, left())],
    ['ollama', () => extractWithOllama(img.base64, left())],
  ] as const) {
    if (Date.now() - t0 >= OCR_DEADLINE_MS) break
    if (name === 'ollama' && !ollamaConfigured()) continue
    try {
      const candidate = sanitizeCard(await run())
      if (Object.values(candidate).some(Boolean)) { parsed = candidate; source = name; break }
    } catch (err) {
      console.error(`[OCR] ${name} failed:`, (err as Error)?.name === 'TimeoutError' ? 'timeout' : (err as Error)?.message?.slice(0, 120))
    }
  }

  // Deduplication check (parsed values are validated strings, never operators)
  await connectDB()
  let existing = null
  if (parsed.email) existing = await Contact.findOne({ orgId, createdBy: userId, email: parsed.email }).lean()
  if (!existing && parsed.phone) existing = await Contact.findOne({ orgId, createdBy: userId, phone: parsed.phone }).lean()

  return NextResponse.json({
    parsed,
    source,
    existingId: existing ? String((existing as { _id: unknown })._id) : null,
  })
}
