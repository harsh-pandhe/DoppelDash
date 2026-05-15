'use client'
import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, Check, Loader2, Globe } from 'lucide-react'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useToast } from '@/components/ui/toast'
import { useUser } from '@/lib/useUser'

interface Holiday {
  _id: string; name: string; date: string; type: string
  description?: string; isRecurringYearly: boolean; year: number
}

const TYPE_META: Record<string, { badge: string; label: string }> = {
  national:   { badge: 'bg-red-100 text-red-700 border-red-200',      label: 'National'   },
  regional:   { badge: 'bg-blue-100 text-blue-700 border-blue-200',   label: 'Regional'   },
  restricted: { badge: 'bg-orange-100 text-orange-700 border-orange-200', label: 'Restricted' },
  optional:   { badge: 'bg-gray-100 text-gray-600 border-gray-200',   label: 'Optional'   },
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export default function HolidaysPage() {
  const { user } = useUser()
  const toast    = useToast()
  const role    = user?.role || 'employee'
  const canEdit = role === 'boss' || role === 'manager'

  const [year,     setYear]     = useState(new Date().getFullYear())
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [loading,  setLoading]  = useState(true)
  const [adding,   setAdding]   = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [form,     setForm]     = useState({ name: '', date: '', type: 'optional', description: '' })

  const fetchHolidays = useCallback(async () => {
    setLoading(true)
    const res  = await fetch(`/api/holidays?year=${year}`)
    const data = await res.json()
    setHolidays(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [year])

  useEffect(() => { fetchHolidays() }, [fetchHolidays])

  const addHoliday = async () => {
    if (!form.name || !form.date) { toast('Name and date required', 'error'); return }
    setSaving(true)
    const res = await fetch('/api/holidays', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify(form),
    })
    if (res.ok) { toast('Holiday added', 'success'); setAdding(false); setForm({ name:'', date:'', type:'optional', description:'' }); fetchHolidays() }
    else toast('Failed to add', 'error')
    setSaving(false)
  }

  const deleteHoliday = async (id: string) => {
    await fetch('/api/holidays', { method: 'DELETE', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ id }) })
    toast('Removed', 'info')
    fetchHolidays()
  }

  // Group by month
  const byMonth = MONTHS.reduce((acc, _, i) => {
    acc[i] = holidays.filter(h => new Date(h.date).getMonth() === i).sort((a, b) => new Date(a.date).getDate() - new Date(b.date).getDate())
    return acc
  }, {} as Record<number, Holiday[]>)

  const totalNational   = holidays.filter(h => h.type === 'national').length
  const totalRestricted = holidays.filter(h => h.type === 'restricted').length

  return (
    <>
      <Header title="Public Holidays" />
      <main className="flex-1 p-5 lg:p-8 xl:px-12 space-y-5 w-full bg-surface-2">

        {/* Hero */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#003B73] via-[#0057A8] to-[#1d6dc2] p-6 text-white">
          <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/10 pointer-events-none" />
          <Globe className="w-6 h-6 text-white/70 mb-2" />
          <h2 className="text-xl font-extrabold tracking-tight">India Public Holidays {year}</h2>
          <p className="text-white/80 text-sm mt-1">
            {totalNational} national · {totalRestricted} restricted/optional holidays
          </p>
        </div>

        {/* Year nav + add */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setYear(y => y-1)}
              className="px-3 h-9 rounded-xl border border-surface-border text-sm font-semibold hover:border-brand-400 transition-colors">
              ← {year-1}
            </button>
            <span className="text-sm font-extrabold text-gray-900 px-2">{year}</span>
            <button type="button" onClick={() => setYear(y => y+1)}
              className="px-3 h-9 rounded-xl border border-surface-border text-sm font-semibold hover:border-brand-400 transition-colors">
              {year+1} →
            </button>
          </div>
          {canEdit && (
            <Button className="gap-2" onClick={() => setAdding(a => !a)}>
              <Plus className="w-4 h-4" /> Add Holiday
            </Button>
          )}
        </div>

        {/* Add form */}
        {adding && (
          <div className="bg-white rounded-2xl border border-surface-border p-5 space-y-4">
            <h3 className="text-sm font-bold text-gray-700">New Holiday</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="hol-name">Name</Label>
                <Input id="hol-name" value={form.name} onChange={e => setForm(f=>({...f,name:e.target.value}))} placeholder="e.g. Founders Day" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hol-date">Date</Label>
                <input id="hol-date" type="date" aria-label="Holiday date" title="Holiday date" value={form.date} onChange={e => setForm(f=>({...f,date:e.target.value}))}
                  className="w-full h-10 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="hol-type">Type</Label>
                <select id="hol-type" aria-label="Holiday type" title="Holiday type" value={form.type} onChange={e => setForm(f=>({...f,type:e.target.value}))}
                  className="w-full h-10 px-3 rounded-xl border border-surface-border text-sm focus:outline-none focus:border-brand-500">
                  <option value="national">National</option>
                  <option value="regional">Regional</option>
                  <option value="restricted">Restricted</option>
                  <option value="optional">Optional</option>
                </select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hol-desc">Description (optional)</Label>
                <Input id="hol-desc" value={form.description} onChange={e => setForm(f=>({...f,description:e.target.value}))} placeholder="Brief note" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button className="gap-1.5" onClick={addHoliday} disabled={saving}>
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                Save
              </Button>
              <Button variant="outline" onClick={() => setAdding(false)}>Cancel</Button>
            </div>
          </div>
        )}

        {/* Month grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_,i) => <div key={i} className="h-40 rounded-2xl bg-surface-border animate-pulse" />)}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {MONTHS.map((month, mi) => {
              const mHolidays = byMonth[mi] || []
              return (
                <div key={month} className={`bg-white rounded-2xl border overflow-hidden transition-shadow hover:shadow-md ${mHolidays.length > 0 ? 'border-surface-border' : 'border-surface-border opacity-60'}`}>
                  <div className={`px-4 py-2.5 border-b border-surface-border flex items-center justify-between ${mHolidays.length > 0 ? 'bg-gradient-to-r from-[#e8f0fa] to-white' : 'bg-surface'}`}>
                    <p className="text-sm font-extrabold text-gray-900">{month}</p>
                    {mHolidays.length > 0 && (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand-100 text-brand-700">{mHolidays.length}</span>
                    )}
                  </div>
                  {mHolidays.length === 0 ? (
                    <p className="text-xs text-surface-muted px-4 py-3">No holidays</p>
                  ) : (
                    <div className="divide-y divide-surface-border">
                      {mHolidays.map(h => {
                        const t = TYPE_META[h.type] || TYPE_META.optional
                        return (
                          <div key={h._id} className="px-4 py-2.5 flex items-start gap-3 group">
                            <div className="text-center flex-shrink-0">
                              <p className="text-lg font-extrabold text-gray-900 leading-none">{new Date(h.date).getDate()}</p>
                              <p className="text-[9px] font-bold text-surface-muted uppercase">{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(h.date).getDay()]}</p>
                            </div>
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-bold text-gray-900 truncate">{h.name}</p>
                              <span className={`text-[9px] font-bold px-1.5 py-0 rounded-full border ${t.badge}`}>{t.label}</span>
                              {h.description && <p className="text-[9px] text-surface-muted mt-0.5 truncate">{h.description}</p>}
                            </div>
                            {canEdit && (
                              <button type="button" title="Remove holiday" aria-label="Remove holiday"
                                onClick={() => deleteHoliday(h._id)}
                                className="opacity-0 group-hover:opacity-100 p-1 rounded-lg hover:bg-red-50 text-surface-muted hover:text-red-500 transition-all flex-shrink-0">
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {/* Legend */}
        <div className="flex flex-wrap gap-3 pt-2">
          {Object.entries(TYPE_META).map(([k, v]) => (
            <span key={k} className={`flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full border ${v.badge}`}>
              {v.label}
            </span>
          ))}
          <p className="text-[10px] text-surface-muted self-center">Dates are approximate for lunar holidays (Eid, Diwali, etc.)</p>
        </div>
      </main>
    </>
  )
}
