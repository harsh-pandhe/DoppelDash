'use client'

import React, { useState, useEffect, Suspense } from 'react'
import { PASSWORD_MAX, passwordRuleState } from '@/lib/auth/passwordRules'
import Link from 'next/link'
import {
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Loader2,
  ArrowRight,
  Clock,
  Check,
  Shield,
  KeyRound,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

function ResetPasswordContent() {
  // The reset token travels in the URL FRAGMENT (never sent to a server / logged). Legacy ?token= links are still
  // read, then the address bar is scrubbed so the secret does not stay in history, screenshots or referrers.
  const [token, setToken] = useState<string | null>(null)
  const [tokenRead, setTokenRead] = useState(false)

  const [verifying, setVerifying] = useState(true)
  const [tokenStatus, setTokenStatus] = useState<{
    valid: boolean
    email?: string
    reason?: string
    error?: string
  } | null>(null)

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [resetSuccess, setResetSuccess] = useState(false)
  const [formError, setFormError] = useState('')

  useEffect(() => {
    const read = () => {
      const fromHash = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token')
      const fromQuery = new URLSearchParams(window.location.search).get('token')
      const found = fromHash || fromQuery
      if (found) { setToken(found); window.history.replaceState(null, '', window.location.pathname) }
      setTokenRead(true)
    }
    read()
    window.addEventListener('hashchange', read)
    return () => window.removeEventListener('hashchange', read)
  }, [])

  useEffect(() => {
    if (!tokenRead) return
    if (!token) {
      setTokenStatus({
        valid: false,
        reason: 'missing_token',
        error: 'This password reset link is incomplete. Request a new one.',
      })
      setVerifying(false)
      return
    }

    let isMounted = true
    async function verify() {
      try {
        const res = await fetch('/api/auth/password-reset/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
        const data = await res.json()
        if (isMounted) {
          setTokenStatus(data)
          setVerifying(false)
        }
      } catch {
        if (isMounted) {
          setTokenStatus({
            valid: false,
            reason: 'network_error',
            error: 'We couldn’t check this link. Check your connection and reload the page.',
          })
          setVerifying(false)
        }
      }
    }

    verify()
    return () => {
      isMounted = false
    }
  }, [token, tokenRead])

  // Validation rules
  // Canonical contract (identical on every endpoint and on Android): 8–128 characters. No composition rules.
  const hasMinLength = passwordRuleState(newPassword).length
  const passwordsMatch = passwordRuleState(newPassword, confirmPassword).match
  const isFormValid = hasMinLength && passwordsMatch

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!token || !isFormValid || submitting) return

    setFormError('')
    setSubmitting(true)

    try {
      const res = await fetch('/api/auth/password-reset/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          newPassword,
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        setFormError(data.error || 'Failed to reset password. Please try again.')
        setSubmitting(false)
        return
      }

      setToken(null)
      setResetSuccess(true)
    } catch {
      setFormError('Network connection error. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative min-h-screen w-full flex flex-col justify-between overflow-x-hidden bg-slate-950 font-sans selection:bg-blue-500 selection:text-white">
      {/* Background glow effects */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-blue-600/15 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-[350px] h-[350px] bg-cyan-500/10 blur-[100px] rounded-full pointer-events-none" />

      {/* Header */}
      <header className="relative z-10 w-full p-6 flex items-center justify-between max-w-5xl mx-auto">
        <div className="flex items-center gap-3">
          <img src="/icon-192.png" alt="Doppelmayr India" className="h-9 w-9 rounded-xl shadow-md" />
          <span className="font-bold text-white tracking-tight text-lg">Doppelmayr India</span>
        </div>
        <Link
          href="/sign-in"
          className="text-xs font-semibold text-slate-300 hover:text-white px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20 transition-all bg-white/5"
        >
          Sign In
        </Link>
      </header>

      {/* Main card */}
      <main className="relative z-10 flex-1 flex items-center justify-center p-4 sm:p-6 my-auto">
        <div className="w-full max-w-[480px] rounded-3xl bg-slate-900/65 backdrop-blur-2xl border border-white/10 shadow-[0_8px_32px_0_rgba(0,0,0,0.6)] p-6 sm:p-8">
          {verifying ? (
            <div className="flex flex-col items-center justify-center p-8 space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center animate-pulse">
                <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
              </div>
              <div className="text-center space-y-1">
                <p className="text-sm font-semibold text-white">Verifying reset token...</p>
                <p className="text-xs text-slate-400">Validating token authenticity and expiration.</p>
              </div>
            </div>
          ) : resetSuccess ? (
            <div className="text-center space-y-5">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 mx-auto flex items-center justify-center">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <div className="space-y-2">
                <h1 className="text-2xl font-bold text-white tracking-tight">Password Reset Complete</h1>
                <p className="text-xs text-slate-300 leading-relaxed">
                  Your password has been updated successfully. You can now sign in using your new credentials.
                </p>
              </div>
              <div className="pt-2">
                <Link
                  href="/sign-in"
                  className="w-full inline-flex items-center justify-center gap-2 h-11 px-4 rounded-xl text-sm font-semibold bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white shadow-lg shadow-blue-500/25 transition-all"
                >
                  <span>Sign In Now</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>
          ) : !tokenStatus?.valid ? (
            <div className="text-center space-y-6">
              {tokenStatus?.reason === 'expired' ? (
                <>
                  <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 mx-auto flex items-center justify-center">
                    <Clock className="w-7 h-7" />
                  </div>
                  <div className="space-y-2">
                    <h1 className="text-xl font-bold text-white tracking-tight">Reset Link Expired</h1>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      This password reset link has expired for security reasons. Password reset links are valid for 1 hour.
                    </p>
                  </div>
                </>
              ) : tokenStatus?.reason === 'already_used' ? (
                <>
                  <div className="w-14 h-14 rounded-2xl bg-slate-500/10 border border-slate-500/20 text-slate-400 mx-auto flex items-center justify-center">
                    <CheckCircle2 className="w-7 h-7" />
                  </div>
                  <div className="space-y-2">
                    <h1 className="text-xl font-bold text-white tracking-tight">Link Already Used</h1>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      This password reset link has already been used. Each reset link can only be consumed once.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="w-14 h-14 rounded-2xl bg-rose-500/10 border border-rose-500/20 text-rose-400 mx-auto flex items-center justify-center">
                    <XCircle className="w-7 h-7" />
                  </div>
                  <div className="space-y-2">
                    <h1 className="text-xl font-bold text-white tracking-tight">Invalid Reset Link</h1>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      {tokenStatus?.error || 'Password reset link is invalid or no longer available.'}
                    </p>
                  </div>
                </>
              )}

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <Link
                  href="/forgot-password"
                  className="flex-1 inline-flex items-center justify-center h-11 px-4 rounded-xl text-sm font-semibold bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white shadow-lg shadow-blue-500/25 transition-all"
                >
                  Request New Link
                </Link>
                <Link
                  href="/sign-in"
                  className="flex-1 inline-flex items-center justify-center h-11 px-4 rounded-xl text-sm font-semibold bg-white/10 hover:bg-white/15 text-white transition-colors"
                >
                  Go to Sign In
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="space-y-2 text-center">
                <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 mx-auto flex items-center justify-center">
                  <KeyRound className="w-6 h-6" />
                </div>
                <h1 className="text-2xl font-bold text-white tracking-tight">Set New Password</h1>
                <p className="text-xs text-slate-400">
                  Enter and confirm your new account password below.
                </p>
                {tokenStatus?.email && (
                  <div className="inline-block mt-1">
                    <span className="text-[11px] font-mono px-3 py-1 rounded-full bg-white/5 border border-white/10 text-slate-300">
                      {tokenStatus.email}
                    </span>
                  </div>
                )}
              </div>

              {formError && (
                <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-300 flex items-start gap-2.5">
                  <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <span className="font-medium leading-relaxed">{formError}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="new-password" className="text-xs font-semibold text-slate-300">
                    New Password
                  </Label>
                  <div className="relative group">
                    <Lock className="absolute inset-y-0 left-0 ml-3.5 my-auto h-4 w-4 text-slate-500 group-focus-within:text-blue-400 transition-colors" />
                    <Input
                      id="new-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Min. 8 characters"
                      autoComplete="new-password"
                      className="pl-10 pr-10 h-11 bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus:border-blue-500 focus:ring-blue-500/30 text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label="Toggle password visibility"
                      className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-500 hover:text-white transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="confirm-password" className="text-xs font-semibold text-slate-300">
                    Confirm Password
                  </Label>
                  <div className="relative group">
                    <Lock className="absolute inset-y-0 left-0 ml-3.5 my-auto h-4 w-4 text-slate-500 group-focus-within:text-blue-400 transition-colors" />
                    <Input
                      id="confirm-password"
                      type={showPassword ? 'text' : 'password'}
                      required
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter password"
                      autoComplete="new-password"
                      className="pl-10 pr-10 h-11 bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus:border-blue-500 focus:ring-blue-500/30 text-sm"
                    />
                  </div>
                </div>

                {/* Real-time Password Requirements Checklist */}
                <div className="p-3.5 rounded-xl bg-white/5 border border-white/10 space-y-2 text-xs">
                  <p className="font-semibold text-slate-300 text-[11px] uppercase tracking-wider">
                    Password Requirements:
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                    <div className={`flex items-center gap-1.5 ${hasMinLength ? 'text-emerald-400' : 'text-slate-400'}`}>
                      <Check className={`w-3.5 h-3.5 ${hasMinLength ? 'text-emerald-400' : 'opacity-30'}`} />
                      <span>{`8–${PASSWORD_MAX} characters`}</span>
                    </div>
                  </div>
                  {confirmPassword.length > 0 && (
                    <div className={`flex items-center gap-1.5 text-[11px] pt-1 border-t border-white/5 ${passwordsMatch ? 'text-emerald-400' : 'text-rose-400'}`}>
                      <Check className={`w-3.5 h-3.5 ${passwordsMatch ? 'text-emerald-400' : 'opacity-30'}`} />
                      <span>{passwordsMatch ? 'Passwords match' : 'Passwords do not match'}</span>
                    </div>
                  )}
                </div>

                <Button
                  type="submit"
                  disabled={submitting || !isFormValid}
                  className="w-full h-11 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-semibold text-sm rounded-xl shadow-lg shadow-blue-500/25 transition-all mt-4"
                >
                  {submitting ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Resetting password...
                    </span>
                  ) : (
                    'Set New Password'
                  )}
                </Button>
              </form>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 w-full p-6 text-center text-xs text-slate-500 max-w-5xl mx-auto flex items-center justify-center gap-1.5">
        <Shield className="w-3.5 h-3.5 text-slate-600" />
        <span>Doppelmayr India · Employee workspace</span>
      </footer>
    </div>
  )
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen w-full flex items-center justify-center bg-slate-950 text-white">
          <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
        </div>
      }
    >
      <ResetPasswordContent />
    </Suspense>
  )
}
