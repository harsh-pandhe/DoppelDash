/**
 * Travel request validation for POST /api/travel (Slice 1). Every failure is a 4xx with field names — a malformed payload must never reach
 * Mongoose as a 500, and callers cannot bypass these checks by calling the API directly.
 *
 * ── The verified create contract (traced from the model, the Web form `/travel/new` and the Flutter `TravelRepository.create`) ──
 *  Required:  purpose, destination, departureDate, returnDate
 *  Optional:  legs[]  (from, to, date, mode ∈ train|flight|bus|taxi|own_vehicle|other, estimatedCost, notes)
 *             estimatedTotal, advanceRequested, accommodation { required, city, checkIn, checkOut, estimatedCost },
 *             itineraryDocs[] (shape here; each value is resolved server-side against the private-attachment contract in lib/travel/attachments.ts), clientRequestId (idempotency key)
 *  Server-controlled (never accepted from a client): orgId, userId, userName, employeeId, status, manager/admin notes, approvedBy/At,
 *             rejectedBy/At, expenseId, requestHash, timestamps. Any unsupported field is rejected, so none of them can be mass-assigned.
 *  Dates:     'YYYY-MM-DD' (Web date inputs, Flutter) or ISO-8601 date-time; date-only values mean UTC midnight (what `new Date('YYYY-MM-DD')`
 *             always meant here). returnDate ≥ departureDate (a same-day trip is valid). Years 2000–2100.
 *  Money:     Indian rupees by convention (no currency field exists; the apps label ₹). Finite, ≥ 0, ≤ MAX_TRAVEL_AMOUNT, rounded to paise
 *             (2 decimals) and summed in INTEGER paise — no floating-point drift. Numbers or plain numeric strings are accepted.
 *
 * ── Cost rule (client total = a CLAIM, never an authority) ──
 *  itemised = Σ legs[].estimatedCost + (accommodation.required ? accommodation.estimatedCost : 0)
 *   • itemised > 0 → the persisted total IS the server-computed itemised sum. A client `estimatedTotal` > 0 that differs from it is rejected
 *     (400, field `estimatedTotal`); an omitted/zero claim means "unspecified" and is accepted (the Flutter form sends 0 when its free-text total is empty).
 *   • itemised = 0 → there is nothing to compute from, so the validated claim is the (documented) lump-sum estimate; omitted → 0.
 *  advanceRequested must not exceed the persisted total.
 *
 * Unresolved product questions are listed in docs/TRAVEL_VERTICAL_AUDIT.md (currency, leg dates outside the trip window, lump-sum + partial legs).
 */
import { createHash } from 'crypto'

export const MAX_TRAVEL_AMOUNT = 100_000_000   // ₹10 crore: far above any real trip, far below integer-paise precision limits (1e10 ≪ 2^53)
export const MAX_LEGS = 20
export const MAX_ITINERARY_DOCS = 10
export const MAX_ITINERARY_DOC_LENGTH = 2048
export const TRAVEL_MODES = ['train', 'flight', 'bus', 'taxi', 'own_vehicle', 'other'] as const
export type TravelModeValue = typeof TRAVEL_MODES[number]
export const MAX_BODY_BYTES = 64 * 1024

export interface Problems { error: string; fields: string[]; code: string }

