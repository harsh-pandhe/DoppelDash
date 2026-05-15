'use client'
import { useState, useEffect, useCallback } from 'react'
import {
  Shield, User, Briefcase, Check, Loader2, Ban, UserCheck,
  Save, Search, Database, Lock, Plus, Copy, Eye, EyeOff,
  Building2, CalendarDays, Star,
} from 'lucide-react'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/toast'
import { useUser } from '@/lib/useUser'
import { ALL_PERMISSIONS, type Permission } from '@/lib/permissions'
import { useAutoRefresh } from '@/lib/useAutoRefresh'
import * as Dialog from '@radix-ui/react-dialog'

interface EmployeeProfile {
  employeeId: string; department: string; designation: string
  employeeType: string; joiningDate: string; onboardingComplete: boolean
  lastLoginAt?: string; photo?: string
  reportingManagerId?: string | null
  privileges?: {
    food:   { tier: string; dailyLimit: number }
    taxi:   { tier: string; perKmLimit: number }
    flight: { tier: string; enabled: boolean }
    hotel:  { tier: string; perNightLimit: number }
  }
}

interface UserRow {
  id: string; name: string; email: string; role: string; banned: boolean
  lastActive: number | null
  balance: { casual: number; sick: number; earned: number; privilege: number; restricted: number }
  permissions?: Permission[]
  employee?: EmployeeProfile | null
  createdAt?: string
}

const ROLES = ['employee', 'manager', 'boss'] as const

const ROLE_META: Record<string, { gradient: string; badge: string; icon: React.ElementType }> = {
  employee: { gradient: 'from-gray-400 to-gray-500',    badge: 'bg-gray-100 text-gray-700',    icon: User      },
  manager:  { gradient: 'from-brand-400 to-brand-600',  badge: 'bg-brand-100 text-brand-700',  icon: Briefcase },
  boss:     { gradient: 'from-amber-400 to-orange-500', badge: 'bg-amber-100 text-amber-700',  icon: Shield    },
}

const AVATAR_GRADIENTS = ['from-brand-400 to-brand-600','from-purple-400 to-violet-600','from-orange-400 to-red-500','from-emerald-400 to-green-600','from-pink-400 to-rose-500','from-cyan-400 to-teal-600']
const avatarGradient = (name: string) => AVATAR_GRADIENTS[name.charCodeAt(0) % AVATAR_GRADIENTS.length]

const PRIVILEGE_TIERS: Record<string, string> = {
  none: '—', basic: 'Basic', standard: 'Std', premium: 'Premium',
  ac: 'AC', ac_premium: 'AC+', economy: 'Economy', business: 'Business',
  budget: 'Budget',
}

const DEFAULT_PRIVILEGES = {
  food:   { tier: 'none', dailyLimit: 0 },
  taxi:   { tier: 'none', perKmLimit: 0 },
  flight: { tier: 'none', enabled: false },
  hotel:  { tier: 'none', perNightLimit: 0 },
}

