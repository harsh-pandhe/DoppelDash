'use client'

import React, { useState } from 'react'
import Link from 'next/link'
import {
  Mail,
  ArrowLeft,
  Loader2,
  CheckCircle2,
  KeyRound,
  Shield,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return

    setError('')
    setSubmitting(true)

    try {
      const res = await fetch('/api/auth/password-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Unable to request password reset. Please try again.')
        setSubmitting(false)
        return
      }

      setSubmitted(true)
    } catch {
      setError('Network connection error — please check your connection and try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative min-h-screen w-full flex flex-col justify-between overflow-x-hidden bg-slate-950 font-sans selection:bg-blue-500 selection:text-white">
      {/* Background glow effects */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-blue-600/15 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-10 right-10 w-[350px] h-[350px] bg-cyan-500/10 blur-[100px] rounded-full pointer-events-none" />

      {/* Top Header */}
      <header className="relative z-10 w-full p-6 flex items-center justify-between max-w-5xl mx-auto">
        <div className="flex items-center gap-3">
          <img src="/icon-192.png" alt="Doppelmayr India" className="h-9 w-9 rounded-xl shadow-md" />
          <span className="font-bold text-white tracking-tight text-lg">Doppelmayr India</span>
        </div>
        <Link
          href="/sign-in"
          className="text-xs font-semibold text-slate-300 hover:text-white px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20 transition-all bg-white/5 flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Back to Sign In
        </Link>
      </header>

      {/* Main card */}
      <main className="relative z-10 flex-1 flex items-center justify-center p-4 sm:p-6 my-auto">
        <div className="w-full max-w-[440px] rounded-3xl bg-slate-900/65 backdrop-blur-2xl border border-white/10 shadow-[0_8px_32px_0_rgba(0,0,0,0.6)] p-6 sm:p-8">
          {submitted ? (
            <div className="text-center space-y-5">
              <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 mx-auto flex items-center justify-center">
                <CheckCircle2 className="w-7 h-7" />
              </div>
              <div className="space-y-2">
                <h1 className="text-xl font-bold text-white tracking-tight">Check your email</h1>
                <p className="text-xs text-slate-300 leading-relaxed">
                  If an account exists for <span className="font-semibold text-white">{email}</span>, we have sent a secure password reset link.
                </p>
                <p className="text-[11px] text-slate-400">
                  Please check your spam or junk folder if you don&apos;t see it within a few minutes. The link expires in 1 hour.
                </p>
              </div>
              <div className="pt-2">
                <Link
                  href="/sign-in"
                  className="w-full inline-flex items-center justify-center h-11 px-4 rounded-xl text-sm font-semibold bg-white/10 hover:bg-white/15 text-white transition-colors"
                >
                  Return to Sign In
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="space-y-2 text-center">
                <div className="w-12 h-12 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-400 mx-auto flex items-center justify-center">
                  <KeyRound className="w-6 h-6" />
                </div>
                <h1 className="text-2xl font-bold text-white tracking-tight">Reset password</h1>
                <p className="text-xs text-slate-400">
                  Enter your verified work email address and we&apos;ll send you a link to reset your password.
                </p>
              </div>

              {error && (
                <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-300 flex items-start gap-2.5">
                  <span className="text-red-400 font-bold mt-0.5">⚠</span>
                  <span className="font-medium leading-relaxed">{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="reset-email" className="text-xs font-semibold text-slate-300">
                    Work Email
                  </Label>
                  <div className="relative group">
                    <Mail className="absolute inset-y-0 left-0 ml-3.5 my-auto h-4 w-4 text-slate-500 group-focus-within:text-blue-400 transition-colors" />
                    <Input
                      id="reset-email"
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="name@company.com"
                      autoComplete="email"
                      autoFocus
                      className="pl-10 h-11 bg-white/5 border-white/10 text-white placeholder:text-slate-500 focus:border-blue-500 focus:ring-blue-500/30 text-sm"
                    />
                  </div>
                </div>

                <Button
                  type="submit"
                  disabled={submitting || !email}
                  className="w-full h-11 bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-500 hover:to-cyan-500 text-white font-semibold text-sm rounded-xl shadow-lg shadow-blue-500/25 transition-all mt-2"
                >
                  {submitting ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Sending reset link...
                    </span>
                  ) : (
                    'Send Reset Link'
                  )}
                </Button>
              </form>

              <div className="text-center pt-2">
                <Link
                  href="/sign-in"
                  className="text-xs text-slate-400 hover:text-white transition-colors"
                >
                  Remember your password? <span className="font-semibold text-blue-400">Sign in</span>
                </Link>
              </div>
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