const TOP_FIELDS = ['purpose', 'destination', 'departureDate', 'returnDate', 'legs', 'estimatedTotal', 'advanceRequested', 'accommodation', 'itineraryDocs', 'clientRequestId']
const LEG_FIELDS = ['from', 'to', 'date', 'mode', 'estimatedCost', 'notes']
const ACC_FIELDS = ['required', 'city', 'checkIn', 'checkOut', 'estimatedCost']

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype
const present = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k) && o[k] !== undefined && o[k] !== null
const safeKey = (k: string) => (/^[A-Za-z0-9_.-]{1,40}$/.test(k) ? k : 'unsupported_field')

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})(T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})?)?$/
function parseDate(v: unknown): Date | null {
  if (typeof v !== 'string') return null
  const m = DATE_RE.exec(v.trim()); if (!m) return null
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3])
  if (y < 2000 || y > 2100 || mo < 1 || mo > 12 || d < 1) return null
  const probe = new Date(Date.UTC(y, mo - 1, d))                    // calendar check: rejects 2026-02-30 and similar
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null
  const date = new Date(v.trim())
  return Number.isNaN(date.getTime()) ? null : date
}
/** Rupees → integer paise (round half up on the decimal value), or null when not a valid amount. */
export function toPaise(v: unknown): number | null {
  let n: number
  if (typeof v === 'number') n = v
  else if (typeof v === 'string' && /^\d{1,12}(\.\d{1,6})?$/.test(v.trim())) n = Number(v.trim())
  else return null
  if (!Number.isFinite(n) || n < 0 || n > MAX_TRAVEL_AMOUNT) return null
  return Math.round(Number((n * 100).toPrecision(15)))
}
const rupees = (paise: number) => paise / 100
const text = (v: unknown, max: number): string | null => (typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max ? v.trim() : null)
const optText = (v: unknown, max: number): string | null | undefined => (v === undefined || v === null || v === '' ? undefined : text(v, max))

export interface ValidTravel {
  data: {
    purpose: string; destination: string; departureDate: Date; returnDate: Date
    legs: { from: string; to: string; date: Date; mode: TravelModeValue; estimatedCost: number; notes?: string }[]
    estimatedTotal: number; advanceRequested: number
    accommodation?: { required: boolean; city?: string; checkIn?: Date; checkOut?: Date; estimatedCost?: number }
    itineraryDocs: string[]
  }
  clientRequestId?: string
  /** sha256 of the canonical VALIDATED request: same logical request ⇒ same hash (used for idempotent-retry vs key-reuse detection). */
  requestHash: string
}

