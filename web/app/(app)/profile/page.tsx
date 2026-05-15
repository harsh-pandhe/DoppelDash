'use client'
import { useState, useEffect, useCallback } from 'react'
import {
  User, Building2, CreditCard, Heart, Phone, MapPin,
  Mail, Briefcase, Upload, Loader2, Save, Edit3, X, Shield,
} from 'lucide-react'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useToast } from '@/components/ui/toast'
import { useUser } from '@/lib/useUser'

interface Employee {
  _id: string
  employeeId: string
  firstName: string
  lastName: string
  email: string
  phone?: string
  photo?: string
  gender?: string
  dateOfBirth?: string
  workAnniversary?: string
  personalAnniversary?: string
  department: string
  designation: string
  employeeType: string
  joiningDate: string
  reportingManagerId?: string
  address?: string
  city?: string
  state?: string
  bankDetails?: {
    bankName: string
    accountNumber: string
    ifscCode: string
    accountHolderName: string
    accountType: 'savings' | 'current'
  }
  medicalDetails?: {
    bloodGroup?: string
    allergies?: string[]
    medications?: string[]
    conditions?: string[]
    insuranceProvider?: string
    insurancePolicyNumber?: string
  }
  emergencyContacts: { _id?: string; name: string; phone: string; relationship: string }[]
  reportingManager?: { id: string; name: string; designation: string; email: string } | null
  privileges?: {
    food:   { tier: string; dailyLimit: number }
    taxi:   { tier: string; perKmLimit: number }
    flight: { tier: string; enabled: boolean }
    hotel:  { tier: string; perNightLimit: number }
    travelAdvance: number
  }
}

type Section = 'personal' | 'bank' | 'medical' | 'emergency'

function fmtDate(d?: string) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
}

