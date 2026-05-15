'use client'
import { useState, useEffect } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Sparkles, ChevronLeft, ChevronRight, Check, X, type LucideIcon, Users, CalendarClock, Receipt, Plane, Bell, Keyboard } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Step { icon: LucideIcon; title: string; body: string; emoji?: string }

const STEPS: Step[] = [
  { icon: Sparkles,       title: 'Welcome to DoppelDash',  body: "Your account is ready. Quick 30-second tour so you know where everything lives. Press Esc anytime to skip." },
  { icon: Users,          title: 'Contacts (CRM)',          body: "Find people in 3 views (card, list, table). Color-label hot leads, set sharing (private/team/org). Search with Cmd+K." },
  { icon: CalendarClock,  title: 'Leave',                   body: "Request casual / sick / earned / privilege / LWP. Half-day option included. Your manager approves." },
  { icon: Receipt,        title: 'Expenses',                body: "Log spends in Simple mode or Table mode (line items + per-row receipts). Upload bill — Gemini auto-fills." },
  { icon: Plane,          title: 'Travel Requests',         body: "Apply BEFORE the trip for advance approval. Privilege banner shows your limits (food, taxi tier, flight)." },
  { icon: Bell,           title: 'Notifications',           body: "Bell icon shows pending approvals (managers), returned expenses, urgent announcements, contact reminders." },
  { icon: Keyboard,       title: 'Pro tip — Shortcuts',     body: "Press ? to see all shortcuts. Cmd+K opens search. G+D jumps to dashboard, G+C to contacts, etc." },
]

const LS_KEY = 'dd_welcome_tour_seen_v1'

export default function WelcomeTour() {
  const [open, setOpen] = useState(false)
  const [idx,  setIdx]  = useState(0)

  useEffect(() => {
    if (typeof window === 'undefined') return
    const seen = localStorage.getItem(LS_KEY)
    if (!seen) {
      // Small delay so it doesn't pop instantly
      const t = setTimeout(() => setOpen(true), 800)
      return () => clearTimeout(t)
    }
  }, [])

  const close = () => {
    localStorage.setItem(LS_KEY, '1')
    setOpen(false)
  }

  const Cur = STEPS[idx]
  const Icon = Cur.icon
  const isFirst = idx === 0
  const isLast  = idx === STEPS.length - 1

  return (
    <Dialog.Root open={open} onOpenChange={o => { if (!o) close() }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/55 backdrop-blur-sm z-50" />
        <Dialog.Content className="fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-white rounded-3xl shadow-2xl overflow-hidden">

          <Dialog.Title className="sr-only">{Cur.title}</Dialog.Title>
          <Dialog.Description className="sr-only">{Cur.body}</Dialog.Description>

          {/* Header */}
          <div className="bg-gradient-to-br from-brand-500 via-brand-600 to-purple-700 px-7 pt-7 pb-6 text-white relative">
            <button type="button" onClick={close} aria-label="Skip tour"
              className="absolute top-4 right-4 p-1.5 rounded-lg hover:bg-white/15 transition-colors">
              <X className="w-4 h-4" />
            </button>
            <div className="w-14 h-14 rounded-2xl bg-white/15 backdrop-blur flex items-center justify-center mb-4">
              <Icon className="w-7 h-7" />
            </div>
            <h2 className="text-xl font-extrabold leading-tight">{Cur.title}</h2>
          </div>

          {/* Body */}
          <div className="p-7 space-y-5">
            <p className="text-sm text-gray-700 leading-relaxed">{Cur.body}</p>

            {/* Step dots */}
            <div className="flex justify-center gap-1.5">
              {STEPS.map((_, i) => (
                <button key={i} type="button" onClick={() => setIdx(i)} aria-label={`Go to step ${i+1}`}
                  className={`h-1.5 rounded-full transition-all ${i === idx ? 'w-6 bg-brand-500' : i < idx ? 'w-1.5 bg-brand-300' : 'w-1.5 bg-surface-border'}`} />
              ))}
            </div>

            {/* Nav */}
            <div className="flex items-center gap-2">
              {!isFirst && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setIdx(i => i - 1)}>
                  <ChevronLeft className="w-3.5 h-3.5" /> Back
                </Button>
              )}
              <button type="button" onClick={close} className="text-xs font-semibold text-surface-muted hover:text-gray-700 px-2">
                Skip
              </button>
              <div className="ml-auto">
                {isLast ? (
                  <Button size="sm" className="gap-1.5" onClick={close}>
                    <Check className="w-3.5 h-3.5" /> Got it
                  </Button>
                ) : (
                  <Button size="sm" className="gap-1.5" onClick={() => setIdx(i => i + 1)}>
                    Next <ChevronRight className="w-3.5 h-3.5" />
                  </Button>
                )}
              </div>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
