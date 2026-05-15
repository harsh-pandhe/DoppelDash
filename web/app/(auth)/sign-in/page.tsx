'use client'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Mail, Lock, Eye, EyeOff, ChevronRight, ShieldCheck, Sparkles, X, Send,
  Loader2, Check, Mountain,
} from 'lucide-react'

type Step = 'credentials' | 'otp' | 'change-password'
type ChatMsg = { role: 'user' | 'model'; text: string }

export default function SignInPage() {
  const router = useRouter()

  // Auth state
  const [step,       setStep]       = useState<Step>('credentials')
  const [email,      setEmail]      = useState('')
  const [password,   setPassword]   = useState('')
  const [showPwd,    setShowPwd]    = useState(false)
  const [otp,        setOtp]        = useState(['','','','','',''])
  const [userId,     setUserId]     = useState('')
  const [firstName,  setFirstName]  = useState('')
  const [newPwd,     setNewPwd]     = useState('')
  const [newPwd2,    setNewPwd2]    = useState('')
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState('')
  const [mounted,    setMounted]    = useState(false)
  const otpRefs = useRef<(HTMLInputElement|null)[]>([])

  // Support chat state
  const [showSupport,  setShowSupport]  = useState(false)
  const [supportQuery, setSupportQuery] = useState('')
  const [isTyping,     setIsTyping]     = useState(false)
  const [chatHistory,  setChatHistory]  = useState<ChatMsg[]>([
    { role: 'model', text: "Hi! I'm the DoppelDash IT Assistant ✨. Trouble signing in, no OTP, or need access? I can help." }
  ])
  const chatEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setMounted(true) }, [])
  useEffect(() => {
    if (step === 'otp') setTimeout(() => otpRefs.current[0]?.focus(), 100)
  }, [step])
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [chatHistory, isTyping])

  /* ─── Auth handlers ────────────────────────────────────────────────── */
  const submitCredentials = async () => {
    setError(''); setLoading(true)
    try {
      const res  = await fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, password }) })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Login failed'); return }
      setUserId(data.userId); setFirstName(data.firstName); setStep('otp')
    } catch { setError('Network error — try again') }
    finally { setLoading(false) }
  }

  const routeAfterAuth = async () => {
    // If employee record exists and onboarding is incomplete → onboarding, else dashboard
    try {
      const r = await fetch('/api/employees/me')
      if (r.ok) {
        const emp = await r.json()
        if (emp && emp.onboardingComplete === false) {
          router.replace('/onboarding')
          return
        }
      }
    } catch { /* fall through to dashboard */ }
    router.replace('/dashboard')
  }

  const submitOTPDirect = async (code: string) => {
    setError(''); setLoading(true)
    try {
      const res  = await fetch('/api/auth/verify-otp', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ userId, otp: code }) })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Invalid OTP'); setOtp(['','','','','','']); otpRefs.current[0]?.focus(); return }
      if (data.mustChangePassword) { setStep('change-password'); return }
      await routeAfterAuth()
    } catch { setError('Network error') }
    finally { setLoading(false) }
  }
  const submitOTP = () => {
    const code = otp.join('')
    if (code.length < 6) { setError('Enter the full 6-digit code'); return }
    submitOTPDirect(code)
  }

  const submitChangePassword = async () => {
    if (newPwd !== newPwd2) { setError('Passwords do not match'); return }
    if (newPwd.length < 8)  { setError('Password must be at least 8 characters'); return }
    setError(''); setLoading(true)
    try {
      const res = await fetch('/api/auth/change-password', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ newPassword: newPwd }) })
      if (!res.ok) { const d = await res.json(); setError(d.error || 'Failed'); return }
      await routeAfterAuth()
    } catch { setError('Network error') }
    finally { setLoading(false) }
  }

  const handleOtpInput = (i: number, val: string) => {
    const next = [...otp]
    next[i] = val.replace(/\D/g, '').slice(-1)
    setOtp(next)
    if (val && i < 5) otpRefs.current[i+1]?.focus()
    if (next.every(v => v) && !loading) {
      setTimeout(() => { const code = next.join(''); if (code.length === 6) submitOTPDirect(code) }, 100)
    }
  }
  const handleOtpKey = (i: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otp[i] && i > 0) otpRefs.current[i-1]?.focus()
  }
  const handleOtpPaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6)
    if (text.length === 6) {
      e.preventDefault()
      setOtp(text.split(''))
      setTimeout(() => submitOTPDirect(text), 100)
    }
  }

  /* ─── Support chat ─────────────────────────────────────────────────── */
  const sendSupport = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!supportQuery.trim() || isTyping) return
    const next: ChatMsg[] = [...chatHistory, { role: 'user', text: supportQuery }]
    setChatHistory(next)
    setSupportQuery('')
    setIsTyping(true)
    try {
      const res  = await fetch('/api/support/chat', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ messages: next }) })
      const data = await res.json()
      setChatHistory([...next, { role: 'model', text: data.text || data.error || "Couldn't get a response." }])
    } catch {
      setChatHistory([...next, { role: 'model', text: 'Network error. Try again or email IT-NaviMumbai@doppelmayr.com.' }])
    } finally { setIsTyping(false) }
  }

  /* ─── Stepper data ─────────────────────────────────────────────────── */
  const stepIdx = step === 'credentials' ? 0 : step === 'otp' ? 1 : 2
  const stepProgress = stepIdx / 2  // 0, 0.5, 1

  return (
    <div className="min-h-screen flex font-sans relative overflow-hidden bg-slate-950">

      {/* ─── Slow-pan background image ─────────────────────────────────── */}
      <style jsx global>{`
        @keyframes slowPan {
          0%   { transform: scale(1) translate(0, 0); }
          50%  { transform: scale(1.05) translate(-1%, -1%); }
          100% { transform: scale(1) translate(0, 0); }
        }
        .animate-pan { animation: slowPan 30s ease-in-out infinite; }
      `}</style>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <div
        className="absolute inset-0 z-0 animate-pan bg-cover bg-center"
        style={{ backgroundImage: 'url("https://images.unsplash.com/photo-1551524559-8af4e6624178?auto=format&fit=crop&w=2400&q=80")' }}
        aria-hidden
      />
      <div className="absolute inset-0 z-0 bg-gradient-to-r from-slate-950/95 via-slate-950/40 to-slate-950/80" />
      <div className="absolute inset-0 z-0 bg-gradient-to-t from-slate-950/95 via-slate-950/10 to-transparent" />

      {/* ─── Main layout ───────────────────────────────────────────────── */}
      <div className="relative z-10 w-full flex flex-col lg:flex-row">

        {/* LEFT — brand story */}
        <div className="w-full lg:w-1/2 p-8 lg:p-16 flex flex-col justify-between min-h-[40vh] lg:min-h-screen text-white">
          <div className={`transform transition-all duration-1000 ${mounted ? 'translate-y-0 opacity-100' : '-translate-y-8 opacity-0'}`}>
            <div className="flex items-center gap-4 mb-2">
              <div className="w-12 h-12 bg-blue-600/20 backdrop-blur-md rounded-xl border border-blue-400/30 flex items-center justify-center">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" className="w-6 h-6 text-blue-400" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M4 6h16" />
                  <path d="M12 6v4" />
                  <rect x="6" y="10" width="12" height="8" rx="2" />
                  <path d="M8 14h8" />
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-white">DoppelDash</h1>
                <p className="text-xs font-medium text-blue-300 tracking-widest uppercase">Doppelmayr India</p>
              </div>
            </div>
          </div>

          <div className={`mt-auto lg:my-auto transform transition-all duration-1000 delay-300 ${mounted ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'}`}>
            <span className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest bg-white/10 backdrop-blur border border-white/15 px-3 py-1 rounded-full mb-5">
              <Mountain className="w-3 h-3" />Since 1893 · Wolfurt, Austria
            </span>
            <h2 className="text-4xl lg:text-6xl font-bold leading-[1.05] mb-6">
              Connecting<br/>
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-300">Peaks & People.</span>
            </h2>
            <p className="text-lg text-slate-300 max-w-md font-light leading-relaxed">
              Secure access to the Doppelmayr India network. Engineering the future of ropeways globally.
            </p>

            <div className="grid grid-cols-3 gap-4 max-w-md mt-8">
              {[
                { v: '15,400+', l: 'Installations' },
                { v: '96',      l: 'Countries' },
                { v: '130+',    l: 'Years' },
              ].map(s => (
                <div key={s.l} className="border-l-2 border-blue-400/80 pl-3">
                  <p className="text-2xl xl:text-3xl font-black tracking-tight text-white">{s.v}</p>
                  <p className="text-[10px] uppercase tracking-widest text-white/50 font-bold mt-1">{s.l}</p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* RIGHT — glass card form */}
        <div className="w-full lg:w-1/2 flex items-center justify-center p-4 lg:p-16">
          <div className={`w-full max-w-[440px] transform transition-all duration-1000 delay-500 ${mounted ? 'translate-y-0 opacity-100' : 'translate-y-12 opacity-0'}`}>
            <div className="relative rounded-3xl overflow-hidden bg-slate-900/55 backdrop-blur-2xl border border-white/10 shadow-[0_8px_32px_0_rgba(0,0,0,0.5)]">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-60" />

              {/* Ropeway stepper */}
              <div className="px-8 pt-8 pb-2">
                <div className="relative flex items-center justify-between mb-7">
                  <div className="absolute left-0 top-1/2 w-full h-px bg-slate-700 -z-10 -translate-y-1/2" />
                  <div
                    className="absolute left-0 top-1/2 h-px bg-blue-500 -z-10 -translate-y-1/2 shadow-[0_0_8px_rgba(59,130,246,0.8)] transition-all duration-500"
                    style={{ width: `${stepProgress * 100}%` }}
                  />
                  {(['credentials','otp','change-password'] as Step[]).map((s, i) => {
                    const done = i < stepIdx
                    const cur  = i === stepIdx
                    return (
                      <div key={s} className="flex flex-col items-center relative">
                        {cur && (
                          <div className="absolute -top-6 text-blue-400" aria-hidden>
                            <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6 drop-shadow-lg" strokeWidth="1" stroke="white">
                              <path d="M4 6h16" stroke="currentColor" fill="none"/>
                              <path d="M12 6v3" stroke="currentColor" fill="none"/>
                              <rect x="7" y="9" width="10" height="7" rx="1.5" />
                            </svg>
                          </div>
                        )}
                        <div className={`rounded-full ring-4 ring-slate-900/70 flex items-center justify-center transition-all ${
                          done ? 'w-3 h-3 bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,1)]' :
                          cur  ? 'w-4 h-4 border-2 border-blue-400 bg-slate-900 mt-1' :
                                 'w-3 h-3 bg-slate-700'
                        }`}>
                          {done && <Check className="w-2 h-2 text-white" />}
                        </div>
                      </div>
                    )
                  })}
                </div>

                <h3 className="text-2xl font-semibold text-white tracking-tight">
                  {step === 'credentials' && 'Sign in to DoppelDash'}
                  {step === 'otp'         && (firstName ? `Confirm it's you, ${firstName}` : "Confirm it's you")}
                  {step === 'change-password' && 'Set a new password'}
                </h3>
                <p className="text-sm text-slate-400 mt-1">
                  {step === 'credentials' && 'Use your Doppelmayr India work credentials.'}
                  {step === 'otp'         && <>We sent a 6-digit code to <span className="text-slate-200 font-medium">{email}</span>. It expires in 10 minutes.</>}
                  {step === 'change-password' && 'First sign-in detected. Choose a password only you know.'}
                </p>
              </div>

              {/* Form body */}
              <div className="p-8 pt-4">
                {error && (
                  <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/20 text-xs text-red-300 flex items-start gap-2">
                    <span className="text-red-400 mt-0.5">⚠</span>
                    <span className="font-medium">{error}</span>
                  </div>
                )}

                {/* STEP 1 — credentials */}
                {step === 'credentials' && (
                  <form className="space-y-5" onSubmit={e => { e.preventDefault(); submitCredentials() }}>
                    <div className="space-y-2">
                      <label htmlFor="email" className="text-xs font-medium text-slate-300 uppercase tracking-wider block">Work Email</label>
                      <div className="relative group">
                        <Mail className="absolute inset-y-0 left-0 ml-4 my-auto h-5 w-5 text-slate-500 group-focus-within:text-blue-400 transition-colors" />
                        <input
                          id="email" type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="email" autoFocus
                          className="block w-full pl-12 pr-4 py-3.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:bg-white/10 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all text-sm"
                          placeholder="name@doppelmayr.in"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label htmlFor="password" className="text-xs font-medium text-slate-300 uppercase tracking-wider block">Password</label>
                        <button type="button" onClick={() => setShowSupport(true)}
                          className="text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors flex items-center gap-1">
                          <Sparkles className="w-3 h-3" />Smart IT Help
                        </button>
                      </div>
                      <div className="relative group">
                        <Lock className="absolute inset-y-0 left-0 ml-4 my-auto h-5 w-5 text-slate-500 group-focus-within:text-blue-400 transition-colors" />
                        <input
                          id="password" type={showPwd ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password"
                          className="block w-full pl-12 pr-12 py-3.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:bg-white/10 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all text-sm tracking-widest"
                          placeholder="Enter password"
                        />
                        <button type="button" onClick={() => setShowPwd(p => !p)} aria-label="Toggle password"
                          className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-500 hover:text-white transition-colors">
                          {showPwd ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                        </button>
                      </div>
                    </div>

                    <button type="submit" disabled={loading || !email || !password}
                      className="group w-full flex items-center justify-center gap-2 bg-gradient-to-r from-[#003B73] to-[#0057A8] hover:from-[#0057A8] hover:to-[#1d6dc2] disabled:opacity-50 disabled:cursor-not-allowed text-white py-4 px-4 rounded-xl font-medium transition-all active:scale-[0.98] shadow-lg shadow-[#0057A8]/30 mt-6 border border-white/10">
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (<><span>Continue securely</span><ChevronRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" /></>)}
                    </button>
                  </form>
                )}

                {/* STEP 2 — OTP */}
                {step === 'otp' && (
                  <div className="space-y-5">
                    <div className="flex gap-2 justify-center" onPaste={handleOtpPaste}>
                      {otp.map((v, i) => (
                        <input key={i}
                          ref={el => { otpRefs.current[i] = el }}
                          type="text" inputMode="numeric" maxLength={1} value={v}
                          onChange={e => handleOtpInput(i, e.target.value)}
                          onKeyDown={e => handleOtpKey(i, e)}
                          aria-label={`Digit ${i+1}`}
                          className={`w-11 h-14 text-center text-xl font-black rounded-xl border-2 transition-all focus:outline-none ${
                            v
                              ? 'border-blue-500 bg-blue-500/10 text-white ring-2 ring-blue-500/30'
                              : 'border-white/10 bg-white/5 text-white focus:border-blue-400 focus:ring-2 focus:ring-blue-500/30'
                          }`}
                        />
                      ))}
                    </div>

                    <button type="button" onClick={submitOTP} disabled={loading || otp.join('').length < 6}
                      className="group w-full flex items-center justify-center gap-2 bg-gradient-to-r from-[#003B73] to-[#0057A8] hover:from-[#0057A8] hover:to-[#1d6dc2] disabled:opacity-50 disabled:cursor-not-allowed text-white py-4 px-4 rounded-xl font-medium transition-all active:scale-[0.98] shadow-lg shadow-[#0057A8]/30 border border-white/10">
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (<><ShieldCheck className="h-4 w-4" /><span>Verify and sign in</span></>)}
                    </button>

                    <div className="flex items-center justify-between text-xs">
                      <button type="button" onClick={() => { setStep('credentials'); setOtp(['','','','','','']); setError('') }}
                        className="text-slate-400 hover:text-white font-medium">← Use different account</button>
                      <button type="button" onClick={submitCredentials} disabled={loading}
                        className="text-blue-400 hover:text-blue-300 font-bold disabled:opacity-50">Resend code</button>
                    </div>
                  </div>
                )}

                {/* STEP 3 — change password */}
                {step === 'change-password' && (
                  <form className="space-y-5" onSubmit={e => { e.preventDefault(); submitChangePassword() }}>
                    <div className="space-y-2">
                      <label htmlFor="np1" className="text-xs font-medium text-slate-300 uppercase tracking-wider block">New Password</label>
                      <div className="relative">
                        <Lock className="absolute inset-y-0 left-0 ml-4 my-auto h-5 w-5 text-slate-500" />
                        <input id="np1" type={showPwd ? 'text' : 'password'} value={newPwd} onChange={e => setNewPwd(e.target.value)} autoFocus
                          className="block w-full pl-12 pr-12 py-3.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:bg-white/10 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all text-sm"
                          placeholder="Minimum 8 characters" />
                        <button type="button" onClick={() => setShowPwd(p => !p)} aria-label="Toggle password"
                          className="absolute inset-y-0 right-0 pr-4 flex items-center text-slate-500 hover:text-white">
                          {showPwd ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                        </button>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label htmlFor="np2" className="text-xs font-medium text-slate-300 uppercase tracking-wider block">Confirm Password</label>
                      <input id="np2" type={showPwd ? 'text' : 'password'} value={newPwd2} onChange={e => setNewPwd2(e.target.value)}
                        className="block w-full px-4 py-3.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder-slate-500 focus:bg-white/10 focus:outline-none focus:ring-2 focus:ring-blue-500/50 focus:border-blue-500 transition-all text-sm"
                        placeholder="Repeat password" />
                    </div>

                    {newPwd.length > 0 && (
                      <div className="grid grid-cols-3 gap-1.5">
                        {([
                          ['8+ chars',      newPwd.length >= 8],
                          ['Has number',    /\d/.test(newPwd)],
                          ['Has uppercase', /[A-Z]/.test(newPwd)],
                        ] as [string, boolean][]).map(([label, ok]) => (
                          <div key={label} className={`flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded-md transition-colors ${ok ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/20' : 'bg-white/5 text-slate-400 border border-white/5'}`}>
                            <span>{ok ? '✓' : '○'}</span>{label}
                          </div>
                        ))}
                      </div>
                    )}

                    <button type="submit" disabled={loading || !newPwd || newPwd !== newPwd2 || newPwd.length < 8}
                      className="group w-full flex items-center justify-center gap-2 bg-gradient-to-r from-[#003B73] to-[#0057A8] hover:from-[#0057A8] hover:to-[#1d6dc2] disabled:opacity-50 disabled:cursor-not-allowed text-white py-4 px-4 rounded-xl font-medium transition-all active:scale-[0.98] shadow-lg shadow-[#0057A8]/30 mt-2 border border-white/10">
                      {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : (<><Lock className="h-4 w-4" /><span>Save and continue</span></>)}
                    </button>
                  </form>
                )}
              </div>

              {/* Secure footer */}
              <div className="bg-white/5 border-t border-white/10 p-4 flex items-center justify-center gap-2 text-xs text-slate-400">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                Encrypted over TLS · 2-factor sign-in
              </div>
            </div>

            <p className="text-center text-[11px] text-slate-500 mt-4">
              Internal platform · Doppelmayr India
            </p>
            <p className="text-center text-[10px] text-slate-600 mt-1">
              Access restricted to authorised employees. All sessions are logged.
            </p>
          </div>
        </div>
      </div>

      {/* ─── AI Support Modal ─────────────────────────────────────────── */}
      {showSupport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm" onClick={() => setShowSupport(false)}>
          <div className="w-full max-w-md bg-slate-900 border border-white/10 rounded-2xl shadow-2xl overflow-hidden flex flex-col h-[540px]" onClick={e => e.stopPropagation()}>

            <div className="p-4 border-b border-white/10 flex items-center justify-between bg-white/5">
              <div className="flex items-center gap-2 text-white font-medium">
                <div className="w-8 h-8 rounded-full bg-blue-500/20 flex items-center justify-center text-blue-400">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold">DoppelDash IT Assistant</p>
                  <p className="text-[10px] text-slate-400">Powered by Gemini · Public access</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowSupport(false)} aria-label="Close" className="text-slate-400 hover:text-white p-1 rounded-lg hover:bg-white/10 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 scrollbar-thin">
              {chatHistory.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-2xl p-3 text-sm whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white rounded-br-sm'
                      : 'bg-white/10 text-slate-200 border border-white/5 rounded-bl-sm'
                  }`}>{msg.text}</div>
                </div>
              ))}
              {isTyping && (
                <div className="flex justify-start">
                  <div className="rounded-2xl p-4 bg-white/10 border border-white/5 rounded-bl-sm flex gap-1">
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-pulse" />
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <div className="p-4 border-t border-white/10 bg-white/5">
              <form onSubmit={sendSupport} className="flex gap-2">
                <input type="text" value={supportQuery} onChange={e => setSupportQuery(e.target.value)} placeholder="Ask about login, OTP, VPN…"
                  className="flex-1 bg-slate-950 border border-white/10 rounded-xl px-4 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/30" />
                <button type="submit" disabled={isTyping || !supportQuery.trim()} aria-label="Send"
                  className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white w-10 h-10 rounded-xl flex items-center justify-center transition-colors flex-shrink-0">
                  <Send className="w-4 h-4 ml-0.5" />
                </button>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
