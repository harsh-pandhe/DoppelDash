/**
 * Expense input validation shared by POST /api/rms and PATCH /api/rms/[id].
 * Every failure is a 4xx with field names — a malformed payload must never reach Mongoose as a 500.
 *
 * Limits are deliberately generous (they exist to stop garbage and abuse, not to enforce policy; the per-employee
 * reimbursement privileges are a business rule outside this validator).
 */
import { receiptRefFromUploadUrl } from '@/lib/uploads/attachmentStorage'

export const MAX_EXPENSE_AMOUNT = 100_000_000 // ₹10 crore: far above any real claim, below float-precision trouble
export const MAX_LINE_ITEMS = 50
export const MAX_RECEIPTS = 10

export const EXPENSE_STATUSES = ['pending_manager', 'pending_admin', 'paid', 'rejected', 'returned', 'void'] as const
export const PAYMENT_METHODS = ['cash', 'card', 'upi', 'bank_transfer', 'advance_adjusted', 'na'] as const

export interface Problems { error: string; fields: string[] }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const validDate = (v: unknown): Date | null => {
  if (typeof v !== 'string' && !(v instanceof Date)) return null
  const d = new Date(v as string)
  return Number.isNaN(d.getTime()) ? null : d
}
const money = (v: unknown): number | null => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > MAX_EXPENSE_AMOUNT) return null
  return Math.round(n * 100) / 100
}
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim().length > 0 && v.length <= max ? v.trim() : null)
/**
 * `mode: 'create'` requires title, reason, amount, startDate. `mode: 'update'` validates only what is present.
 * Returns the cleaned, whitelisted-shape data or the list of offending fields.
 * Line items are always (re)set to `pending` here: an employee can never pre-approve their own lines.
 */
export interface ExpenseCtx {
  orgId: string
  /** Set when updating: lets the client send back the receipt paths it was given (`/api/rms/<id>/receipt/<n>`). */
  expenseId?: string
  /** Stored values of the expense being updated (refs `cld:…` or pre-existing legacy URLs). */
  existingReceipts?: string[]
  existingLineReceipts?: (string | undefined)[]
}

/**
 * Resolves ONE attachment value from a client into what we store:
 *   - the receipt path this API returned for THIS expense (kept as-is) → the stored value at that index;
 *   - the URL the provider returned for a fresh upload → an authenticated, tenant-bound reference (`cld:…`), flagged new;
 *   - a legacy value that is already stored on this expense (resubmitting an old claim unchanged);
 *   - anything else (raw `cld:` refs, other tenants, public URLs, external hosts…) → null.
 */
function resolveAttachment(value: unknown, ctx: ExpenseCtx, line: boolean): { value: string; isNew: boolean } | null {
  if (typeof value !== 'string') return null
  const m = /^\/api\/rms\/([a-f0-9]{24})\/receipt\/(l?)(\d+)(?:\.[a-z0-9]+)?$/i.exec(value)
  if (m) {
    if (!ctx.expenseId || m[1].toLowerCase() !== ctx.expenseId.toLowerCase() || (m[2] === 'l') !== line) return null
    const list = line ? ctx.existingLineReceipts : ctx.existingReceipts
    const kept = list?.[Number(m[3])]
    return kept ? { value: kept, isNew: false } : null
  }
  const ref = receiptRefFromUploadUrl(value, ctx.orgId)
  if (ref) return { value: ref, isNew: true }
  const pool = line ? ctx.existingLineReceipts : ctx.existingReceipts
  if (pool?.includes(value) && !value.startsWith('cld:')) return { value, isNew: false }
  return null
}

