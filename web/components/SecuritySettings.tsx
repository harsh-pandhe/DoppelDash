'use client'
import { useState, useEffect, useCallback } from 'react'
import { startRegistration } from '@simplewebauthn/browser'
import { QRCodeSVG } from 'qrcode.react'
import {
  ShieldCheck, Smartphone, KeyRound, Plus, Trash2, Loader2, CheckCircle2, Copy,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { useUser, clearUserCache } from '@/lib/useUser'

interface Passkey {
  id: string; nickname: string; deviceType: string; backedUp: boolean
  lastUsedAt?: string; createdAt: string
}

function deviceNickname(): string {
  const ua = navigator.userAgent
  const browser = ua.includes('Edg') ? 'Edge' : ua.includes('Chrome') ? 'Chrome' : ua.includes('Firefox') ? 'Firefox' : ua.includes('Safari') ? 'Safari' : 'Browser'
  const os = ua.includes('Windows') ? 'Windows' : ua.includes('Mac') ? 'macOS' : ua.includes('Android') ? 'Android' : ua.includes('iPhone') || ua.includes('iPad') ? 'iOS' : ua.includes('Linux') ? 'Linux' : 'device'
  return `${browser} on ${os}`
}

export default function SecuritySettings() {
  const toast = useToast()
  const { user } = useUser()

  /* ── TOTP ─────────────────────────────────────────────────────────── */
  const [totpEnabled, setTotpEnabled] = useState<boolean | null>(null)
  const [setupUrl,    setSetupUrl]    = useState('')
  const [setupSecret, setSetupSecret] = useState('')
  const [totpCode,    setTotpCode]    = useState('')
  const [totpBusy,    setTotpBusy]    = useState(false)

  useEffect(() => {
    if (user) setTotpEnabled(!!user.totpEnabled)
  }, [user])

  const beginTotp = async () => {
    setTotpBusy(true)
    try {
      const res  = await fetch('/api/auth/totp/setup', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { toast(data.error || 'Setup failed', 'error'); return }
      setSetupUrl(data.otpauthUrl); setSetupSecret(data.secret)
    } catch { toast('Network error', 'error') }
    finally { setTotpBusy(false) }
  }

  const confirmTotp = async () => {
    if (totpCode.length < 6) return
    setTotpBusy(true)
    try {
      const res  = await fetch('/api/auth/totp/setup', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: totpCode }),
      })
      const data = await res.json()
      if (!res.ok) { toast(data.error || 'Incorrect code', 'error'); return }
      setTotpEnabled(true); setSetupUrl(''); setSetupSecret(''); setTotpCode('')
      clearUserCache()
      toast('Authenticator enabled — you can now sign in without email codes', 'success')
    } catch { toast('Network error', 'error') }
    finally { setTotpBusy(false) }
  }

  const disableTotpFn = async () => {
    if (!confirm('Disable authenticator app sign-in? You will fall back to email codes.')) return
    setTotpBusy(true)
    try {
      const res = await fetch('/api/auth/totp/setup', { method: 'DELETE' })
      if (!res.ok) { toast('Failed to disable', 'error'); return }
      setTotpEnabled(false); clearUserCache()
      toast('Authenticator disabled', 'success')
    } catch { toast('Network error', 'error') }
    finally { setTotpBusy(false) }
  }

  /* ── Passkeys ─────────────────────────────────────────────────────── */
  const [passkeys, setPasskeys] = useState<Passkey[]>([])
  const [pkBusy,   setPkBusy]   = useState(false)

  const loadPasskeys = useCallback(async () => {
    try {
      const res  = await fetch('/api/auth/passkey/credentials')
      const data = await res.json()
      if (res.ok) setPasskeys(data.passkeys || [])
    } catch { /* best-effort */ }
  }, [])

  useEffect(() => { loadPasskeys() }, [loadPasskeys])

  const addPasskey = async () => {
    setPkBusy(true)
    try {
      const optRes  = await fetch('/api/auth/passkey/register', { method: 'POST' })
      const options = await optRes.json()
      if (!optRes.ok) { toast(options.error || 'Could not start registration', 'error'); return }

      const attestation = await startRegistration(options)

      const verRes = await fetch('/api/auth/passkey/register', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: attestation, nickname: deviceNickname() }),
      })
      const verData = await verRes.json()
      if (!verRes.ok) { toast(verData.error || 'Registration failed', 'error'); return }
      toast('Passkey added — use it to sign in instantly', 'success')
      loadPasskeys()
    } catch (err) {
      if (err instanceof Error && err.name === 'NotAllowedError') { /* user dismissed */ }
      else if (err instanceof Error && err.name === 'InvalidStateError') toast('This device already has a passkey for your account', 'error')
      else toast('Passkey registration failed — your browser may not support it', 'error')
    } finally { setPkBusy(false) }
  }

  const removePasskey = async (pk: Passkey) => {
    if (!confirm(`Remove "${pk.nickname}"? You won't be able to sign in with it anymore.`)) return
    try {
      const res = await fetch('/api/auth/passkey/credentials', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: pk.id }),
      })
      if (!res.ok) { toast('Failed to remove passkey', 'error'); return }
      toast('Passkey removed', 'success')
      loadPasskeys()
    } catch { toast('Network error', 'error') }
  }

  const copySecret = () => {
    navigator.clipboard.writeText(setupSecret).then(() => toast('Secret copied — paste into your authenticator app', 'success'))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-brand-600" />
          Sign-in &amp; Security
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* ── Authenticator app ─────────────────────────────────────── */}
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
            <Smartphone className="w-4 h-4 text-brand-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <p className="text-sm font-semibold text-gray-900">Authenticator app</p>
                <p className="text-xs text-surface-muted">
                  6-digit codes from Google/Microsoft Authenticator — works even when email is unreachable.
                </p>
              </div>
              {totpEnabled === true ? (
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-1 rounded-lg">
                    <CheckCircle2 className="w-3 h-3" />Enabled
                  </span>
                  <Button variant="outline" size="sm" onClick={disableTotpFn} disabled={totpBusy}>Disable</Button>
                </div>
              ) : totpEnabled === false && !setupUrl ? (
                <Button size="sm" onClick={beginTotp} disabled={totpBusy}>
                  {totpBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Set up'}
                </Button>
              ) : null}
            </div>

            {setupUrl && (
              <div className="mt-4 p-4 rounded-2xl border border-surface-border bg-surface space-y-4">
                <div className="flex flex-col sm:flex-row gap-4 items-center">
                  <div className="bg-white p-3 rounded-xl border border-surface-border">
                    <QRCodeSVG value={setupUrl} size={140} />
                  </div>
                  <div className="flex-1 space-y-2 text-center sm:text-left">
                    <p className="text-sm font-semibold text-gray-900">1. Scan with your authenticator app</p>
                    <p className="text-xs text-surface-muted">Google Authenticator, Microsoft Authenticator, or any TOTP app.</p>
                    <button type="button" onClick={copySecret}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-brand-700 hover:text-brand-800">
                      <Copy className="w-3 h-3" />Can&apos;t scan? Copy the secret key
                    </button>
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-gray-900">2. Enter the 6-digit code it shows</p>
                  <div className="flex gap-2">
                    <Input
                      value={totpCode}
                      onChange={e => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                      placeholder="123456" inputMode="numeric" className="max-w-[140px] text-center font-mono tracking-widest"
                    />
                    <Button onClick={confirmTotp} disabled={totpBusy || totpCode.length < 6}>
                      {totpBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Verify & enable'}
                    </Button>
                    <Button variant="ghost" onClick={() => { setSetupUrl(''); setSetupSecret(''); setTotpCode('') }}>Cancel</Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Passkeys ──────────────────────────────────────────────── */}
        <div className="flex items-start gap-3 pt-4 border-t border-surface-border">
          <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
            <KeyRound className="w-4 h-4 text-brand-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <p className="text-sm font-semibold text-gray-900">Passkeys</p>
                <p className="text-xs text-surface-muted">
                  Sign in with fingerprint, face, or device PIN — no password or code needed.
                </p>
              </div>
              <Button size="sm" onClick={addPasskey} disabled={pkBusy}>
                {pkBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (<><Plus className="w-3.5 h-3.5 mr-1" />Add passkey</>)}
              </Button>
            </div>

            {passkeys.length > 0 && (
              <div className="mt-3 space-y-2">
                {passkeys.map(pk => (
                  <div key={pk.id} className="flex items-center gap-3 p-3 rounded-xl border border-surface-border bg-surface">
                    <KeyRound className="w-4 h-4 text-brand-500 flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-gray-900 truncate">{pk.nickname}</p>
                      <p className="text-[11px] text-surface-muted">
                        Added {new Date(pk.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                        {pk.lastUsedAt && <> · last used {new Date(pk.lastUsedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</>}
                        {pk.backedUp && ' · synced'}
                      </p>
                    </div>
                    <button type="button" onClick={() => removePasskey(pk)} aria-label={`Remove ${pk.nickname}`}
                      className="p-1.5 rounded-lg text-surface-muted hover:text-red-600 hover:bg-red-50 transition-colors">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </CardContent>
    </Card>
  )
}
