/**
 * Replaces clerkClient.users calls. Reads from our User collection.
 * Returns shape compatible with old Clerk usage to minimise call-site changes.
 */
import { connectDB } from '@/lib/db'
import User from '@/models/User'
import type { UserRole } from '@/models/User'

export interface ListedUser {
  id: string
  firstName: string
  lastName: string
  fullName: string
  email: string
  orgId: string
  role: UserRole
  permissions: string[]
  banned: boolean
  isActive: boolean
  mailAccess: boolean
  sessionVersion?: number
  primaryEmailAddress: { emailAddress: string }
  unsafeMetadata: { role: UserRole; permissions: string[] }
  lastActiveAt: number | null
  createdAt: number
}

export async function listUsers(opts: { limit?: number; orgId?: string | null } = {}): Promise<ListedUser[]> {
  await connectDB()
  const filter = opts.orgId ? { orgId: opts.orgId } : {}
  const docs = await User.find(filter).sort({ createdAt: -1 }).limit(opts.limit ?? 200).lean()
  return docs.map(u => ({
    id:        String(u._id),
    firstName: u.firstName,
    lastName:  u.lastName,
    fullName:  `${u.firstName} ${u.lastName}`.trim(),
    email:     u.email,
    orgId:     u.orgId || 'org_doppelmayr',
    role:      u.role,
    permissions: u.permissions || [],
    banned:    u.isBanned,
    isActive:  u.isActive,
    mailAccess: u.mailAccess ?? false,
    sessionVersion: u.sessionVersion ?? 1,
    primaryEmailAddress: { emailAddress: u.email },
    unsafeMetadata: { role: u.role, permissions: u.permissions || [] },
    lastActiveAt: u.lastLoginAt ? new Date(u.lastLoginAt).getTime() : null,
    createdAt: new Date(u.createdAt).getTime(),
  }))
}

export async function getUserById(id: string, orgId?: string | null): Promise<ListedUser | null> {
  await connectDB()
  try {
    const filter: Record<string, unknown> = { _id: id }
    if (orgId) filter.orgId = orgId
    const u = await User.findOne(filter).lean()
    if (!u) return null
    return {
      id:        String(u._id),
      firstName: u.firstName,
      lastName:  u.lastName,
      fullName:  `${u.firstName} ${u.lastName}`.trim(),
      email:     u.email,
      orgId:     u.orgId || 'org_doppelmayr',
      role:      u.role,
      permissions: u.permissions || [],
      banned:    u.isBanned,
      isActive:  u.isActive,
      mailAccess: u.mailAccess ?? false,
      sessionVersion: u.sessionVersion ?? 1,
      primaryEmailAddress: { emailAddress: u.email },
      unsafeMetadata: { role: u.role, permissions: u.permissions || [] },
      lastActiveAt: u.lastLoginAt ? new Date(u.lastLoginAt).getTime() : null,
      createdAt: new Date(u.createdAt).getTime(),
    }
  } catch { return null }
}

export async function updateUser(
  id: string,
  patch: { role?: UserRole; permissions?: string[]; isBanned?: boolean; isActive?: boolean; mailAccess?: boolean; firstName?: string; lastName?: string },
  orgId?: string | null
) {
  await connectDB()
  const filter: Record<string, unknown> = { _id: id }
  if (orgId) filter.orgId = orgId
  return User.findOneAndUpdate(filter, patch, { returnDocument: 'after' }).lean()
}
