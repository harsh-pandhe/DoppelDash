'use client'
import { useState, useEffect, useCallback } from 'react'
import { Shield, User, Briefcase, Check, Loader2, Ban, UserCheck, Save, Search } from 'lucide-react'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'

interface UserRow {
  id: string; name: string; email: string; role: string; banned: boolean
  lastActive: number | null; balance: { casual: number; medical: number; earned: number }
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
  const [editBal, setEditBal] = useState(false)
  const [bal, setBal] = useState(u.balance)
  const [savingBal, setSavingBal] = useState(false)

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
          <Button type="button" size="sm" variant="outline"
            className={u.banned ? 'text-green-600 border-green-200' : 'text-red-600 border-red-200 hover:bg-red-50'}
            onClick={toggleBan} disabled={banUpdating}>
            {banUpdating
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : u.banned ? <UserCheck className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />
            }
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export default function AdminUsersPage() {
  const [users,   setUsers]   = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search,  setSearch]  = useState('')

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
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-muted pointer-events-none" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by name or email…"
              className="pl-9 h-9 pr-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 min-w-[220px]"
            />
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
