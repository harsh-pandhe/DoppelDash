/**
 * Drop-in replacement for Clerk's auth() + currentUser().
 *
 * Usage in API routes:
 *   const { userId, user } = await getUser()
 *   if (!userId) return 401
 *   const role = user?.role   (or user?.unsafeMetadata?.role for compat)
 */
import { cookies } from 'next/headers'
import { verifyToken } from './jwt'
import { connectDB } from '@/lib/db'
import User, { type IUserPublic } from '@/models/User'

export interface AuthResult {
  userId: string | null
  user:   IUserPublic | null
}

export async function getUser(): Promise<AuthResult> {
  const cookieStore = await cookies()
  const token = cookieStore.get('dd_session')?.value
  if (!token) return { userId: null, user: null }

  const payload = await verifyToken(token)
  if (!payload) return { userId: null, user: null }

  // Fetch fresh user from DB (captures ban, role changes, etc.)
  await connectDB()
  const dbUser = await User.findById(payload.userId).lean() as (IUserPublic & { _id: unknown; passwordHash?: string }) | null
  if (!dbUser || !dbUser.isActive || dbUser.isBanned) return { userId: null, user: null }

  const pub: IUserPublic = {
    id:                 String(dbUser._id),
    email:              dbUser.email,
    role:               dbUser.role,
    firstName:          dbUser.firstName,
    lastName:           dbUser.lastName,
    fullName:           `${dbUser.firstName} ${dbUser.lastName}`.trim(),
    permissions:        dbUser.permissions || [],
    isActive:           dbUser.isActive,
    isBanned:           dbUser.isBanned,
    mustChangePassword: dbUser.mustChangePassword,
    lastLoginAt:        dbUser.lastLoginAt,
    loginCount:         dbUser.loginCount,
    unsafeMetadata:     { role: dbUser.role, permissions: dbUser.permissions || [] },
  }
  return { userId: pub.id, user: pub }
}

/** Short-hand: just get userId (no DB hit, from token only) */
export async function getUserId(): Promise<string | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get('dd_session')?.value
  if (!token) return null
  const payload = await verifyToken(token)
  return payload?.userId || null
}
