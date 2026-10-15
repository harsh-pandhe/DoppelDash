'use client'

import React from 'react'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { cn } from '@/lib/ds/cn'
import { Icon } from './icon'
import { Skeleton } from './states'

export interface Column<T> {
  key: string
  header: string
  cell: (row: T) => React.ReactNode
  /** Right-aligned, tabular figures (money, counts, durations). */
  numeric?: boolean
  sortable?: boolean
  /** Relative width weight (default 1). */
  weight?: number
}

export interface DataTableProps<T> {
  columns: Column<T>[]
  rows: T[]
  rowKey: (row: T) => string
  /** Accessible table name (rendered as a visually hidden caption). */
  caption: string
  /** Card-like row used below the `md` breakpoint instead of squeezing columns. */
  renderCompact: (row: T) => React.ReactNode
  sortKey?: string
  sortAsc?: boolean
  onSort?: (key: string, asc: boolean) => void
  onRowClick?: (row: T) => void
  rowLabel?: (row: T) => string
  loading?: boolean
  empty?: React.ReactNode
  className?: string
}

/**
 * The single data-table pattern. md+ : a real <table> (header, sortable columns with aria-sort, keyboard-activatable rows).
 * Below md: one compact card-like row per record (never a squeezed table). Loading = skeleton rows; no rows = `empty`.
 */
export function DataTable<T>({ columns, rows, rowKey, caption, renderCompact, sortKey, sortAsc = true, onSort, onRowClick, rowLabel, loading, empty, className }: DataTableProps<T>) {
  if (loading) {
    return (
      <div className={cn('space-y-3 p-4', className)} role="status" aria-label={`Loading ${caption}`}>
        {[0, 1, 2, 3].map(i => <div key={i} className="flex items-center gap-3"><Skeleton className="h-10 w-10 rounded-ds-full" /><div className="flex-1 space-y-2"><Skeleton className="h-3 w-1/3" /><Skeleton className="h-3 w-2/3" /></div></div>)}
      </div>
    )
  }
  if (rows.length === 0) return <div className={className}>{empty}</div>
  const total = columns.reduce((s, c) => s + (c.weight ?? 1), 0)
  return (
    <div className={className}>
      <table className="hidden w-full table-fixed border-collapse md:table">
        <caption className="ds-sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-ds-outline-variant">
            {columns.map(c => {
              const active = sortKey === c.key
              return (
                <th key={c.key} scope="col" style={{ width: `${((c.weight ?? 1) / total) * 100}%` }} aria-sort={c.sortable ? (active ? (sortAsc ? 'ascending' : 'descending') : 'none') : undefined} className={cn('px-4 py-3 text-ds-label-medium font-semibold text-ds-on-surface-variant', c.numeric ? 'text-right' : 'text-left')}>
                  {c.sortable && onSort ? (
                    <button type="button" onClick={() => onSort(c.key, active ? !sortAsc : true)} className={cn('inline-flex min-h-8 items-center gap-1 rounded-ds-sm hover:text-ds-on-surface', c.numeric && 'flex-row-reverse')}>
                      {c.header}{active && <Icon icon={sortAsc ? ArrowUp : ArrowDown} size="xs" />}
                    </button>
                  ) : c.header}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr
              key={rowKey(r)}
              tabIndex={onRowClick ? 0 : undefined}
              aria-label={onRowClick ? rowLabel?.(r) : undefined}
              onClick={onRowClick ? () => onRowClick(r) : undefined}
              onKeyDown={onRowClick ? e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onRowClick(r) } } : undefined}
              className={cn('border-b border-ds-outline-variant/60 last:border-0', onRowClick && 'cursor-pointer transition-colors duration-ds-fast hover:bg-ds-on-surface/[.04]')}
            >
              {columns.map(c => <td key={c.key} className={cn('min-h-14 px-4 py-3 align-middle text-ds-body-medium text-ds-on-surface', c.numeric && 'ds-tabular text-right')}>{c.cell(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="md:hidden" role="list" aria-label={caption}>
        {rows.map(r => (
          <div key={rowKey(r)} role="listitem" className="border-b border-ds-outline-variant/60 last:border-0">
            {onRowClick ? <button type="button" aria-label={rowLabel?.(r)} onClick={() => onRowClick(r)} className="block w-full text-left hover:bg-ds-on-surface/[.04]">{renderCompact(r)}</button> : renderCompact(r)}
          </div>
        ))}
      </div>
    </div>
  )
}
