export const STATUS_BADGE: Record<string, string> = {
  pending:         'bg-amber-50   text-amber-700   border border-amber-200',
  approved:        'bg-emerald-50 text-emerald-700 border border-emerald-200',
  rejected:        'bg-red-50     text-red-700     border border-red-200',
  pending_manager: 'bg-amber-50   text-amber-700   border border-amber-200',
  pending_boss:    'bg-blue-50    text-blue-700    border border-blue-200',
  paid:            'bg-emerald-50 text-emerald-700 border border-emerald-200',
}

export const STATUS_LABEL: Record<string, string> = {
  pending:         'Pending',
  approved:        'Approved',
  rejected:        'Rejected',
  pending_manager: 'Mgr Review',
  pending_boss:    'Payout',
  paid:            'Paid',
}

export function statusBadge(status: string): string {
  return STATUS_BADGE[status] ?? 'bg-gray-50 text-gray-600 border border-gray-200'
}

export function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status.replace(/_/g, ' ')
}
