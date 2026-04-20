'use client'
import { useState, useEffect, useCallback } from 'react'
import { Plus, Search, Phone, Mail, Building2, Trash2, Pencil, Download, Tag, Users } from 'lucide-react'
import Link from 'next/link'
import * as Dialog from '@radix-ui/react-dialog'
import Header from '@/components/layout/Header'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { CardSkeleton } from '@/components/ui/skeleton'
import { useToast } from '@/components/ui/toast'

interface Contact {
  _id: string; name: string; email?: string; phone?: string
  company?: string; designation?: string; gender?: string; tags?: string[]
}

function DeleteDialog({ name, onConfirm }: { name: string; onConfirm: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="Delete contact"
          className="p-1.5 rounded-lg hover:bg-red-50 text-surface-muted hover:text-red-500 transition-colors"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/40 z-50" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm">
          <Dialog.Title className="text-base font-bold text-gray-900 mb-1">Delete Contact</Dialog.Title>
          <Dialog.Description className="text-sm text-surface-muted mb-5">
            Are you sure you want to delete <strong>{name}</strong>? This cannot be undone.
          </Dialog.Description>
          <div className="flex gap-3 justify-end">
            <Dialog.Close asChild>
              <Button type="button" variant="outline" size="sm">Cancel</Button>
            </Dialog.Close>
            <Button type="button" size="sm" className="bg-red-600 hover:bg-red-700"
              onClick={() => { onConfirm(); setOpen(false) }}>
              Delete
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

function exportCSV(contacts: Contact[]) {
  const headers = ['Name', 'Email', 'Phone', 'Company', 'Designation', 'Tags']
  const rows = contacts.map(c => [
    `"${c.name}"`, `"${c.email || ''}"`, `"${c.phone || ''}"`,
    `"${c.company || ''}"`, `"${c.designation || ''}"`,
    `"${(c.tags || []).join('; ')}"`,
  ])
  const csv  = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = `contacts-${Date.now()}.csv`; a.click()
  URL.revokeObjectURL(url)
}

export default function CRMPage() {
  const toast = useToast()
  const [contacts, setContacts] = useState<Contact[]>([])
  const [query,    setQuery]    = useState('')
  const [tagFilter,setTagFilter]= useState('')
  const [loading,  setLoading]  = useState(true)

  const fetchContacts = useCallback(async () => {
    setLoading(true)
    const res  = await fetch(`/api/crm?q=${encodeURIComponent(query)}`)
    const data = await res.json()
    setContacts(Array.isArray(data) ? data : [])
    setLoading(false)
  }, [query])

  useEffect(() => { fetchContacts() }, [fetchContacts])

  const deleteContact = async (id: string, name: string) => {
    await fetch(`/api/crm/${id}`, { method: 'DELETE' })
    setContacts(c => c.filter(x => x._id !== id))
    toast(`${name} deleted`, 'info')
  }

  // Collect all unique tags across contacts for filter chips
  const allTags = Array.from(new Set(contacts.flatMap(c => c.tags || [])))

  const displayed = tagFilter
    ? contacts.filter(c => c.tags?.includes(tagFilter))
    : contacts

  return (
    <>
      <Header title="CRM — Stakeholder Contacts" />
      <main className="flex-1 p-6 space-y-5">

        {/* Toolbar */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-muted pointer-events-none" />
            <Input placeholder="Search contacts…" value={query}
              onChange={e => setQuery(e.target.value)} className="pl-9" />
          </div>
          <div className="flex gap-2">
            {contacts.length > 0 && (
              <Button type="button" variant="outline" size="sm" className="gap-2" onClick={() => exportCSV(contacts)}>
                <Download className="w-4 h-4" /> Export
              </Button>
            )}
            <Link href="/crm/new">
              <Button className="gap-2"><Plus className="w-4 h-4" /> Add Contact</Button>
            </Link>
          </div>
        </div>

        {/* Tag filter chips */}
        {allTags.length > 0 && (
          <div className="flex items-center gap-2 flex-wrap">
            <Tag className="w-3.5 h-3.5 text-surface-muted flex-shrink-0" />
            <button type="button"
              onClick={() => setTagFilter('')}
              className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${!tagFilter ? 'bg-brand-500 text-white' : 'bg-white border border-surface-border text-gray-600 hover:border-brand-400'}`}>
              All
            </button>
            {allTags.map(tag => (
              <button type="button" key={tag}
                onClick={() => setTagFilter(tagFilter === tag ? '' : tag)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${tagFilter === tag ? 'bg-brand-500 text-white' : 'bg-white border border-surface-border text-gray-600 hover:border-brand-400'}`}>
                {tag}
              </button>
            ))}
          </div>
        )}

        {/* Count */}
        {!loading && contacts.length > 0 && (
          <p className="text-xs text-surface-muted">
            {displayed.length} contact{displayed.length !== 1 ? 's' : ''}{tagFilter ? ` tagged "${tagFilter}"` : ''}
          </p>
        )}

        {/* Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[...Array(6)].map((_, i) => <CardSkeleton key={i} />)}
          </div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-20 h-20 rounded-3xl bg-brand-50 flex items-center justify-center mb-5">
              <Users className="w-10 h-10 text-brand-300" />
            </div>
            <p className="font-bold text-gray-900 text-lg mb-1">
              {tagFilter ? `No contacts tagged "${tagFilter}"` : query ? 'No results found' : 'No contacts yet'}
            </p>
            <p className="text-sm text-surface-muted mb-5 max-w-xs">
              {tagFilter || query ? 'Try a different search or filter.' : 'Add your first stakeholder contact to get started.'}
            </p>
            {!tagFilter && !query && (
              <Link href="/crm/new"><Button size="sm" className="gap-2"><Plus className="w-4 h-4" />Add Contact</Button></Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {displayed.map(c => (
              <Card key={c._id} className="hover:shadow-md transition-shadow group">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center flex-shrink-0">
                      <span className="text-brand-700 font-bold text-sm">{c.name[0]?.toUpperCase()}</span>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Link href={`/crm/${c._id}`}>
                        <button type="button" aria-label="Edit contact"
                          className="p-1.5 rounded-lg hover:bg-brand-50 text-surface-muted hover:text-brand-600 transition-colors">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                      </Link>
                      <DeleteDialog name={c.name} onConfirm={() => deleteContact(c._id, c.name)} />
                    </div>
                  </div>
                  <p className="font-semibold text-gray-900 text-sm mb-0.5 truncate">{c.name}</p>
                  {c.designation && <p className="text-xs text-surface-muted truncate">{c.designation}</p>}
                  <div className="mt-3 space-y-1">
                    {c.company && (
                      <div className="flex items-center gap-1.5 text-xs text-gray-600">
                        <Building2 className="w-3 h-3 text-surface-muted flex-shrink-0" />{c.company}
                      </div>
                    )}
                    {c.email && (
                      <div className="flex items-center gap-1.5 text-xs text-gray-600">
                        <Mail className="w-3 h-3 text-surface-muted flex-shrink-0" />
                        <span className="truncate">{c.email}</span>
                      </div>
                    )}
                    {c.phone && (
                      <div className="flex items-center gap-1.5 text-xs text-gray-600">
                        <Phone className="w-3 h-3 text-surface-muted flex-shrink-0" />{c.phone}
                      </div>
                    )}
                  </div>
                  {c.tags && c.tags.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-3">
                      {c.tags.slice(0, 3).map(tag => (
                        <Badge key={tag} variant="secondary" className="text-[10px] px-1.5 py-0 cursor-pointer"
                          onClick={() => setTagFilter(tag)}>
                          {tag}
                        </Badge>
                      ))}
                      {c.tags.length > 3 && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0">+{c.tags.length - 3}</Badge>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </>
  )
}
