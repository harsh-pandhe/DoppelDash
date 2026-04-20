'use client'
import { useState } from 'react'
import { useUser } from '@clerk/nextjs'
import { UserProfile } from '@clerk/nextjs'
import { Shield, User, Briefcase, ChevronDown, Check, Loader2 } from 'lucide-react'
import Header from '@/components/layout/Header'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'

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
    <div className="relative">
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

export default function SettingsPage() {
  const { user } = useUser()

  return (
    <>
      <Header title="Settings" />
      <main className="flex-1 p-6 space-y-6 max-w-3xl">

        {/* Role switcher */}
        <Card>
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
