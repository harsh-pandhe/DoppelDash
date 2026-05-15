'use client'
import { useMemo, useState } from 'react'

export type SortDir = 'asc' | 'desc' | null

/**
 * Sort an array client-side by clicking column headers.
 * Cycle: asc → desc → off
 */
export function useTableSort<T extends Record<string, unknown>>(
  rows: T[],
  initial?: { key: string; dir: SortDir }
) {
  const [sortKey, setSortKey] = useState<string | null>(initial?.key ?? null)
  const [sortDir, setSortDir] = useState<SortDir>(initial?.dir ?? null)

  const sorted = useMemo(() => {
    if (!sortKey || !sortDir) return rows
    const copy = [...rows]
    copy.sort((a, b) => {
      const av = getPath(a, sortKey)
      const bv = getPath(b, sortKey)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return sortDir === 'asc' ? av - bv : bv - av
      const as = String(av).toLowerCase()
      const bs = String(bv).toLowerCase()
      return sortDir === 'asc' ? as.localeCompare(bs) : bs.localeCompare(as)
    })
    return copy
  }, [rows, sortKey, sortDir])

  const toggle = (key: string) => {
    if (sortKey !== key) { setSortKey(key); setSortDir('asc'); return }
    if (sortDir === 'asc')  { setSortDir('desc'); return }
    if (sortDir === 'desc') { setSortKey(null); setSortDir(null); return }
    setSortDir('asc')
  }

  return { sorted, sortKey, sortDir, toggle }
}

function getPath(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, k) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[k] : undefined), obj)
}