export default function ProfilePage() {
  const toast = useToast()
  const { user } = useUser()
  const [emp, setEmp]       = useState<Employee | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Section | null>(null)
  const [saving,  setSaving]  = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/employees/me')
      const data = await res.json()
      setEmp(data || null)
    } catch { setEmp(null) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const patch = async (payload: Record<string, unknown>) => {
    setSaving(true)
    try {
      const res = await fetch('/api/employees/me', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) { toast('Save failed', 'error'); return false }
      const updated = await res.json()
      setEmp(updated)
      toast('Profile updated', 'success')
      setEditing(null)
      return true
    } catch { toast('Network error', 'error'); return false }
    finally { setSaving(false) }
  }

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const fd = new FormData(); fd.append('file', file)
    setSaving(true)
    try {
      const up = await fetch('/api/upload', { method: 'POST', body: fd })
      const d  = await up.json()
      if (!d.url) { toast('Photo upload failed', 'error'); return }
      await patch({ photo: d.url })
    } finally { setSaving(false); e.target.value = '' }
  }

  if (loading) return (
    <>
      <Header title="My Profile" />
      <main className="flex-1 p-5 lg:p-8 xl:px-12 max-w-5xl w-full mx-auto space-y-5 bg-surface-2">
        {[...Array(4)].map((_, i) => <div key={i} className="h-40 rounded-2xl bg-surface-border animate-pulse" />)}
      </main>
    </>
  )

  if (!emp) return (
    <>
      <Header title="My Profile" />
      <main className="flex-1 p-5 lg:p-8 xl:px-12 max-w-5xl w-full mx-auto space-y-5 bg-surface-2">
        <div className="text-center py-20 bg-white rounded-2xl border border-surface-border">
          <User className="w-12 h-12 text-brand-200 mx-auto mb-3" />
          <p className="font-semibold text-gray-900">No employee record yet</p>
          <p className="text-sm text-surface-muted mt-1">Your manager will set up your profile shortly.</p>
        </div>
      </main>
    </>
  )

  const fullName = `${emp.firstName} ${emp.lastName}`.trim()
  const initials = `${emp.firstName[0] || ''}${emp.lastName[0] || ''}`.toUpperCase()
  const role = user?.role || 'employee'

  return (
    <>
      <Header title="My Profile" />
      <main className="flex-1 p-5 lg:p-8 xl:px-12 max-w-5xl w-full mx-auto space-y-5 bg-surface-2">

        {/* Profile hero */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#003B73] via-[#0057A8] to-[#1d6dc2] p-6 text-white">
          <div className="absolute -top-12 -right-12 w-48 h-48 rounded-full bg-white/10 pointer-events-none" />
          <div className="absolute -bottom-10 -left-6 w-32 h-32 rounded-full bg-white/5 pointer-events-none" />
          <div className="relative z-10 flex items-start gap-5 flex-wrap">
            <div className="relative">
              {emp.photo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={emp.photo} alt={fullName} className="w-24 h-24 rounded-2xl object-cover border-4 border-white/30 shadow-lg" />
              ) : (
                <div className="w-24 h-24 rounded-2xl bg-white/15 flex items-center justify-center border-4 border-white/30 shadow-lg">
                  <span className="text-3xl font-extrabold">{initials}</span>
                </div>
              )}
              <label htmlFor="photo-upload" className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-white text-[#0057A8] flex items-center justify-center cursor-pointer shadow-md hover:scale-110 transition-transform">
                <Upload className="w-4 h-4" />
              </label>
              <input id="photo-upload" type="file" accept="image/*" aria-label="Upload profile photo" title="Upload profile photo" className="hidden" onChange={handlePhotoUpload} disabled={saving} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/70 mb-1">{emp.employeeId}</p>
              <h2 className="text-2xl font-extrabold tracking-tight">{fullName}</h2>
              <p className="text-white/85 text-sm mt-0.5">{emp.designation}</p>
              <p className="text-white/75 text-xs mt-1 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5" /> {emp.department}
                <span className="mx-1.5">·</span>
                <span className="capitalize">{emp.employeeType.replace('_', ' ')}</span>
              </p>
              <p className="text-white/75 text-xs mt-1 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5" /> {emp.email}
              </p>
            </div>
          </div>
        </div>

        {/* Work info (read-only) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <Briefcase className="w-4 h-4 text-brand-500" /> Work info
              <span className="text-[10px] font-normal text-surface-muted ml-2">Set by boss / manager · contact admin to change</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <InfoRow label="Employee ID"  value={emp.employeeId} />
              <InfoRow label="Department"   value={emp.department} />
              <InfoRow label="Designation"  value={emp.designation} />
              <InfoRow label="Type"         value={emp.employeeType.replace('_', ' ')} className="capitalize" />
              <InfoRow label="Joining date" value={fmtDate(emp.joiningDate)} />
              <InfoRow label="Role"         value={role} className="capitalize" />
              {emp.reportingManager ? (
                <div className="p-3 rounded-xl bg-surface border border-surface-border col-span-2 sm:col-span-3">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-surface-muted mb-1 flex items-center gap-1.5">
                    <Briefcase className="w-3 h-3" /> Reports to
                  </p>
                  <p className="text-sm font-semibold text-gray-900">{emp.reportingManager.name}</p>
                  <p className="text-xs text-surface-muted">{emp.reportingManager.designation} · <a href={`mailto:${emp.reportingManager.email}`} className="text-brand-600 hover:underline">{emp.reportingManager.email}</a></p>
                </div>
              ) : (
                <InfoRow label="Reports to" value="Not assigned" />
              )}
            </div>
          </CardContent>
        </Card>

        {/* Personal info */}
        <SectionCard
          title="Personal info" icon={User}
          editing={editing === 'personal'}
          onEdit={() => setEditing('personal')}
          onCancel={() => setEditing(null)}>
          {editing === 'personal' ? (
            <PersonalForm emp={emp} onSave={patch} saving={saving} />
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <InfoRow label="Phone"        value={emp.phone || '—'} />
              <InfoRow label="Date of birth" value={fmtDate(emp.dateOfBirth)} />
              <InfoRow label="Gender"       value={emp.gender || '—'} className="capitalize" />
              <InfoRow label="Anniversary"  value={fmtDate(emp.personalAnniversary)} />
              <InfoRow label="City"         value={emp.city || '—'} />
              <InfoRow label="State"        value={emp.state || '—'} />
              <div className="col-span-2 sm:col-span-3">
                <InfoRow label="Address" value={emp.address || '—'} icon={MapPin} />
              </div>
            </div>
          )}
        </SectionCard>

        {/* Bank details */}
        <SectionCard
          title="Bank details" icon={CreditCard}
          subtitle="Used for expense reimbursements only · encrypted at rest"
          editing={editing === 'bank'}
          onEdit={() => setEditing('bank')}
          onCancel={() => setEditing(null)}>
          {editing === 'bank' ? (
            <BankForm emp={emp} onSave={patch} saving={saving} />
          ) : emp.bankDetails?.bankName ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <InfoRow label="Bank"          value={emp.bankDetails.bankName} />
              <InfoRow label="Account holder" value={emp.bankDetails.accountHolderName} />
              <InfoRow label="Account no."   value={`••••${(emp.bankDetails.accountNumber || '').slice(-4)}`} />
              <InfoRow label="IFSC"          value={emp.bankDetails.ifscCode} />
              <InfoRow label="Type"          value={emp.bankDetails.accountType} className="capitalize" />
            </div>
          ) : (
            <EmptyState message="No bank details on file yet." />
          )}
        </SectionCard>

        {/* Medical details */}
        <SectionCard
          title="Medical details" icon={Heart}
          subtitle="Only visible to you and HR · used in emergencies"
          editing={editing === 'medical'}
          onEdit={() => setEditing('medical')}
          onCancel={() => setEditing(null)}>
          {editing === 'medical' ? (
            <MedicalForm emp={emp} onSave={patch} saving={saving} />
          ) : emp.medicalDetails && Object.keys(emp.medicalDetails).length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <InfoRow label="Blood group"        value={emp.medicalDetails.bloodGroup || '—'} />
              <InfoRow label="Insurance provider" value={emp.medicalDetails.insuranceProvider || '—'} />
              <InfoRow label="Policy number"      value={emp.medicalDetails.insurancePolicyNumber || '—'} />
              <div className="sm:col-span-2"><InfoRow label="Allergies"   value={(emp.medicalDetails.allergies   || []).join(', ') || '—'} /></div>
              <div className="sm:col-span-2"><InfoRow label="Medications" value={(emp.medicalDetails.medications || []).join(', ') || '—'} /></div>
              <div className="sm:col-span-2"><InfoRow label="Conditions"  value={(emp.medicalDetails.conditions  || []).join(', ') || '—'} /></div>
            </div>
          ) : (
            <EmptyState message="No medical details on file yet." />
          )}
        </SectionCard>

        {/* Emergency contacts */}
        <SectionCard
          title="Emergency contacts" icon={Phone}
          subtitle="Reached only in critical situations"
          editing={editing === 'emergency'}
          onEdit={() => setEditing('emergency')}
          onCancel={() => setEditing(null)}>
          {editing === 'emergency' ? (
            <EmergencyForm emp={emp} onSave={patch} saving={saving} />
          ) : emp.emergencyContacts.length > 0 ? (
            <div className="space-y-2">
              {emp.emergencyContacts.map((c, i) => (
                <div key={c._id || i} className="flex items-center gap-3 p-3 rounded-xl bg-surface border border-surface-border">
                  <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0">
                    <Phone className="w-4 h-4 text-brand-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-gray-900 truncate">{c.name}</p>
                    <p className="text-xs text-surface-muted capitalize">{c.relationship}</p>
                  </div>
                  <a href={`tel:${c.phone.replace(/\s+/g, '')}`} className="text-sm font-semibold text-brand-700 hover:underline">{c.phone}</a>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message="No emergency contacts on file yet." />
          )}
        </SectionCard>

        {/* Privileges (read-only) */}
        {emp.privileges && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
                <Shield className="w-4 h-4 text-brand-500" /> Travel & expense privileges
                <span className="text-[10px] font-normal text-surface-muted ml-2">Managed by boss</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
                <PrivTile label="Food"   value={emp.privileges.food.tier   === 'none' ? 'Not eligible' : `${emp.privileges.food.tier} · ₹${emp.privileges.food.dailyLimit}/day`}   on={emp.privileges.food.tier   !== 'none'} />
                <PrivTile label="Taxi"   value={emp.privileges.taxi.tier   === 'none' ? 'Not eligible' : `${emp.privileges.taxi.tier} · ₹${emp.privileges.taxi.perKmLimit}/km`}   on={emp.privileges.taxi.tier   !== 'none'} />
                <PrivTile label="Flight" value={emp.privileges.flight.enabled ? `${emp.privileges.flight.tier}` : 'Not eligible'}                                                  on={emp.privileges.flight.enabled} />
                <PrivTile label="Hotel"  value={emp.privileges.hotel.tier  === 'none' ? 'Not eligible' : `${emp.privileges.hotel.tier} · ₹${emp.privileges.hotel.perNightLimit}/night`} on={emp.privileges.hotel.tier !== 'none'} />
                <PrivTile label="Advance" value={emp.privileges.travelAdvance > 0 ? `Up to ₹${emp.privileges.travelAdvance.toLocaleString('en-IN')}` : 'Not eligible'} on={emp.privileges.travelAdvance > 0} />
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </>
  )
}

/* ─── Primitives ───────────────────────────────────────────────────────── */

function InfoRow({ label, value, icon: Icon, className }: { label: string; value: string; icon?: React.ElementType; className?: string }) {
  return (
    <div className="p-3 rounded-xl bg-surface border border-surface-border">
      <p className="text-[10px] font-bold uppercase tracking-widest text-surface-muted mb-1 flex items-center gap-1.5">
        {Icon && <Icon className="w-3 h-3" />}{label}
      </p>
      <p className={`text-sm font-semibold text-gray-900 ${className || ''}`}>{value}</p>
    </div>
  )
}

function EmptyState({ message }: { message: string }) {
  return (
    <p className="text-sm text-surface-muted py-4 text-center">{message}</p>
  )
}

function PrivTile({ label, value, on }: { label: string; value: string; on: boolean }) {
  return (
    <div className={`p-3 rounded-xl border ${on ? 'bg-brand-50/50 border-brand-200' : 'bg-surface border-surface-border opacity-70'}`}>
      <p className="text-[10px] font-bold uppercase tracking-widest text-surface-muted">{label}</p>
      <p className={`text-xs font-bold mt-1 capitalize ${on ? 'text-brand-700' : 'text-gray-500'}`}>{value}</p>
    </div>
  )
}

function SectionCard({ title, icon: Icon, subtitle, editing, onEdit, onCancel, children }: {
  title: string
  icon: React.ElementType
  subtitle?: string
  editing: boolean
  onEdit: () => void
  onCancel: () => void
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <CardTitle className="text-sm font-bold text-gray-700 flex items-center gap-2">
              <Icon className="w-4 h-4 text-brand-500" /> {title}
            </CardTitle>
            {subtitle && <p className="text-xs text-surface-muted mt-1">{subtitle}</p>}
          </div>
          {!editing ? (
            <Button type="button" variant="outline" size="sm" className="gap-1.5 flex-shrink-0" onClick={onEdit}>
              <Edit3 className="w-3.5 h-3.5" /> Edit
            </Button>
          ) : (
            <Button type="button" variant="outline" size="sm" className="gap-1.5 flex-shrink-0" onClick={onCancel}>
              <X className="w-3.5 h-3.5" /> Cancel
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  )
}

/* ─── Forms ────────────────────────────────────────────────────────────── */

function PersonalForm({ emp, onSave, saving }: { emp: Employee; onSave: (p: Record<string, unknown>) => Promise<boolean>; saving: boolean }) {
  const [phone,    setPhone]    = useState(emp.phone || '')
  const [dob,      setDob]      = useState(emp.dateOfBirth ? emp.dateOfBirth.split('T')[0] : '')
  const [gender,   setGender]   = useState(emp.gender || '')
  const [annv,     setAnnv]     = useState(emp.personalAnniversary ? emp.personalAnniversary.split('T')[0] : '')
  const [address,  setAddress]  = useState(emp.address || '')
  const [city,     setCity]     = useState(emp.city || '')
  const [stateV,   setStateV]   = useState(emp.state || '')

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Phone">
          <Input value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 98765 43210" />
        </Field>
        <Field label="Gender">
          <select aria-label="Gender" value={gender} onChange={e => setGender(e.target.value)}
            className="w-full h-10 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500">
            <option value="">Prefer not to say</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
            <option value="non_binary">Non-binary</option>
            <option value="other">Other</option>
          </select>
        </Field>
        <Field label="Date of birth">
          <input type="date" aria-label="Date of birth" value={dob} onChange={e => setDob(e.target.value)}
            className="w-full h-10 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500" />
        </Field>
        <Field label="Personal anniversary">
          <input type="date" aria-label="Personal anniversary" value={annv} onChange={e => setAnnv(e.target.value)}
            className="w-full h-10 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500" />
        </Field>
      </div>
      <Field label="Address">
        <Input value={address} onChange={e => setAddress(e.target.value)} placeholder="House / street / area" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="City"><Input value={city} onChange={e => setCity(e.target.value)} /></Field>
        <Field label="State"><Input value={stateV} onChange={e => setStateV(e.target.value)} /></Field>
      </div>
      <Button className="gap-2" disabled={saving}
        onClick={() => onSave({
          phone, gender,
          dateOfBirth: dob   || undefined,
          personalAnniversary: annv || undefined,
          address, city, state: stateV,
        })}>
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
      </Button>
    </div>
  )
}

function BankForm({ emp, onSave, saving }: { emp: Employee; onSave: (p: Record<string, unknown>) => Promise<boolean>; saving: boolean }) {
  const [b, setB] = useState({
    bankName:          emp.bankDetails?.bankName || '',
    accountHolderName: emp.bankDetails?.accountHolderName || '',
    accountNumber:     emp.bankDetails?.accountNumber || '',
    ifscCode:          emp.bankDetails?.ifscCode || '',
    accountType:       emp.bankDetails?.accountType || 'savings',
  })
  return (
    <div className="space-y-3">
      <Field label="Bank name"><Input value={b.bankName} onChange={e => setB(s => ({ ...s, bankName: e.target.value }))} placeholder="State Bank of India" /></Field>
      <Field label="Account holder name"><Input value={b.accountHolderName} onChange={e => setB(s => ({ ...s, accountHolderName: e.target.value }))} placeholder="As on passbook" /></Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Account number"><Input value={b.accountNumber} onChange={e => setB(s => ({ ...s, accountNumber: e.target.value }))} /></Field>
        <Field label="IFSC code"><Input value={b.ifscCode} onChange={e => setB(s => ({ ...s, ifscCode: e.target.value.toUpperCase() }))} placeholder="SBIN0001234" /></Field>
      </div>
      <Field label="Account type">
        <select aria-label="Account type" value={b.accountType} onChange={e => setB(s => ({ ...s, accountType: e.target.value as 'savings' | 'current' }))}
          className="w-full h-10 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500">
          <option value="savings">Savings</option>
          <option value="current">Current</option>
        </select>
      </Field>
      <Button className="gap-2" disabled={saving} onClick={() => onSave({ bankDetails: b })}>
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
      </Button>
    </div>
  )
}

function MedicalForm({ emp, onSave, saving }: { emp: Employee; onSave: (p: Record<string, unknown>) => Promise<boolean>; saving: boolean }) {
  const [m, setM] = useState({
    bloodGroup:          emp.medicalDetails?.bloodGroup || '',
    allergies:           (emp.medicalDetails?.allergies   || []).join(', '),
    medications:         (emp.medicalDetails?.medications || []).join(', '),
    conditions:          (emp.medicalDetails?.conditions  || []).join(', '),
    insuranceProvider:   emp.medicalDetails?.insuranceProvider || '',
    insurancePolicyNumber: emp.medicalDetails?.insurancePolicyNumber || '',
  })
  return (
    <div className="space-y-3">
      <Field label="Blood group">
        <select aria-label="Blood group" value={m.bloodGroup} onChange={e => setM(s => ({ ...s, bloodGroup: e.target.value }))}
          className="w-full h-10 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500">
          <option value="">Select</option>
          {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(g => <option key={g} value={g}>{g}</option>)}
        </select>
      </Field>
      <Field label="Allergies" hint="Comma-separated">
        <Input value={m.allergies} onChange={e => setM(s => ({ ...s, allergies: e.target.value }))} placeholder="Penicillin, Peanuts" />
      </Field>
      <Field label="Current medications" hint="Comma-separated">
        <Input value={m.medications} onChange={e => setM(s => ({ ...s, medications: e.target.value }))} placeholder="Metformin 500mg" />
      </Field>
      <Field label="Conditions" hint="Comma-separated">
        <Input value={m.conditions} onChange={e => setM(s => ({ ...s, conditions: e.target.value }))} placeholder="Diabetes, Hypertension" />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Insurance provider"><Input value={m.insuranceProvider} onChange={e => setM(s => ({ ...s, insuranceProvider: e.target.value }))} /></Field>
        <Field label="Policy number"><Input value={m.insurancePolicyNumber} onChange={e => setM(s => ({ ...s, insurancePolicyNumber: e.target.value }))} /></Field>
      </div>
      <Button className="gap-2" disabled={saving}
        onClick={() => onSave({
          medicalDetails: {
            bloodGroup:          m.bloodGroup || undefined,
            allergies:           m.allergies  ? m.allergies.split(',').map(s => s.trim()).filter(Boolean)  : [],
            medications:         m.medications? m.medications.split(',').map(s => s.trim()).filter(Boolean): [],
            conditions:          m.conditions ? m.conditions.split(',').map(s => s.trim()).filter(Boolean) : [],
            insuranceProvider:   m.insuranceProvider     || undefined,
            insurancePolicyNumber: m.insurancePolicyNumber || undefined,
          },
        })}>
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
      </Button>
    </div>
  )
}

function EmergencyForm({ emp, onSave, saving }: { emp: Employee; onSave: (p: Record<string, unknown>) => Promise<boolean>; saving: boolean }) {
  const [list, setList] = useState(emp.emergencyContacts.length > 0
    ? emp.emergencyContacts
    : [{ name: '', phone: '', relationship: '' }])

  const update = (i: number, field: keyof typeof list[number], v: string) =>
    setList(l => l.map((x, j) => j === i ? { ...x, [field]: v } : x))

  return (
    <div className="space-y-3">
      {list.map((c, i) => (
        <div key={i} className="p-3 rounded-xl border border-surface-border space-y-3 bg-surface/40">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-bold uppercase tracking-widest text-surface-muted">Contact {i + 1}</p>
            {list.length > 1 && (
              <button type="button" onClick={() => setList(l => l.filter((_, j) => j !== i))}
                className="text-[10px] text-red-500 hover:underline font-semibold">Remove</button>
            )}
          </div>
          <Input placeholder="Full name"            value={c.name}         onChange={e => update(i, 'name', e.target.value)} />
          <Input placeholder="+91 98765 43210"      value={c.phone}        onChange={e => update(i, 'phone', e.target.value)} />
          <Input placeholder="Relationship (Spouse, Parent…)" value={c.relationship} onChange={e => update(i, 'relationship', e.target.value)} />
        </div>
      ))}
      {list.length < 3 && (
        <button type="button" onClick={() => setList(l => [...l, { name: '', phone: '', relationship: '' }])}
          className="w-full py-2.5 rounded-xl border-2 border-dashed border-surface-border text-sm text-surface-muted hover:border-brand-400 hover:text-brand-600 transition-all">
          + Add another contact
        </button>
      )}
      <Button className="gap-2" disabled={saving}
        onClick={() => onSave({ emergencyContacts: list.filter(c => c.name && c.phone) })}>
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save
      </Button>
    </div>
  )
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label} {hint && <span className="text-surface-muted font-normal">({hint})</span>}</Label>
      {children}
    </div>
  )
}
