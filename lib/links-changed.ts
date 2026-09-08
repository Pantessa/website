'use client'

// One signal for "the creator's links just changed" — a mint, a revoke, a
// claim. The studio (main screen) and the rail (JourneyStrip + the live
// list) each own their OWN copy of the links + journey state, so a mint on
// one surface used to leave the other reading stale until its next 30s poll
// (the rail's "First link → first payout 0/3 · Mint your first link" strip
// sat unchanged right after the studio minted — squad gtm 2026-09-08, L-4).
// Every writer calls notifyLinksChanged(); every reader subscribes.

import { useEffect } from 'react'

export const LINKS_CHANGED_EVENT = 'yf:links-changed'

export function notifyLinksChanged(): void {
  if (typeof window === 'undefined') return
  try {
    window.dispatchEvent(new Event(LINKS_CHANGED_EVENT))
  } catch {
    /* ignore */
  }
}

/** Run `fn` whenever any surface reports a links change. */
export function useLinksChanged(fn: () => void): void {
  useEffect(() => {
    if (typeof window === 'undefined') return
    window.addEventListener(LINKS_CHANGED_EVENT, fn)
    return () => window.removeEventListener(LINKS_CHANGED_EVENT, fn)
  }, [fn])
}
