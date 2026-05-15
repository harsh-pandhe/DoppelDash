'use client'
import { useEffect, useRef } from 'react'

/**
 * Persist form state to localStorage. Restores on mount.
 * Call clear() after successful submit to wipe draft.
 *
 * Usage:
 *   const [form, setForm] = useState(EMPTY)
 *   const draft = useFormAutosave('rms-new-expense', form, setForm)
 *   // on submit success: draft.clear()
 */
export function useFormAutosave<T>(
  key:    string,
  state:  T,
  setState: (v: T) => void,
  opts:   { debounceMs?: number; restoreOnMount?: boolean } = {}
): { clear: () => void; restored: boolean } {
  const { debounceMs = 600, restoreOnMount = true } = opts
  const restoredRef = useRef(false)
  const tRef        = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fullKey     = `dd_draft_${key}`

  // Restore once on mount
  useEffect(() => {
    if (!restoreOnMount || restoredRef.current) return
    try {
      const raw = localStorage.getItem(fullKey)
      if (raw) setState(JSON.parse(raw))
    } catch { /* ignore */ }
    restoredRef.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Save (debounced)
  useEffect(() => {
    if (!restoredRef.current) return
    if (tRef.current) clearTimeout(tRef.current)
    tRef.current = setTimeout(() => {
      try { localStorage.setItem(fullKey, JSON.stringify(state)) } catch { /* quota */ }
    }, debounceMs)
    return () => { if (tRef.current) clearTimeout(tRef.current) }
  }, [state, debounceMs, fullKey])

  const clear = () => {
    try { localStorage.removeItem(fullKey) } catch { /* ignore */ }
  }
  return { clear, restored: restoredRef.current }
}
