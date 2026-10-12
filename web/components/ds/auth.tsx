'use client'

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Circle } from 'lucide-react'
import { cn } from '@/lib/ds/cn'
import { passwordRuleState, PASSWORD_MAX, PASSWORD_MIN } from '@/lib/auth/passwordRules'
import { Icon } from './icon'
import { BrandLogo } from './shell'

/**
 * Centered authentication frame for the internal Doppelmayr portal: brand header, one focused card, a quiet footer.
 * No marketing panel, no 3D scene. A single faint cable line is the only decoration.
 */
export function AuthShell({ title, description, children, footer, className }: { title: string; description?: string; children: React.ReactNode; footer?: React.ReactNode; className?: string }) {
  return (
    <div className="relative flex min-h-screen flex-col bg-ds-page text-ds-on-surface">
      <svg aria-hidden className="ds-auth-line pointer-events-none absolute inset-x-0 top-0 h-48 w-full" viewBox="0 0 1200 190" preserveAspectRatio="none" fill="none">
        <path d="M-20 38 C 300 120, 900 120, 1220 28" stroke="currentColor" strokeWidth="1.5" opacity=".7" />
      </svg>
      <header className="relative z-10 flex h-16 items-center px-5 sm:px-8"><BrandLogo size={40} /></header>
      <main className="relative z-10 flex flex-1 items-start justify-center px-4 pb-10 pt-6 sm:items-center sm:pt-0">
        <div className={cn('w-full max-w-[440px]', className)}>
          <div className="rounded-ds-xl border border-ds-outline-variant/80 bg-ds-card p-6 shadow-ds-1 sm:p-8">
            <h1 className="text-ds-headline-small text-ds-on-surface">{title}</h1>
            {description && <p className="mt-2 text-ds-body-medium text-ds-on-surface-variant">{description}</p>}
            <div className="mt-6">{children}</div>
          </div>
          {footer && <div className="mt-5 text-center text-ds-body-small text-ds-on-surface-variant">{footer}</div>}
        </div>
      </main>
      <footer className="relative z-10 flex flex-wrap items-center justify-center gap-x-5 gap-y-1 px-4 pb-6 text-ds-body-small text-ds-on-surface-variant">
        <span>Doppelmayr India · Employee workspace</span>
        <a className="rounded-ds-xs underline-offset-2 hover:underline" href="/privacy">Privacy</a>
        <a className="rounded-ds-xs underline-offset-2 hover:underline" href="/terms">Terms</a>
        <a className="rounded-ds-xs underline-offset-2 hover:underline" href="/support">Support</a>
      </footer>
    </div>
  )
}

/** Wraps one step of a multi-step flow; a new `stepKey` plays a short directional slide + fade (reduced motion: fade). */
export function StepTransition({ stepKey, direction = 'forward', children, className }: { stepKey: string; direction?: 'forward' | 'back'; children: React.ReactNode; className?: string }) {
  return <div key={stepKey} className={cn(direction === 'forward' ? 'ds-anim-slide-right' : 'ds-anim-slide-left', className)} data-step={stepKey}>{children}</div>
}

/** Six-digit one-time-code input: auto-advance, paste, backspace/arrow navigation, one-time-code autofill. */
export function OtpInput({ value, onChange, onComplete, length = 6, disabled, error, label = 'Verification code', autoFocus }: { value: string; onChange: (v: string) => void; onComplete?: (v: string) => void; length?: number; disabled?: boolean; error?: boolean; label?: string; autoFocus?: boolean }) {
  const refs = useRef<(HTMLInputElement | null)[]>([])
  const digits = Array.from({ length }, (_, i) => value[i] ?? '')
  const focus = (i: number) => refs.current[Math.max(0, Math.min(length - 1, i))]?.focus()
  useEffect(() => { if (autoFocus) focus(0) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [autoFocus])
  const commit = (next: string) => { onChange(next); if (next.length === length) onComplete?.(next) }
  const groupId = React.useId()
  return (
    <div role="group" aria-labelledby={groupId} className="flex flex-col gap-2">
      <span id={groupId} className="ds-sr-only">{label}</span>
      <div className="flex justify-between gap-2">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={el => { refs.current[i] = el }}
            value={d}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            maxLength={1}
            disabled={disabled}
            aria-label={`${label}, digit ${i + 1} of ${length}`}
            aria-invalid={error || undefined}
            onFocus={e => e.currentTarget.select()}
            onChange={e => {
              const c = e.target.value.replace(/\D/g, '').slice(-1)
              const next = (value.slice(0, i) + c + value.slice(i + 1)).slice(0, length)
              if (!c) { commit(value.slice(0, i) + value.slice(i + 1)); return }
              commit(next); focus(i + 1)
            }}
            onKeyDown={e => {
              if (e.key === 'Backspace' && !d && i > 0) { e.preventDefault(); commit(value.slice(0, i - 1)); focus(i - 1) }
              else if (e.key === 'ArrowLeft') { e.preventDefault(); focus(i - 1) }
              else if (e.key === 'ArrowRight') { e.preventDefault(); focus(i + 1) }
            }}
            onPaste={e => {
              const t = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length)
              if (!t) return
              e.preventDefault(); commit(t); focus(t.length >= length ? length - 1 : t.length)
            }}
            className={cn('h-14 w-full min-w-0 rounded-ds-input border bg-ds-card text-center text-ds-headline-small ds-tabular text-ds-on-surface transition-colors duration-ds-fast focus:border-ds-primary disabled:opacity-[0.38]', error ? 'border-ds-error' : 'border-ds-outline-variant hover:border-ds-outline')}
          />
        ))}
      </div>
    </div>
  )
}

/** Seconds counting down to 0 (UI-only pacing for "resend"). `restart()` begins again. */
export function useCountdown(seconds: number) {
  const [left, setLeft] = useState(seconds)
  useEffect(() => {
    if (left <= 0) return
    const t = setTimeout(() => setLeft(l => l - 1), 1000)
    return () => clearTimeout(t)
  }, [left])
  const restart = useCallback(() => setLeft(seconds), [seconds])
  return { left, restart, label: `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` }
}

/** The password contract exactly as the API enforces it, with live state shown by icon AND text (never colour alone). */
export function PasswordRules({ password, confirm }: { password: string; confirm?: string }) {
  const s = passwordRuleState(password, confirm)
  const Item = ({ ok, children }: { ok: boolean; children: React.ReactNode }) => (
    <li className={cn('flex items-center gap-2 text-ds-body-small', ok ? 'text-ds-success' : 'text-ds-on-surface-variant')}>
      <Icon icon={ok ? Check : Circle} size="xs" />
      <span>{children}<span className="ds-sr-only">{ok ? ' — met' : ' — not met yet'}</span></span>
    </li>
  )
  return (
    <ul aria-label="Password requirements" className="space-y-1">
      <Item ok={s.length}>{PASSWORD_MIN}–{PASSWORD_MAX} characters</Item>
      {confirm !== undefined && <Item ok={s.match && password.length > 0}>Both entries match</Item>}
    </ul>
  )
}
