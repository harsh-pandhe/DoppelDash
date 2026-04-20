import { useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Eye, EyeOff, Mail, Lock, User, AlertCircle,
  ArrowRight, Loader2, CheckCircle2, ShieldCheck, Briefcase, Crown,
} from 'lucide-react'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import BrandPanel from '@/components/BrandPanel'
import { cn } from '@/lib/utils'

const ROLES = [
  { value: 'employee', label: 'Employee',  icon: User,       desc: 'Submit leaves & expenses' },
  { value: 'manager',  label: 'Manager',   icon: Briefcase,  desc: 'Approve team requests'    },
  { value: 'boss',     label: 'Boss',       icon: Crown,      desc: 'Full administrative access' },
]

function PasswordStrength({ password }) {
  const strength = useMemo(() => {
    if (!password) return 0
    let score = 0
    if (password.length >= 8)             score++
    if (/[A-Z]/.test(password))           score++
    if (/[0-9]/.test(password))           score++
    if (/[^A-Za-z0-9]/.test(password))    score++
    return score
  }, [password])

  const labels = ['', 'Weak', 'Fair', 'Good', 'Strong']
  const colors = ['', 'bg-red-400', 'bg-orange-400', 'bg-yellow-400', 'bg-green-500']
  const textColors = ['', 'text-red-500', 'text-orange-500', 'text-yellow-600', 'text-green-600']

  if (!password) return null

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={cn(
              'h-1.5 flex-1 rounded-full transition-all duration-300',
              i <= strength ? colors[strength] : 'bg-surface-border'
            )}
          />
        ))}
      </div>
      {strength > 0 && (
        <p className={cn('text-xs font-medium', textColors[strength])}>
          {labels[strength]} password
        </p>
      )}
    </div>
  )
}

