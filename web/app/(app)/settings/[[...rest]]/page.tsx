'use client'
import { useState, useEffect, useRef } from 'react'
import { useUser } from '@clerk/nextjs'
import { UserProfile } from '@clerk/nextjs'
import { Shield, User, Briefcase, ChevronDown, Check, Loader2, Mail, CheckCircle2, AlertCircle, RefreshCw, Inbox, Send, Trash2, Eye, EyeOff } from 'lucide-react'
import Header from '@/components/layout/Header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

const ROLES = [
  { value: 'employee', label: 'Employee',  desc: 'Standard access — submit leaves & expenses',              icon: User,      color: 'text-gray-500'  },
  { value: 'manager',  label: 'Manager',   desc: 'Approve/reject leave and expense requests',               icon: Briefcase, color: 'text-brand-500' },
  { value: 'boss',     label: 'Boss',      desc: 'Final approval — mark expenses as paid, full oversight',  icon: Shield,    color: 'text-accent-500'},
]

function RoleSwitcher() {
  const { user } = useUser()
  const toast    = useToast()
  const current  = (user?.unsafeMetadata?.role as string) || 'employee'
  const [open,    setOpen]   = useState(false)
  const [saving,  setSaving] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const switchRole = async (role: string) => {
    if (role === current) { setOpen(false); return }
    setSaving(true)
    try {
      await user?.update({ unsafeMetadata: { ...user.unsafeMetadata, role } })
      toast(`Role changed to ${role}`, 'success')
      setOpen(false)
      window.location.reload()
    } catch {
      toast('Failed to update role', 'error')
    } finally {
      setSaving(false)
    }
  }

  const cur = ROLES.find(r => r.value === current) || ROLES[0]
  const CurIcon = cur.icon

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-3 w-full px-4 py-3 rounded-xl border border-surface-border bg-white hover:border-brand-400 transition-colors group"
      >
        <div className={`w-9 h-9 rounded-lg bg-surface flex items-center justify-center flex-shrink-0 ${cur.color}`}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CurIcon className="w-4 h-4" />}
        </div>
        <div className="flex-1 text-left">
          <p className="text-sm font-bold text-gray-900 capitalize">{cur.label}</p>
          <p className="text-xs text-surface-muted">{cur.desc}</p>
        </div>
        <ChevronDown className={`w-4 h-4 text-surface-muted transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="absolute top-full left-0 right-0 mt-1.5 bg-white border border-surface-border rounded-xl shadow-lg z-20 overflow-hidden">
          {ROLES.map(role => {
            const Icon = role.icon
            const active = role.value === current
            return (
              <button
                key={role.value}
                type="button"
                onClick={() => switchRole(role.value)}
                className="flex items-center gap-3 w-full px-4 py-3 hover:bg-surface transition-colors text-left"
              >
                <div className={`w-8 h-8 rounded-lg bg-surface flex items-center justify-center flex-shrink-0 ${role.color}`}>
                  <Icon className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-gray-900 capitalize">{role.label}</p>
                  <p className="text-xs text-surface-muted">{role.desc}</p>
                </div>
                {active && <Check className="w-4 h-4 text-brand-500 flex-shrink-0" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function EmailSyncCard() {
  const toast = useToast()
  const [status,       setStatus]       = useState<{ configured: boolean; lastSyncedAt: string | null } | null>(null)
  const [syncing,      setSyncing]      = useState(false)
  const [syncResult,   setSyncResult]   = useState<{ fetched: number; matched: number } | null>(null)

  useEffect(() => {
    fetch('/api/sync/email').then(r => r.json()).then(setStatus).catch(() => {})
  }, [])

  const syncNow = async () => {
    setSyncing(true); setSyncResult(null)
    try {
      const res  = await fetch('/api/sync/email', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { toast(data.error || 'Sync failed', 'error'); return }
      setSyncResult({ fetched: data.fetched, matched: data.matched })
      setStatus(s => s ? { ...s, lastSyncedAt: data.lastSyncedAt } : s)
      toast(`Synced — ${data.matched} email(s) matched to contacts`, 'success')
    } catch {
      toast('Sync failed', 'error')
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="flex items-start gap-4 p-4 rounded-xl border border-surface-border bg-white">
      <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Inbox className="w-5 h-5 text-indigo-500" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-gray-900">Email → CRM Sync (IMAP)</p>
        <p className="text-xs text-surface-muted">Matches inbox emails to contacts by sender address, adds timeline entries.</p>
        {status !== null && (
          <p className="text-xs mt-1 flex items-center gap-1">
            {status.configured
              ? <><CheckCircle2 className="w-3 h-3 text-green-500" /><span className="text-green-600 font-semibold">Configured</span></>
              : <><AlertCircle  className="w-3 h-3 text-amber-500" /><span className="text-amber-600 font-semibold">Not configured</span> — add IMAP_HOST / IMAP_USER / IMAP_PASS to .env.local</>
            }
          </p>
        )}
        {status?.lastSyncedAt && (
          <p className="text-[10px] text-surface-muted mt-0.5">
            Last synced: {new Date(status.lastSyncedAt).toLocaleString('en-IN')}
          </p>
        )}
        {syncResult && (
          <p className="text-xs text-brand-600 font-semibold mt-1">
            ✓ {syncResult.fetched} fetched · {syncResult.matched} matched
          </p>
        )}
      </div>
      <Button type="button" size="sm" variant="outline" className="gap-1.5 flex-shrink-0"
        onClick={syncNow} disabled={syncing || !status?.configured}>
        {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
        {syncing ? 'Syncing…' : 'Sync Now'}
      </Button>
    </div>
  )
}

const SMTP_PRESETS = [
  { label: 'Outlook / Microsoft 365', host: 'smtp.office365.com', port: 587 },
  { label: 'Gmail',                   host: 'smtp.gmail.com',      port: 587 },
  { label: 'Yahoo Mail',              host: 'smtp.mail.yahoo.com', port: 587 },
  { label: 'Custom',                  host: '',                    port: 587 },
]

function MyEmailCard() {
  const toast = useToast()
  const [config,    setConfig]    = useState<{ emailAddress: string; smtpHost: string; smtpPort: number; isVerified: boolean } | null>(null)
  const [loading,   setLoading]   = useState(true)
  const [editing,   setEditing]   = useState(false)
  const [testing,   setTesting]   = useState(false)
  const [saving,    setSaving]    = useState(false)
  const [showPass,  setShowPass]  = useState(false)

  const [form, setForm] = useState({ emailAddress: '', smtpHost: '', smtpPort: 587, appPassword: '' })

  useEffect(() => {
    fetch('/api/user/email-config')
      .then(r => r.ok ? r.json() : null)
      .then(d => { setConfig(d); if (!d) setEditing(true) })
      .catch(() => setEditing(true))
      .finally(() => setLoading(false))
  }, [])

  const applyPreset = (host: string, port: number) => setForm(f => ({ ...f, smtpHost: host, smtpPort: port }))

  const save = async () => {
    if (!form.emailAddress || !form.smtpHost || !form.appPassword) {
      toast('Fill all fields', 'error'); return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/user/email-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) { toast((await res.json()).error || 'Save failed', 'error'); return }
      toast('Email config saved', 'success')
      setConfig({ ...form, isVerified: false })
      setEditing(false)
    } catch {
      toast('Save failed', 'error')
    } finally {
      setSaving(false)
    }
  }

  const testConnection = async () => {
    setTesting(true)
    try {
      const res = await fetch('/api/user/email-config/test', { method: 'POST' })
      const data = await res.json()
      if (!res.ok) { toast(data.error || 'Test failed', 'error'); return }
      toast('Connected! Test email sent to yourself', 'success')
      setConfig(c => c ? { ...c, isVerified: true } : c)
    } catch {
      toast('Test failed', 'error')
    } finally {
      setTesting(false)
    }
  }

  const remove = async () => {
    await fetch('/api/user/email-config', { method: 'DELETE' })
    setConfig(null)
    setForm({ emailAddress: '', smtpHost: '', smtpPort: 587, appPassword: '' })
    setEditing(true)
    toast('Email config removed', 'info')
  }

  if (loading) return (
    <div className="flex items-center gap-3 p-4 rounded-xl border border-surface-border bg-white">
      <Loader2 className="w-4 h-4 animate-spin text-brand-500" />
      <span className="text-sm text-surface-muted">Loading email config…</span>
    </div>
  )

  return (
    <div className="rounded-xl border border-surface-border bg-white overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-4 p-4">
        <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
          <Send className="w-5 h-5 text-brand-500" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900">My Email (Outgoing)</p>
          <p className="text-xs text-surface-muted">Link your Outlook or Gmail to send CRM campaigns from your account.</p>
          {config && (
            <div className="flex items-center gap-1.5 mt-0.5">
              {config.isVerified
                ? <><CheckCircle2 className="w-3 h-3 text-green-500" /><span className="text-xs text-green-600 font-semibold">{config.emailAddress} — Verified</span></>
                : <><AlertCircle  className="w-3 h-3 text-amber-500" /><span className="text-xs text-amber-600 font-semibold">{config.emailAddress} — Not tested</span></>
              }
            </div>
          )}
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {config && !config.isVerified && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={testConnection} disabled={testing}>
              {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              {testing ? 'Testing…' : 'Test'}
            </Button>
          )}
          {config && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => { setForm({ emailAddress: config.emailAddress, smtpHost: config.smtpHost, smtpPort: config.smtpPort, appPassword: '' }); setEditing(e => !e) }}>
              {editing ? 'Cancel' : 'Edit'}
            </Button>
          )}
          {config && (
            <Button size="sm" variant="outline" className="gap-1.5 text-red-600 hover:text-red-700 border-red-200 hover:border-red-300" onClick={remove}>
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Edit form */}
      {editing && (
        <div className="border-t border-surface-border px-4 pb-4 pt-3 space-y-3 bg-surface/30">
          {/* Presets */}
          <div>
            <p className="text-xs font-semibold text-surface-muted mb-1.5">Quick setup</p>
            <div className="flex flex-wrap gap-2">
              {SMTP_PRESETS.map(p => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applyPreset(p.host, p.port)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                    form.smtpHost === p.host
                      ? 'bg-brand-500 text-white border-brand-500'
                      : 'bg-white text-gray-700 border-surface-border hover:border-brand-400'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2 space-y-1">
              <Label htmlFor="emailAddress" className="text-xs">Email address</Label>
              <Input id="emailAddress" type="email" placeholder="harsh@doppelmayr.in"
                value={form.emailAddress} onChange={e => setForm(f => ({ ...f, emailAddress: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="smtpHost" className="text-xs">SMTP host</Label>
              <Input id="smtpHost" placeholder="smtp.office365.com"
                value={form.smtpHost} onChange={e => setForm(f => ({ ...f, smtpHost: e.target.value }))} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="smtpPort" className="text-xs">Port</Label>
              <Input id="smtpPort" type="number" placeholder="587"
                value={form.smtpPort} onChange={e => setForm(f => ({ ...f, smtpPort: Number(e.target.value) }))} />
            </div>
            <div className="col-span-2 space-y-1">
              <Label htmlFor="appPassword" className="text-xs">App password</Label>
              <div className="relative">
                <Input id="appPassword" type={showPass ? 'text' : 'password'}
                  placeholder="Generate in Outlook/Gmail account security settings"
                  value={form.appPassword} onChange={e => setForm(f => ({ ...f, appPassword: e.target.value }))} />
                <button type="button" onClick={() => setShowPass(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-muted hover:text-gray-700">
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-[10px] text-surface-muted">
                Outlook: myaccount.microsoft.com → Security → App passwords &nbsp;|&nbsp;
                Gmail: myaccount.google.com → Security → App passwords
              </p>
            </div>
          </div>

          <Button type="button" className="w-full gap-2" onClick={save} disabled={saving}>
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving…</> : <><Check className="w-4 h-4" /> Save Email Config</>}
          </Button>
        </div>
      )}
    </div>
  )
}

function OutlookConnect() {
  const [status, setStatus] = useState<'unknown' | 'connected' | 'disconnected'>('unknown')

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('outlook') === 'connected') setStatus('connected')
    else if (params.get('outlook') === 'error') setStatus('disconnected')
    else setStatus('unknown')
  }, [])

  return (
    <div className="flex items-center gap-4 p-4 rounded-xl border border-surface-border bg-white">
      <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center flex-shrink-0">
        <Mail className="w-5 h-5 text-blue-500" />
      </div>
      <div className="flex-1">
        <p className="text-sm font-bold text-gray-900">Microsoft Outlook</p>
        <p className="text-xs text-surface-muted">Auto-sync emails to CRM contact timelines</p>
        {status === 'connected' && (
          <p className="text-xs text-green-600 font-semibold flex items-center gap-1 mt-0.5">
            <CheckCircle2 className="w-3 h-3" /> Connected
          </p>
        )}
        {status === 'disconnected' && (
          <p className="text-xs text-red-600 font-semibold flex items-center gap-1 mt-0.5">
            <AlertCircle className="w-3 h-3" /> Connection failed — try again
          </p>
        )}
      </div>
      <a href="/api/auth/outlook">
        <Button type="button" size="sm" variant="outline" className="gap-1.5">
          <Mail className="w-3.5 h-3.5" />
          {status === 'connected' ? 'Reconnect' : 'Connect'}
        </Button>
      </a>
    </div>
  )
}

export default function SettingsPage() {
  const { user } = useUser()

  return (
    <>
      <Header title="Settings" />
      <main className="flex-1 p-6 space-y-6 max-w-3xl">

        {/* Role switcher */}
        <Card className="relative z-20">
          <CardHeader>
            <CardTitle className="text-sm font-bold text-gray-700">Your Role</CardTitle>
            <p className="text-xs text-surface-muted mt-0.5">Controls what you can see and do in DoppelDash.</p>
          </CardHeader>
          <CardContent className="pt-0">
            <RoleSwitcher />
          </CardContent>
        </Card>

        {/* Account info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-bold text-gray-700">Account Info</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            {[
              { label: 'Full name',  value: user?.fullName || '—' },
              { label: 'Email',      value: user?.primaryEmailAddress?.emailAddress || '—' },
              { label: 'User ID',    value: user?.id || '—' },
              { label: 'Member since', value: user?.createdAt ? new Date(user.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' }) : '—' },
            ].map(({ label, value }) => (
              <div key={label} className="flex items-center justify-between py-2 border-b border-surface-border last:border-0">
                <span className="text-xs font-semibold text-surface-muted uppercase tracking-wide">{label}</span>
                <span className="text-sm font-medium text-gray-900 truncate max-w-xs text-right">{value}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Outlook integration */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-bold text-gray-700">Integrations</CardTitle>
            <p className="text-xs text-surface-muted mt-0.5">Connect external services to enhance your CRM.</p>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <MyEmailCard />
            <EmailSyncCard />
            <OutlookConnect />
          </CardContent>
        </Card>

        {/* Clerk UserProfile for password/2FA/etc */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-bold text-gray-700">Security & Profile</CardTitle>
            <p className="text-xs text-surface-muted mt-0.5">Manage password, two-factor auth, and connected accounts.</p>
          </CardHeader>
          <CardContent className="pt-0">
            <UserProfile
              appearance={{
                elements: {
                  rootBox:  'w-full',
                  cardBox:  'shadow-none border-0 bg-transparent p-0 w-full',
                  card:     'shadow-none border-0 bg-transparent p-0 m-0',
                  navbar:   'hidden',
                  pageScrollBox: 'p-0',
                },
              }}
            />
          </CardContent>
        </Card>

      </main>
    </>
  )
}