/* ─── Create User Dialog ──────────────────────────────────────────────────── */
function CreateUserDialog({ canCreateManager, onCreated }: { canCreateManager: boolean; onCreated: () => void }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [created, setCreated] = useState<{ tempPassword: string; employeeId: string } | null>(null)
  const [showPwd, setShowPwd] = useState(false)
  const [form, setForm] = useState({
    firstName: '', lastName: '', email: '',
    newRole: 'employee' as 'employee' | 'manager',
    department: '', designation: '', employeeType: 'full_time', joiningDate: '',
  })

  const reset = () => { setForm({ firstName:'',lastName:'',email:'',newRole:'employee',department:'',designation:'',employeeType:'full_time',joiningDate:'' }); setCreated(null) }

  const submit = async () => {
    if (!form.firstName || !form.lastName || !form.email) { toast('Name and email required', 'error'); return }
    setSaving(true)
    try {
      const res  = await fetch('/api/admin/users', { method: 'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(form) })
      const data = await res.json()
      if (!res.ok) { toast(data.error || 'Failed to create user', 'error'); return }
      setCreated({ tempPassword: data.tempPassword, employeeId: data.employeeId })
      onCreated()
    } catch { toast('Network error', 'error') }
    finally { setSaving(false) }
  }

  return (
    <Dialog.Root open={open} onOpenChange={v => { setOpen(v); if (!v) reset() }}>
      <Dialog.Trigger asChild>
        <Button className="gap-2"><Plus className="w-4 h-4" /> Add Member</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50 backdrop-blur-sm" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
          <div className="sticky top-0 bg-white border-b border-surface-border px-6 py-4 flex items-center justify-between">
            <div>
              <Dialog.Title className="text-base font-bold text-gray-900">Add Team Member</Dialog.Title>
              <Dialog.Description className="text-xs text-surface-muted">Creates Clerk account + employee record. Temp password shown once.</Dialog.Description>
            </div>
          </div>

          {created ? (
            <div className="p-6 space-y-4">
              <div className="flex items-center gap-3 p-4 rounded-xl bg-green-50 border border-green-200">
                <Check className="w-5 h-5 text-green-600 flex-shrink-0" />
                <div>
                  <p className="text-sm font-bold text-green-800">Account created!</p>
                  <p className="text-xs text-green-700">Employee ID: <strong>{created.employeeId}</strong></p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Temporary Password <span className="text-red-500">(share with employee, shown once)</span></Label>
                <div className="flex gap-2">
                  <div className="flex-1 font-mono text-sm px-3 py-2 rounded-xl border border-surface-border bg-surface">
                    {showPwd ? created.tempPassword : '••••••••••'}
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => setShowPwd(p => !p)}>
                    {showPwd ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                  <Button type="button" variant="outline" size="sm"
                    onClick={() => { navigator.clipboard.writeText(created.tempPassword); toast('Copied', 'success') }}>
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <Button className="w-full" onClick={() => { setOpen(false); reset() }}>Done</Button>
            </div>
          ) : (
            <div className="p-6 space-y-4">
              {/* Role */}
              <div className="space-y-1.5">
                <Label>Role</Label>
                <div className="flex gap-2">
                  {(['employee', ...(canCreateManager ? ['manager'] : [])] as const).map(r => (
                    <button key={r} type="button" onClick={() => setForm(f => ({...f, newRole: r as 'employee' | 'manager'}))}
                      className={`flex-1 py-2 rounded-xl text-sm font-bold capitalize border-2 transition-all
                        ${form.newRole === r ? 'border-brand-400 bg-brand-50 text-brand-700' : 'border-surface-border text-gray-500'}`}>
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {/* Name */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="firstName">First Name</Label>
                  <Input id="firstName" value={form.firstName} onChange={e => setForm(f=>({...f,firstName:e.target.value}))} placeholder="Rahul" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lastName">Last Name</Label>
                  <Input id="lastName" value={form.lastName} onChange={e => setForm(f=>({...f,lastName:e.target.value}))} placeholder="Sharma" />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="email">Work Email</Label>
                <Input id="email" type="email" value={form.email} onChange={e => setForm(f=>({...f,email:e.target.value}))} placeholder="rahul@doppelmayr.com" />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="department">Department</Label>
                  <Input id="department" value={form.department} onChange={e => setForm(f=>({...f,department:e.target.value}))} placeholder="Engineering" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="designation">Designation</Label>
                  <Input id="designation" value={form.designation} onChange={e => setForm(f=>({...f,designation:e.target.value}))} placeholder="Project Manager" />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="empType">Type</Label>
                  <select id="empType" aria-label="Employee type" title="Employee type" value={form.employeeType} onChange={e => setForm(f=>({...f,employeeType:e.target.value}))}
                    className="w-full h-10 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500">
                    <option value="full_time">Full-time</option>
                    <option value="part_time">Part-time</option>
                    <option value="contract">Contract</option>
                    <option value="intern">Intern</option>
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="joinDate">Joining Date</Label>
                  <input id="joinDate" type="date" aria-label="Joining date" title="Joining date" value={form.joiningDate} onChange={e => setForm(f=>({...f,joiningDate:e.target.value}))}
                    className="w-full h-10 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500" />
                </div>
              </div>

              <Button className="w-full gap-2" onClick={submit} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Create Account
              </Button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/* ─── User Card ───────────────────────────────────────────────────────────── */
function UserCard({ u, allUsers, onUpdate, isBoss }: { u: UserRow; allUsers: UserRow[]; onUpdate: () => void; isBoss: boolean }) {
  const toast  = useToast()
  const [roleUpdating, setRoleUpdating] = useState(false)
  const [banUpdating,  setBanUpdating]  = useState(false)
  const [editBal,  setEditBal]   = useState(false)
  const [bal,      setBal]       = useState(u.balance)
  const [savingBal,setSavingBal] = useState(false)
  const [showPerms,setShowPerms] = useState(false)
  const [savingPerms, setSavingPerms] = useState(false)
  const [perms, setPerms] = useState<Permission[]>(u.permissions || [])
  const [showPrivEdit, setShowPrivEdit] = useState(false)
  const [savingPrivs, setSavingPrivs] = useState(false)
  const [privs, setPrivs] = useState<NonNullable<EmployeeProfile['privileges']>>(u.employee?.privileges || DEFAULT_PRIVILEGES)
  const [savingMgr, setSavingMgr] = useState(false)

  const managers = allUsers.filter(x => (x.role === 'manager' || x.role === 'boss') && x.id !== u.id && !x.banned)
  const currentMgr = managers.find(m => m.id === u.employee?.reportingManagerId)

  const setReportingManager = async (mgrId: string | null) => {
    setSavingMgr(true)
    const res = await fetch(`/api/admin/users/${u.id}`, {
      method: 'PATCH', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ reportingManagerId: mgrId }),
    })
    if (res.ok) toast(mgrId ? 'Reporting manager set' : 'Reporting manager cleared', 'success')
    else toast('Failed to update reporting manager', 'error')
    setSavingMgr(false); onUpdate()
  }

  useEffect(() => {
    setPrivs(u.employee?.privileges || DEFAULT_PRIVILEGES)
  }, [u.employee?.privileges])

  const togglePerm = (perm: Permission) =>
    setPerms(prev => prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm])

  const savePerms = async () => {
    setSavingPerms(true)
    await fetch(`/api/admin/users/${u.id}`, { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ permissions: perms }) })
    toast('Permissions saved', 'success'); setSavingPerms(false); setShowPerms(false); onUpdate()
  }

  const savePrivileges = async () => {
    setSavingPrivs(true)
    const res = await fetch(`/api/admin/users/${u.id}`, {
      method: 'PATCH', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ privileges: privs }),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      toast(data.error || 'Failed to save privileges', 'error')
      setSavingPrivs(false)
      return
    }
    toast('Privileges saved', 'success')
    setSavingPrivs(false)
    setShowPrivEdit(false)
    onUpdate()
  }

  const changeRole = async (role: string) => {
    if (role === u.role) return
    setRoleUpdating(true)
    await fetch(`/api/admin/users/${u.id}`, { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ role }) })
    toast(`Role → ${role}`, 'success'); setRoleUpdating(false); onUpdate()
  }

  const toggleBan = async () => {
    setBanUpdating(true)
    await fetch(`/api/admin/users/${u.id}`, { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ banned: !u.banned }) })
    toast(u.banned ? 'User reinstated' : 'User suspended', u.banned ? 'success' : 'info'); setBanUpdating(false); onUpdate()
  }

  const saveBalance = async () => {
    setSavingBal(true)
    await fetch(`/api/admin/balances/${u.id}`, { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify(bal) })
    toast('Leave balance updated', 'success'); setSavingBal(false); setEditBal(false); onUpdate()
  }

  const roleMeta = ROLE_META[u.role] || ROLE_META.employee
  const RoleIcon = roleMeta.icon
  const initials = u.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
  const emp = u.employee

  return (
    <div className={`bg-white rounded-2xl border overflow-hidden transition-all ${u.banned ? 'opacity-60 border-surface-border' : 'border-surface-border hover:shadow-md'}`}>
      <div className={`h-1 bg-gradient-to-r ${roleMeta.gradient}`} />
      <div className="p-5">
        <div className="flex items-start gap-4">
          {/* Avatar */}
          <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${avatarGradient(u.name)} flex items-center justify-center flex-shrink-0`}>
            {emp?.photo
              ? <img src={emp.photo} alt={u.name} className="w-12 h-12 rounded-2xl object-cover" />
              : <span className="text-white font-bold text-sm">{initials}</span>
            }
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <p className="font-bold text-sm text-gray-900">{u.name}</p>
              <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${roleMeta.badge}`}>
                <RoleIcon className="w-2.5 h-2.5" /> {u.role}
              </span>
              {emp?.employeeId && <span className="text-[10px] font-mono text-surface-muted">{emp.employeeId}</span>}
              {u.banned && <Badge variant="destructive" className="text-[10px]">Suspended</Badge>}
              {emp && !emp.onboardingComplete && (
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-yellow-50 text-yellow-700 border border-yellow-200">Onboarding pending</span>
              )}
            </div>
            <p className="text-xs text-surface-muted">{u.email}</p>
            {emp && (
              <div className="flex items-center gap-3 mt-1 flex-wrap">
                {emp.department && (
                  <span className="flex items-center gap-1 text-[10px] text-surface-muted">
                    <Building2 className="w-3 h-3" />{emp.department}
                  </span>
                )}
                {emp.designation && (
                  <span className="flex items-center gap-1 text-[10px] text-surface-muted">
                    <Star className="w-3 h-3" />{emp.designation}
                  </span>
                )}
                {emp.joiningDate && (
                  <span className="flex items-center gap-1 text-[10px] text-surface-muted">
                    <CalendarDays className="w-3 h-3" />
                    Joined {new Date(emp.joiningDate).toLocaleDateString('en-IN', { month:'short', year:'numeric' })}
                  </span>
                )}
              </div>
            )}
            {emp?.lastLoginAt && (
              <p className="text-[10px] text-surface-muted mt-0.5">
                Last login: {new Date(emp.lastLoginAt).toLocaleString('en-IN', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' })}
              </p>
            )}

            {/* Role selector — boss only */}
            {isBoss && (
              <div className="flex gap-1.5 mt-3 flex-wrap">
                {ROLES.map(r => {
                  const m = ROLE_META[r]; const Ico = m.icon
                  return (
                    <button type="button" key={r} onClick={() => changeRole(r)}
                      className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold transition-all
                        ${u.role === r ? m.badge : 'bg-surface text-surface-muted hover:bg-surface-border'}`}>
                      {u.role === r && !roleUpdating && <Check className="w-2.5 h-2.5" />}
                      {roleUpdating && u.role === r && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
                      <Ico className="w-2.5 h-2.5" /> {r}
                    </button>
                  )
                })}
              </div>
            )}

            {/* Reporting manager — boss only, employees + managers */}
            {isBoss && u.role !== 'boss' && (
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold uppercase tracking-widest text-surface-muted">Reports to</span>
                <select aria-label="Reporting manager" value={u.employee?.reportingManagerId || ''}
                  onChange={e => setReportingManager(e.target.value || null)}
                  disabled={savingMgr}
                  className="h-7 px-2 rounded-lg border border-surface-border text-[11px] font-semibold focus:outline-none focus:border-brand-500 max-w-[200px]">
                  <option value="">— Unassigned —</option>
                  {managers.map(m => (
                    <option key={m.id} value={m.id}>{m.name} ({m.role})</option>
                  ))}
                </select>
                {savingMgr && <Loader2 className="w-3 h-3 animate-spin text-brand-500" />}
                {currentMgr && (
                  <span className="text-[10px] text-surface-muted">→ approvals routed to {currentMgr.name.split(' ')[0]}</span>
                )}
              </div>
            )}

            {/* Leave balances */}
            <div className="mt-3 pt-3 border-t border-surface-border">
              {!editBal ? (
                <div className="flex items-center gap-4 flex-wrap">
                  {[['Casual', bal.casual, 'text-blue-600'], ['Sick', bal.sick, 'text-red-600'], ['Earned', bal.earned, 'text-green-600'], ['Priv', bal.privilege, 'text-purple-600'], ['Restr', bal.restricted, 'text-orange-600']].map(([k, v, c]) => (
                    <div key={String(k)} className="text-center">
                      <p className={`text-base font-extrabold tabular-nums ${c}`}>{v}</p>
                      <p className="text-[9px] text-surface-muted">{k}</p>
                    </div>
                  ))}
                  {isBoss && (
                    <button type="button" onClick={() => setEditBal(true)} className="text-[10px] font-semibold text-brand-500 hover:underline ml-2">Edit</button>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  {(['casual','sick','earned','privilege','restricted'] as const).map(k => (
                    <div key={k} className="space-y-0.5">
                      <label className="text-[9px] font-bold uppercase tracking-wide text-surface-muted">{k.slice(0,4)}</label>
                      <input type="number" min="0" max="365" value={bal[k] ?? 0}
                        onChange={e => setBal(b => ({ ...b, [k]: Number(e.target.value) }))}
                        aria-label={`${k} leave balance`}
                        className="w-12 h-7 px-2 rounded-lg border border-surface-border text-xs focus:outline-none focus:border-brand-500" />
                    </div>
                  ))}
                  <Button type="button" size="sm" className="h-7 gap-1 mt-4" onClick={saveBalance} disabled={savingBal}>
                    {savingBal ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                  </Button>
                  <button type="button" onClick={() => setEditBal(false)} className="text-[10px] text-surface-muted hover:text-red-500 mt-4">Cancel</button>
                </div>
              )}
            </div>

            {/* Privilege summary */}
            {emp?.privileges && (
              <div className="mt-2">
                <div className="flex flex-wrap gap-1.5 items-center justify-between">
                  <div className="flex flex-wrap gap-1.5">
                    {[
                      { k: 'Food',   v: emp.privileges.food?.tier   || 'none', sub: emp.privileges.food?.dailyLimit   ? `₹${emp.privileges.food.dailyLimit}/day` : '' },
                      { k: 'Taxi',   v: emp.privileges.taxi?.tier   || 'none', sub: emp.privileges.taxi?.perKmLimit   ? `₹${emp.privileges.taxi.perKmLimit}/km`  : '' },
                      { k: 'Flight', v: emp.privileges.flight?.tier || 'none', sub: '' },
                      { k: 'Hotel',  v: emp.privileges.hotel?.tier  || 'none', sub: emp.privileges.hotel?.perNightLimit ? `₹${emp.privileges.hotel.perNightLimit}/night` : '' },
                    ].filter(p => p.v !== 'none').map(p => (
                      <span key={p.k} className="text-[9px] px-2 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-700 font-semibold">
                        {p.k}: {PRIVILEGE_TIERS[p.v] || p.v}{p.sub ? ` · ${p.sub}` : ''}
                      </span>
                    ))}
                  </div>
                  {isBoss && (
                    <button type="button" onClick={() => setShowPrivEdit(v => !v)}
                      className={`text-[10px] font-semibold ${showPrivEdit ? 'text-red-600' : 'text-brand-600 hover:underline'}`}>
                      {showPrivEdit ? 'Cancel edit' : 'Edit privileges'}
                    </button>
                  )}
                </div>
                {showPrivEdit && (
                  <div className="mt-3 p-4 rounded-2xl border border-surface-border bg-surface/70 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label htmlFor={`food-tier-${u.id}`}>Food tier</Label>
                        <select id={`food-tier-${u.id}`} value={privs.food.tier} onChange={e => setPrivs(p => ({ ...p, food: { ...p.food, tier: e.target.value } }))}
                          className="w-full h-10 px-3 rounded-lg border border-surface-border text-sm focus:outline-none focus:border-brand-500">
                          <option value="none">None</option>
                          <option value="basic">Basic</option>
                          <option value="standard">Standard</option>
                          <option value="premium">Premium</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label>Food limit</Label>
                        <Input type="number" min={0} value={privs.food.dailyLimit}
                          onChange={e => setPrivs(p => ({ ...p, food: { ...p.food, dailyLimit: Number(e.target.value) } }))}
                          className="h-10" />
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`taxi-tier-${u.id}`}>Taxi tier</Label>
                        <select id={`taxi-tier-${u.id}`} value={privs.taxi.tier} onChange={e => setPrivs(p => ({ ...p, taxi: { ...p.taxi, tier: e.target.value } }))}
                          className="w-full h-10 px-3 rounded-lg border border-surface-border text-sm focus:outline-none focus:border-brand-500">
                          <option value="none">None</option>
                          <option value="standard">Standard</option>
                          <option value="ac">AC</option>
                          <option value="ac_premium">AC+</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label>Taxi limit</Label>
                        <Input type="number" min={0} value={privs.taxi.perKmLimit}
                          onChange={e => setPrivs(p => ({ ...p, taxi: { ...p.taxi, perKmLimit: Number(e.target.value) } }))}
                          className="h-10" />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label>Flight allowed</Label>
                        <div className="flex items-center gap-2">
                          <input id={`flight-enabled-${u.id}`} type="checkbox" checked={privs.flight.enabled}
                            onChange={e => setPrivs(p => ({ ...p, flight: { ...p.flight, enabled: e.target.checked } }))}
                            className="h-4 w-4 accent-brand-500" />
                          <label htmlFor={`flight-enabled-${u.id}`} className="text-sm text-slate-700">Enable flight</label>
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`flight-tier-${u.id}`}>Flight tier</Label>
                        <select id={`flight-tier-${u.id}`} value={privs.flight.tier} onChange={e => setPrivs(p => ({ ...p, flight: { ...p.flight, tier: e.target.value } }))}
                          disabled={!privs.flight.enabled}
                          className="w-full h-10 px-3 rounded-lg border border-surface-border text-sm focus:outline-none focus:border-brand-500 disabled:cursor-not-allowed disabled:bg-surface/60">
                          <option value="none">None</option>
                          <option value="economy">Economy</option>
                          <option value="business">Business</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label htmlFor={`hotel-tier-${u.id}`}>Hotel tier</Label>
                        <select id={`hotel-tier-${u.id}`} value={privs.hotel.tier} onChange={e => setPrivs(p => ({ ...p, hotel: { ...p.hotel, tier: e.target.value } }))}
                          className="w-full h-10 px-3 rounded-lg border border-surface-border text-sm focus:outline-none focus:border-brand-500">
                          <option value="none">None</option>
                          <option value="budget">Budget</option>
                          <option value="standard">Standard</option>
                          <option value="premium">Premium</option>
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label>Hotel limit</Label>
                        <Input type="number" min={0} value={privs.hotel.perNightLimit}
                          onChange={e => setPrivs(p => ({ ...p, hotel: { ...p.hotel, perNightLimit: Number(e.target.value) } }))}
                          className="h-10" />
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      <Button type="button" size="sm" className="gap-2" onClick={savePrivileges} disabled={savingPrivs}>
                        {savingPrivs ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                        Save privileges
                      </Button>
                      <button type="button" className="text-xs text-surface-muted hover:text-red-600"
                        onClick={() => { setShowPrivEdit(false); setPrivs(u.employee?.privileges || DEFAULT_PRIVILEGES) }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2 flex-shrink-0">
            {isBoss && (
              <Button type="button" size="sm" variant="outline" title="Manage permissions"
                className={showPerms ? 'bg-purple-50 border-purple-300 text-purple-600' : 'text-purple-600 border-purple-200 hover:bg-purple-50'}
                onClick={() => setShowPerms(p => !p)}>
                <Lock className="w-3.5 h-3.5" />
              </Button>
            )}
            <Button type="button" size="sm" variant="outline"
              className={u.banned ? 'text-green-600 border-green-200 hover:bg-green-50' : 'text-red-600 border-red-200 hover:bg-red-50'}
              onClick={toggleBan} disabled={banUpdating}>
              {banUpdating ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                : u.banned ? <UserCheck className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />}
            </Button>
          </div>
        </div>

        {/* Permissions panel */}
        {showPerms && (
          <div className="mt-4 pt-4 border-t border-surface-border space-y-3">
            <p className="text-[10px] font-bold uppercase tracking-widest text-surface-muted flex items-center gap-1.5">
              <Lock className="w-3 h-3" /> Extra Permissions
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ALL_PERMISSIONS.map(p => (
                <label key={p.key} className="flex items-start gap-2.5 cursor-pointer p-2.5 rounded-xl hover:bg-surface transition-colors border border-transparent hover:border-surface-border">
                  <input type="checkbox" className="mt-0.5 accent-brand-500"
                    checked={perms.includes(p.key)} onChange={() => togglePerm(p.key)} />
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
      </div>
    </div>
  )
}

/* ─── Page ────────────────────────────────────────────────────────────────── */
export default function AdminUsersPage() {
  const { user } = useUser()
  const role = (user?.unsafeMetadata?.role as string) || 'employee'
  const isBoss = role === 'boss'

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
  useAutoRefresh(fetchUsers, { intervalMs: 30_000 })

  const filtered = search.trim()
    ? users.filter(u => u.name.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase()))
    : users

  return (
    <>
      <Header title="Team Members" />
      <main className="flex-1 p-5 space-y-5 max-w-3xl w-full mx-auto">

        <div className="flex items-center gap-3 flex-wrap justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center flex-shrink-0">
              <Shield className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900">{users.length} Team Member{users.length !== 1 ? 's' : ''}</p>
              <p className="text-xs text-surface-muted">Manage roles, balances, and privileges.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {process.env.NODE_ENV !== 'production' && (
              <Button type="button" variant="outline" size="sm" className="gap-1.5 text-orange-600 border-orange-200 hover:bg-orange-50"
                onClick={runSeed} disabled={seeding}>
                {seeding ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Database className="w-3.5 h-3.5" />}
                Reseed
              </Button>
            )}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-muted pointer-events-none" />
              <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search…"
                className="pl-9 h-9 pr-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500 min-w-[200px]" />
            </div>
            <CreateUserDialog canCreateManager={isBoss} onCreated={fetchUsers} />
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">{[...Array(5)].map((_,i) => <div key={i} className="h-32 rounded-2xl bg-surface-border animate-pulse" />)}</div>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-surface-muted py-8 text-center">No users match &quot;{search}&quot;</p>
        ) : (
          <div className="space-y-3">
            {filtered.map(u => <UserCard key={u.id} u={u} allUsers={users} onUpdate={fetchUsers} isBoss={isBoss} />)}
          </div>
        )}
      </main>
    </>
  )
}
