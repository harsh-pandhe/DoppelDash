/**
 * Per-route field whitelists for request bodies, used with `pick()`.
 *
 * Kept out of the route files themselves: a Next.js `route.ts` may only export
 * route handlers, so a shared constant cannot live there. Centralising them
 * also makes it easy to see what a client is allowed to set anywhere.
 *
 * Anything omitted here is server-derived — ownership (`userId`, `createdBy`,
 * `authorId`), approval metadata (`approvedBy`, `paidBy`), share tokens, and
 * status fields the state machine owns.
 */

export const EXPENSE_CREATE_FIELDS = [
  'title', 'reason', 'amount', 'travelFrom', 'travelTo', 'startDate', 'endDate',
  'lineItems', 'hasLineItems', 'receipts', 'travelRequestId', 'clientRequestId',
] as const

/** Approvers record a decision only — never amounts, dates or ownership. */
export const EXPENSE_REVIEW_FIELDS = [
  'status', 'managerNote', 'adminNote', 'paymentMethod', 'paymentProof', 'paymentNote',
] as const

export const LEAVE_CREATE_FIELDS = [
  'type', 'startDate', 'endDate', 'days', 'reason', 'medicalDocs',
] as const

export const LEAVE_REVIEW_FIELDS = ['status', 'managerNote'] as const

export const ANNOUNCEMENT_CREATE_FIELDS = ['title', 'body', 'priority', 'pinned'] as const

export const ORG_SETTINGS_FIELDS = [
  'name', 'companyName', 'timezone', 'currency', 'address', 'website', 'phone', 'email', 'logo', 'workHours', 'fiscalYearStart',
] as const

export const BALANCE_FIELDS = [
  'casual', 'sick', 'earned', 'privilege', 'restricted', 'lwpDays',
] as const

export const CONTACT_CREATE_FIELDS = [
  'name', 'email', 'phone', 'company', 'designation', 'gender', 'caste', 'religion',
  'notes', 'tags', 'projects', 'photo', 'birthday', 'anniversary',
  'reminderDate', 'reminderNote', 'timeline', 'visibility', 'sharedWith', 'colorLabel',
] as const
