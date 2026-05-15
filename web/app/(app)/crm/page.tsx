'use client'
import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Plus, Search, Phone, Mail, Building2, Trash2, Pencil, Download,
  Tag, Users, Megaphone, Upload, Loader2, CheckCircle2, AlertCircle,
  LayoutGrid, List, Table2, Globe, Lock, Users2, Eye,
  Palette, X, ScanLine,
} from 'lucide-react'
import Link from 'next/link'
import * as Dialog from '@radix-ui/react-dialog'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { CardSkeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast'
import { EmptyState } from '@/components/ui/empty-state'
import { SortableTH } from '@/components/ui/sortable-th'
import { useTableSort } from '@/lib/useTableSort'
import { useAutoRefresh } from '@/lib/useAutoRefresh'
import Papa from 'papaparse'

interface ColorLabel { color: string; label: string }
interface Contact {
  _id: string; name: string; email?: string; phone?: string
  company?: string; designation?: string; tags?: string[]
  visibility?: 'private' | 'team' | 'org' | 'boss_only'
  colorLabel?: ColorLabel
  photo?: string
}
type CsvRow = Record<string, string>
type ViewMode = 'card' | 'list' | 'table'

const AVATAR_GRADIENTS = [
  'from-brand-400 to-brand-600','from-purple-400 to-violet-600',
  'from-orange-400 to-red-500','from-emerald-400 to-green-600',
  'from-pink-400 to-rose-500','from-cyan-400 to-teal-600',
  'from-amber-400 to-orange-500','from-indigo-400 to-purple-600',
]
const avatarGradient = (name: string) => AVATAR_GRADIENTS[name.charCodeAt(0) % AVATAR_GRADIENTS.length]

const COLOR_PALETTE = [
  '#ef4444','#f97316','#eab308','#22c55e','#14b8a6',
  '#3b82f6','#8b5cf6','#ec4899','#6b7280','#1e293b',
]

const VISIBILITY_META: Record<string, { icon: React.ElementType; label: string; badge: string }> = {
  private:   { icon: Lock,   label: 'Only me',   badge: 'bg-gray-100 text-gray-600'  },
  team:      { icon: Users2, label: 'My team',   badge: 'bg-blue-100 text-blue-700'  },
  org:       { icon: Globe,  label: 'Everyone',  badge: 'bg-green-100 text-green-700' },
  boss_only: { icon: Eye,    label: 'Boss only', badge: 'bg-purple-100 text-purple-700' },
}

/* ─── Color Label Popover ──────────────────────────────────────────────────── */
function ColorLabelPopover({ contactId, current, onSaved }: {
  contactId: string; current?: ColorLabel; onSaved: (label: ColorLabel | null) => void
}) {
  const [open,  setOpen]  = useState(false)
  const [color, setColor] = useState(current?.color || COLOR_PALETTE[0])
  const [label, setLabel] = useState(current?.label || '')
  const [saving,setSaving]= useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    if (open) document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const save = async () => {
    const trimmed = label.trim()
    if (!trimmed) return            // disabled state guards this
    setSaving(true)
    const next = { color, label: trimmed }
    const res = await fetch(`/api/crm/${contactId}`, {
      method: 'PATCH', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ colorLabel: next }),
    })
    if (res.ok) {
      onSaved(next)
      setOpen(false)
    }
    setSaving(false)
  }
  const remove = async () => {
    await fetch(`/api/crm/${contactId}`, { method: 'PATCH', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ colorLabel: null }) })
    onSaved(null); setOpen(false)
  }

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={e => { e.preventDefault(); setOpen(o => !o) }} aria-label="Set color label"
        className="p-1.5 rounded-lg hover:bg-surface text-surface-muted hover:text-gray-700 transition-colors">
        {current ? (
          <span className="w-3.5 h-3.5 rounded-full block" style={{ background: current.color }} />
        ) : (
          <Palette className="w-3.5 h-3.5" />
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-30 bg-white rounded-2xl shadow-xl border border-surface-border p-3 w-60 space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-wide text-surface-muted">Color Label</p>
          <div className="flex flex-wrap gap-1.5">
            {COLOR_PALETTE.map(c => (
              <button key={c} type="button" title={c} onClick={() => setColor(c)}
                className={`w-6 h-6 rounded-full transition-transform hover:scale-110 ${color === c ? 'ring-2 ring-offset-1 ring-gray-700 scale-110' : ''}`}
                style={{ background: c }} />
            ))}
            <label className="w-6 h-6 rounded-full border-2 border-dashed border-surface-border flex items-center justify-center cursor-pointer hover:border-brand-500 transition-colors overflow-hidden relative"
              title="Pick custom color" style={!COLOR_PALETTE.includes(color) ? { background: color, borderColor: color } : undefined}>
              <input type="color" value={color} onChange={e => setColor(e.target.value)}
                aria-label="Pick custom color"
                className="absolute inset-0 opacity-0 w-full h-full cursor-pointer" />
              {COLOR_PALETTE.includes(color) && <span className="text-[10px] font-bold text-surface-muted">+</span>}
            </label>
          </div>
          <div className="flex items-center gap-2 px-2 py-1 rounded-lg border border-surface-border bg-surface">
            <span className="w-3.5 h-3.5 rounded-full flex-shrink-0" style={{ background: color }} />
            <input value={color} onChange={e => {
              const v = e.target.value
              if (/^#[0-9a-f]{0,6}$/i.test(v)) setColor(v)
            }} maxLength={7} aria-label="Hex color"
              className="flex-1 text-[10px] font-mono bg-transparent focus:outline-none uppercase tracking-wider" />
          </div>
          <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Label name (e.g. Hot Lead)"
            aria-label="Color label name"
            className="w-full h-8 px-2.5 rounded-lg border border-surface-border text-xs focus:outline-none focus:border-brand-500" />
          {!label.trim() && (
            <p className="text-[9px] text-amber-600 leading-tight">Pick a color and type a label name to save.</p>
          )}
          <div className="flex gap-2">
            <Button size="sm" className="flex-1 h-7 text-xs" onClick={save} disabled={saving || !label.trim()}>
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />}
              Save
            </Button>
            {current && (
              <button type="button" title="Remove label" aria-label="Remove label" onClick={remove}
                className="px-2 py-1 text-[10px] text-red-500 hover:text-red-600 font-semibold rounded-lg hover:bg-red-50">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── Visibility Selector ──────────────────────────────────────────────────── */
function VisibilitySelect({ contactId, current, onSaved }: {
  contactId: string; current?: string; onSaved: (v: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    if (open) document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [open])

  const vis = current || 'private'
  const meta = VISIBILITY_META[vis] || VISIBILITY_META.private
  const Icon = meta.icon

  const set = async (v: string) => {
    await fetch(`/api/crm/${contactId}`, { method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ visibility: v }) })
    onSaved(v); setOpen(false)
  }

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={e => { e.preventDefault(); setOpen(o => !o) }} aria-label="Set visibility"
        className={`flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold transition-all ${meta.badge} hover:opacity-80`}>
        <Icon className="w-2.5 h-2.5" />{meta.label}
      </button>
      {open && (
        <div className="absolute left-0 top-6 z-30 bg-white rounded-xl shadow-xl border border-surface-border p-1.5 w-40 space-y-0.5">
          {Object.entries(VISIBILITY_META).map(([v, m]) => {
            const I = m.icon
            return (
              <button key={v} type="button" onClick={() => set(v)}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors hover:bg-surface text-left
                  ${vis === v ? 'bg-brand-50 text-brand-700' : 'text-gray-700'}`}>
                <I className="w-3.5 h-3.5 flex-shrink-0" />{m.label}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/* ─── CSV Import ───────────────────────────────────────────────────────────── */
function CSVImportDialog({ onImport }: { onImport: () => void }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<CsvRow[]>([])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ created: number; errors: number } | null>(null)
  const toast = useToast()

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]; if (!file) return
    Papa.parse<CsvRow>(file, { header: true, skipEmptyLines: true, complete: r => setRows(r.data) })
    e.target.value = ''
  }

  const importAll = async () => {
    if (!rows.length) return
    setLoading(true); setResult(null)
    let created = 0; let errors = 0
    await Promise.all(rows.map(async row => {
      const body = { name: row.name||row.Name||'', email: row.email||row.Email||'', phone: row.phone||row.Phone||'', company: row.company||row.Company||'', designation: row.designation||row.Designation||'', tags: (row.tags||row.Tags||'').split(';').map((s:string)=>s.trim()).filter(Boolean) }
      if (!body.name) { errors++; return }
      const res = await fetch('/api/crm', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) })
      if (res.ok) created++; else errors++
    }))
    setResult({ created, errors })
    if (created > 0) { toast(`${created} contacts imported`, 'success'); onImport() }
    setLoading(false)
  }

  return (
    <Dialog.Root open={open} onOpenChange={o => { setOpen(o); if(!o){setRows([]);setResult(null)} }}>
      <Dialog.Trigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-2"><Upload className="w-4 h-4" />Import</Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
          <Dialog.Title className="text-base font-bold text-gray-900 mb-1">Import Contacts</Dialog.Title>
          <Dialog.Description className="text-sm text-surface-muted mb-4">CSV with columns: name, email, phone, company, designation, tags</Dialog.Description>
          <label className="flex flex-col items-center gap-2 p-6 border-2 border-dashed border-surface-border rounded-xl cursor-pointer hover:border-brand-400 transition-colors">
            <Upload className="w-6 h-6 text-surface-muted" />
            <span className="text-sm font-semibold text-gray-700">Choose CSV file</span>
            <input type="file" accept=".csv" className="hidden" onChange={onFile} aria-label="Choose CSV file" />
          </label>
          {rows.length > 0 && !result && (
            <div className="mt-3 space-y-2">
              <p className="text-xs font-semibold text-gray-700">{rows.length} rows detected</p>
              <div className="max-h-32 overflow-y-auto rounded-xl border border-surface-border text-xs divide-y">
                {rows.slice(0,8).map((r,i) => <div key={i} className="px-3 py-1.5 truncate">{r.name||r.Name||'(no name)'}</div>)}
                {rows.length>8 && <div className="px-3 py-1.5 text-surface-muted">…+{rows.length-8} more</div>}
              </div>
            </div>
          )}
          {result && (
            <div className={`mt-3 flex items-center gap-2 p-3 rounded-xl text-sm font-semibold ${result.errors===0?'bg-green-50 text-green-700':'bg-orange-50 text-orange-700'}`}>
              {result.errors===0?<CheckCircle2 className="w-4 h-4"/>:<AlertCircle className="w-4 h-4"/>}
              {result.created} imported{result.errors>0?`, ${result.errors} failed`:''}
            </div>
          )}
          <div className="flex gap-3 mt-4 justify-end">
            <Dialog.Close asChild><Button type="button" variant="outline" size="sm">Close</Button></Dialog.Close>
            {rows.length>0&&!result&&(
              <Button type="button" size="sm" onClick={importAll} disabled={loading} className="gap-1.5">
                {loading?<Loader2 className="w-3 h-3 animate-spin"/>:<Upload className="w-3 h-3"/>}
                Import {rows.length}
              </Button>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function DeleteDialog({ name, onConfirm }: { name: string; onConfirm: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" aria-label="Delete contact" className="p-1.5 rounded-lg hover:bg-red-50 text-surface-muted hover:text-red-500 transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-2xl p-6 w-full max-w-sm">
          <Dialog.Title className="text-base font-bold text-gray-900 mb-1">Delete Contact</Dialog.Title>
          <Dialog.Description className="text-sm text-surface-muted mb-5">Delete <strong>{name}</strong>? This cannot be undone.</Dialog.Description>
          <div className="flex gap-3 justify-end">
            <Dialog.Close asChild><Button type="button" variant="outline" size="sm">Cancel</Button></Dialog.Close>
            <Button type="button" size="sm" className="bg-red-600 hover:bg-red-700" onClick={() => { onConfirm(); setOpen(false) }}>Delete</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function exportCSV(contacts: Contact[]) {
  const headers = ['Name','Email','Phone','Company','Designation','Tags','Visibility','ColorLabel']
  const rows = contacts.map(c => [
    `"${c.name}"`,`"${c.email||''}"`,`"${c.phone||''}"`,
    `"${c.company||''}"`,`"${c.designation||''}"`,
    `"${(c.tags||[]).join('; ')}"`,`"${c.visibility||'private'}"`,`"${c.colorLabel?.label||''}"`,
  ])
  const csv = [headers.join(','),...rows.map(r=>r.join(','))].join('\n')
  const a   = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}))
  a.download = `contacts-${Date.now()}.csv`; a.click()
}

/* ─── Page ─────────────────────────────────────────────────────────────────── */
export default function CRMPage() {
  const toast = useToast()
  const [contacts,  setContacts]  = useState<Contact[]>([])
  const [query,     setQuery]     = useState('')
  const [debQ,      setDebQ]      = useState('')
  const [tagFilter, setTagFilter] = useState('')
  const [loading,   setLoading]   = useState(true)
  const [view,      setView]      = useState<ViewMode>('card')

  useEffect(() => {
    const t = setTimeout(() => setDebQ(query), 300)
    return () => clearTimeout(t)
  }, [query])

  const fetchContacts = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/crm?q=${encodeURIComponent(debQ)}`)
      const data = await res.json()
      setContacts(Array.isArray(data) ? data : [])
    } catch { setContacts([]) }
    finally { setLoading(false) }
  }, [debQ])

  useEffect(() => { fetchContacts() }, [fetchContacts])
  useAutoRefresh(fetchContacts, { intervalMs: 30_000 })

  const deleteContact = async (id: string, name: string) => {
    await fetch(`/api/crm/${id}`, { method: 'DELETE' })
    setContacts(c => c.filter(x => x._id !== id))
    toast(`${name} deleted`, 'info')
  }

  const updateLocal = (id: string, patch: Partial<Contact>) =>
    setContacts(cs => cs.map(c => c._id === id ? { ...c, ...patch } : c))

  const allTags  = Array.from(new Set(contacts.flatMap(c => c.tags || [])))
  const displayed = tagFilter ? contacts.filter(c => c.tags?.includes(tagFilter)) : contacts

  /* ── Card View ─────────────────────────────────────────────────────────── */
  const CardView = () => (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {displayed.map(c => {
        const initials = c.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
        const grad = avatarGradient(c.name)
        return (
          <div key={c._id} className="group bg-white rounded-2xl border border-surface-border hover:shadow-lg hover:border-brand-200 transition-all overflow-hidden">
            {/* Color label bar or gradient bar */}
            <div className="h-1" style={c.colorLabel ? { background: c.colorLabel.color } : undefined}>
              {!c.colorLabel && <div className={`h-full bg-gradient-to-r ${grad}`} />}
            </div>
            <div className="p-4">
              <div className="flex items-start justify-between mb-3">
                <div className="relative">
                  <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${grad} flex items-center justify-center flex-shrink-0`}>
                    {c.photo
                      ? <img src={c.photo} alt={c.name} className="w-12 h-12 rounded-2xl object-cover" />
                      : <span className="text-white font-bold text-sm">{initials}</span>}
                  </div>
                  {c.colorLabel && (
                    <span className="absolute -bottom-1 -right-1 text-[8px] font-bold px-1 py-0 rounded-full text-white whitespace-nowrap"
                      style={{ background: c.colorLabel.color }}>
                      {c.colorLabel.label}
                    </span>
                  )}
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <ColorLabelPopover contactId={c._id} current={c.colorLabel}
                    onSaved={l => updateLocal(c._id, { colorLabel: l ?? undefined })} />
                  <Link href={`/crm/${c._id}`}>
                    <button type="button" aria-label="Edit contact" className="p-1.5 rounded-lg hover:bg-brand-50 text-surface-muted hover:text-brand-600 transition-colors">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </Link>
                  <DeleteDialog name={c.name} onConfirm={() => deleteContact(c._id, c.name)} />
                </div>
              </div>

              <Link href={`/crm/${c._id}`} className="block">
                <p className="font-bold text-gray-900 text-sm mb-0.5 truncate hover:text-brand-600 transition-colors">{c.name}</p>
                {c.designation && <p className="text-xs text-surface-muted truncate">{c.designation}</p>}
              </Link>

              <div className="space-y-1.5 mt-2">
                {c.company && <div className="flex items-center gap-2 text-xs text-gray-600"><Building2 className="w-3 h-3 text-surface-muted flex-shrink-0" /><span className="truncate font-medium">{c.company}</span></div>}
                {c.email   && <div className="flex items-center gap-2 text-xs text-gray-500"><Mail    className="w-3 h-3 text-surface-muted flex-shrink-0" /><span className="truncate">{c.email}</span></div>}
                {c.phone   && <div className="flex items-center gap-2 text-xs text-gray-500"><Phone   className="w-3 h-3 text-surface-muted flex-shrink-0" /><span>{c.phone}</span></div>}
              </div>

              <div className="flex items-center justify-between mt-3 pt-3 border-t border-surface-border">
                <div className="flex flex-wrap gap-1">
                  {(c.tags||[]).slice(0,2).map(tag => (
                    <Badge key={tag} variant="secondary" className="text-[9px] px-1.5 py-0 cursor-pointer hover:bg-brand-100 hover:text-brand-700" onClick={() => setTagFilter(tag)}>{tag}</Badge>
                  ))}
                  {(c.tags||[]).length > 2 && <Badge variant="secondary" className="text-[9px] px-1.5 py-0">+{(c.tags||[]).length-2}</Badge>}
                </div>
                <VisibilitySelect contactId={c._id} current={c.visibility}
                  onSaved={v => updateLocal(c._id, { visibility: v as Contact['visibility'] })} />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )

  /* ── List View ─────────────────────────────────────────────────────────── */
  const ListView = () => (
    <div className="bg-white rounded-2xl border border-surface-border divide-y divide-surface-border overflow-hidden">
      {displayed.map(c => {
        const grad = avatarGradient(c.name)
        const initials = c.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)
        return (
          <div key={c._id} className="flex items-center gap-4 px-4 py-3 hover:bg-surface/40 transition-colors group">
            {/* Avatar */}
            <div className="relative flex-shrink-0">
              <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${grad} flex items-center justify-center`}>
                {c.photo ? <img src={c.photo} alt={c.name} className="w-9 h-9 rounded-xl object-cover" /> : <span className="text-white font-bold text-[10px]">{initials}</span>}
              </div>
              {c.colorLabel && <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white" style={{ background: c.colorLabel.color }} />}
            </div>

            <div className="flex-1 min-w-0 grid grid-cols-[2fr_1.5fr_1fr_auto] gap-4 items-center">
              <div className="min-w-0">
                <Link href={`/crm/${c._id}`} className="text-sm font-bold text-gray-900 hover:text-brand-600 truncate block">{c.name}</Link>
                {c.designation && <p className="text-[10px] text-surface-muted truncate">{c.designation}</p>}
              </div>
              <div className="min-w-0">
                {c.company && <p className="text-xs text-gray-600 font-medium truncate">{c.company}</p>}
                {c.email && <p className="text-[10px] text-surface-muted truncate">{c.email}</p>}
              </div>
              <div>
                {c.phone && <p className="text-xs text-gray-600">{c.phone}</p>}
              </div>
              <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <ColorLabelPopover contactId={c._id} current={c.colorLabel} onSaved={l => updateLocal(c._id, { colorLabel: l ?? undefined })} />
                <VisibilitySelect contactId={c._id} current={c.visibility} onSaved={v => updateLocal(c._id, { visibility: v as Contact['visibility'] })} />
                <Link href={`/crm/${c._id}`}><button type="button" aria-label="Edit" className="p-1.5 rounded-lg hover:bg-brand-50 text-surface-muted hover:text-brand-600"><Pencil className="w-3.5 h-3.5"/></button></Link>
                <DeleteDialog name={c.name} onConfirm={() => deleteContact(c._id, c.name)} />
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )

  /* ── Table View ────────────────────────────────────────────────────────── */
  const TableView = () => {
    const { sorted, sortKey, sortDir, toggle } = useTableSort(displayed as unknown as Record<string, unknown>[])
    return (
    <div className="bg-white rounded-2xl border border-surface-border overflow-hidden">
      <div className="overflow-x-auto max-h-[calc(100vh-260px)]">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-surface shadow-sm">
            <tr className="border-b border-surface-border">
              <SortableTH label="Name"    sortKey="name"    activeKey={sortKey} activeDir={sortDir} onClick={toggle} />
              <SortableTH label="Company" sortKey="company" activeKey={sortKey} activeDir={sortDir} onClick={toggle} />
              <SortableTH label="Email"   sortKey="email"   activeKey={sortKey} activeDir={sortDir} onClick={toggle} />
              <SortableTH label="Phone"   sortKey="phone"   activeKey={sortKey} activeDir={sortDir} onClick={toggle} />
              <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wide text-surface-muted whitespace-nowrap">Tags</th>
              <th className="text-left px-4 py-2.5 text-[10px] font-bold uppercase tracking-wide text-surface-muted whitespace-nowrap">Label</th>
              <SortableTH label="Visibility" sortKey="visibility" activeKey={sortKey} activeDir={sortDir} onClick={toggle} />
              <th className="px-4 py-2.5"><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border">
            {(sorted as unknown as Contact[]).map(c => {
              const grad = avatarGradient(c.name)
              const initials = c.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)
              return (
                <tr key={c._id} className="hover:bg-surface/40 transition-colors group">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className={`w-7 h-7 rounded-lg bg-gradient-to-br ${grad} flex items-center justify-center flex-shrink-0`}>
                        {c.photo ? <img src={c.photo} alt="" className="w-7 h-7 rounded-lg object-cover"/> : <span className="text-white font-bold text-[9px]">{initials}</span>}
                      </div>
                      <div>
                        <Link href={`/crm/${c._id}`} className="text-sm font-bold text-gray-900 hover:text-brand-600">{c.name}</Link>
                        {c.designation && <p className="text-[10px] text-surface-muted">{c.designation}</p>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600 font-medium">{c.company||'—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{c.email||'—'}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">{c.phone||'—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1 flex-wrap max-w-[120px]">
                      {(c.tags||[]).slice(0,2).map(t=><span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-surface border border-surface-border text-gray-600">{t}</span>)}
                      {(c.tags||[]).length>2 && <span className="text-[9px] text-surface-muted">+{(c.tags||[]).length-2}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {c.colorLabel ? (
                      <span className="flex items-center gap-1 text-[10px] font-semibold">
                        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{background:c.colorLabel.color}}/>
                        {c.colorLabel.label}
                      </span>
                    ) : <span className="text-[10px] text-surface-muted">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    <VisibilitySelect contactId={c._id} current={c.visibility} onSaved={v => updateLocal(c._id, { visibility: v as Contact['visibility'] })} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <ColorLabelPopover contactId={c._id} current={c.colorLabel} onSaved={l => updateLocal(c._id, { colorLabel: l ?? undefined })} />
                      <Link href={`/crm/${c._id}`}><button type="button" aria-label="Edit" className="p-1 rounded-lg hover:bg-brand-50 text-surface-muted hover:text-brand-600"><Pencil className="w-3.5 h-3.5"/></button></Link>
                      <DeleteDialog name={c.name} onConfirm={() => deleteContact(c._id, c.name)} />
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )}

  return (
    <>
      <Header title="Contacts" />
      <main className="flex-1 p-5 lg:p-8 xl:px-12 space-y-4 w-full bg-surface-2">

        {/* Toolbar */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-muted pointer-events-none" />
            <Input placeholder="Search contacts…" value={query} onChange={e => setQuery(e.target.value)} className="pl-9 rounded-xl" />
          </div>
          <div className="flex gap-2 flex-wrap items-center">
            {/* View toggle */}
            <div className="flex rounded-xl border border-surface-border overflow-hidden">
              {([['card', LayoutGrid],['list', List],['table', Table2]] as const).map(([v, Icon]) => (
                <button key={v} type="button" title={v} onClick={() => setView(v)}
                  className={`p-2 transition-all ${view===v ? 'bg-brand-500 text-white' : 'bg-white text-surface-muted hover:bg-surface'}`}>
                  <Icon className="w-4 h-4" />
                </button>
              ))}
            </div>
            {contacts.length>0 && <Button type="button" variant="outline" size="sm" className="gap-2" onClick={()=>exportCSV(contacts)}><Download className="w-4 h-4"/>Export</Button>}
            <CSVImportDialog onImport={fetchContacts} />
            <Link href="/crm/scan"><Button type="button" variant="outline" size="sm" className="gap-2"><ScanLine className="w-4 h-4"/>Scan Card</Button></Link>
            <Link href="/crm/campaigns"><Button type="button" variant="outline" size="sm" className="gap-2"><Megaphone className="w-4 h-4"/>Campaign</Button></Link>
            <Link href="/crm/new"><Button className="gap-2"><Plus className="w-4 h-4"/>Add Contact</Button></Link>
          </div>
        </div>

        {/* Tag filters */}
        {allTags.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <Tag className="w-3.5 h-3.5 text-surface-muted flex-shrink-0" />
            <button type="button" onClick={() => setTagFilter('')}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${!tagFilter?'bg-brand-500 text-white':'bg-white border border-surface-border text-gray-600 hover:border-brand-400'}`}>
              All
            </button>
            {allTags.map(tag => (
              <button type="button" key={tag} onClick={() => setTagFilter(tagFilter===tag?'':tag)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${tagFilter===tag?'bg-brand-500 text-white':'bg-white border border-surface-border text-gray-600 hover:border-brand-400'}`}>
                {tag}
              </button>
            ))}
          </div>
        )}

        {!loading && contacts.length > 0 && (
          <p className="text-xs text-surface-muted">
            {displayed.length} contact{displayed.length!==1?'s':''}{tagFilter?` tagged "${tagFilter}"`:''} · <span className="capitalize">{view} view</span>
          </p>
        )}

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_,i) => <CardSkeleton key={i} />)}
          </div>
        ) : displayed.length === 0 ? (
          <EmptyState
            icon={Users}
            size="lg"
            variant={query || tagFilter ? 'search' : 'default'}
            title={tagFilter ? `No contacts tagged "${tagFilter}"` : query ? 'No results found' : 'No contacts yet'}
            description={tagFilter || query ? 'Try a different search or filter, or clear filters to see all.' : 'Add your first stakeholder, partner, or client to start building your CRM.'}
            action={!tagFilter && !query ? { label: 'Add Contact', href: '/crm/new', icon: Plus } : undefined}
            secondaryAction={(query || tagFilter) ? { label: 'Clear filters', onClick: () => { setQuery(''); setTagFilter('') } } : undefined}
          />
        ) : view === 'card' ? <CardView /> : view === 'list' ? <ListView /> : <TableView />}
      </main>
    </>
  )
}
