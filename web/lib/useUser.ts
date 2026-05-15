'use client'
import { useEffect, useState } from 'react'

export interface ClientUser {
  id: string
  email: string
  role: 'boss' | 'manager' | 'employee'
  firstName: string
  lastName: string
  fullName: string
  permissions: string[]
  isActive: boolean
  isBanned: boolean
  mustChangePassword: boolean
  loginCount: number
  // Compat with old Clerk shape used across pages
  unsafeMetadata: { role: string; permissions: string[] }
}

interface UseUserResult {
  isLoaded: boolean
  isSignedIn: boolean
  user: ClientUser | null
}

let cached: ClientUser | null = null
let cachedAt = 0
const TTL = 30_000   // 30s

export function useUser(): UseUserResult {
  const [user,    setUser]    = useState<ClientUser | null>(cached)
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

  return { isLoaded: loaded, isSignedIn: !!user, user }
}

export function clearUserCache() { cached = null; cachedAt = 0 }
