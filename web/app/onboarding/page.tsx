'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useUser } from '@clerk/nextjs'
import { User, Briefcase, Crown, ArrowRight, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

const ROLES = [
  { value: 'employee', label: 'Employee',  icon: User,      desc: 'Submit leaves, scan contacts & log expenses', color: 'text-blue-500' },
  { value: 'manager',  label: 'Manager',   icon: Briefcase, desc: 'Approve team requests & manage your reports', color: 'text-purple-500' },
  { value: 'boss',     label: 'Boss',       icon: Crown,     desc: 'Full administrative access & final approvals',  color: 'text-accent-500' },
]

export default function OnboardingPage() {
  const { user } = useUser()
  const router = useRouter()
  const [role, setRole] = useState('employee')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async () => {
    setLoading(true)
    try {
      await user?.update({ unsafeMetadata: { role } })
      router.push('/dashboard')
    } catch {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-10">
          <div className="w-14 h-14 rounded-2xl bg-brand-500 flex items-center justify-center mx-auto mb-4 shadow-lg">
            <span className="text-white font-black text-2xl">D</span>
          </div>
          <h1 className="text-2xl font-extrabold text-gray-900 mb-2">Welcome to DoppelDash!</h1>
          <p className="text-surface-muted text-sm">
            Hi {user?.firstName || 'there'} — one last step. Select your role to get started.
          </p>
        </div>

        {/* Role cards */}
        <div className="space-y-3 mb-8">
          {ROLES.map(({ value, label, icon: Icon, desc, color }) => (
            <button
              key={value}
              onClick={() => setRole(value)}
              className={cn(
                'w-full flex items-center gap-4 p-4 rounded-2xl border-2 text-left transition-all',
                role === value
                  ? 'border-brand-500 bg-brand-50 shadow-sm'
                  : 'border-surface-border bg-white hover:border-brand-300'
              )}
            >
              <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0', role === value ? 'bg-brand-100' : 'bg-surface')}>
                <Icon className={cn('w-5 h-5', role === value ? color : 'text-surface-muted')} />
              </div>
              <div className="flex-1 min-w-0">
                <p className={cn('font-semibold text-sm', role === value ? 'text-brand-700' : 'text-gray-900')}>{label}</p>
                <p className="text-xs text-surface-muted mt-0.5 leading-snug">{desc}</p>
              </div>
              <div className={cn('w-4 h-4 rounded-full border-2 flex-shrink-0 transition-colors', role === value ? 'border-brand-500 bg-brand-500' : 'border-surface-border bg-white')}>
                {role === value && <div className="w-full h-full rounded-full bg-white scale-[0.4]" />}
              </div>
            </button>
          ))}
        </div>

        <Button className="w-full h-11 gap-2" onClick={handleSubmit} disabled={loading}>
          {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Setting up…</> : <>Continue to Dashboard <ArrowRight className="w-4 h-4" /></>}
        </Button>

        <p className="text-center text-xs text-surface-muted mt-4">
          You can change your role later from Settings.
        </p>
      </div>
    </div>
  )
}
