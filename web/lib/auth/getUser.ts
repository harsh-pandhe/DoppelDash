/**
 * Drop-in replacement for Clerk's auth() + currentUser().
 *
 * Usage in API routes:
 *   const { userId, user } = await getUser()
 *   if (!userId) return 401
 *   const role = user?.role   (or user?.unsafeMetadata?.role for compat)
 */
import { cookies, headers } from 'next/headers'
import { verifyToken } from './jwt'
import { connectDB } from '@/lib/db'
import User, { type IUserPublic } from '@/models/User'

export type AuthResult =
  | { userId: string; user: IUserPublic; orgId: string }
  | { userId: null; user: null; orgId: null }

/** Cookie for web, `Authorization: Bearer <token>` for mobile (no cookie jar). */
async function readToken(): Promise<string | undefined> {
  const cookieStore = await cookies()
  const cookieToken = cookieStore.get('dd_session')?.value
  if (cookieToken) return cookieToken
  const headerStore = await headers()
  return headerStore.get('authorization')?.match(/^Bearer (.+)$/)?.[1]
}

export async function getUser(): Promise<AuthResult> {
  const token = await readToken()
  if (!token) return { userId: null, user: null, orgId: null }

  const payload = await verifyToken(token)
  if (!payload) return { userId: null, user: null, orgId: null }

  // Fetch fresh user from DB (captures ban, role changes, etc.)
  await connectDB()
  const dbUser = await User.findById(payload.userId).lean() as (IUserPublic & { _id: unknown; passwordHash?: string; orgId?: string }) | null
  if (!dbUser || !dbUser.isActive || dbUser.isBanned) return { userId: null, user: null, orgId: null }

  const orgId = dbUser.orgId || payload.orgId || 'org_doppelmayr'

  const pub: IUserPublic = {
    id:                 String(dbUser._id),
    email:              dbUser.email,
    orgId,
    role:               dbUser.role,
    firstName:          dbUser.firstName,
    lastName:           dbUser.lastName,
    fullName:           `${dbUser.firstName} ${dbUser.lastName}`.trim(),
    permissions:        dbUser.permissions || [],
    isActive:           dbUser.isActive,
    isBanned:           dbUser.isBanned,
    mustChangePassword: dbUser.mustChangePassword,
    totpEnabled:        dbUser.totpEnabled ?? false,
    tourSeen:           dbUser.tourSeen ?? false,
    mailAccess:         dbUser.mailAccess ?? false,
    lastLoginAt:        dbUser.lastLoginAt,
    loginCount:         dbUser.loginCount,
    unsafeMetadata:     { role: dbUser.role, permissions: dbUser.permissions || [] },
  }
  return { userId: pub.id, user: pub, orgId: pub.orgId }
}

/** Short-hand: just get userId (no DB hit, from token only) */
export async function getUserId(): Promise<string | null> {
  const token = await readToken()
  if (!token) return null
  const payload = await verifyToken(token)
  return payload?.userId || null
}

/** Short-hand: get orgId from token only without DB hit */
export async function getOrgId(): Promise<string | null> {
  const token = await readToken()
  if (!token) return null
  const payload = await verifyToken(token)
  return payload?.orgId || 'org_doppelmayr'
}
