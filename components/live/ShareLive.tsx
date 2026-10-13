'use client'

// SHARE THIS FIGHT (GTM squad 2026-10-13, lane CARD fills this file). Copies
// the URL that carries the pick (`?t=`, the view, the window) — a card with
// live standings unfurls from it (app/api/og/live) — and uses navigator.share
// on a phone. Mounted (one line each, the coordinator's seats) in /live's
// view bar and the deck's bar. Renders nothing until CARD lands.

import type { LiveView } from '@/lib/battle'

export interface ShareLiveProps {
  view: LiveView
  /** The deck's bar or /live's strip. */
  seat: 'live' | 'deck'
  /** The pick to carry; the seat reads it from lib/use-market-pick when omitted. */
  markets?: readonly string[]
}

export default function ShareLive(_props: ShareLiveProps) {
  return null
}
