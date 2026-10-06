'use client'

// THE SPINE'S UNSEEN-DOT (squad front-door, 2026-10-06, Nate: "pulls the
// user to see jobs, links, wallet as they go"). A 6px accent dot at the
// top-right of the JOBS, LINKS and WALLET seats — both postures — until each
// place has been visited once (lib/guide dotFor). Never on MARKETS, CHATS,
// DOCS or SETTINGS; gone once "Don't show tips" is on.
//
// The dot is also the one that notices the visit for the two DRAWER places
// (JOBS and LINKS are tabs of /chat, not pages): the desktop drawer open on
// that tab, or the phone screen showing it, counts. The wallet page's own
// seat records its visit. Nothing here reads a click; it reads the store
// AppSpine already writes.
//
// Rendered inside the seat's button/link (AppSpine owns the one line each),
// so it never changes a seat's hit area or accessible name. GUIDE lane owns
// this file.

import { useEffect } from 'react'
import { dotFor, noteGuideEvent, type GuideDotTab } from '@/lib/guide'
import { useYeetfulStore } from '@/lib/store'
import { useHydrated } from '@/lib/use-hydrated'
import { useGuideState } from './use-guide-state'
import './guide.css'

const TITLE: Record<GuideDotTab, string> = {
  jobs: 'New here: your running jobs',
  links: 'New here: links that pay you',
  wallet: 'New here: one window for every chain',
}

export default function SpineGuideDot({ tab }: { tab: GuideDotTab }) {
  const hydrated = useHydrated()
  const state = useGuideState()
  const railTab = useYeetfulStore((s) => s.railTab)
  const railOpen = useYeetfulStore((s) => s.mcpRailOpen)
  const phoneScreen = useYeetfulStore((s) => s.phoneScreen)

  // The drawer places: showing = visited.
  const showing = tab !== 'wallet' && ((railTab === tab && railOpen) || phoneScreen === tab)
  useEffect(() => {
    if (hydrated && showing) noteGuideEvent(`visited:${tab as 'jobs' | 'links'}`)
  }, [hydrated, showing, tab])

  if (!hydrated || !dotFor(tab, state)) return null
  return <span className="guide-dot" data-guide-dot={tab} title={TITLE[tab]} aria-hidden />
}
