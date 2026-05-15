'use client'
import { useState, useEffect } from 'react'
import { useUser } from '@/lib/useUser'
import { useRouter } from 'next/navigation'
import { Shield, User, Briefcase, Lock, Loader2, Mail, CheckCircle2, AlertCircle, RefreshCw, Inbox, Send, Trash2, Eye, EyeOff, Building2, Check, LogOut, KeyRound } from 'lucide-react'
import Header from '@/components/layout/Header'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import FileUploader from '@/components/ui/file-uploader'

const ROLE_META: Record<string, { icon: React.ElementType; color: string; label: string; desc: string }> = {
  employee: { icon: User,      color: 'text-gray-500',  label: 'Employee', desc: 'Standard access' },
  manager:  { icon: Briefcase, color: 'text-brand-500', label: 'Manager',  desc: 'Approve requests, manage team' },
  boss:     { icon: Shield,    color: 'text-amber-500', label: 'Boss',     desc: 'Full oversight & admin' },
}

function ChangePasswordCard() {
  const toast = useToast()
  const [cur,  setCur]  = useState('')
  const [n1,   setN1]   = useState('')
  const [n2,   setN2]   = useState('')
  const [show, setShow] = useState(false)
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (n1 !== n2) { toast('Passwords do not match', 'error'); return }
    if (n1.length < 8) { toast('At least 8 characters', 'error'); return }
    setSaving(true)
    const res = await fetch('/api/auth/change-password', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ currentPassword: cur, newPassword: n1 }),
    })
    if (res.ok) { toast('Password changed', 'success'); setCur(''); setN1(''); setN2('') }
    else { toast((await res.json()).error || 'Failed', 'error') }
    setSaving(false)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2"><KeyRound className="w-4 h-4 text-brand-500"/>Change Password</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        <div className="space-y-1.5">
          <Label htmlFor="cur-pwd">Current password</Label>
          <Input id="cur-pwd" type={show?'text':'password'} value={cur} onChange={e => setCur(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="n1-pwd">New password</Label>
          <div className="relative">
            <Input id="n1-pwd" type={show?'text':'password'} value={n1} onChange={e => setN1(e.target.value)} placeholder="Min 8 characters" />
            <button type="button" title="Toggle" aria-label="Toggle password visibility" onClick={() => setShow(s=>!s)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-muted hover:text-gray-700">
              {show?<EyeOff className="w-4 h-4"/>:<Eye className="w-4 h-4"/>}
            </button>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="n2-pwd">Confirm new password</Label>
          <Input id="n2-pwd" type={show?'text':'password'} value={n2} onChange={e => setN2(e.target.value)} />
        </div>
        <Button className="gap-2" onClick={submit} disabled={saving || !n1 || n1 !== n2}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Lock className="w-4 h-4"/>}
          Update Password
        </Button>
      </CardContent>
    </Card>
  )
}

const SMTP_PRESETS = [
  { label: 'Gmail',           host: 'smtp.gmail.com',      port: 587, hint: 'Generate App Password at myaccount.google.com → Security → 2FA → App passwords' },
  { label: 'Outlook / 365',   host: 'smtp.office365.com',  port: 587, hint: 'Use App Password from myaccount.microsoft.com → Security → Advanced security' },
  { label: 'Yahoo',           host: 'smtp.mail.yahoo.com', port: 587, hint: 'Generate App Password in Yahoo Account Security' },
  { label: 'Zoho',            host: 'smtp.zoho.com',       port: 587, hint: 'Use Zoho Mail App-Specific Password' },
  { label: 'Custom',          host: '',                    port: 587, hint: 'Any SMTP server' },
]

