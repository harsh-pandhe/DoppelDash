'use client'
import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Keyboard, X } from 'lucide-react'

interface Shortcut { keys: string[]; label: string }
interface Group { title: string; items: Shortcut[] }

const GROUPS: Group[] = [
  { title: 'Navigation', items: [
    { keys: ['⌘','K'], label: 'Open global search' },
    { keys: ['G','D'], label: 'Go to Dashboard' },
    { keys: ['G','C'], label: 'Go to Contacts' },
    { keys: ['G','L'], label: 'Go to Leave' },
    { keys: ['G','E'], label: 'Go to Expenses' },
    { keys: ['G','T'], label: 'Go to Travel' },
    { keys: ['G','A'], label: 'Go to Announcements' },
  ]},
  { title: 'Actions', items: [
    { keys: ['?'],   label: 'Show this shortcuts panel' },
    { keys: ['Esc'], label: 'Close dialogs / popovers' },
  ]},
]

const ROUTES: Record<string, string> = {
  d: '/dashboard', c: '/crm', l: '/lms', e: '/rms', t: '/travel', a: '/announcements',
}

export default function ShortcutsPanel() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let lastG = 0
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const inInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable
      if (inInput) return

      if (e.key === '?') { e.preventDefault(); setOpen(true); return }
      if (e.key === 'g' || e.key === 'G') { lastG = Date.now(); return }
      if (Date.now() - lastG < 1500 && ROUTES[e.key.toLowerCase()]) {
        e.preventDefault()
        window.location.href = ROUTES[e.key.toLowerCase()]
        lastG = 0
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-y-auto">
          <div className="sticky top-0 bg-white border-b border-surface-border px-5 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center">
                <Keyboard className="w-4 h-4 text-white" />
              </div>
              <div>
                <Dialog.Title className="text-base font-bold text-gray-900">Keyboard Shortcuts</Dialog.Title>
                <Dialog.Description className="text-xs text-surface-muted">Get around faster.</Dialog.Description>
              </div>
            </div>
            <Dialog.Close asChild>
              <button type="button" aria-label="Close" className="p-1.5 rounded-lg hover:bg-surface text-surface-muted">
                <X className="w-4 h-4" />
              </button>
            </Dialog.Close>
          </div>

          <div className="p-5 space-y-5">
            {GROUPS.map(g => (
              <div key={g.title}>
                <p className="text-[10px] font-bold uppercase tracking-widest text-surface-muted mb-2">{g.title}</p>
                <div className="space-y-1">
                  {g.items.map((s, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-surface/50 transition-colors">
                      <span className="text-sm text-gray-700">{s.label}</span>
                      <div className="flex gap-1">
                        {s.keys.map((k, j) => (
                          <kbd key={j} className="px-2 py-0.5 text-[10px] font-mono font-bold bg-surface border border-surface-border text-gray-700 rounded shadow-sm">{k}</kbd>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <p className="text-[10px] text-surface-muted text-center pt-2">
              Press <kbd className="px-1.5 py-0.5 text-[9px] font-mono font-bold bg-surface border border-surface-border rounded">?</kbd> anytime to reopen this
            </p>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