export function validateExpense(body: unknown, mode: 'create' | 'update', ctx: ExpenseCtx): { data: Record<string, unknown>; newRefs: string[] } | { problems: Problems } {
  if (!isObj(body)) return { problems: { error: 'Invalid expense', fields: ['body'] } }
  const bad: string[] = []
  const newRefs: string[] = []
  const out: Record<string, unknown> = {}
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined
  const need = (k: string) => mode === 'create' || has(k)

  if (need('title'))  { const v = text(body.title, 200);   if (v === null) bad.push('title');  else out.title = v }
  if (need('reason')) { const v = text(body.reason, 2000); if (v === null) bad.push('reason'); else out.reason = v }
  if (need('amount')) { const v = money(body.amount);      if (v === null) bad.push('amount'); else out.amount = v }
  if (need('startDate')) { const v = validDate(body.startDate); if (!v) bad.push('startDate'); else out.startDate = v }
  if (has('endDate') && body.endDate !== null && body.endDate !== '') {
    const v = validDate(body.endDate); if (!v) bad.push('endDate'); else out.endDate = v
  }
  const s = (out.startDate as Date | undefined), e = (out.endDate as Date | undefined)
  if (s && e && e < s) bad.push('endDate')
  for (const k of ['travelFrom', 'travelTo']) {
    if (has(k) && body[k] !== null && body[k] !== '') { if (typeof body[k] !== 'string' || (body[k] as string).length > 200) bad.push(k); else out[k] = body[k] }
  }
  if (has('travelRequestId')) out.travelRequestId = body.travelRequestId // existence/ownership checked by the route
  if (has('hasLineItems')) { if (typeof body.hasLineItems !== 'boolean') bad.push('hasLineItems'); else out.hasLineItems = body.hasLineItems }

  if (has('receipts')) {
    const r = body.receipts
    // Attachments must be files in THIS organisation's private storage (see lib/uploads/attachmentStorage) — not arbitrary URLs.
    const resolved = Array.isArray(r) && r.length <= MAX_RECEIPTS ? r.map(x => resolveAttachment(x, ctx, false)) : null
    if (!resolved || resolved.some(x => x === null)) bad.push('receipts')
    else {
      const items = resolved as { value: string; isNew: boolean }[]
      out.receipts = items.map(i => i.value)
      newRefs.push(...items.filter(i => i.isNew).map(i => i.value))
    }
  }

  if (has('lineItems')) {
    const li = body.lineItems
    if (!Array.isArray(li) || li.length > MAX_LINE_ITEMS) bad.push('lineItems')
    else {
      const cleaned: Record<string, unknown>[] = []
      li.forEach((item, idx) => {
        if (!isObj(item)) { bad.push('lineItems'); return }
        const description = text(item.description, 500), amount = money(item.amount), date = validDate(item.date)
        if (description === null || amount === null || !date) { bad.push('lineItems'); return }
        const row: Record<string, unknown> = { description, amount, date, status: 'pending' }
        if (item.category !== undefined && item.category !== null) { if (typeof item.category !== 'string' || item.category.length > 50) { bad.push('lineItems'); return } row.category = item.category }
        if (item.receiptUrl !== undefined && item.receiptUrl !== null && item.receiptUrl !== '') {
          const r = resolveAttachment(item.receiptUrl, ctx, true)
          if (!r) { bad.push('lineItems'); return }
          row.receiptUrl = r.value
          if (r.isNew) newRefs.push(r.value)
        }
        void idx
        cleaned.push(row)
      })
      out.lineItems = cleaned
      if (out.hasLineItems === true || (out.hasLineItems === undefined && cleaned.length > 0 && has('amount'))) {
        const sum = Math.round(cleaned.reduce((t, r) => t + (r.amount as number), 0) * 100) / 100
        if (typeof out.amount === 'number' && Math.abs(sum - out.amount) > 0.01) bad.push('amount')
      }
    }
  }

  if (has('clientRequestId')) { const v = text(body.clientRequestId, 64); if (v === null) bad.push('clientRequestId'); else out.clientRequestId = v }

  if (bad.length) return { problems: { error: 'Invalid expense', fields: Array.from(new Set(bad)) } }
  return { data: out, newRefs }
}

/** Reviewer decision fields (status/notes/payment) — validated, with payment fields reserved for admins. */
export function validateReview(body: unknown, role: string): { data: Record<string, unknown> } | { problems: Problems } {
  if (!isObj(body)) return { problems: { error: 'Invalid request', fields: ['body'] } }
  const bad: string[] = []
  const out: Record<string, unknown> = {}
  const has = (k: string) => Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined
  if (has('status')) { if (typeof body.status !== 'string' || !(EXPENSE_STATUSES as readonly string[]).includes(body.status)) bad.push('status'); else out.status = body.status }
  // Managers may only write managerNote; adminNote and every payment field belong to admins.
  const writable = role === 'admin' ? ['managerNote', 'adminNote', 'paymentProof', 'paymentNote'] : ['managerNote']
  for (const k of ['managerNote', 'adminNote', 'paymentProof', 'paymentNote']) {
    if (!has(k)) continue
    if (body[k] !== null && (typeof body[k] !== 'string' || (body[k] as string).length > 2000)) bad.push(k)
    else if (writable.includes(k)) out[k] = body[k]
  }
  if (has('paymentMethod')) {
    if (typeof body.paymentMethod !== 'string' || !(PAYMENT_METHODS as readonly string[]).includes(body.paymentMethod)) bad.push('paymentMethod')
    else if (role === 'admin') out.paymentMethod = body.paymentMethod
  }
  if (bad.length) return { problems: { error: 'Invalid request', fields: Array.from(new Set(bad)) } }
  return { data: out }
}
