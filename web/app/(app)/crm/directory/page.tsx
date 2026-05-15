'use client'
import { useState, useEffect } from 'react'
import { Search, Phone, Mail, Building2, Users, CalendarDays } from 'lucide-react'
import Header from '@/components/layout/Header'
import { Input } from '@/components/ui/input'

interface DirectoryEntry {
  clerkUserId: string; name: string; email: string; phone: string
  photo: string; department: string; designation: string
  employeeId: string; role: string; joiningDate: string | null
}

const AVATAR_GRADIENTS = ['from-brand-400 to-brand-600','from-purple-400 to-violet-600','from-orange-400 to-red-500','from-emerald-400 to-green-600','from-pink-400 to-rose-500','from-cyan-400 to-teal-600']
const avatarGradient = (n: string) => AVATAR_GRADIENTS[n.charCodeAt(0) % AVATAR_GRADIENTS.length]

const ROLE_BADGE: Record<string, string> = {
  boss:     'bg-amber-100 text-amber-700',
  manager:  'bg-brand-100 text-brand-700',
  employee: 'bg-gray-100 text-gray-600',
}

export default function DirectoryPage() {
  const [entries, setEntries] = useState<DirectoryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [query,   setQuery]   = useState('')
  const [deptFilter, setDeptFilter] = useState('')

  useEffect(() => {
    fetch('/api/employees/directory')
      .then(r => r.json())
      .then(d => { setEntries(Array.isArray(d) ? d : []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  const depts = Array.from(new Set(entries.map(e => e.department).filter(Boolean)))

  const displayed = entries.filter(e => {
    const q = query.toLowerCase()
    const matchQ = !q || e.name.toLowerCase().includes(q) || e.department.toLowerCase().includes(q) || e.designation.toLowerCase().includes(q) || e.email.toLowerCase().includes(q)
    const matchD = !deptFilter || e.department === deptFilter
    return matchQ && matchD
  })

  // Group by department
  const grouped: Record<string, DirectoryEntry[]> = {}
  displayed.forEach(e => {
    const d = e.department || 'General'
    if (!grouped[d]) grouped[d] = []
    grouped[d].push(e)
  })

  return (
    <>
      <Header title="Employee Directory" />
      <main className="flex-1 p-5 lg:p-8 xl:px-12 space-y-5 w-full bg-surface-2">

        {/* Hero */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 p-6 text-white">
          <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/10 pointer-events-none" />
          <Users className="w-6 h-6 text-brand-200 mb-2" />
          <h2 className="text-xl font-extrabold">Employee Directory</h2>
          <p className="text-brand-200 text-sm mt-1">{entries.length} team members across {depts.length} departments</p>
        </div>

        {/* Search + dept filter */}
        <div className="flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-muted pointer-events-none" />
            <Input placeholder="Search by name, role, department…" value={query} onChange={e => setQuery(e.target.value)} className="pl-9 rounded-xl" />
          </div>
          <div className="flex gap-2 flex-wrap">
            <button type="button" onClick={() => setDeptFilter('')}
              className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${!deptFilter?'bg-brand-500 text-white':'bg-white border border-surface-border text-gray-600 hover:border-brand-400'}`}>
              All Depts
            </button>
            {depts.map(d => (
              <button key={d} type="button" onClick={() => setDeptFilter(deptFilter===d?'':d)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-all ${deptFilter===d?'bg-brand-500 text-white':'bg-white border border-surface-border text-gray-600 hover:border-brand-400'}`}>
                {d}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {[...Array(6)].map((_,i) => <div key={i} className="h-20 rounded-2xl bg-surface-border animate-pulse" />)}
          </div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center py-20 text-center">
            <Users className="w-12 h-12 text-brand-200 mb-3" />
            <p className="font-bold text-gray-900">No results found</p>
          </div>
        ) : (
          <div className="space-y-6">
            {Object.entries(grouped).sort(([a],[b])=>a.localeCompare(b)).map(([dept, members]) => (
              <div key={dept}>
                <div className="flex items-center gap-2 mb-3">
                  <Building2 className="w-4 h-4 text-brand-500" />
                  <p className="text-sm font-extrabold text-gray-900">{dept}</p>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand-100 text-brand-700">{members.length}</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {members.map(e => {
                    const grad    = avatarGradient(e.name)
                    const initials = e.name.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2)
                    return (
                      <div key={e.clerkUserId} className="bg-white rounded-2xl border border-surface-border p-4 hover:shadow-md transition-shadow flex items-center gap-3">
                        <div className={`w-12 h-12 rounded-2xl bg-gradient-to-br ${grad} flex items-center justify-center flex-shrink-0`}>
                          {e.photo
                            ? <img src={e.photo} alt={e.name} className="w-12 h-12 rounded-2xl object-cover" />
                            : <span className="text-white font-bold text-sm">{initials}</span>}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-bold text-gray-900 truncate">{e.name}</p>
                            <span className={`text-[9px] font-bold px-1.5 py-0 rounded-full capitalize ${ROLE_BADGE[e.role]||ROLE_BADGE.employee}`}>{e.role}</span>
                          </div>
                          {e.designation && <p className="text-xs text-surface-muted truncate">{e.designation}</p>}
                          {e.employeeId && <p className="text-[10px] font-mono text-surface-muted">{e.employeeId}</p>}
                          <div className="flex gap-3 mt-1.5 flex-wrap">
                            {e.email && (
                              <a href={`mailto:${e.email}`} className="flex items-center gap-1 text-[10px] text-brand-600 hover:text-brand-700 hover:underline">
                                <Mail className="w-3 h-3" />{e.email}
                              </a>
                            )}
                            {e.phone && (
                              <a href={`tel:${e.phone}`} className="flex items-center gap-1 text-[10px] text-gray-600 hover:text-gray-800">
                                <Phone className="w-3 h-3" />{e.phone}
                              </a>
                            )}
                          </div>
                          {e.joiningDate && (
                            <p className="flex items-center gap-1 text-[9px] text-surface-muted mt-1">
                              <CalendarDays className="w-2.5 h-2.5" />
                              Joined {new Date(e.joiningDate).toLocaleDateString('en-IN',{month:'short',year:'numeric'})}
                            </p>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </>
  )
}
