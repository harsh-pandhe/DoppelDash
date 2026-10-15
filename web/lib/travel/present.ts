/**
 * THE public shape of a Travel record (Slice 5). Every Travel route that returns a trip goes through `presentTravelRecord`, which builds the
 * response from an explicit ALLOWLIST — a field added to the model later is NOT exposed until it is added here.
 *
 * Never exposed (and why): `clientRequestId` / `requestHash` (idempotency
 * internals), `conversion` (lease token/state of the trip→expense protocol), `__v`, and any `cld:` private storage reference or provider URL
 * (documents appear only as authenticated proxy paths `/api/travel/<id>/itinerary/<n>[.ext]`; legacy plain values are shown as stored).
 */
import { isReceiptRef, parseReceiptRef } from '@/lib/uploads/attachmentStorage'

type Dict = Record<string, unknown>
const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v))

function presentLeg(l: Dict) {
  return { _id: str(l._id), from: l.from, to: l.to, date: l.date, mode: l.mode, estimatedCost: l.estimatedCost, ...(l.notes !== undefined ? { notes: l.notes } : {}) }
}

export function presentDocs(tripId: string, orgId: string | undefined, docs: unknown): string[] {
  if (!Array.isArray(docs)) return []
  return docs.map((d: unknown, i) => {
    if (typeof d !== 'string') return ''
    if (!isReceiptRef(d)) return d                                          // legacy plain value: shown as stored (never rewritten, never trusted)
    // ANY `cld:` value is private storage syntax and is never echoed: a valid reference gets its typed proxy path, anything else an
    // extension-less path that the proxy answers with 404 `legacy_attachment`.
    const parsed = orgId ? parseReceiptRef(d, orgId) : null
    return `/api/travel/${tripId}/itinerary/${i}${parsed ? '.' + parsed.ext : ''}`
  })
}

export function presentTravelRecord(t: unknown): Dict {
  const src = ((t as { toObject?: () => Dict })?.toObject ? (t as { toObject: () => Dict }).toObject() : t) as Dict
  const id = String(src._id)
  const acc = src.accommodation as Dict | undefined
  const out: Dict = {
    _id: id,
    orgId: src.orgId,                                                          // the caller's OWN tenant (records of other tenants are never returned); kept for client compatibility
    userId: src.userId, userName: src.userName,
    ...(src.employeeId !== undefined ? { employeeId: src.employeeId } : {}),
    purpose: src.purpose, destination: src.destination,
    departureDate: src.departureDate, returnDate: src.returnDate,
    legs: Array.isArray(src.legs) ? (src.legs as Dict[]).map(presentLeg) : [],
    itineraryDocs: presentDocs(id, src.orgId as string | undefined, src.itineraryDocs),
    estimatedTotal: src.estimatedTotal, advanceRequested: src.advanceRequested ?? 0,
    status: src.status,
    revision: typeof src.revision === 'number' ? src.revision : 0,            // records that predate the token read as revision 0
    createdAt: src.createdAt, updatedAt: src.updatedAt,
  }
  if (acc) out.accommodation = { required: !!acc.required, ...(acc.city !== undefined ? { city: acc.city } : {}), ...(acc.checkIn !== undefined ? { checkIn: acc.checkIn } : {}), ...(acc.checkOut !== undefined ? { checkOut: acc.checkOut } : {}), ...(acc.estimatedCost !== undefined ? { estimatedCost: acc.estimatedCost } : {}) }
  for (const k of ['managerNote', 'adminNote', 'approvedBy', 'approvedAt', 'rejectedBy', 'rejectedAt', 'expenseId']) if (src[k] !== undefined && src[k] !== null && src[k] !== '') out[k] = src[k]
  return out
}
