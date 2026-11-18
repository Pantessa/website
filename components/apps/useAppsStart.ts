'use client'

// The first-run screen's state, shared by the desktop page and the phone
// (rules: lib/apps-start). The wallet read is lib/held-read, the one the
// watchlist rail uses, so a page still makes one read per wallet per window.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { startHiddenKey, startPhase, startRows, startSuggestions, START_HEADLINE } from '@/lib/apps-start'
import { arrivalPhrase } from '@/lib/funding-arrival'
import { HELD_EVERY_MS, peekHeld, readHeld, type HeldRead } from '@/lib/held-read'
import { useCardFund } from '@/lib/use-card-fund'
import type { McpServer } from '@/lib/store'

function loadHidden(address: string): boolean {
  try {
    return window.localStorage.getItem(startHiddenKey(address)) === '1'
  } catch {
    return false
  }
}

export function useAppsStart(p: { address: string; servers: McpServer[]; active: McpServer[]; ready: boolean; totalUsd: number | null; needs: number }) {
  const { address, servers, active, ready, totalUsd, needs } = p
  const [read, setRead] = useState<HeldRead | null | undefined>(() => peekHeld(address) ?? undefined)
  const [hidden, setHidden] = useState(() => loadHidden(address))

  useEffect(() => {
    setRead(peekHeld(address) ?? undefined)
    setHidden(loadHidden(address))
    let live = true
    void readHeld(address).then((r) => {
      if (live) setRead(r)
    })
    return () => {
      live = false
    }
  }, [address])

  // Money sent straight to the address has no purchase to watch, so an empty
  // wallet keeps being read while the page is on screen.
  const empty = read?.empty === true
  useEffect(() => {
    if (!empty) return
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      void readHeld(address, HELD_EVERY_MS - 1_000).then((r) => {
        if (r) setRead(r)
      })
    }, HELD_EVERY_MS)
    return () => clearInterval(t)
  }, [empty, address])

  const recheck = useCallback(() => {
    void readHeld(address, 0, true).then((r) => {
      if (r) setRead(r)
    })
  }, [address])

  const fund = useCardFund({ holder: address, empty, cardFunding: read?.cardFunding === true, onLanded: recheck })
  const rows = useMemo(() => startRows(servers), [servers])
  const activeSlugs = useMemo(() => active.map((s) => s.slug), [active])
  const suggestions = useMemo(() => startSuggestions(rows, activeSlugs), [rows, activeSlugs])
  const phase = startPhase({ read, ready: ready || active.length === 0, totalUsd, needs, hidden, landed: !!fund.landed })

  const hide = () => {
    setHidden(true)
    fund.dismissLanded()
    try {
      window.localStorage.setItem(startHiddenKey(address), '1')
    } catch {
      // Private mode: hidden until the page reloads.
    }
  }

  const headline = fund.landed ? `${arrivalPhrase(fund.landed.arrival, fund.landed.stableSymbol)} landed.` : START_HEADLINE
  return { phase, headline, rows, suggestions, fund, hide, canHide: !fund.landed }
}

export type AppsStartState = ReturnType<typeof useAppsStart>
