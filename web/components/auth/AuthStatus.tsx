import React from 'react'
import { Illustration } from '@/components/ds'
import type { Art } from '@/components/ds'

/** Centered status block used inside AuthShell for dead-end/terminal states (invalid link, expired, restricted…). */
export default function AuthStatus({ art, title, message, children }: { art: Art; title: string; message: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center text-center">
      <Illustration art={art} size={96} />
      <h2 className="mt-4 text-ds-title-large text-ds-on-surface">{title}</h2>
      <p className="mt-2 text-ds-body-medium text-ds-on-surface-variant">{message}</p>
      {children && <div className="mt-6 flex w-full flex-col gap-2">{children}</div>}
    </div>
  )
}
