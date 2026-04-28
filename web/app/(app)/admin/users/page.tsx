'use client'
import { useState, useEffect, useCallback } from 'react'
import { Shield, User, Briefcase, Check, Loader2, Ban, UserCheck, Save, Search, Database, Lock } from 'lucide-react'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import { ALL_PERMISSIONS, type Permission } from '@/lib/permissions'

interface UserRow {
  id: string; name: string; email: string; role: string; banned: boolean
  lastActive: number | null; balance: { casual: number; medical: number; earned: number }
  permissions?: Permission[]
}

const ROLES = ['employee', 'manager', 'boss'] as const
const ROLE_COLORS: Record<string, string> = {
  employee: 'bg-gray-100 text-gray-700',
  manager:  'bg-brand-100 text-brand-700',
  boss:     'bg-accent-100 text-accent-700',
}

function UserCard({ u, onUpdate }: { u: UserRow; onUpdate: () => void }) {
  const toast  = useToast()
  const [roleUpdating, setRoleUpdating] = useState(false)
  const [banUpdating,  setBanUpdating]  = useState(false)
  const [editBal,  setEditBal]  = useState(false)
  const [bal,      setBal]      = useState(u.balance)
  const [savingBal,setSavingBal]= useState(false)
  const [showPerms,setShowPerms]= useState(false)
  const [savingPerms,setSavingPerms] = useState(false)
  const [perms, setPerms] = useState<Permission[]>(u.permissions || [])

  const togglePerm = (perm: Permission) => {
    setPerms(prev => prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm])
  }

  const savePerms = async () => {
    setSavingPerms(true)
    await fetch(`/api/admin/users/${u.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions: perms }),
    })
    toast('Permissions saved', 'success')
    setSavingPerms(false)
    setShowPerms(false)
    onUpdate()
  }

  const changeRole = async (role: string) => {
    if (role === u.role) return
    setRoleUpdating(true)
    await fetch(`/api/admin/users/${u.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role }),
    })
    toast(`Role changed to ${role}`, 'success')
    setRoleUpdating(false)
    onUpdate()
  }

  const toggleBan = async () => {
    setBanUpdating(true)
    await fetch(`/api/admin/users/${u.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ banned: !u.banned }),
    })
    toast(u.banned ? 'User reinstated' : 'User suspended', u.banned ? 'success' : 'info')
    setBanUpdating(false)
    onUpdate()
  }

  const saveBalance = async () => {
    setSavingBal(true)
    await fetch(`/api/admin/balances/${u.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bal),
    })
    toast('Leave balance updated', 'success')
    setSavingBal(false)
    setEditBal(false)
    onUpdate()
  }

  return (
    <Card className={u.banned ? 'opacity-60' : ''}>
      <CardContent className="p-4">
        <div className="flex items-start gap-4 flex-wrap">
          {/* Avatar */}
          <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center flex-shrink-0">
            <span className="font-bold text-brand-700 text-sm">
              {u.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)}
            </span>
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <p className="font-bold text-sm text-gray-900">{u.name}</p>
              {u.banned && <Badge variant="destructive" className="text-[10px]">Suspended</Badge>}
            </div>
            <p className="text-xs text-surface-muted">{u.email}</p>
            {u.lastActive && (
              <p className="text-[10px] text-surface-muted mt-0.5">
                Last active: {new Date(u.lastActive).toLocaleDateString('en-IN')}
              </p>
            )}

            {/* Role selector */}
            <div className="flex gap-1.5 mt-2 flex-wrap">
              {ROLES.map(r => (
                <button type="button" key={r} onClick={() => changeRole(r)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold transition-all
                    ${u.role === r ? ROLE_COLORS[r] : 'bg-surface text-surface-muted hover:bg-surface-border'}`}>
                  {u.role === r && !roleUpdating && <Check className="w-2.5 h-2.5" />}
                  {roleUpdating && u.role === r && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                  {r === 'boss' ? <Shield className="w-2.5 h-2.5" /> : r === 'manager' ? <Briefcase className="w-2.5 h-2.5" /> : <User className="w-2.5 h-2.5" />}
                  {r}
                </button>
              ))}
            </div>

            {/* Leave balance */}
            <div className="mt-3">
              {!editBal ? (
                <div className="flex items-center gap-3 flex-wrap">
                  {[['C', bal.casual], ['M', bal.medical], ['E', bal.earned]].map(([k, v]) => (
                    <span key={String(k)} className="text-[10px] font-semibold text-surface-muted">
                      {k}: <span className="text-gray-900">{v}</span>
                    </span>
                  ))}
                  <button type="button" onClick={() => setEditBal(true)}
                    className="text-[10px] text-brand-500 font-semibold hover:underline">Edit balance</button>
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap mt-1">
                  {(['casual', 'medical', 'earned'] as const).map(k => (
                    <div key={k} className="space-y-0.5">
                      <label className="text-[9px] font-bold uppercase tracking-wide text-surface-muted">{k[0].toUpperCase()}</label>
                      <input type="number" min="0" max="365" value={bal[k]}
                        onChange={e => setBal(b => ({ ...b, [k]: Number(e.target.value) }))}
                        aria-label={`${k} leave balance`}
                        className="w-14 h-7 px-2 rounded-lg border border-surface-border text-xs focus:outline-none focus:border-brand-500" />
                    </div>
                  ))}
                  <Button type="button" size="sm" className="h-7 gap-1 mt-4" onClick={saveBalance} disabled={savingBal}>
                    {savingBal ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                  </Button>
                  <button type="button" onClick={() => setEditBal(false)}
                    className="text-[10px] text-surface-muted hover:text-red-500 mt-4">Cancel</button>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 flex-shrink-0">
            <Button type="button" size="sm" variant="outline" title="Manage permissions"
              className={showPerms ? 'bg-purple-50 border-purple-300 text-purple-600' : 'text-purple-600 border-purple-200 hover:bg-purple-50'}
              onClick={() => setShowPerms(p => !p)}>
              <Lock className="w-3.5 h-3.5" />
            </Button>
            <Button type="button" size="sm" variant="outline"
              className={u.banned ? 'text-green-600 border-green-200' : 'text-red-600 border-red-200 hover:bg-red-50'}
              onClick={toggleBan} disabled={banUpdating}>
              {banUpdating
                ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : u.banned ? <UserCheck className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />
              }
            </Button>
          </div>
        </div>
        {/* End flex row */}

        {/* Permissions panel */}
        {showPerms && (
          <div className="mt-3 pt-3 border-t border-surface-border space-y-2">
            <p className="text-[10px] font-bold uppercase tracking-wide text-surface-muted flex items-center gap-1">
              <Lock className="w-3 h-3" /> Extra Permissions (employee only — ignored for manager/boss)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ALL_PERMISSIONS.map(p => (
                <label key={p.key} className="flex items-start gap-2 cursor-pointer p-2 rounded-lg hover:bg-surface transition-colors">
                  <input type="checkbox" className="mt-0.5 accent-brand-500"
                    checked={perms.includes(p.key)}
                    onChange={() => togglePerm(p.key)} />
                  <div>
                    <p className="text-xs font-semibold text-gray-900">{p.label}</p>
                    <p className="text-[10px] text-surface-muted">{p.desc}</p>
                  </div>
                </label>
              ))}
            </div>
            <div className="flex gap-2">
              <Button type="button" size="sm" className="gap-1.5" onClick={savePerms} disabled={savingPerms}>
                {savingPerms ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                Save Permissions
              </Button>
              <button type="button" className="text-xs text-surface-muted hover:text-red-500"
                onClick={() => { setPerms(u.permissions || []); setShowPerms(false) }}>Cancel</button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export default function AdminUsersPage() {
  const [users,   setUsers]   = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')
  const [seeding, setSeeding] = useState(false)
  const toast = useToast()

  const runSeed = async () => {
    if (!confirm('Wipe and reseed all dev data for your account?')) return
    setSeeding(true)
    try {
      const res = await fetch('/api/dev/seed', { method: 'POST' })
      const d   = await res.json()
      if (res.ok) toast(`Seeded: ${d.seeded?.contacts}c / ${d.seeded?.leaves}l / ${d.seeded?.expenses}e`, 'success')
      else toast(d.error || 'Seed failed', 'error')
    } catch { toast('Seed failed', 'error') }
    setSeeding(false)
  }

  const fetchUsers = useCallback(async () => {
    setLoading(true)
    const res  = await fetch('/api/admin/users')
    const data = await res.json()
    setUsers(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchUsers() }, [fetchUsers])

  const filtered = search.trim()
    ? users.filter(u =>
        u.name.toLowerCase().includes(search.toLowerCase()) ||
        u.email.toLowerCase().includes(search.toLowerCase())
      )
    : users

  return (
    <>
      <Header title="User Management" />
      <main className="flex-1 p-6 space-y-5 max-w-3xl">
        <div className="flex items-center gap-3 flex-wrap justify-between">
          <p className="text-sm text-surface-muted">Manage roles, leave balances, and account status for all employees.</p>
          <div className="flex items-center gap-2">
            {process.env.NODE_ENV !== 'production' && (
              <Button type="button" variant="outline" size="sm" className="gap-1.5 text-orange-600 border-orange-200 hover:bg-orange-50"
                onClick={runSeed} disabled={seeding}>
                {seeding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
                Reseed Dev Data
              </Button>
            )}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-muted pointer-events-none" />
              <input
                value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search by name or email…"
                className="pl-9 h-9 pr-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 min-w-[220px]"
              />
            </div>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">{[...Array(5)].map((_, i) => <div key={i} className="h-24 rounded-2xl bg-surface-border animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-surface-muted py-8 text-center">No users match &quot;{search}&quot;</p>
        ) : (
          <div className="space-y-3">
            {filtered.map(u => <UserCard key={u.id} u={u} onUpdate={fetchUsers} />)}
          </div>
        )}
      </main>
    </>
  )
}
