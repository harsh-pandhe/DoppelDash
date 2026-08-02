// Dynamic RBAC — Phase E
// Roles: employee / manager / boss (set in Clerk unsafeMetadata.role)
// Extra permissions: stored in Clerk unsafeMetadata.permissions: string[]
// Used to grant specific capabilities to employees without full role upgrade

export const ALL_PERMISSIONS = [
  { key: 'approve_leaves',      label: 'Approve Leaves',      desc: 'Can approve or reject leave requests' },
  { key: 'approve_expenses',    label: 'Approve Expenses',    desc: 'Can approve expense claims (manager step)' },
  { key: 'post_announcements',  label: 'Post Announcements',  desc: 'Can create and pin announcements' },
  { key: 'view_all_data',       label: 'View All Data',       desc: 'Can see all employees\' leaves & expenses' },
  { key: 'manage_contacts',     label: 'Manage CRM',          desc: 'Can add, edit, and delete CRM contacts' },
] as const

export type Permission = typeof ALL_PERMISSIONS[number]['key']

export interface UserMeta {
  role?: string
  permissions?: Permission[]
}

export function hasPermission(meta: UserMeta | null | undefined, perm: Permission): boolean {
  if (!meta) return false
  const role = meta.role || 'employee'
  if (role === 'admin') return true
  if (role === 'manager') {
    if (['approve_leaves', 'approve_expenses', 'post_announcements', 'view_all_data', 'manage_contacts'].includes(perm)) return true
  }
  return (meta.permissions || []).includes(perm)
}

/**
 * Separation of duties on approve/reject/forward/pay transitions.
 *
 * A manager must never action their own request — it escalates to an admin
 * instead. An admin has nobody above them, so blocking them outright would
 * deadlock their own requests (deployments routinely run with a single admin);
 * their self-approvals are allowed but flagged in the audit log.
 *
 * Only call this for approval transitions, never for an owner editing their
 * own returned/draft record.
 */
export function selfApprovalCheck(
  actorId: string,
  actorRole: string,
  ownerId: string,
): { blocked: boolean; selfApproved: boolean } {
  if (actorId !== ownerId) return { blocked: false, selfApproved: false }
  if (actorRole === 'admin') return { blocked: false, selfApproved: true }
  return { blocked: true, selfApproved: true }
}

export const SELF_APPROVAL_ERROR =
  'You cannot action your own request — it must be reviewed by an admin.'

export function getRolePermissions(role: string): Permission[] {
  if (role === 'admin') return ALL_PERMISSIONS.map(p => p.key)
  if (role === 'manager') return ['approve_leaves', 'approve_expenses', 'post_announcements', 'view_all_data', 'manage_contacts']
  return []
}