export function validateTravelCreate(body: unknown): ValidTravel | { problems: Problems } {
  const fail = (fields: string[]): { problems: Problems } => ({ problems: { error: 'Invalid travel request', fields: Array.from(new Set(fields)), code: 'invalid_travel_request' } })
  if (!isObj(body)) return fail(['body'])
  const bad: string[] = []
  for (const k of Object.keys(body)) if (!TOP_FIELDS.includes(k)) bad.push(safeKey(k))   // protected/server-owned fields land here too

  const purpose = text(body.purpose, 1000); if (purpose === null) bad.push('purpose')
  const destination = text(body.destination, 200); if (destination === null) bad.push('destination')
  const departure = parseDate(body.departureDate); if (!departure) bad.push('departureDate')
  const ret = parseDate(body.returnDate); if (!ret) bad.push('returnDate')
  if (departure && ret && ret < departure) bad.push('returnDate')

  // legs
  const legs: ValidTravel['data']['legs'] = []; let legsPaise = 0
  if (present(body, 'legs')) {
    if (!Array.isArray(body.legs) || body.legs.length > MAX_LEGS) bad.push('legs')
    else (body.legs as unknown[]).forEach((l, i) => {
      const at = (f: string) => `legs[${i}].${f}`
      if (!isObj(l)) { bad.push(`legs[${i}]`); return }
      for (const k of Object.keys(l)) if (!LEG_FIELDS.includes(k)) bad.push(at(safeKey(k)))
      const from = text(l.from, 200), to = text(l.to, 200), date = parseDate(l.date)
      const mode = typeof l.mode === 'string' && (TRAVEL_MODES as readonly string[]).includes(l.mode) ? (l.mode as TravelModeValue) : null
      if (from === null) bad.push(at('from')); if (to === null) bad.push(at('to')); if (!date) bad.push(at('date')); if (!mode) bad.push(at('mode'))
      let cost = 0
      if (present(l, 'estimatedCost')) { const p = toPaise(l.estimatedCost); if (p === null) bad.push(at('estimatedCost')); else cost = p }
      const notes = optText(l.notes, 1000); if (notes === null) bad.push(at('notes'))
      if (from !== null && to !== null && date && mode && notes !== null) { legs.push({ from, to, date, mode, estimatedCost: rupees(cost), ...(notes ? { notes } : {}) }); legsPaise += cost }
    })
  }

  // accommodation
  let accommodation: ValidTravel['data']['accommodation']; let accPaise = 0
  if (present(body, 'accommodation')) {
    const a = body.accommodation
    if (!isObj(a)) bad.push('accommodation')
    else {
      for (const k of Object.keys(a)) if (!ACC_FIELDS.includes(k)) bad.push(`accommodation.${safeKey(k)}`)
      if (typeof a.required !== 'boolean') bad.push('accommodation.required')
      const city = optText(a.city, 200); if (city === null) bad.push('accommodation.city')
      const ci = present(a, 'checkIn') && a.checkIn !== '' ? parseDate(a.checkIn) : undefined; if (ci === null) bad.push('accommodation.checkIn')
      const co = present(a, 'checkOut') && a.checkOut !== '' ? parseDate(a.checkOut) : undefined; if (co === null) bad.push('accommodation.checkOut')
      if (ci && co && co < ci) bad.push('accommodation.checkOut')
      let cost: number | undefined
      if (present(a, 'estimatedCost')) { const p = toPaise(a.estimatedCost); if (p === null) bad.push('accommodation.estimatedCost'); else cost = p }
      if (typeof a.required === 'boolean' && city !== null && ci !== null && co !== null) {
        accommodation = { required: a.required, ...(city ? { city } : {}), ...(ci ? { checkIn: ci } : {}), ...(co ? { checkOut: co } : {}), ...(cost !== undefined ? { estimatedCost: rupees(cost) } : {}) }
        if (a.required && cost) accPaise = cost
      }
    }
  }

  // itinerary documents: bounded array of unique strings here; WHAT they may be is decided by lib/travel/attachments.ts (private, tenant-bound, user-bound, purpose-bound)
  let itineraryDocs: string[] = []
  if (present(body, 'itineraryDocs')) {
    const d = body.itineraryDocs
    if (!Array.isArray(d) || d.length > MAX_ITINERARY_DOCS || d.some(x => typeof x !== 'string' || x.length === 0 || x.length > MAX_ITINERARY_DOC_LENGTH) || new Set(d).size !== d.length) bad.push('itineraryDocs')
    else itineraryDocs = d as string[]
  }

  // money: claim vs itemised
  let claimPaise = 0
  if (present(body, 'estimatedTotal')) { const p = toPaise(body.estimatedTotal); if (p === null) bad.push('estimatedTotal'); else claimPaise = p }
  let advancePaise = 0
  if (present(body, 'advanceRequested')) { const p = toPaise(body.advanceRequested); if (p === null) bad.push('advanceRequested'); else advancePaise = p }
  const itemised = legsPaise + accPaise
  const totalPaise = itemised > 0 ? itemised : claimPaise
  if (itemised > 0 && claimPaise > 0 && claimPaise !== itemised) bad.push('estimatedTotal')   // a claim that contradicts the itemised costs
  if (totalPaise > MAX_TRAVEL_AMOUNT * 100) bad.push('estimatedTotal')
  if (advancePaise > totalPaise && !bad.includes('advanceRequested')) bad.push('advanceRequested')

  let clientRequestId: string | undefined
  if (present(body, 'clientRequestId')) { const v = text(body.clientRequestId, 64); if (v === null || !/^[A-Za-z0-9_.:-]+$/.test(v)) bad.push('clientRequestId'); else clientRequestId = v }

  if (bad.length || !purpose || !destination || !departure || !ret) return fail(bad)
  const data = { purpose, destination, departureDate: departure, returnDate: ret, legs, estimatedTotal: rupees(totalPaise), advanceRequested: rupees(advancePaise), ...(accommodation ? { accommodation } : {}), itineraryDocs }
  const canonical = JSON.stringify({
    p: purpose, d: destination, dep: departure.toISOString(), ret: ret.toISOString(),
    l: legs.map(l => [l.from, l.to, l.date.toISOString(), l.mode, Math.round(l.estimatedCost * 100), l.notes ?? '']),
    t: totalPaise, a: advancePaise,
    acc: accommodation ? [accommodation.required, accommodation.city ?? '', accommodation.checkIn?.toISOString() ?? '', accommodation.checkOut?.toISOString() ?? '', Math.round((accommodation.estimatedCost ?? 0) * 100)] : null,
    docs: itineraryDocs,
  })
  return { data, clientRequestId, requestHash: createHash('sha256').update(canonical).digest('hex') }
}


