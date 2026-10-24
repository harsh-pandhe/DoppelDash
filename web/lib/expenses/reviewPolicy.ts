/**
 * Expense review policy — the single description of WHO may take WHICH review action at WHICH stage, shared by the Web UI.
 * The server (`app/api/rms/[id]/route.ts`) is the authority; `tests/expense_approval_policy.test.js` drives the real route for every
 * role × state × action and fails if this table and the server ever disagree.
 *
 *   pending_manager  manager OR admin: approve (→ pending_admin), reject, return to the employee
 *                    (admins keep this stage: a small workspace may have no manager; the claim must never get stuck)
 *   pending_admin    admin only: pay, reject, send back to manager review (reason required, audited)
 *   settled states   nothing — except that an admin may VOID a paid claim (reason required; `canVoid`). A settled claim is never deleted (D-03.1/D-03.2).
 */
export type ReviewAction = 'approve' | 'reject' | 'return' | 'pay' | 'send_back'
export type ExpenseStatusLike = 'pending_manager' | 'pending_admin' | 'paid' | 'rejected' | 'returned' | 'void' | string

export const ACTION_TARGET: Record<ReviewAction, string> = {
  approve: 'pending_admin', reject: 'rejected', return: 'returned', pay: 'paid', send_back: 'pending_manager',
}

export function reviewActions(role: string | undefined | null, status: ExpenseStatusLike): ReviewAction[] {
  const privileged = role === 'manager' || role === 'admin'
  if (!privileged) return []
  if (status === 'pending_manager') return ['approve', 'reject', 'return']
  if (status === 'pending_admin' && role === 'admin') return ['pay', 'reject', 'send_back']
  return []
}

/** The status a bulk "approve" / "reject" moves a claim to for this reviewer, or null when the reviewer may not act on it. */
export function bulkTarget(role: string | undefined | null, status: ExpenseStatusLike, kind: 'approve' | 'reject'): string | null {
  const a = reviewActions(role, status)
  if (kind === 'reject') return a.includes('reject') ? ACTION_TARGET.reject : null
  if (a.includes('pay')) return ACTION_TARGET.pay
  if (a.includes('approve')) return ACTION_TARGET.approve
  return null
}

/** D-03.2: only an admin may void, only a PAID claim, and a reason is mandatory (enforced by the server). Kept separate from `reviewActions` so bulk actions never see it. */
export function canVoid(role: string | undefined | null, status: ExpenseStatusLike): boolean {
  return role === 'admin' && status === 'paid'
}
