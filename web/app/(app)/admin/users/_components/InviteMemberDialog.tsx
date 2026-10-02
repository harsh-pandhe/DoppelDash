'use client'

import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import {
  Mail,
  X,
  Loader2,
  Copy,
  Check,
  Send,
  Info,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/toast'

interface InviteMemberDialogProps {
  canCreateManager: boolean
  onInvited: () => void
}

export default function InviteMemberDialog({ canCreateManager, onInvited }: InviteMemberDialogProps) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  // Success state with generated link
  const [createdInvite, setCreatedInvite] = useState<{
    inviteUrl: string
    email: string
    role: string
    emailDelivered: boolean
  } | null>(null)

  // Form state
  const [form, setForm] = useState({
    email: '',
    role: 'employee' as 'employee' | 'manager',
    firstName: '',
    lastName: '',
    department: '',
    designation: '',
    employeeType: 'full_time' as 'full_time' | 'part_time' | 'intern' | 'contractor',
  })

  const reset = () => {
    setForm({
      email: '',
      role: 'employee',
      firstName: '',
      lastName: '',
      department: '',
      designation: '',
      employeeType: 'full_time',
    })
    setCreatedInvite(null)
    setCopied(false)
  }

  const handleCopyLink = async () => {
    if (!createdInvite?.inviteUrl) return
    try {
      await navigator.clipboard.writeText(createdInvite.inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast('Invitation link copied to clipboard', 'success')
    } catch {
      toast('Failed to copy link', 'error')
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.email.trim()) {
      toast('Email is required', 'error')
      return
    }

    setSaving(true)
    try {
      const res = await fetch('/api/admin/invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })

      const data = await res.json()

      if (!res.ok) {
        toast(data.error || 'Failed to create invitation', 'error')
        setSaving(false)
        return
      }

      setCreatedInvite({
        inviteUrl: data.inviteUrl,
        email: form.email,
        role: form.role,
        emailDelivered: data.emailDelivery?.delivered ?? false,
      })

      onInvited()
      toast('Invitation generated successfully', 'success')
    } catch {
      toast('Network error — please try again', 'error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(v) => { setOpen(v); if (!v) reset() }}>
      <Dialog.Trigger asChild>
        <Button className="gap-2 bg-brand-500 hover:bg-brand-600 text-white shadow">
          <Mail className="w-4 h-4" /> Invite Member
        </Button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 animate-fade-in" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-lg bg-surface border border-surface-border rounded-2xl shadow-2xl p-6 z-50 space-y-4 max-h-[92vh] overflow-y-auto">
          {/* Dialog Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-xl bg-brand-50 border border-brand-200 flex items-center justify-center text-brand-600">
                <Mail className="w-4 h-4" />
              </div>
              <div>
                <Dialog.Title className="text-base font-bold text-ink">
                  {createdInvite ? 'Invitation Ready' : 'Invite Team Member'}
                </Dialog.Title>
                <Dialog.Description className="text-xs text-surface-muted">
                  {createdInvite
                    ? 'Member invitation link has been generated.'
                    : 'Send a secure single-use invitation link to onboard a new user.'}
                </Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button
                type="button"
                className="w-8 h-8 rounded-lg flex items-center justify-center text-surface-muted hover:text-ink hover:bg-surface-2 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          {/* If invitation created, show copy link / email status view */}
          {createdInvite ? (
            <div className="space-y-4 py-2">
              {createdInvite.emailDelivered ? (
                <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-start gap-2.5">
                  <Check className="w-4 h-4 text-emerald-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">Invitation Email Delivered</p>
                    <p className="text-emerald-700 mt-0.5">
                      An invitation email has been sent to <strong>{createdInvite.email}</strong>.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-start gap-2.5">
                  <Info className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold">Email Delivery Not Configured</p>
                    <p className="text-amber-800 mt-0.5">
                      Outbound email is unconfigured in this environment. You can share the invitation link below directly with the invitee:
                    </p>
                  </div>
                </div>
              )}

              {/* Copyable Link Box */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold text-ink">Invitation Link</Label>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={createdInvite.inviteUrl}
                    className="h-10 text-xs font-mono bg-surface-1 border-surface-border text-ink"
                  />
                  <Button
                    type="button"
                    onClick={handleCopyLink}
                    className="h-10 px-4 gap-1.5 flex-shrink-0 bg-brand-500 hover:bg-brand-600 text-white"
                  >
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copied' : 'Copy'}
                  </Button>
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={reset}>
                  Invite Another
                </Button>
                <Dialog.Close asChild>
                  <Button type="button">Done</Button>
                </Dialog.Close>
              </div>
            </div>
          ) : (
            /* Creation Form */
            <form onSubmit={submit} className="space-y-3.5 pt-1">
              <div className="space-y-1">
                <Label htmlFor="inv-email" className="text-xs font-semibold text-ink">
                  Email Address <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="inv-email"
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="colleague@example.com"
                  className="h-10"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="inv-first-name" className="text-xs font-semibold text-ink">First Name</Label>
                  <Input
                    id="inv-first-name"
                    value={form.firstName}
                    onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
                    placeholder="Jane"
                    className="h-10"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="inv-last-name" className="text-xs font-semibold text-ink">Last Name</Label>
                  <Input
                    id="inv-last-name"
                    value={form.lastName}
                    onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
                    placeholder="Doe"
                    className="h-10"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="inv-role" className="text-xs font-semibold text-ink">Role</Label>
                  <select
                    id="inv-role"
                    value={form.role}
                    onChange={(e) => setForm((f) => ({ ...f, role: e.target.value as 'employee' | 'manager' }))}
                    className="w-full h-10 px-3 rounded-lg border border-surface-border text-sm bg-surface focus:outline-none focus:border-brand-500"
                  >
                    <option value="employee">Employee</option>
                    {canCreateManager && <option value="manager">Manager</option>}
                  </select>
                </div>

                <div className="space-y-1">
                  <Label htmlFor="inv-type" className="text-xs font-semibold text-ink">Employment Type</Label>
                  <select
                    id="inv-type"
                    value={form.employeeType}
                    onChange={(e) => setForm((f) => ({ ...f, employeeType: e.target.value as 'full_time' | 'part_time' | 'intern' | 'contractor' }))}
                    className="w-full h-10 px-3 rounded-lg border border-surface-border text-sm bg-surface focus:outline-none focus:border-brand-500"
                  >
                    <option value="full_time">Full-time</option>
                    <option value="part_time">Part-time</option>
                    <option value="contractor">Contractor</option>
                    <option value="intern">Intern</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="inv-dept" className="text-xs font-semibold text-ink">Department</Label>
                  <Input
                    id="inv-dept"
                    value={form.department}
                    onChange={(e) => setForm((f) => ({ ...f, department: e.target.value }))}
                    placeholder="e.g. Engineering"
                    className="h-10"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="inv-desig" className="text-xs font-semibold text-ink">Designation</Label>
                  <Input
                    id="inv-desig"
                    value={form.designation}
                    onChange={(e) => setForm((f) => ({ ...f, designation: e.target.value }))}
                    placeholder="e.g. Lead Engineer"
                    className="h-10"
                  />
                </div>
              </div>

              <div className="pt-3 flex justify-end gap-2">
                <Dialog.Close asChild>
                  <Button type="button" variant="outline">Cancel</Button>
                </Dialog.Close>
                <Button type="submit" disabled={saving} className="gap-2 bg-brand-500 hover:bg-brand-600 text-white">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Generate Invitation
                </Button>
              </div>
            </form>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
