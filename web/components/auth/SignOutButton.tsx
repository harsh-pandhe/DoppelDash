'use client'

import React, { useState } from 'react'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ds'
import { clearUserCache } from '@/lib/useUser'

/** Ends the session server-side (revokes the token), clears client caches, then returns to sign-in with a notice. */
export async function signOut(): Promise<void> {
  try { await fetch('/api/auth/logout', { method: 'POST' }) } catch { /* best effort — the cookie is cleared by the response when it arrives */ }
  clearUserCache()
  window.location.assign('/sign-in?reason=signed-out')
}

export default function SignOutButton({ variant = 'filled' }: { variant?: 'filled' | 'outlined' | 'text' }) {
  const [busy, setBusy] = useState(false)
  return <Button variant={variant} size="lg" expand icon={LogOut} loading={busy} onClick={async () => { setBusy(true); await signOut() }}>Sign out</Button>
}

/** Same sign-out, rendered with the legacy dark-card button classes (used on the web-access-restricted page). */
export function PlainSignOutButton({ className }: { className: string }) {
  const [busy, setBusy] = useState(false)
  return (
    <button type="button" disabled={busy} onClick={async () => { setBusy(true); await signOut() }} className={className}>
      <LogOut className="w-4 h-4" />
      {busy ? 'Signing out…' : 'Sign Out'}
    </button>
  )
}
