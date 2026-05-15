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
  role: UserRole
  permissions: string[]
  banned: boolean
  isActive: boolean
  primaryEmailAddress: { emailAddress: string }
  unsafeMetadata: { role: UserRole; permissions: string[] }
  lastActiveAt: number | null
  createdAt: number
}

export async function listUsers(opts: { limit?: number } = {}): Promise<ListedUser[]> {
  await connectDB()
  const docs = await User.find({}).sort({ createdAt: -1 }).limit(opts.limit ?? 200).lean()
  return docs.map(u => ({
    id:        String(u._id),
    firstName: u.firstName,
    lastName:  u.lastName,
    fullName:  `${u.firstName} ${u.lastName}`.trim(),
    email:     u.email,
    role:      u.role,
    permissions: u.permissions || [],
    banned:    u.isBanned,
    isActive:  u.isActive,
    primaryEmailAddress: { emailAddress: u.email },
    unsafeMetadata: { role: u.role, permissions: u.permissions || [] },
    lastActiveAt: u.lastLoginAt ? new Date(u.lastLoginAt).getTime() : null,
    createdAt: new Date(u.createdAt).getTime(),
  }))
}

export async function getUserById(id: string): Promise<ListedUser | null> {
  await connectDB()
  try {
    const u = await User.findById(id).lean()
    if (!u) return null
    return {
      id:        String(u._id),
      firstName: u.firstName,
      lastName:  u.lastName,
      fullName:  `${u.firstName} ${u.lastName}`.trim(),
      email:     u.email,
      role:      u.role,
      permissions: u.permissions || [],
      banned:    u.isBanned,
      isActive:  u.isActive,
      primaryEmailAddress: { emailAddress: u.email },
      unsafeMetadata: { role: u.role, permissions: u.permissions || [] },
      lastActiveAt: u.lastLoginAt ? new Date(u.lastLoginAt).getTime() : null,
      createdAt: new Date(u.createdAt).getTime(),
    }
  } catch { return null }
}

export async function updateUser(id: string, patch: { role?: UserRole; permissions?: string[]; isBanned?: boolean; isActive?: boolean; firstName?: string; lastName?: string }) {
  await connectDB()
  return User.findByIdAndUpdate(id, patch, { returnDocument: 'after' }).lean()
}
