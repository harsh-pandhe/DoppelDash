'use client'
import { useEffect, useState } from 'react'

/**
 * Single shared notifications source. Previously Header polled /api/notifications
 * every 30s AND BottomNav polled it every 60s independently — both mounted at
 * once, so the HAR showed ~5 redundant fetches per session (2–6s each).
 *
 * This store keeps ONE in-flight fetch + ONE interval shared across every
 * subscriber, pauses polling while the tab is hidden, and caches the last
 * result so newly-mounted components render instantly instead of refetching.
 */
export interface NotifItem {
  id: string
  kind: string
  ts: string
  [k: string]: unknown
}

let items: NotifItem[] = []
let fetchedAt = 0
let inflight: Promise<void> | null = null
const subscribers = new Set<() => void>()
let pollId: ReturnType<typeof setInterval> | null = null
let visBound = false

const POLL_MS = 45_000
const FRESH_MS = 20_000

function emit() { subscribers.forEach((fn) => fn()) }

async function doFetch(): Promise<void> {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      const res = await fetch('/api/notifications')
      const data = await res.json()
      if (Array.isArray(data.items)) { items = data.items; fetchedAt = Date.now(); emit() }
    } catch { /* best-effort */ }
    finally { inflight = null }
  })()
  return inflight
}

function ensurePolling() {
  if (pollId) return
  pollId = setInterval(() => {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
    void doFetch()
  }, POLL_MS)
  if (!visBound && typeof document !== 'undefined') {
    visBound = true
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - fetchedAt > FRESH_MS) void doFetch()
    })
  }
}

function maybeStopPolling() {
  if (subscribers.size === 0 && pollId) { clearInterval(pollId); pollId = null }
}

/** Subscribe to the shared notifications list. */
export function useNotificationItems(): { items: NotifItem[]; refresh: () => Promise<void> } {
  const [, force] = useState(0)
  useEffect(() => {
    const cb = () => force((n) => n + 1)
    subscribers.add(cb)
    ensurePolling()
    // first mount of any subscriber → fetch if stale
    if (Date.now() - fetchedAt > FRESH_MS) void doFetch()
    return () => { subscribers.delete(cb); maybeStopPolling() }
  }, [])
  return { items, refresh: doFetch }
}

/** Force a refresh from outside the hook (e.g. after marking read). */
export function refreshNotifications() { return doFetch() }
