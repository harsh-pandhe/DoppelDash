import { ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'
import type { SortDir } from '@/lib/useTableSort'

interface Props {
  label:    string
  sortKey:  string
  activeKey: string | null
  activeDir: SortDir
  onClick:  (key: string) => void
  align?:   'left' | 'right' | 'center'
  className?: string
}

/** Clickable column header that participates in useTableSort */
export function SortableTH({ label, sortKey, activeKey, activeDir, onClick, align = 'left', className = '' }: Props) {
  const active = activeKey === sortKey && activeDir !== null
  const Icon   = !active ? ChevronsUpDown : activeDir === 'asc' ? ChevronUp : ChevronDown
  const alignCls = align === 'right' ? 'text-right justify-end' : align === 'center' ? 'text-center justify-center' : 'text-left'
  return (
    <th className={`px-4 py-2.5 text-[10px] font-bold uppercase tracking-wide text-surface-muted whitespace-nowrap ${className}`}>
      <button
        type="button"
        onClick={() => onClick(sortKey)}
        className={`flex items-center gap-1 w-full ${alignCls} transition-colors ${active ? 'text-brand-600' : 'hover:text-gray-700'}`}
        aria-sort={active ? (activeDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <span>{label}</span>
        <Icon className={`w-3 h-3 flex-shrink-0 transition-opacity ${active ? 'opacity-100' : 'opacity-40 group-hover:opacity-70'}`} />
      </button>
    </th>
  )
}
