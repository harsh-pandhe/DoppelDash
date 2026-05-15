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
export async function notifyTargetsFor(employeeUserId: string): Promise<string[]> {
  await connectDB()

  const emp     = await Employee.findOne({ clerkUserId: employeeUserId }, 'reportingManagerId').lean()
  const users   = await listUsers({ limit: 500 })
  const bosses  = users.filter(u => u.role === 'boss').map(u => u.email).filter((e): e is string => !!e)

  if (emp?.reportingManagerId) {
    const mgr = await getUserById(emp.reportingManagerId)
    const mgrEmail = mgr?.email
    return Array.from(new Set([...(mgrEmail ? [mgrEmail] : []), ...bosses]))
  }

  // Fallback: every manager + boss
  const all = users
    .filter(u => u.role === 'manager' || u.role === 'boss')
    .map(u => u.email)
    .filter((e): e is string => !!e)
  return Array.from(new Set(all))
}
