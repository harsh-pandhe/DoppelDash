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
  employee: { icon: User,      color: 'text-ink-muted',  label: 'Employee', desc: 'Standard access' },
  manager:  { icon: Briefcase, color: 'text-brand-500', label: 'Manager',  desc: 'Approve requests, manage team' },
  admin:    { icon: Shield,    color: 'text-amber-500', label: 'Admin',    desc: 'Full oversight & admin' },
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
        <CardTitle className="text-sm font-bold text-ink-muted flex items-center gap-2"><KeyRound className="w-4 h-4 text-brand-500"/>Change Password</CardTitle>
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
              className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-muted hover:text-ink-muted">
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
        <CardTitle className="text-sm font-bold text-ink-muted flex items-center gap-2">
          <Building2 className="w-4 h-4 text-brand-500"/>Organisation Profile
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 pt-0">
        {!isBoss && <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">Only admin can edit.</p>}
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
            <CardTitle className="text-sm font-bold text-ink-muted">Account</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <div className="flex items-center gap-4 p-4 rounded-xl border border-surface-border bg-surface-1">
              <div className={`w-12 h-12 rounded-xl bg-surface flex items-center justify-center ${meta.color}`}>
                <RoleIcon className="w-5 h-5"/>
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm text-ink">{user?.fullName || '—'}</p>
                <p className="text-xs text-surface-muted">{user?.email || '—'}</p>
                <p className="text-[10px] font-bold uppercase tracking-widest mt-0.5">{meta.label} · {meta.desc}</p>
              </div>
              <div className="flex flex-col gap-2">
                <Link href="/profile" className="inline-flex items-center gap-1.5 px-3 h-9 rounded-xl border border-surface-border text-xs font-semibold text-ink-muted hover:border-brand-400 hover:text-brand-600 transition-colors">
                  <User className="w-3.5 h-3.5" /> Edit profile
                </Link>
                <Button variant="outline" size="sm" className="gap-1.5 text-red-600 border-red-200 hover:bg-red-50" onClick={logout}>
                  <LogOut className="w-3.5 h-3.5"/>Sign out
                </Button>
              </div>
            </div>
            <p className="text-[10px] text-surface-muted">Role can only be changed by an admin in User Management.</p>
          </CardContent>
        </Card>

        <ChangePasswordCard />

        <OrgProfileCard isBoss={role === 'admin'} />

        {/* Mail integrations (SMTP / IMAP / Outlook) are configured centrally via
            environment by the developer — not exposed in the user-facing settings. */}

      </main>
    </>
  )
}
