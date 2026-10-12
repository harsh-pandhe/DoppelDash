import Employee from '@/models/Employee'
import { listUsers, getUserById } from '@/lib/auth'
import { connectDB } from '@/lib/db'

/**
 * Resolve which manager(s) + boss(es) should receive a notification for
 * an action by a given employee.
 *
 * Routing:
 *   - If the employee has Employee.reportingManagerId set → notify ONLY that manager (+ all bosses).
 *   - Otherwise → notify ALL managers + bosses.
 *
 * Returns deduped email list.
 */
export async function notifyTargetsFor(employeeUserId: string, orgId: string): Promise<string[]> {
  await connectDB()
  const effectiveOrgId = orgId

  const emp     = await Employee.findOne({ clerkUserId: employeeUserId, orgId: effectiveOrgId }, 'reportingManagerId').lean()
  const users   = await listUsers({ limit: 500, orgId: effectiveOrgId })
  const bosses  = users.filter(u => u.role === 'admin').map(u => u.email).filter((e): e is string => !!e)

  if (emp?.reportingManagerId) {
    const mgr = await getUserById(emp.reportingManagerId, effectiveOrgId)
    const mgrEmail = mgr?.email
    return Array.from(new Set([...(mgrEmail ? [mgrEmail] : []), ...bosses]))
  }

  // Fallback: every manager + boss in this organization
  const all = users
    .filter(u => u.role === 'manager' || u.role === 'admin')
    .map(u => u.email)
    .filter((e): e is string => !!e)
  return Array.from(new Set(all))
}
