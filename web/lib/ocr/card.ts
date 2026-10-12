/** Business-card OCR: output sanitising + stored scanned-card input validation (nothing the model or a client sends is trusted). */
import { checkOcrImage } from './image'

export const CARD_FIELDS = ['name', 'email', 'phone', 'company', 'designation', 'address', 'website', 'linkedin'] as const
export type CardField = typeof CARD_FIELDS[number]
export type ParsedCard = Record<CardField, string | null>
export const EMPTY_CARD = (): ParsedCard => ({ name: null, email: null, phone: null, company: null, designation: null, address: null, website: null, linkedin: null })

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g
const MAX: Record<CardField, number> = { name: 200, email: 254, phone: 40, company: 200, designation: 200, address: 500, website: 300, linkedin: 300 }
const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']{2,}$/
const PHONE = /^[+\d][\d\s().-]{4,38}$/

const clean = (v: unknown, max: number) => {
  if (typeof v !== 'string') return null
  const t = v.replace(CONTROL, '').replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, max) : null
}
function httpUrl(v: string): string | null {
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`
  try { const u = new URL(withScheme); return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString().slice(0, 300) : null } catch { return null }
}

/** Per-field validation shared by OCR output and user-edited fields. Returns the cleaned value or undefined if invalid. */
export function cleanCardField(field: CardField, v: unknown): string | null | undefined {
  if (v === null || v === undefined || v === '') return null
  const t = clean(v, MAX[field])
  if (t === null) return typeof v === 'string' ? null : undefined
  if (field === 'email') return EMAIL.test(t) ? t.toLowerCase() : undefined
  if (field === 'phone') return PHONE.test(t) ? t : undefined
  if (field === 'website' || field === 'linkedin') return httpUrl(t) ?? undefined
  return t
}

/** OCR output → only valid known fields survive; invalid values become null (never an error, never a crash). */
export function sanitizeCard(raw: unknown): ParsedCard {
  const out = EMPTY_CARD()
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  for (const f of CARD_FIELDS) { const v = cleanCardField(f, (raw as Record<string, unknown>)[f]); out[f] = v === undefined ? null : v }
  return out
}

export interface CardInputOk { imageData?: string; ocrSource?: 'gemini' | 'ollama' | 'fallback'; rawText?: string; parsedFields?: Record<string, string>; contactId?: string }
export type CardInput = { ok: true; data: CardInputOk } | { ok: false; status: 400 | 413 | 415; error: string; fields?: string[] }

/** Validates the body of POST/PATCH /api/crm/scanned-cards[/id]. `requireImage` for creation. */
export function validateScannedCardInput(body: unknown, requireImage: boolean): CardInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, status: 400, error: 'Invalid request body' }
  const b = body as Record<string, unknown>
  const data: CardInputOk = {}
  if (b.imageData !== undefined || requireImage) {
    if (typeof b.imageData !== 'string' || !b.imageData) return { ok: false, status: 400, error: 'imageData required', fields: ['imageData'] }
    if (b.imageData.length > 1_500_000) return { ok: false, status: 400, error: 'imageData too large', fields: ['imageData'] }
    if (!/^data:image\/(jpeg|png|webp);base64,/i.test(b.imageData)) return { ok: false, status: 415, error: 'imageData must be a JPEG, PNG or WebP data URI', fields: ['imageData'] }
    const check = checkOcrImage({ imageBase64: b.imageData })
    if (!check.ok) return { ok: false, status: check.status === 413 ? 400 : check.status, error: check.error, fields: ['imageData'] }
    data.imageData = b.imageData
  }
  if (b.ocrSource !== undefined) {
    if (b.ocrSource !== 'gemini' && b.ocrSource !== 'ollama' && b.ocrSource !== 'fallback') return { ok: false, status: 400, error: 'Invalid ocrSource', fields: ['ocrSource'] }
    data.ocrSource = b.ocrSource
  }
  if (b.rawText !== undefined && b.rawText !== null) {
    if (typeof b.rawText !== 'string' || b.rawText.length > 5000) return { ok: false, status: 400, error: 'rawText is invalid or too long', fields: ['rawText'] }
    data.rawText = b.rawText
  }
  if (b.parsedFields !== undefined) {
    if (!b.parsedFields || typeof b.parsedFields !== 'object' || Array.isArray(b.parsedFields)) return { ok: false, status: 400, error: 'parsedFields must be an object', fields: ['parsedFields'] }
    const out: Record<string, string> = {}
    const bad: string[] = []
    for (const [k, v] of Object.entries(b.parsedFields as Record<string, unknown>)) {
      if (!(CARD_FIELDS as readonly string[]).includes(k)) { bad.push(k); continue } // unknown keys are rejected, not silently stored
      const c = cleanCardField(k as CardField, v)
      if (c === undefined) bad.push(k); else if (c) out[k] = c
    }
    if (bad.length) return { ok: false, status: 400, error: 'Some scanned fields are invalid', fields: bad }
    data.parsedFields = out
  }
  if (b.contactId !== undefined) { if (typeof b.contactId !== 'string') return { ok: false, status: 400, error: 'Invalid contactId', fields: ['contactId'] }; data.contactId = b.contactId }
  return { ok: true, data }
}
