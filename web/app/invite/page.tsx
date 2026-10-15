'use client'

import React, { useState, useEffect, Suspense } from 'react'
import { PASSWORD_MAX, passwordRuleState } from '@/lib/auth/passwordRules'
import Link from 'next/link'
import {
  Building2,
  Mail,
  Briefcase,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  XCircle,
  Eye,
  EyeOff,
  Loader2,
  ArrowRight,
  ShieldAlert,
  Clock,
  Check,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface InvitationDetails {
  valid: boolean
  status?: string
  reason?: string
  email?: string
  role?: string
  firstName?: string
  lastName?: string
  department?: string
  designation?: string
  orgId?: string
  organizationName?: string
  expiresAt?: string
}

function InviteAcceptanceContent() {
  // Token travels in the URL fragment; legacy ?token= is still read. Either way the address bar is scrubbed.
  const [token, setToken] = useState<string | null>(null)
  const [tokenRead, setTokenRead] = useState(false)

  const [verifying, setVerifying] = useState(true)
  const [invitation, setInvitation] = useState<InvitationDetails | null>(null)

  // Form inputs
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  // Submission state
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [success, setSuccess] = useState(false)

  // Verify invitation token on mount
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
      setVerifying(false)
      setInvitation({ valid: false, reason: 'missing_token' })
      return
    }

    let isMounted = true
    const verifyToken = async () => {
      try {
        setVerifying(true)
        const res = await fetch('/api/auth/invitations/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) })
        const data = await res.json()

        if (!isMounted) return

        if (res.ok && data.valid) {
          setInvitation(data)
          setFirstName(data.firstName || '')
          setLastName(data.lastName || '')
        } else {
          setInvitation({
            valid: false,
            reason: data.reason || (res.status === 404 ? 'invalid_token' : 'expired'),
            email: data.email,
            organizationName: data.organizationName,
          })
        }
      } catch {
        if (isMounted) {
          setInvitation({ valid: false, reason: 'network_error' })
        }
      } finally {
        if (isMounted) {
          setVerifying(false)
        }
      }
    }

    verifyToken()

    return () => {
      isMounted = false
    }
  }, [token, tokenRead])

  // Password requirements calculation
  // Canonical contract: 8–128 characters, no composition rules (same as the server and Android).
  const hasMinLength = passwordRuleState(password).length
  const passwordsMatch = passwordRuleState(password, confirmPassword).match
  const isFormValid =
    hasMinLength &&
    passwordsMatch &&
    firstName.trim().length > 0 &&
    lastName.trim().length > 0

  const handleAccept = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isFormValid || submitting || !token) return

    setSubmitting(true)
    setSubmitError('')

    try {
      const res = await fetch('/api/auth/invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          password,
          firstName: firstName.trim(),
          lastName: lastName.trim(),
        }),
      })

      const data = await res.json()

      if (!res.ok) {
        if (res.status === 409) {
          setSubmitError(
            'An account with this email already exists. You can sign in using your existing account credentials.'
          )
        } else if (res.status === 410) {
          setSubmitError('This invitation has expired or been revoked. Please ask your administrator to send a new invitation.')
        } else {
          setSubmitError(data.error || 'Failed to activate account. Please check your inputs and try again.')
        }
        setSubmitting(false)
        return
      }

      setSuccess(true)
      setToken(null)
      // Server decides whether this organisation may use the web client.
      const dest = data.webAccess === false ? '/web-access-restricted' : '/dashboard'
      setTimeout(() => {
        window.location.href = dest
      }, 700)
    } catch {
      setSubmitError('A network error occurred. Please check your internet connection and try again.')
      setSubmitting(false)
    }
  }

  // 1. Loading State
  if (verifying) {
    return (
      <div className="flex flex-col items-center justify-center p-8 space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center animate-pulse">
          <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
        </div>
        <div className="text-center space-y-1">
          <p className="text-sm font-semibold text-white">Verifying invitation...</p>
          <p className="text-xs text-slate-400">Validating secure security token with the server.</p>
        </div>
      </div>
    )
  }

  // 2. Error States (Invalid / Expired / Revoked / Already Accepted / Missing)
  if (!invitation || !invitation.valid) {
    const reason = invitation?.reason || 'invalid_token'

    let title = 'Invalid Invitation Link'
    let description = 'This invitation link is invalid or no longer available. Please check the URL or request a new invitation.'
    let icon = <XCircle className="w-7 h-7 text-red-400" />
    let badge = 'Invalid Link'
    let badgeClass = 'bg-red-500/10 text-red-400 border-red-500/20'

    if (reason === 'expired') {
      title = 'Invitation Expired'
      description = 'This invitation has passed its 7-day validity window. Ask your organization administrator to resend your invitation.'
      icon = <Clock className="w-7 h-7 text-amber-400" />
      badge = 'Expired'
      badgeClass = 'bg-amber-500/10 text-amber-400 border-amber-500/20'
    } else if (reason === 'revoked') {
      title = 'Invitation Revoked'
      description = 'This invitation has been revoked by an organization administrator. Contact your team if you believe this was an error.'
      icon = <ShieldAlert className="w-7 h-7 text-rose-400" />
      badge = 'Revoked'
      badgeClass = 'bg-rose-500/10 text-rose-400 border-rose-500/20'
    } else if (reason === 'already_accepted') {
      title = 'Invitation Already Accepted'
      description = 'This invitation has already been used to activate an account. You can sign in directly with your email and password.'
      icon = <CheckCircle2 className="w-7 h-7 text-emerald-400" />
      badge = 'Already Accepted'
      badgeClass = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
    } else if (reason === 'missing_token') {
      title = 'Missing Invitation Token'
      description = 'No invitation token was found in the link. Please open the complete link provided in your invitation message.'
      icon = <AlertTriangle className="w-7 h-7 text-amber-400" />
      badge = 'Missing Token'
      badgeClass = 'bg-amber-500/10 text-amber-400 border-amber-500/20'
    }

    return (
      <div className="space-y-6 text-center">
        <div className="flex justify-center">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold border ${badgeClass}`}>
            {badge}
          </span>
        </div>

        <div className="w-16 h-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center mx-auto shadow-inner">
          {icon}
        </div>

        <div className="space-y-2">
          <h2 className="text-xl sm:text-2xl font-bold text-white tracking-tight">{title}</h2>
          <p className="text-sm text-slate-300 max-w-sm mx-auto leading-relaxed">{description}</p>
        </div>

        <div className="pt-2">
          <Link href="/sign-in">
            <Button className="w-full h-11 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-xl shadow-lg shadow-blue-900/30 gap-2">
              Go to Sign In <ArrowRight className="w-4 h-4" />
            </Button>
          </Link>
        </div>
      </div>
    )
  }

  // 3. Success State
  if (success) {
    return (
      <div className="space-y-6 text-center py-4">
        <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto shadow-lg shadow-emerald-950/40">
          <CheckCircle2 className="w-8 h-8 text-emerald-400" />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-white">Account Activated!</h2>
          <p className="text-sm text-slate-300">
            Welcome to <span className="font-semibold text-white">{invitation.organizationName}</span>. Establishing your secure session...
          </p>
        </div>
        <div className="flex items-center justify-center gap-2 text-xs text-blue-400 font-medium">
          <Loader2 className="w-4 h-4 animate-spin" /> Redirecting to dashboard...
        </div>
      </div>
    )
  }

  // 4. Valid Invitation Acceptance Form
  return (
    <div className="space-y-6">
      {/* Header & Tenant Info */}
      <div className="text-center space-y-3">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold max-w-full truncate">
          <Building2 className="w-3.5 h-3.5 flex-shrink-0" />
          <span className="truncate">{invitation.organizationName}</span>
        </div>

        <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
          Join Your Team
        </h1>
        <p className="text-sm text-slate-300 max-w-sm mx-auto">
          Complete your profile and create a secure password to activate your account.
        </p>
      </div>

      {/* Invitation Context Summary Pill */}
      <div className="p-3.5 rounded-2xl bg-slate-950/60 border border-white/10 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400 flex items-center gap-1.5">
            <Mail className="w-3.5 h-3.5 text-slate-500" /> Invited Email:
          </span>
          <span className="font-semibold text-white truncate max-w-[200px]" title={invitation.email}>
            {invitation.email}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-400 flex items-center gap-1.5">
            <Briefcase className="w-3.5 h-3.5 text-slate-500" /> Assigned Role:
          </span>
          <span className="capitalize font-semibold text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-md border border-blue-500/20">
            {invitation.role}
          </span>
        </div>
      </div>

      {/* Submission Error Banner */}
      {submitError && (
        <div
          role="alert"
          className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-red-300 text-xs flex items-start gap-2.5 leading-relaxed"
        >
          <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <div className="flex-1">{submitError}</div>
        </div>
      )}

      {/* Acceptance Form */}
      <form onSubmit={handleAccept} className="space-y-4">
        {/* Name Fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="first-name" className="text-xs font-semibold text-slate-200">
              First Name
            </Label>
            <Input
              id="first-name"
              type="text"
              required
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              disabled={submitting}
              placeholder="First name"
              className="h-10 bg-slate-950/50 border-white/15 text-white placeholder:text-slate-500 rounded-xl focus-visible:ring-blue-500"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="last-name" className="text-xs font-semibold text-slate-200">
              Last Name
            </Label>
            <Input
              id="last-name"
              type="text"
              required
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              disabled={submitting}
              placeholder="Last name"
              className="h-10 bg-slate-950/50 border-white/15 text-white placeholder:text-slate-500 rounded-xl focus-visible:ring-blue-500"
            />
          </div>
        </div>

        {/* Password */}
        <div className="space-y-1.5">
          <Label htmlFor="new-password" className="text-xs font-semibold text-slate-200">
            Choose a Password
          </Label>
          <div className="relative">
            <Input
              id="new-password"
              type={showPassword ? 'text' : 'password'}
              required
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={submitting}
              placeholder="Enter strong password"
              className="h-10 pr-10 bg-slate-950/50 border-white/15 text-white placeholder:text-slate-500 rounded-xl focus-visible:ring-blue-500"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Confirm Password */}
        <div className="space-y-1.5">
          <Label htmlFor="confirm-password" className="text-xs font-semibold text-slate-200">
            Confirm Password
          </Label>
          <div className="relative">
            <Input
              id="confirm-password"
              type={showConfirmPassword ? 'text' : 'password'}
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={submitting}
              placeholder="Re-enter your password"
              className="h-10 pr-10 bg-slate-950/50 border-white/15 text-white placeholder:text-slate-500 rounded-xl focus-visible:ring-blue-500"
            />
            <button
              type="button"
              onClick={() => setShowConfirmPassword(!showConfirmPassword)}
              tabIndex={-1}
              aria-label={showConfirmPassword ? 'Hide confirm password' : 'Show confirm password'}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
            >
              {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>

        {/* Real-time Password Requirements Checklist */}
        <div className="p-3 rounded-xl bg-slate-950/40 border border-white/5 space-y-1.5">
          <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Password Requirements</p>
          <div className="grid grid-cols-2 gap-1.5 text-xs">
            <div className={`flex items-center gap-1.5 ${hasMinLength ? 'text-emerald-400' : 'text-slate-500'}`}>
              <Check className={`w-3.5 h-3.5 ${hasMinLength ? 'text-emerald-400' : 'text-slate-600'}`} />
              <span>{`8–${PASSWORD_MAX} characters`}</span>
            </div>
          </div>
          {confirmPassword.length > 0 && (
            <p className={`text-[11px] font-medium pt-1 ${passwordsMatch ? 'text-emerald-400' : 'text-rose-400'}`}>
              {passwordsMatch ? '✓ Passwords match' : '✗ Passwords do not match'}
            </p>
          )}
        </div>

        {/* Submit Button */}
        <Button
          type="submit"
          disabled={!isFormValid || submitting}
          className="w-full h-11 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-xl shadow-lg shadow-blue-900/40 transition-all disabled:opacity-50 disabled:cursor-not-allowed mt-2"
        >
          {submitting ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Activating Account...
            </>
          ) : (
            'Activate Account & Enter Dashboard'
          )}
        </Button>
      </form>

      {/* Footer Link */}
      <div className="text-center pt-2">
        <Link href="/sign-in" className="text-xs text-slate-400 hover:text-white transition-colors">
          Already have an account? <span className="text-blue-400 underline underline-offset-2">Sign in</span>
        </Link>
      </div>
    </div>
  )
}

export default function InvitePage() {
  return (
    <div className="min-h-screen w-full bg-[#0B1528] bg-gradient-to-br from-[#0B1528] via-[#0F1E36] to-[#080D1A] flex flex-col justify-between relative overflow-hidden">
      {/* Background Ambience Glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-blue-600/15 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-[350px] h-[350px] bg-cyan-500/10 blur-[100px] rounded-full pointer-events-none" />

      {/* Header Bar */}
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

      {/* Card Content Area */}
      <main className="relative z-10 flex-1 flex items-center justify-center p-4 sm:p-6 my-auto">
        <div className="w-full max-w-[480px] rounded-3xl bg-slate-900/65 backdrop-blur-2xl border border-white/10 shadow-[0_8px_32px_0_rgba(0,0,0,0.6)] p-6 sm:p-8">
          <Suspense
            fallback={
              <div className="flex flex-col items-center justify-center p-8 space-y-4">
                <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
                <p className="text-xs text-slate-400">Loading invitation...</p>
              </div>
            }
          >
            <InviteAcceptanceContent />
          </Suspense>
        </div>
      </main>

      {/* Footer */}
      <footer className="relative z-10 w-full p-6 text-center text-xs text-slate-500 max-w-5xl mx-auto">
        © {new Date().getFullYear()} Doppelmayr India · Employee workspace
      </footer>
    </div>
  )
}