export default function Register() {
  const { register } = useAuth()
  const navigate = useNavigate()

  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '', role: 'employee' })
  const [showPassword, setShowPassword]       = useState(false)
  const [showConfirm, setShowConfirm]         = useState(false)
  const [error, setError]                     = useState('')
  const [loading, setLoading]                 = useState(false)
  const [fieldErrors, setFieldErrors]         = useState({})

  const handleChange = (e) => {
    const { name, value } = e.target
    setForm((f) => ({ ...f, [name]: value }))
    setFieldErrors((fe) => ({ ...fe, [name]: '' }))
    if (error) setError('')
  }

  const validate = () => {
    const errs = {}
    if (!form.name.trim())                              errs.name = 'Full name is required.'
    if (!form.email.trim())                             errs.email = 'Email is required.'
    if (form.password.length < 6)                       errs.password = 'Password must be at least 6 characters.'
    if (form.password !== form.confirmPassword)         errs.confirmPassword = 'Passwords do not match.'
    setFieldErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!validate()) return
    setError('')
    setLoading(true)
    try {
      await register(form.name, form.email, form.password, form.role)
      navigate('/dashboard')
    } catch (err) {
      setError(err.response?.data?.message || 'Registration failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const passwordsMatch = form.confirmPassword && form.password === form.confirmPassword

  return (
    <div className="min-h-screen flex bg-surface">
      {/* Left brand panel */}
      <div className="lg:w-[45%] xl:w-[42%] flex-shrink-0">
        <BrandPanel subtitle="Join Doppelmayr India's internal management platform. Built for teams that move the world." />
      </div>

      {/* Right form panel */}
      <div className="flex-1 flex flex-col justify-center items-center px-6 py-10 bg-white overflow-y-auto">
        {/* Mobile logo */}
        <div className="lg:hidden flex items-center gap-2 mb-8">
          <div className="w-8 h-8 rounded-lg bg-brand-500 flex items-center justify-center">
            <span className="text-white font-black text-sm">D</span>
          </div>
          <span className="font-bold text-gray-900">DoppelDash</span>
        </div>

        <motion.div
          className="w-full max-w-md"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        >
          {/* Header */}
          <div className="mb-7">
            <h2 className="text-2xl font-extrabold text-gray-900 mb-1">Create your account</h2>
            <p className="text-surface-muted text-sm">Get started with DoppelDash in seconds</p>
          </div>

          {/* Error */}
          <AnimatePresence>
            {error && (
              <motion.div
                key="err"
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
              >
                <Alert variant="destructive" className="mb-5">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              </motion.div>
            )}
          </AnimatePresence>

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Full Name */}
            <div className="space-y-1.5">
              <Label htmlFor="name">Full Name</Label>
              <div className="relative">
                <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-muted pointer-events-none" />
                <Input
                  id="name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  placeholder="Harsh Pandhe"
                  value={form.name}
                  onChange={handleChange}
                  className={cn('pl-10', fieldErrors.name && 'border-red-400 focus:border-red-400 focus:ring-red-400/20')}
                />
              </div>
              {fieldErrors.name && <p className="text-xs text-red-500 mt-1">{fieldErrors.name}</p>}
            </div>

            {/* Email */}
            <div className="space-y-1.5">
              <Label htmlFor="email">Work Email</Label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-muted pointer-events-none" />
                <Input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@doppelmayr.com"
                  value={form.email}
                  onChange={handleChange}
                  className={cn('pl-10', fieldErrors.email && 'border-red-400 focus:border-red-400 focus:ring-red-400/20')}
                />
              </div>
              {fieldErrors.email && <p className="text-xs text-red-500 mt-1">{fieldErrors.email}</p>}
            </div>

            {/* Password */}
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-muted pointer-events-none" />
                <Input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Min. 6 characters"
                  value={form.password}
                  onChange={handleChange}
                  className={cn('pl-10 pr-10', fieldErrors.password && 'border-red-400 focus:border-red-400 focus:ring-red-400/20')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-surface-muted hover:text-gray-700 transition-colors"
                  tabIndex={-1}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              {fieldErrors.password
                ? <p className="text-xs text-red-500 mt-1">{fieldErrors.password}</p>
                : <PasswordStrength password={form.password} />
              }
            </div>

            {/* Confirm Password */}
            <div className="space-y-1.5">
              <Label htmlFor="confirmPassword">Confirm Password</Label>
              <div className="relative">
                <ShieldCheck className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-muted pointer-events-none" />
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type={showConfirm ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Re-enter password"
                  value={form.confirmPassword}
                  onChange={handleChange}
                  className={cn(
                    'pl-10 pr-10',
                    fieldErrors.confirmPassword && 'border-red-400 focus:border-red-400 focus:ring-red-400/20',
                    passwordsMatch && 'border-green-400 focus:border-green-400 focus:ring-green-400/20'
                  )}
                />
                <div className="absolute right-3.5 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  {passwordsMatch && <CheckCircle2 className="w-4 h-4 text-green-500" />}
                  <button
                    type="button"
                    onClick={() => setShowConfirm((v) => !v)}
                    className="text-surface-muted hover:text-gray-700 transition-colors"
                    tabIndex={-1}
                  >
                    {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              {fieldErrors.confirmPassword && (
                <p className="text-xs text-red-500 mt-1">{fieldErrors.confirmPassword}</p>
              )}
            </div>

            {/* Role selector */}
            <div className="space-y-2">
              <Label>Your Role</Label>
              <div className="grid grid-cols-3 gap-2">
                {ROLES.map(({ value, label, icon: Icon, desc }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, role: value }))}
                    className={cn(
                      'flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 text-center transition-all',
                      form.role === value
                        ? 'border-brand-500 bg-brand-50 text-brand-700'
                        : 'border-surface-border bg-white text-gray-600 hover:border-brand-300 hover:bg-surface'
                    )}
                  >
                    <Icon className={cn('w-5 h-5', form.role === value ? 'text-brand-500' : 'text-surface-muted')} />
                    <span className="text-xs font-semibold leading-tight">{label}</span>
                    <span className="text-[10px] leading-tight text-surface-muted hidden sm:block">{desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Terms */}
            <p className="text-xs text-surface-muted">
              By creating an account you agree to the{' '}
              <span className="text-brand-500 font-medium cursor-pointer hover:underline">Terms of Service</span>
              {' '}and{' '}
              <span className="text-brand-500 font-medium cursor-pointer hover:underline">Privacy Policy</span>.
            </p>

            {/* Submit */}
            <Button type="submit" className="w-full h-11 text-sm gap-2" disabled={loading}>
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Creating account…</>
              ) : (
                <>Create Account <ArrowRight className="w-4 h-4" /></>
              )}
            </Button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-surface-border" />
            <span className="text-xs text-surface-muted">or</span>
            <div className="flex-1 h-px bg-surface-border" />
          </div>

          {/* Login link */}
          <p className="text-center text-sm text-gray-600">
            Already have an account?{' '}
            <Link
              to="/login"
              className="text-brand-500 font-semibold hover:text-brand-700 transition-colors"
            >
              Sign in
            </Link>
          </p>
        </motion.div>

        <p className="mt-8 text-xs text-surface-muted text-center lg:hidden">
          © {new Date().getFullYear()} Doppelmayr India Private Limited
        </p>
      </div>
    </div>
  )
}
