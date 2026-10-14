'use client'

// THE ONE PICK'S READS — one subscriber per page (2026-10-13, after the GTM
// squad's QA FINAL: every `useMarketPick()` instance ran
// `useWatchlists({ holdings: false })` + `useHeld()`, so a signed-in visitor
// made six GET /api/watchlists on `/` and two on /live — one per instance).
// Hooks can't be conditional, so the two reads live in this component,
// mounted ONCE per page (the deck on `/`, /live's surface) and published
// into the store (lib/use-market-pick publishPickReads); every surface reads
// the store, and the store decides the opening.
//
// Belt: a seat. Should two ever mount at once, the first holds the reads and
// the second waits its turn (it takes the seat when the first unmounts), so a
// page never has two subscribers — never two reads. Nothing is rendered: the
// server frame and the first client paint are untouched.

import { useEffect, useMemo, useState } from 'react'
import { useWatchlists } from '@/components/markets/watchlist/useWatchlists'
import { useHeld } from '@/lib/use-held'
import { useSession } from '@/lib/session'
import { publishPickReads } from '@/lib/use-market-pick'

let seated: symbol | null = null
const waiting: { token: symbol; take: () => void }[] = []

/** Take the seat now, or when it frees; returns the release. */
function claimSeat(token: symbol, take: () => void): () => void {
  if (seated === null) {
    seated = token
    take()
  } else waiting.push({ token, take })
  return () => {
    if (seated === token) {
      seated = null
      const next = waiting.shift()
      if (next) {
        seated = next.token
        next.take()
      }
    } else {
      const i = waiting.findIndex((w) => w.token === token)
      if (i >= 0) waiting.splice(i, 1)
    }
  }
}

export default function PickReads() {
  const [owns, setOwns] = useState(false)
  useEffect(() => claimSeat(Symbol('pick-reads'), () => setOwns(true)), [])
  return owns ? <PickReadsSubscriber /> : null
}

function PickReadsSubscriber() {
  const { signedOut } = useSession()
  // The wallet's holdings: the shared read (lib/held-read) — one per wallet per minute, page-wide.
  const held = useHeld()
  // The watchlist as a second instance: the lists only (where a rail is beside
  // it, the rail is the page's holdings reader and reconciler).
  const wl = useWatchlists({ holdings: false })
  const watchSymbols = useMemo(() => {
    if (!wl.ready) return [] as string[]
    const activeId = (wl.active as { id?: string } | null)?.id
    const ordered = [...wl.lists].sort((a, b) => (a.id === activeId ? -1 : b.id === activeId ? 1 : 0))
    const out: string[] = []
    for (const l of ordered) for (const sym of l.symbols) if (!out.includes(sym)) out.push(sym)
    return out
  }, [wl.ready, wl.lists, wl.active])
  useEffect(() => publishPickReads({ watchSymbols, held, signedOut }), [watchSymbols, held, signedOut])
  return null
}
