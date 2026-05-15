'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  User, Building2, CreditCard, Heart, Phone,
  ChevronRight, ChevronLeft, Check, Loader2, Upload,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/toast'

const STEPS = [
  { id: 0, label: 'Personal',   icon: User,       desc: 'Basic info & photo' },
  { id: 1, label: 'Work',       icon: Building2,  desc: 'Department & role' },
  { id: 2, label: 'Bank',       icon: CreditCard, desc: 'Payment details' },
  { id: 3, label: 'Medical',    icon: Heart,      desc: 'Health & insurance' },
  { id: 4, label: 'Emergency',  icon: Phone,      desc: 'Emergency contacts' },
]

type BankDetails = { bankName: string; accountNumber: string; ifscCode: string; accountHolderName: string; accountType: string }
type EmergencyContact = { name: string; phone: string; relationship: string }
type MedicalDetails = { bloodGroup: string; allergies: string; medications: string; conditions: string; insuranceProvider: string; insurancePolicyNumber: string }

export default function OnboardingPage() {
  const router  = useRouter()
  const toast   = useToast()

  const [step,    setStep]    = useState(0)
  const [saving,  setSaving]  = useState(false)
  const [loading, setLoading] = useState(true)

  // Step 0 — personal
  const [photo,       setPhoto]       = useState('')
  const [phone,       setPhone]       = useState('')
  const [dob,         setDob]         = useState('')
  const [gender,      setGender]      = useState('')
  const [address,     setAddress]     = useState('')
  const [city,        setCity]        = useState('')
  const [state,       setState]       = useState('')
  const [personalAnn, setPersonalAnn] = useState('')

  // Step 1 — work (read-only from Employee record, but show it)
  const [empProfile, setEmpProfile] = useState<Record<string, unknown> | null>(null)

  // Step 2 — bank
  const [bank, setBank] = useState<BankDetails>({ bankName:'', accountNumber:'', ifscCode:'', accountHolderName:'', accountType:'savings' })

  // Step 3 — medical
  const [medical, setMedical] = useState<MedicalDetails>({ bloodGroup:'', allergies:'', medications:'', conditions:'', insuranceProvider:'', insurancePolicyNumber:'' })

  // Step 4 — emergency contacts
  const [contacts, setContacts] = useState<EmergencyContact[]>([{ name:'', phone:'', relationship:'' }])

  useEffect(() => {
    fetch('/api/employees/me').then(r => r.json()).then(d => {
      if (d) {
        setEmpProfile(d)
        if (d.onboardingComplete) { router.replace('/dashboard'); return }
        setStep(d.onboardingStep || 0)
        if (d.phone) setPhone(d.phone)
        if (d.dateOfBirth) setDob(d.dateOfBirth.split('T')[0])
        if (d.gender) setGender(d.gender)
        if (d.address) setAddress(d.address)
        if (d.city)    setCity(d.city)
        if (d.state)   setState(d.state)
        if (d.personalAnniversary) setPersonalAnn(d.personalAnniversary.split('T')[0])
        if (d.bankDetails) setBank(d.bankDetails)
        if (d.medicalDetails) setMedical({
          bloodGroup: d.medicalDetails.bloodGroup || '',
          allergies:  (d.medicalDetails.allergies  || []).join(', '),
          medications:(d.medicalDetails.medications || []).join(', '),
          conditions: (d.medicalDetails.conditions  || []).join(', '),
          insuranceProvider:     d.medicalDetails.insuranceProvider     || '',
          insurancePolicyNumber: d.medicalDetails.insurancePolicyNumber || '',
        })
        if (d.emergencyContacts?.length) setContacts(d.emergencyContacts)
      }
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [router])

  const saveStep = async (nextStep: number, payload: Record<string, unknown>) => {
    setSaving(true)
    try {
      const res = await fetch('/api/employees/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, onboardingStep: nextStep }),
      })
      if (!res.ok) { toast('Save failed — try again', 'error'); return false }
      return true
    } catch { toast('Network error', 'error'); return false }
    finally { setSaving(false) }
  }

  const handleNext = async () => {
    let payload: Record<string, unknown> = {}

    if (step === 0) {
      payload = { phone, gender, address, city, state,
        dateOfBirth: dob || undefined,
        personalAnniversary: personalAnn || undefined,
        photo: photo || undefined,
      }
    } else if (step === 1) {
      // Work info read-only — just advance
      payload = {}
    } else if (step === 2) {
      payload = { bankDetails: bank }
    } else if (step === 3) {
      payload = {
        medicalDetails: {
          bloodGroup:          medical.bloodGroup || undefined,
          allergies:           medical.allergies  ? medical.allergies.split(',').map(s => s.trim()).filter(Boolean)  : [],
          medications:         medical.medications? medical.medications.split(',').map(s => s.trim()).filter(Boolean): [],
          conditions:          medical.conditions ? medical.conditions.split(',').map(s => s.trim()).filter(Boolean) : [],
          insuranceProvider:   medical.insuranceProvider     || undefined,
          insurancePolicyNumber: medical.insurancePolicyNumber || undefined,
        }
      }
    } else if (step === 4) {
      const validContacts = contacts.filter(c => c.name && c.phone)
      payload = { emergencyContacts: validContacts, onboardingComplete: true }
    }

    const nextStep = step + 1
    const ok = await saveStep(nextStep, payload)
    if (!ok) return

    if (step === 4) {
      toast('Onboarding complete! Welcome aboard.', 'success')
      router.replace('/dashboard')
    } else {
      setStep(nextStep)
    }
  }

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const fd = new FormData(); fd.append('file', file)
    const res = await fetch('/api/upload', { method: 'POST', body: fd })
    const d   = await res.json()
    if (d.url) { setPhoto(d.url); toast('Photo uploaded', 'success') }
  }

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
    </div>
  )

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 via-white to-purple-50 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center mx-auto mb-4 shadow-lg">
            <span className="text-white font-black text-xl">D</span>
          </div>
          <h1 className="text-2xl font-extrabold text-gray-900">Welcome to DoppelDash</h1>
          <p className="text-sm text-surface-muted mt-1">Complete your profile to get started</p>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-between mb-6 px-2">
          {STEPS.map((s, i) => {
            const Icon = s.icon
            const done    = i < step
            const current = i === step
            return (
              <div key={s.id} className="flex items-center flex-1">
                <div className="flex flex-col items-center">
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center transition-all shadow-sm
                    ${done    ? 'bg-brand-500 text-white' :
                      current ? 'bg-white text-brand-600 ring-2 ring-brand-500 shadow-brand-200' :
                                'bg-white text-surface-muted border border-surface-border'}`}>
                    {done ? <Check className="w-4 h-4" /> : <Icon className="w-4 h-4" />}
                  </div>
                  <p className={`text-[9px] font-bold mt-1 ${current ? 'text-brand-600' : done ? 'text-gray-600' : 'text-surface-muted'}`}>{s.label}</p>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`flex-1 h-0.5 mx-1 rounded ${i < step ? 'bg-brand-400' : 'bg-surface-border'}`} />
                )}
              </div>
            )
          })}
        </div>

        {/* Card */}
        <div className="bg-white rounded-3xl shadow-xl border border-surface-border overflow-hidden">
          <div className="bg-gradient-to-r from-brand-500 to-brand-700 px-6 py-4">
            <p className="text-white font-bold">{STEPS[step].label}</p>
            <p className="text-brand-200 text-xs">{STEPS[step].desc}</p>
          </div>

          <div className="p-6 space-y-4">
            {/* Step 0 — Personal */}
            {step === 0 && (
              <>
                {/* Photo */}
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 rounded-2xl bg-surface border-2 border-dashed border-surface-border flex items-center justify-center overflow-hidden flex-shrink-0">
                    {photo
                      ? <img src={photo} alt="Profile" className="w-16 h-16 object-cover" />
                      : <User className="w-6 h-6 text-surface-muted" />}
                  </div>
                  <div>
                    <label htmlFor="photoUpload" className="cursor-pointer inline-flex items-center gap-2 text-sm font-semibold text-brand-600 hover:text-brand-700">
                      <Upload className="w-4 h-4" /> Upload photo
                    </label>
                    <input id="photoUpload" type="file" accept="image/*" className="hidden" onChange={handlePhotoUpload} />
                    <p className="text-[10px] text-surface-muted mt-0.5">JPG, PNG · max 2MB</p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="ob-phone">Phone Number</Label>
                  <Input id="ob-phone" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+91 98765 43210" />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="ob-dob">Date of Birth</Label>
                    <input id="ob-dob" type="date" aria-label="Date of birth" title="Date of birth" value={dob} onChange={e => setDob(e.target.value)}
                      className="w-full h-10 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ob-gender">Gender</Label>
                    <select id="ob-gender" aria-label="Gender" title="Gender" value={gender} onChange={e => setGender(e.target.value)}
                      className="w-full h-10 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500">
                      <option value="">Select</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="non_binary">Non-binary</option>
                      <option value="prefer_not">Prefer not to say</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="ob-personalAnn">Wedding / Personal Anniversary</Label>
                  <input id="ob-personalAnn" type="date" aria-label="Personal anniversary" title="Personal anniversary" value={personalAnn} onChange={e => setPersonalAnn(e.target.value)}
                    className="w-full h-10 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500" />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="ob-address">Address</Label>
                  <Input id="ob-address" value={address} onChange={e => setAddress(e.target.value)} placeholder="123 MG Road" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="ob-city">City</Label>
                    <Input id="ob-city" value={city} onChange={e => setCity(e.target.value)} placeholder="Mumbai" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ob-state">State</Label>
                    <Input id="ob-state" value={state} onChange={e => setState(e.target.value)} placeholder="Maharashtra" />
                  </div>
                </div>
              </>
            )}

            {/* Step 1 — Work (read-only summary) */}
            {step === 1 && empProfile && (
              <div className="space-y-3">
                <p className="text-xs text-surface-muted">Your employment details as set by your manager. Contact HR to update.</p>
                {([
                  ['Employee ID',  empProfile.employeeId],
                  ['Department',   empProfile.department],
                  ['Designation',  empProfile.designation],
                  ['Type',         empProfile.employeeType],
                  ['Joining Date', empProfile.joiningDate ? new Date(empProfile.joiningDate as string).toLocaleDateString('en-IN', { day:'numeric', month:'long', year:'numeric' }) : '—'],
                ] as [string, unknown][]).map(([k, v]) => (
                  <div key={k} className="flex items-center justify-between px-4 py-3 rounded-xl bg-surface border border-surface-border">
                    <span className="text-xs font-bold text-surface-muted uppercase tracking-wide">{k}</span>
                    <span className="text-sm font-semibold text-gray-900">{String(v ?? '—')}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Step 2 — Bank */}
            {step === 2 && (
              <div className="space-y-3">
                <div className="flex items-start gap-3 p-3 rounded-xl bg-blue-50 border border-blue-200">
                  <CreditCard className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-blue-700">Bank details are used for expense reimbursements only. Stored securely.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ob-bank">Bank Name</Label>
                  <Input id="ob-bank" value={bank.bankName} onChange={e => setBank(b=>({...b,bankName:e.target.value}))} placeholder="State Bank of India" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ob-accHolder">Account Holder Name</Label>
                  <Input id="ob-accHolder" value={bank.accountHolderName} onChange={e => setBank(b=>({...b,accountHolderName:e.target.value}))} placeholder="As on passbook" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ob-accNum">Account Number</Label>
                  <Input id="ob-accNum" value={bank.accountNumber} onChange={e => setBank(b=>({...b,accountNumber:e.target.value}))} placeholder="00000000000000" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="ob-ifsc">IFSC Code</Label>
                    <Input id="ob-ifsc" value={bank.ifscCode} onChange={e => setBank(b=>({...b,ifscCode:e.target.value.toUpperCase()}))} placeholder="SBIN0001234" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ob-accType">Account Type</Label>
                    <select id="ob-accType" aria-label="Account type" title="Account type" value={bank.accountType} onChange={e => setBank(b=>({...b,accountType:e.target.value}))}
                      className="w-full h-10 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500">
                      <option value="savings">Savings</option>
                      <option value="current">Current</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* Step 3 — Medical */}
            {step === 3 && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ob-bg">Blood Group</Label>
                  <select id="ob-bg" aria-label="Blood group" title="Blood group" value={medical.bloodGroup} onChange={e => setMedical(m=>({...m,bloodGroup:e.target.value}))}
                    className="w-full h-10 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500">
                    <option value="">Select</option>
                    {['A+','A-','B+','B-','AB+','AB-','O+','O-'].map(g => <option key={g} value={g}>{g}</option>)}
                  </select>
                </div>
                {[
                  ['ob-allergies',  'Allergies',       'allergies',  'e.g. Penicillin, Peanuts'],
                  ['ob-medications','Current Medications', 'medications', 'e.g. Metformin 500mg'],
                  ['ob-conditions', 'Medical Conditions', 'conditions', 'e.g. Diabetes, Hypertension'],
                ].map(([id, label, field, placeholder]) => (
                  <div key={id} className="space-y-1.5">
                    <Label htmlFor={id}>{label} <span className="text-surface-muted font-normal">(comma-separated)</span></Label>
                    <Input id={id} value={(medical as Record<string,string>)[field]} onChange={e => setMedical(m=>({...m,[field]:e.target.value}))} placeholder={placeholder} />
                  </div>
                ))}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="ob-insurer">Insurance Provider</Label>
                    <Input id="ob-insurer" value={medical.insuranceProvider} onChange={e => setMedical(m=>({...m,insuranceProvider:e.target.value}))} placeholder="Star Health" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ob-policy">Policy Number</Label>
                    <Input id="ob-policy" value={medical.insurancePolicyNumber} onChange={e => setMedical(m=>({...m,insurancePolicyNumber:e.target.value}))} placeholder="POL-123456" />
                  </div>
                </div>
              </div>
            )}

            {/* Step 4 — Emergency Contacts */}
            {step === 4 && (
              <div className="space-y-4">
                {contacts.map((c, i) => (
                  <div key={i} className="p-4 rounded-xl border border-surface-border space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold text-surface-muted uppercase tracking-wide">Contact {i + 1}</p>
                      {i > 0 && (
                        <button type="button" onClick={() => setContacts(prev => prev.filter((_,j) => j !== i))}
                          className="text-[10px] text-red-500 hover:underline">Remove</button>
                      )}
                    </div>
                    <Input placeholder="Full name" value={c.name} onChange={e => setContacts(prev => prev.map((x,j) => j===i ? {...x,name:e.target.value} : x))} aria-label={`Emergency contact ${i+1} name`} />
                    <Input placeholder="+91 98765 43210" value={c.phone} onChange={e => setContacts(prev => prev.map((x,j) => j===i ? {...x,phone:e.target.value} : x))} aria-label={`Emergency contact ${i+1} phone`} />
                    <Input placeholder="Relationship (e.g. Spouse, Parent)" value={c.relationship} onChange={e => setContacts(prev => prev.map((x,j) => j===i ? {...x,relationship:e.target.value} : x))} aria-label={`Emergency contact ${i+1} relationship`} />
                  </div>
                ))}
                {contacts.length < 3 && (
                  <button type="button" onClick={() => setContacts(prev => [...prev, { name:'', phone:'', relationship:'' }])}
                    className="w-full py-2.5 rounded-xl border-2 border-dashed border-surface-border text-sm text-surface-muted hover:border-brand-400 hover:text-brand-600 transition-all">
                    + Add another contact
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Footer nav */}
          <div className="px-6 pb-6 flex gap-3">
            {step > 0 && (
              <Button type="button" variant="outline" className="gap-1.5" onClick={() => setStep(s => s - 1)}>
                <ChevronLeft className="w-4 h-4" /> Back
              </Button>
            )}
            <Button className="flex-1 gap-1.5" onClick={handleNext} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : step === 4 ? <Check className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              {step === 4 ? 'Complete Setup' : 'Continue'}
            </Button>
          </div>
        </div>

        <p className="text-center text-xs text-surface-muted mt-4">
          Step {step + 1} of {STEPS.length} · You can update these later in Settings
        </p>
      </div>
    </div>
  )
}
