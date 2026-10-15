'use client'
import { useEffect, useState } from 'react'

export interface ClientUser {
  id: string
  email: string
  role: 'admin' | 'manager' | 'employee'
  firstName: string
  lastName: string
  fullName: string
  permissions: string[]
  isActive: boolean
  isBanned: boolean
  mustChangePassword: boolean
  totpEnabled?: boolean
  tourSeen?: boolean
  mailAccess?: boolean
  loginCount: number
  // Compat with old Clerk shape used across pages
  unsafeMetadata: { role: string; permissions: string[] }
}

/** Server-resolved context from GET /api/auth/me (never derived or defaulted on the client). */
export interface MeContext {
  organization?: { orgId: string; name: string; slug: string | null }
  entitlements?: { plan: string; webEnabled: boolean; androidEnabled: boolean; limits?: Record<string, number> }
  onboarding?: { tourSeen: boolean; profileComplete: boolean; orgSetupRequired: boolean }
}

interface UseUserResult extends MeContext {
  isLoaded: boolean
  isSignedIn: boolean
  user: ClientUser | null
  /** The signed-in user's role, or `null` until the server has answered. There is deliberately NO default role. */
  role: ClientUser['role'] | null
}

type Me = ClientUser & MeContext
let cached: Me | null = null
let cachedAt = 0
const TTL = 30_000   // 30s

export function useUser(): UseUserResult {
  const [user,    setUser]    = useState<Me | null>(cached)
  const [loaded,  setLoaded]  = useState<boolean>(cached !== null && Date.now() - cachedAt < TTL)

  useEffect(() => {
    if (cached && Date.now() - cachedAt < TTL) { setUser(cached); setLoaded(true); return }
    let cancelled = false
    fetch('/api/auth/me')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (cancelled) return; cached = d; cachedAt = Date.now(); setUser(d); setLoaded(true) })
      .catch(() => { if (!cancelled) { setUser(null); setLoaded(true) } })
    return () => { cancelled = true }
  }, [])

  return { isLoaded: loaded, isSignedIn: !!user, user, role: user?.role ?? null, organization: user?.organization, entitlements: user?.entitlements, onboarding: user?.onboarding }
}

export function clearUserCache() { cached = null; cachedAt = 0 }