function MyEmailCard() {
  const toast = useToast()
  const [config,   setConfig]   = useState<{ emailAddress: string; smtpHost: string; smtpPort: number; isVerified: boolean } | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [editing,  setEditing]  = useState(false)
  const [testing,  setTesting]  = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [showPass, setShowPass] = useState(false)
  const [form,     setForm]     = useState({ emailAddress: '', smtpHost: '', smtpPort: 587, appPassword: '' })
  const [presetHint, setPresetHint] = useState<string>('')

  useEffect(() => {
    fetch('/api/user/email-config')
      .then(r => r.ok ? r.json() : null)
      .then(d => { setConfig(d); if (!d) setEditing(true) })
      .catch(() => setEditing(true))
      .finally(() => setLoading(false))
  }, [])

  const applyPreset = (p: typeof SMTP_PRESETS[0]) => {
    setForm(f => ({ ...f, smtpHost: p.host, smtpPort: p.port }))
    setPresetHint(p.hint)
  }

  const save = async () => {
    if (!form.emailAddress || !form.smtpHost || !form.appPassword) { toast('Fill all fields', 'error'); return }
    setSaving(true)
    const res = await fetch('/api/user/email-config', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(form) })
    if (res.ok) {
      toast('Saved — click Test to verify', 'success')
      setConfig({ emailAddress: form.emailAddress, smtpHost: form.smtpHost, smtpPort: form.smtpPort, isVerified: false })
      setEditing(false)
    } else toast((await res.json()).error || 'Save failed', 'error')
    setSaving(false)
  }

  const testConnection = async () => {
    setTesting(true)
    const res = await fetch('/api/user/email-config/test', { method: 'POST' })
    const data = await res.json()
    if (res.ok) {
      toast('Connected! Test email sent to yourself', 'success')
      setConfig(c => c ? { ...c, isVerified: true } : c)
    } else toast(data.error || 'Connection test failed', 'error')
    setTesting(false)
  }

  const [confirmRemove, setConfirmRemove] = useState(false)
  const remove = async () => {
    await fetch('/api/user/email-config', { method: 'DELETE' })
    setConfig(null)
    setForm({ emailAddress: '', smtpHost: '', smtpPort: 587, appPassword: '' })
    setEditing(true)
    setConfirmRemove(false)
    toast('Email disconnected', 'info')
  }

  if (loading) return <div className="h-20 rounded-xl bg-surface-border animate-pulse" />

  return (
    <div className="rounded-xl border border-surface-border bg-white overflow-hidden">
      <div className="flex items-start gap-4 p-4">
        <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0 mt-0.5">
          <Send className="w-5 h-5 text-brand-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900">Connect Your Email</p>
          <p className="text-xs text-surface-muted">Send CRM messages, OTPs, and announcements from your own email account via SMTP.</p>
          {config && (
            <p className="text-xs mt-1 flex items-center gap-1.5">
              {config.isVerified
                ? <><CheckCircle2 className="w-3 h-3 text-green-500"/><span className="text-green-600 font-semibold">{config.emailAddress}</span><span className="text-surface-muted">— verified</span></>
                : <><AlertCircle className="w-3 h-3 text-amber-500"/><span className="text-amber-600 font-semibold">{config.emailAddress}</span><span className="text-surface-muted">— not tested</span></>
              }
            </p>
          )}
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {config && !config.isVerified && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={testConnection} disabled={testing}>
              {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <CheckCircle2 className="w-3.5 h-3.5"/>}Test
            </Button>
          )}
          {config && (
            <Button size="sm" variant="outline" onClick={() => { setForm({ emailAddress: config.emailAddress, smtpHost: config.smtpHost, smtpPort: config.smtpPort, appPassword: '' }); setEditing(e => !e) }}>
              {editing ? 'Cancel' : 'Edit'}
            </Button>
          )}
          {config && !confirmRemove && (
            <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => setConfirmRemove(true)} aria-label="Disconnect">
              <Trash2 className="w-3.5 h-3.5"/>
            </Button>
          )}
          {config && confirmRemove && (
            <div className="flex gap-1.5">
              <Button size="sm" className="bg-red-600 hover:bg-red-700 gap-1 h-7 text-[11px]" onClick={remove}>
                <Trash2 className="w-3 h-3" /> Disconnect
              </Button>
              <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => setConfirmRemove(false)}>Cancel</Button>
            </div>
          )}
        </div>
      </div>

      {editing && (
        <div className="border-t border-surface-border px-4 pb-4 pt-3 space-y-3 bg-surface/30">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-surface-muted mb-1.5">Quick Setup</p>
            <div className="flex flex-wrap gap-1.5">
              {SMTP_PRESETS.map(p => (
                <button key={p.label} type="button" onClick={() => applyPreset(p)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                    form.smtpHost === p.host && p.host !== ''
                      ? 'bg-brand-500 text-white border-brand-500'
                      : 'bg-white text-gray-700 border-surface-border hover:border-brand-400'
                  }`}>
                  {p.label}
                </button>
              ))}
            </div>
            {presetHint && <p className="text-[10px] text-brand-600 mt-1.5">💡 {presetHint}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1">
              <Label htmlFor="me-email">Email address</Label>
              <Input id="me-email" type="email" placeholder="you@gmail.com"
                value={form.emailAddress} onChange={e => setForm(f => ({ ...f, emailAddress: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="me-host">SMTP host</Label>
              <Input id="me-host" placeholder="smtp.gmail.com" value={form.smtpHost} onChange={e => setForm(f => ({ ...f, smtpHost: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="me-port">Port</Label>
              <Input id="me-port" type="number" value={form.smtpPort} onChange={e => setForm(f => ({ ...f, smtpPort: Number(e.target.value) }))} />
            </div>
            <div className="col-span-2 space-y-1">
              <Label htmlFor="me-pass">App password</Label>
              <div className="relative">
                <Input id="me-pass" type={showPass ? 'text' : 'password'} placeholder="App-specific password (not your login password)"
                  value={form.appPassword} onChange={e => setForm(f => ({ ...f, appPassword: e.target.value }))} />
                <button type="button" title="Toggle" aria-label="Toggle visibility" onClick={() => setShowPass(p => !p)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-muted hover:text-gray-700">
                  {showPass ? <EyeOff className="w-4 h-4"/> : <Eye className="w-4 h-4"/>}
                </button>
              </div>
              <p className="text-[10px] text-surface-muted">Encrypted at rest. Never shared.</p>
            </div>
          </div>

          <Button className="w-full gap-2" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Check className="w-4 h-4"/>}Save Email Config
          </Button>
        </div>
      )}
    </div>
  )
}

function EmailSyncCard() {
  const toast = useToast()
  const [status, setStatus] = useState<{ configured: boolean; lastSyncedAt: string | null } | null>(null)
  const [syncing, setSyncing] = useState(false)
  useEffect(() => { fetch('/api/sync/email').then(r => r.json()).then(setStatus).catch(()=>{}) }, [])
  const syncNow = async () => {
    setSyncing(true)
    const res  = await fetch('/api/sync/email', { method: 'POST' })
    const data = await res.json()
    if (res.ok) toast(`Synced — ${data.matched || 0} matched`, 'success')
    else toast(data.error || 'Sync failed', 'error')
    setSyncing(false)
  }
  return (
    <div className="flex items-start gap-4 p-4 rounded-xl border border-surface-border bg-white">
      <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Inbox className="w-5 h-5 text-indigo-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-gray-900">Email → CRM Sync (IMAP)</p>
        <p className="text-xs text-surface-muted">Match inbox emails to contacts by sender address.</p>
        {status !== null && (
          <p className="text-xs mt-1 flex items-center gap-1">
            {status.configured
              ? <><CheckCircle2 className="w-3 h-3 text-green-500"/><span className="text-green-600 font-semibold">Configured</span></>
              : <><AlertCircle className="w-3 h-3 text-amber-500"/><span className="text-amber-600 font-semibold">Not configured</span></>
            }
          </p>
        )}
      </div>
      <Button type="button" size="sm" variant="outline" className="gap-1.5"
        onClick={syncNow} disabled={syncing || !status?.configured}>
        {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin"/> : <RefreshCw className="w-3.5 h-3.5"/>}
        Sync
      </Button>
    </div>
  )
}

function OrgProfileCard({ isBoss }: { isBoss: boolean }) {
  const toast = useToast()
  const [form, setForm] = useState({ name:'', address:'', website:'', phone:'', email:'', logo:'' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [logo, setLogo] = useState<string[]>([])

  useEffect(() => {
    fetch('/api/org/settings').then(r => r.json()).then(d => {
      setForm({ name:d.name||'', address:d.address||'', website:d.website||'', phone:d.phone||'', email:d.email||'', logo:d.logo||'' })
      if (d.logo) setLogo([d.logo])
    }).finally(() => setLoading(false))
  }, [])

  const save = async () => {
    setSaving(true)
    const res = await fetch('/api/org/settings', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ ...form, logo: logo[0] || form.logo }) })
    if (res.ok) toast('Saved', 'success'); else toast('Failed', 'error')
    setSaving(false)
  }

  if (loading) return <div className="h-24 rounded-xl bg-surface-border animate-pulse" />

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
          <Building2 className="w-4 h-4 text-brand-500"/>Organisation Profile
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {!isBoss && <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Only boss can edit.</p>}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2 space-y-1.5">
            <Label>Name</Label>
            <Input value={form.name} onChange={e => setForm(f=>({...f,name:e.target.value}))} disabled={!isBoss} />
          </div>
          <div className="sm:col-span-2 space-y-1.5">
            <Label>Address</Label>
            <Input value={form.address} onChange={e => setForm(f=>({...f,address:e.target.value}))} disabled={!isBoss} />
          </div>
          <div className="space-y-1.5">
            <Label>Website</Label>
            <Input value={form.website} onChange={e => setForm(f=>({...f,website:e.target.value}))} disabled={!isBoss} />
          </div>
          <div className="space-y-1.5">
            <Label>Phone</Label>
            <Input value={form.phone} onChange={e => setForm(f=>({...f,phone:e.target.value}))} disabled={!isBoss} />
          </div>
          <div className="sm:col-span-2 space-y-1.5">
            <Label>Email</Label>
            <Input type="email" value={form.email} onChange={e => setForm(f=>({...f,email:e.target.value}))} disabled={!isBoss} />
          </div>
          {isBoss && (
            <div className="sm:col-span-2">
              <FileUploader label="Logo" hint="PNG or SVG · Max 1" maxFiles={1} onChange={setLogo} disabled={saving} />
            </div>
          )}
        </div>
        {isBoss && (
          <Button className="gap-2" onClick={save} disabled={saving}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Check className="w-4 h-4"/>}Save
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

export default function SettingsPage() {
  const { user } = useUser()
  const router   = useRouter()
  const role     = user?.role || 'employee'
  const meta     = ROLE_META[role] || ROLE_META.employee
  const RoleIcon = meta.icon

  const logout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.replace('/sign-in')
  }

  return (
    <>
      <Header title="Settings" />
      <main className="flex-1 p-5 lg:p-8 xl:px-12 space-y-5 max-w-4xl w-full mx-auto bg-surface-2">

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-bold text-gray-700">Account</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <div className="flex items-center gap-4 p-4 rounded-xl border border-surface-border bg-white">
              <div className={`w-12 h-12 rounded-xl bg-surface flex items-center justify-center ${meta.color}`}>
                <RoleIcon className="w-5 h-5"/>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm text-gray-900">{user?.fullName || '—'}</p>
                <p className="text-xs text-surface-muted">{user?.email || '—'}</p>
                <p className="text-[10px] font-bold uppercase tracking-widest mt-0.5">{meta.label} · {meta.desc}</p>
              </div>
              <div className="flex flex-col gap-2">
                <Link href="/profile" className="inline-flex items-center gap-1.5 px-3 h-9 rounded-xl border border-surface-border text-xs font-semibold text-gray-700 hover:border-brand-400 hover:text-brand-600 transition-colors">
                  <User className="w-3.5 h-3.5" /> Edit profile
                </Link>
                <Button variant="outline" size="sm" className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50" onClick={logout}>
                  <LogOut className="w-3.5 h-3.5"/>Sign out
                </Button>
              </div>
            </div>
            <p className="text-[10px] text-surface-muted">Role can only be changed by the boss in User Management.</p>
          </CardContent>
        </Card>

        <ChangePasswordCard />

        <OrgProfileCard isBoss={role === 'boss'} />

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-bold text-gray-700">Integrations</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <MyEmailCard />
            <EmailSyncCard />
            <a href="/api/auth/outlook" className="flex items-center gap-4 p-4 rounded-xl border border-surface-border bg-white hover:border-brand-300 transition-colors">
              <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center"><Mail className="w-5 h-5 text-blue-500"/></div>
              <div className="flex-1">
                <p className="text-sm font-bold text-gray-900">Microsoft Outlook</p>
                <p className="text-xs text-surface-muted">Auto-sync emails to CRM contact timelines</p>
              </div>
              <Button type="button" size="sm" variant="outline" className="gap-1.5"><Mail className="w-3.5 h-3.5"/>Connect</Button>
            </a>
          </CardContent>
        </Card>

      </main>
    </>
  )
}
