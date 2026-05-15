import { SignJWT, jwtVerify } from 'jose'
import type { IUserPublic } from '@/models/User'

const SECRET_STR = process.env.JWT_SECRET || 'change-me-in-production-32-chars!!'
const SECRET = new TextEncoder().encode(SECRET_STR)
const EXPIRES = '7d'

export interface JWTPayload {
  userId: string
  email:  string
  role:   string
  firstName: string
  lastName:  string
}

export async function signToken(user: IUserPublic): Promise<string> {
  return new SignJWT({
    userId:    user.id,
    email:     user.email,
    role:      user.role,
    firstName: user.firstName,
    lastName:  user.lastName,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(EXPIRES)
    .sign(SECRET)
}

export async function verifyToken(token: string): Promise<JWTPayload | null> {
  try {
    const { payload } = await jwtVerify(token, SECRET)
    return payload as unknown as JWTPayload
  } catch (e) {
    if (process.env.NODE_ENV !== 'production') {
      console.error('[verifyToken]', e instanceof Error ? e.message : e)
    }
    return null
  }
}

export const COOKIE_NAME = 'dd_session'
export const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure:   process.env.NODE_ENV === 'production',
  path:     '/',
  maxAge:   7 * 24 * 60 * 60,
}