/* ───────────────────────── PATCH (Slice 3) ─────────────────────────
 * Body: { revision: <integer, REQUIRED>, status?, managerNote?, adminNote?, itineraryDocs? }
 *   • `revision` is the optimistic-concurrency token the caller READ (GET responses carry `revision`; records that predate it read as 0).
 *   • EITHER a status transition (optionally with notes) OR an itineraryDocs change — never both in one request.
 *   • notes: plain text, ≤ 2000 chars after trimming, no control characters (newline/tab allowed); `null` or an empty string clears the note.
 *   • itineraryDocs: the COMPLETE desired list; each entry is either the proxy path of a document already on this trip
 *     (`/api/travel/<id>/itinerary/<n>[.ext]`, or a legacy value exactly as shown) to KEEP it, or a fresh private-upload URL to ADD one.
 *     Omitting an existing document removes it. Replace = omit one + add one.
 * Everything else — including every protected/server-owned property — is rejected.
 */
export const TRAVEL_STATUSES = ['pending_manager', 'pending_admin', 'approved', 'rejected', 'cancelled'] as const
export const MAX_NOTE_LENGTH = 2000
export const MAX_REVISION = 1_000_000_000
const PATCH_FIELDS = ['revision', 'status', 'managerNote', 'adminNote', 'itineraryDocs']
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/

export interface ValidPatch { revision: number; status?: string; managerNote?: string | null; adminNote?: string | null; itineraryDocs?: string[] }
export type PatchProblem = { status: 400 | 428; error: string; fields: string[]; code: string }

export function validateTravelPatch(body: unknown): ValidPatch | { problems: PatchProblem } {
  const fail = (fields: string[], code = 'invalid_travel_request', status: 400 | 428 = 400, error = 'Invalid travel update'): { problems: PatchProblem } => ({ problems: { status, error, fields: Array.from(new Set(fields)), code } })
  if (!isObj(body)) return fail(['body'])
  const bad: string[] = []
  for (const k of Object.keys(body)) if (!PATCH_FIELDS.includes(k)) bad.push(safeKey(k))      // protected / server-owned fields land here
  if (bad.length) return fail(bad)

  if (!Object.prototype.hasOwnProperty.call(body, 'revision') || body.revision === undefined || body.revision === null) {
    return fail(['revision'], 'revision_required', 428, 'This update must say which version of the request it is based on (send the `revision` you read).')
  }
  const rev = body.revision
  if (typeof rev !== 'number' || !Number.isInteger(rev) || rev < 0 || rev > MAX_REVISION) return fail(['revision'], 'invalid_revision')

  const out: ValidPatch = { revision: rev }
  if (present(body, 'status')) {
    if (typeof body.status !== 'string' || !(TRAVEL_STATUSES as readonly string[]).includes(body.status)) bad.push('status'); else out.status = body.status
  }
  for (const k of ['managerNote', 'adminNote'] as const) {
    if (!Object.prototype.hasOwnProperty.call(body, k) || body[k] === undefined) continue
    const v = body[k]
    if (v === null) { out[k] = null; continue }
    if (typeof v !== 'string' || v.length > MAX_NOTE_LENGTH * 2 || CONTROL_CHARS.test(v) || v.trim().length > MAX_NOTE_LENGTH) { bad.push(k); continue }
    out[k] = v.trim() === '' ? null : v.trim()
  }
  if (present(body, 'itineraryDocs')) {
    const d = body.itineraryDocs
    if (!Array.isArray(d) || d.length > MAX_ITINERARY_DOCS || d.some(x => typeof x !== 'string' || x.length === 0 || x.length > MAX_ITINERARY_DOC_LENGTH) || new Set(d).size !== d.length) bad.push('itineraryDocs'); else out.itineraryDocs = d as string[]
  }
  const hasNotes = out.managerNote !== undefined || out.adminNote !== undefined
  if (out.itineraryDocs !== undefined && (out.status !== undefined || hasNotes)) bad.push('itineraryDocs', out.status !== undefined ? 'status' : 'managerNote')
  if (out.itineraryDocs === undefined && out.status === undefined) bad.push(hasNotes ? 'status' : 'body')   // a notes-only or empty update is not a supported operation
  if (bad.length) return fail(bad)
  return out
}
