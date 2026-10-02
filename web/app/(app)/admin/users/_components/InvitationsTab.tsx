'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Mail,
  Clock,
  CheckCircle2,
  XCircle,
  RotateCw,
  Ban,
  Search,
  Copy,
  Check,
  Loader2,
  Briefcase,
  User,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { useToast } from '@/components/ui/toast'
import * as Dialog from '@radix-ui/react-dialog'

export interface InvitationRow {
  _id: string
  orgId: string
  email: string
  role: 'employee' | 'manager'
  firstName?: string
  lastName?: string
  department?: string
  designation?: string
  expiresAt: string
  acceptedAt?: string
  revokedAt?: string
  createdAt: string
  status: 'pending' | 'accepted' | 'revoked' | 'expired'
}

export default function InvitationsTab() {
  const toast = useToast()
  const [invitations, setInvitations] = useState<InvitationRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'accepted' | 'expired' | 'revoked'>('all')

  // Action state
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null)

  // Resend Link modal state
  const [resentLink, setResentLink] = useState<{ email: string; inviteUrl: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const fetchInvitations = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/admin/invitations')
      const data = await res.json()
      if (res.ok && Array.isArray(data)) {
        setInvitations(data)
      } else {
        setInvitations([])
      }
    } catch {
      toast('Failed to load invitations', 'error')
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    fetchInvitations()
  }, [fetchInvitations])

  const handleRevoke = async (id: string, email: string) => {
    if (!confirm(`Are you sure you want to revoke the invitation for ${email}?`)) return
    setActionLoadingId(id)
    try {
      const res = await fetch(`/api/admin/invitations/${id}`, { method: 'DELETE' })
      const data = await res.json()
      if (res.ok) {
        toast('Invitation revoked', 'success')
        fetchInvitations()
      } else {
        toast(data.error || 'Failed to revoke invitation', 'error')
      }
    } catch {
      toast('Network error while revoking invitation', 'error')
    } finally {
      setActionLoadingId(null)
    }
  }

  const handleResend = async (id: string, email: string) => {
    setActionLoadingId(id)
    try {
      const res = await fetch(`/api/admin/invitations/${id}/resend`, { method: 'POST' })
      const data = await res.json()
      if (res.ok) {
        toast('Invitation resent with new token', 'success')
        if (data.inviteUrl) {
          setResentLink({ email, inviteUrl: data.inviteUrl })
        }
        fetchInvitations()
      } else {
        toast(data.error || 'Failed to resend invitation', 'error')
      }
    } catch {
      toast('Network error while resending invitation', 'error')
    } finally {
      setActionLoadingId(null)
    }
  }

  const copyResentLink = async () => {
    if (!resentLink?.inviteUrl) return
    try {
      await navigator.clipboard.writeText(resentLink.inviteUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
      toast('Copied to clipboard', 'success')
    } catch {
      toast('Failed to copy', 'error')
    }
  }

  const filtered = invitations.filter((inv) => {
    if (statusFilter !== 'all' && inv.status !== statusFilter) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      const name = `${inv.firstName || ''} ${inv.lastName || ''}`.toLowerCase()
      const email = inv.email.toLowerCase()
      const dept = (inv.department || '').toLowerCase()
      if (!name.includes(q) && !email.includes(q) && !dept.includes(q)) return false
    }
    return true
  })

  return (
    <div className="space-y-4">
      {/* Search and Filter Controls */}
      <div className="flex flex-col sm:flex-row items-center gap-3 justify-between">
        <div className="relative w-full sm:w-72">
          <Search className="w-4 h-4 text-surface-muted absolute left-3 top-1/2 -translate-y-1/2" />
          <Input
            placeholder="Search email, name, department..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-xs"
          />
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto overflow-x-auto w-full sm:w-auto pb-1 sm:pb-0">
          {(['all', 'pending', 'accepted', 'expired', 'revoked'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize whitespace-nowrap transition-colors ${
                statusFilter === s
                  ? 'bg-brand-500 text-white shadow-sm'
                  : 'bg-surface-1 text-ink-muted hover:bg-surface-2 border border-surface-border'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Invitations List / Table */}
      {loading ? (
        <div className="py-12 flex flex-col items-center justify-center space-y-3">
          <Loader2 className="w-6 h-6 animate-spin text-brand-500" />
          <p className="text-xs text-surface-muted">Loading organization invitations...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center rounded-2xl border border-dashed border-surface-border bg-surface-1/50 p-6 space-y-2">
          <div className="w-10 h-10 rounded-xl bg-surface-2 flex items-center justify-center mx-auto text-surface-muted">
            <Mail className="w-5 h-5" />
          </div>
          <p className="text-sm font-semibold text-ink">No invitations found</p>
          <p className="text-xs text-surface-muted max-w-sm mx-auto">
            {search || statusFilter !== 'all'
              ? 'No invitations match your current filters.'
              : 'Generate an invitation link to invite employees and managers to your organization.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((inv) => {
            const isPending = inv.status === 'pending'
            const isAccepted = inv.status === 'accepted'
            const isExpired = inv.status === 'expired'
            const isRevoked = inv.status === 'revoked'
            const isLoading = actionLoadingId === inv._id

            return (
              <div
                key={inv._id}
                className="p-4 rounded-xl border border-surface-border bg-surface-1 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-brand-300 transition-colors"
              >
                {/* Invitee Info */}
                <div className="flex items-start gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-xl bg-surface-2 border border-surface-border flex items-center justify-center text-ink flex-shrink-0 mt-0.5">
                    {inv.role === 'manager' ? (
                      <Briefcase className="w-4 h-4 text-brand-600" />
                    ) : (
                      <User className="w-4 h-4 text-slate-500" />
                    )}
                  </div>
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-ink truncate">
                        {inv.firstName || inv.lastName
                          ? `${inv.firstName || ''} ${inv.lastName || ''}`.trim()
                          : inv.email}
                      </p>
                      <Badge
                        variant={inv.role === 'manager' ? 'default' : 'secondary'}
                        className="text-[10px] uppercase font-bold py-0 h-4"
                      >
                        {inv.role}
                      </Badge>

                      {/* Status Badges */}
                      {isPending && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                          <Clock className="w-3 h-3 text-amber-600" /> Pending
                        </span>
                      )}
                      {isAccepted && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" /> Accepted
                        </span>
                      )}
                      {isExpired && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">
                          <Clock className="w-3 h-3 text-slate-500" /> Expired
                        </span>
                      )}
                      {isRevoked && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">
                          <XCircle className="w-3 h-3 text-rose-600" /> Revoked
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-3 text-xs text-surface-muted flex-wrap">
                      <span>{inv.email}</span>
                      {inv.department && <span>· {inv.department}</span>}
                      {inv.designation && <span>· {inv.designation}</span>}
                      <span>· Created {new Date(inv.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-2 self-end sm:self-center flex-shrink-0">
                  {/* Resend button for pending/expired */}
                  {(isPending || isExpired) && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isLoading}
                      onClick={() => handleResend(inv._id, inv.email)}
                      className="h-8 gap-1.5 text-xs text-brand-600 border-brand-200 hover:bg-brand-50"
                    >
                      {isLoading ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <RotateCw className="w-3 h-3" />
                      )}
                      Resend
                    </Button>
                  )}

                  {/* Revoke button for pending */}
                  {isPending && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={isLoading}
                      onClick={() => handleRevoke(inv._id, inv.email)}
                      className="h-8 gap-1.5 text-xs text-red-600 border-red-200 hover:bg-red-50"
                    >
                      <Ban className="w-3 h-3" />
                      Revoke
                    </Button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Resent Link Dialog */}
      <Dialog.Root open={!!resentLink} onOpenChange={(o) => { if (!o) setResentLink(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 animate-fade-in" />
          <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-surface border border-surface-border rounded-2xl shadow-2xl p-6 z-50 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-ink font-bold text-sm">
                <RotateCw className="w-4 h-4 text-brand-600" /> New Invitation Link
              </div>
              <Dialog.Close asChild>
                <button type="button" className="text-surface-muted hover:text-ink">
                  <XCircle className="w-4 h-4" />
                </button>
              </Dialog.Close>
            </div>

            <p className="text-xs text-surface-muted leading-relaxed">
              A new high-entropy token has been generated for <strong>{resentLink?.email}</strong>. The previous link is now invalid.
            </p>

            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={resentLink?.inviteUrl || ''}
                  className="h-10 text-xs font-mono bg-surface-1 border-surface-border text-ink"
                />
                <Button
                  type="button"
                  onClick={copyResentLink}
                  className="h-10 px-4 gap-1.5 flex-shrink-0 bg-brand-500 hover:bg-brand-600 text-white"
                >
                  {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <Dialog.Close asChild>
                <Button type="button">Done</Button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
