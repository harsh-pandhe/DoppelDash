/**
 * Receipt OCR pipeline — exactly the providers that exist in this codebase, in this order:
 *
 *   image ──▶ Gemini (lib/gemini, if GEMINI_API_KEY is set)
 *         └─▶ Ollama (only if OLLAMA_URL is configured — a local/dev model, unreachable from serverless)
 *             └─▶ empty "fallback" result (the user fills the form by hand)
 *
 * The whole chain runs under one deadline (serverless functions die at ~10–26 s), a provider that errors, times out
 * or returns garbage just hands over to the next, and NOTHING the model says is trusted: every field is validated
 * and clamped by [sanitizeReceipt] before it can reach the client, and OCR output can never carry server-owned or
 * approval fields (only title / vendor / amount / date / description survive).
 */
import { geminiVision } from '@/lib/gemini'
import { MAX_EXPENSE_AMOUNT } from '@/lib/expenses/validation'
import type { OcrImageMime } from './image'

export const RECEIPT_PROMPT = `You are a receipt and invoice OCR assistant. Look at this bill/receipt/invoice image carefully.
Extract the key expense information and return ONLY a valid JSON object — no explanation, no markdown.
Use null for any field you cannot find.

Required format:
{
  "title": "short expense title (e.g. 'Hotel Stay - Taj Mumbai', 'Air ticket Mumbai to Delhi', 'Client dinner at Trident')",
  "vendor": "vendor or merchant name",
  "amount": number or null (total amount as a number, no currency symbol, e.g. 4500 not '₹4,500'),
  "date": "YYYY-MM-DD format if found, else null",
  "description": "brief one-line description of what was purchased"
}`

export interface ParsedReceipt { title: string | null; vendor: string | null; amount: number | null; date: string | null; description: string | null }
export type OcrProvider = 'gemini' | 'ollama' | 'fallback'
export const EMPTY_RECEIPT: ParsedReceipt = { title: null, vendor: null, amount: null, date: null, description: null }
export const OCR_DEADLINE_MS = Number(process.env.OCR_DEADLINE_MS) || 22_000

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g
const str = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const t = v.replace(CONTROL, '').replace(/\s+/g, ' ').trim()
  return t.length === 0 ? null : t.slice(0, max)
}

function amountOf(v: unknown): number | null {
  let n: number
  if (typeof v === 'number') n = v
  else if (typeof v === 'string') {
    const cleaned = v.replace(/[^\d.,-]/g, '').replace(/,(?=\d{3}(\D|$))/g, '').replace(',', '.')
    if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null
    n = Number(cleaned)
  } else return null
  if (!Number.isFinite(n) || n <= 0 || n > MAX_EXPENSE_AMOUNT) return null
  return Math.round(n * 100) / 100
}

function dateOf(v: unknown, now = new Date()): string | null {
  if (typeof v !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim())
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null // e.g. 2026-02-31
  if (y < 2000 || dt.getTime() > now.getTime() + 86_400_000) return null // implausible / future
  return `${m[1]}-${m[2]}-${m[3]}`
}

/** Validates + clamps an arbitrary model answer into the only shape the app accepts. Unknown keys are dropped. */
export function sanitizeReceipt(raw: unknown, now = new Date()): ParsedReceipt {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ...EMPTY_RECEIPT }
  const r = raw as Record<string, unknown>
  return {
    title: str(r.title, 200),
    vendor: str(r.vendor, 200),
    amount: amountOf(r.amount),
    date: dateOf(r.date, now),
    description: str(r.description, 500),
  }
}
export const isEmptyReceipt = (p: ParsedReceipt) => Object.values(p).every(v => v === null)

/** Pulls the first JSON object out of a model reply (tolerates prose and ``` fences); null if there is none. */
export function extractJson(text: string): unknown {
  const fenced = text.replace(/```(?:json)?/gi, '')
  const start = fenced.indexOf('{')
  const end = fenced.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { return JSON.parse(fenced.slice(start, end + 1)) } catch { return null }
}

export const ollamaConfigured = () => !!(process.env.OLLAMA_URL || '').trim()

async function viaGemini(b64: string, mime: OcrImageMime, timeoutMs: number): Promise<unknown> {
  if (!process.env.GEMINI_API_KEY) throw new Error('gemini not configured')
  return extractJson(await geminiVision(RECEIPT_PROMPT, b64, mime, timeoutMs))
}

async function viaOllama(b64: string, timeoutMs: number): Promise<unknown> {
  const url = (process.env.OLLAMA_URL || '').trim().replace(/\/+$/, '')
  if (!url) throw new Error('ollama not configured')
  const res = await fetch(`${url}/api/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: process.env.OLLAMA_MODEL || 'gemma3:4b', stream: false, messages: [{ role: 'user', content: RECEIPT_PROMPT, images: [b64] }] }),
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (!res.ok) throw new Error(`ollama ${res.status}`)
  const data = await res.json()
  return extractJson(typeof data?.message?.content === 'string' ? data.message.content : '')
}

export interface ReceiptOcrResult { parsed: ParsedReceipt; provider: OcrProvider; attempts: { provider: 'gemini' | 'ollama'; outcome: 'ok' | 'empty' | 'error' }[] }

/** Runs the chain; never throws. `empty` / `error` from one provider falls through to the next. */
export async function runReceiptOcr(b64: string, mime: OcrImageMime, deadlineMs = OCR_DEADLINE_MS): Promise<ReceiptOcrResult> {
  const t0 = Date.now()
  const left = () => Math.max(1000, deadlineMs - (Date.now() - t0))
  const attempts: ReceiptOcrResult['attempts'] = []
  const steps: ['gemini' | 'ollama', () => Promise<unknown>][] = []
  if (process.env.GEMINI_API_KEY) steps.push(['gemini', () => viaGemini(b64, mime, left())])
  if (ollamaConfigured()) steps.push(['ollama', () => viaOllama(b64, left())])
  for (const [provider, run] of steps) {
    if (Date.now() - t0 >= deadlineMs) break
    try {
      const parsed = sanitizeReceipt(await run())
      if (!isEmptyReceipt(parsed)) { attempts.push({ provider, outcome: 'ok' }); return { parsed, provider, attempts } }
      attempts.push({ provider, outcome: 'empty' })
    } catch (err) {
      attempts.push({ provider, outcome: 'error' })
      // status/message only — never the image, the key, or the provider body
      console.error(`[receipt-ocr] ${provider} failed:`, (err as Error)?.name === 'TimeoutError' ? 'timeout' : (err as Error)?.message?.slice(0, 120))
    }
  }
  return { parsed: { ...EMPTY_RECEIPT }, provider: 'fallback', attempts }
}
