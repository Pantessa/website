'use client'

// ─────────────────────────────────────────────────────────────────────────
//  Live poll + pill — the "watchable" primitive for the ten-strangers drill:
//  Nate keeps /dashboard/failures and the link funnel open while a recruit
//  signs, so those views must refresh on their own. One hook, one pill:
//  useLivePoll re-runs a loader every `everyMs` while the tab is VISIBLE
//  (pauses hidden, refires on return), and LivePill renders
//  "live · updated Xs ago" off the last-success stamp. Lightweight by design
//  — 20–30s cadence, no websockets, nothing new to deploy.
// ─────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react'

export function useLivePoll(load: () => void | Promise<unknown>, everyMs: number, enabled = true) {
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const loadRef = useRef(load)
  loadRef.current = load

  useEffect(() => {
    if (!enabled) return
    let timer: ReturnType<typeof setInterval> | null = null
    const tick = async () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
      try {
        await loadRef.current()
        setUpdatedAt(Date.now())
      } catch {
        /* the loader owns its own error state */
      }
    }
    const start = () => {
      if (timer) return
      timer = setInterval(() => void tick(), everyMs)
    }
    const stop = () => {
      if (timer) clearInterval(timer)
      timer = null
    }
    const onVis = () => {
      if (document.visibilityState === 'visible') {
        void tick()
        start()
      } else stop()
    }
    // First stamp = now (the caller already loaded once on mount).
    setUpdatedAt(Date.now())
    start()
    document.addEventListener('visibilitychange', onVis)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [everyMs, enabled])

  return { updatedAt, markUpdated: () => setUpdatedAt(Date.now()) }
}

/** "live · updated 12s ago" — re-renders itself every second; muted mono. */
export function LivePill({ updatedAt, className = '' }: { updatedAt: number | null; className?: string }) {
  const [, force] = useState(0)
  useEffect(() => {
    const t = setInterval(() => force((n) => n + 1), 1000)
    return () => clearInterval(t)
  }, [])
  const ago = updatedAt ? Math.max(0, Math.round((Date.now() - updatedAt) / 1000)) : null
  const label = ago == null ? 'live' : ago < 2 ? 'live · just now' : ago < 60 ? `live · updated ${ago}s ago` : `live · updated ${Math.round(ago / 60)}m ago`
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] px-2 py-0.5 mono text-[10px] uppercase tracking-wider text-[color:var(--muted-2)] whitespace-nowrap ${className}`}
      title="This view refreshes itself while the tab is visible"
      data-live-pill
    >
      <span className="inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--accent)] animate-pulse" aria-hidden />
      {label}
    </span>
  )
}
