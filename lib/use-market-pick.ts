'use client'

// THE ONE PICK, in the browser (GTM squad 2026-10-13, lane PICK fills this
// file; the names are the contract the other lanes compile against — keep
// every export's shape, change its body). lib/market-pick holds the pure
// rules. One store per page: the deck switches channels and /live switches
// views, so every mounted surface reads the same list and the same lens.
//
// Contract:
//   markets  — the pick, in the hand's order (venue spellings)
//   source   — where it came from this visit (lib/market-pick PickSource)
//   lens     — the tape's single-market lens (must be a pick, else null)
//   universe — the venue's market list the page knows (for resolving a typed name)
//   add(raw) — several at once; returns lib/battle's OwnAdd (added / unknown / full)
//   remove(market), set(markets, by)  — by: 'hand' writes the memory; a default never does
//   setLens(market|null)
//   seat     — 'page' mirrors ?t= into the URL; 'stage' (the deck) reads none of it
//
// Until PICK lands, this returns the fallback trio and no-ops, so ARENA /
// ALERTS / CARD mount against it from minute one.

import { useCallback, useMemo, useState } from 'react'
import { FALLBACK_ARMIES, type OwnAdd } from '@/lib/battle'
import { addToPick, lensFor, removeFromPick, type PickSource } from '@/lib/market-pick'

export type PickSeat = 'page' | 'stage'

export interface MarketPickState {
  markets: string[]
  source: PickSource
  lens: string | null
  universe: string[]
  add: (raw: string) => OwnAdd
  remove: (market: string) => void
  set: (markets: readonly string[], by: 'hand' | PickSource) => void
  setLens: (market: string | null) => void
}

export function useMarketPick(_opts: { seat?: PickSeat } = {}): MarketPickState {
  // STUB (coordinator, R0): local state only, no memory, no URL, no watchlist.
  const [markets, setMarkets] = useState<string[]>(() => [...FALLBACK_ARMIES])
  const [source, setSource] = useState<PickSource>('fallback')
  const [lensRaw, setLensRaw] = useState<string | null>(null)
  const universe = useMemo<string[]>(() => [], [])
  const add = useCallback((raw: string): OwnAdd => {
    const r = addToPick(raw, markets, markets)
    if (r.added.length) {
      setMarkets((m) => [...m, ...r.added])
      setSource('hand')
    }
    return r
  }, [markets])
  const remove = useCallback((market: string) => {
    setMarkets((m) => removeFromPick(m, market))
    setSource('hand')
  }, [])
  const set = useCallback((next: readonly string[], by: 'hand' | PickSource) => {
    setMarkets([...next])
    setSource(by)
  }, [])
  const setLens = useCallback((m: string | null) => setLensRaw(m), [])
  return { markets, source, lens: lensFor(lensRaw, markets), universe, add, remove, set, setLens }
}
