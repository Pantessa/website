'use client'

// THE ONE PICK, in the browser (GTM squad 2026-10-13, lane PICK). lib/market-pick
// holds the pure rules; this file is the store every live surface on a page
// reads — the deck's four channels, /live's four views, the share card, the
// picker sheet. One zustand store per page load: the deck switches channels
// and /live switches views, and every mounted surface reads the same list
// and the same lens.
//
// Contract (the other lanes compile against these names — keep the shapes):
//   markets  — the pick, in the hand's order (venue spellings)
//   source   — where it came from this visit (lib/market-pick PickSource)
//   lens     — the tape's single-market lens (must be a pick, else null)
//   universe — the venue's market list the page knows (for resolving a typed name)
//   add(raw) — several at once; returns lib/battle's OwnAdd (added / unknown / full)
//   remove(market), set(markets, by)  — by: 'hand' writes the memory; a default never does
//   setLens(market|null)
//   ready    — the opening has painted (false on the server and until the first read decides)
//   seat     — 'page' reads `?t=` / `?m=` and mirrors them into /live's URL;
//              'stage' (the deck, the default) reads none of it — `/?t=` is nobody's
//
// The opening runs once per page load and settles as the reads land
// (lib/market-pick openingPick for the order, replacesPick for which later
// read may replace a painted default): `?t=` (page seat) → this browser's
// memory (the two old memories carried over once) → the watchlist → the
// wallet's holdings (held ≤4s while a wallet may still answer — Battle's
// rule) → the venue's top gainers → the fallback trio (after 6s). ONLY a
// hand writes the memory; another tab's hand arrives through `storage`.

import { useCallback, useEffect, useMemo } from 'react'
import { create } from 'zustand'
import { DEFAULT_PICK, pickList, resolveMarket, type OwnAdd } from '@/lib/battle'
import { readArmyContexts } from '@/lib/battle-feed'
import {
  MARKET_PICK_KEY,
  PICK_PARAM,
  addToPick,
  cleanPick,
  heldPick,
  lensFor,
  normalizeMarket,
  openingPick,
  parseMarketPick,
  parsePickParam,
  pickParam,
  readMarketPick,
  removeFromPick,
  replacesPick,
  samePick,
  watchlistPick,
  writeMarketPick,
  type MarketPick,
  type PickSource,
} from '@/lib/market-pick'
import { readTapeUniverse } from '@/lib/tape-feed'
import { useHeld } from '@/lib/use-held'
import { useSession } from '@/lib/session'
import { useWatchlists } from '@/components/markets/watchlist/useWatchlists'

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
  /** The opening has painted (additive, lane PICK): false on the server render and until a read decides. */
  ready?: boolean
}

/** How long the opening holds for a wallet's holdings before the venue's pick paints (Battle's rule). */
export const PICK_HELD_WAIT_MS = 4000
/** How long the venue gets to answer before the fallback trio paints. */
export const PICK_VENUE_WAIT_MS = 6000

interface PickStore {
  markets: string[]
  source: PickSource
  lensRaw: string | null
  ready: boolean
  universe: string[]
  /** The inputs the opening reads, filled as the reads land. */
  memory: MarketPick | null
  memoryRead: boolean
  venue: string[]
  heldWaited: boolean
  venueWaited: boolean
  /** Paint a pick; `write` (default: a hand's) puts it in this browser's memory. */
  show: (markets: readonly string[], source: PickSource, write?: boolean) => void
  setLensRaw: (m: string | null) => void
}

export const usePickStore = create<PickStore>((set) => ({
  markets: [],
  source: 'fallback',
  lensRaw: null,
  ready: false,
  universe: [],
  memory: null,
  memoryRead: false,
  venue: [],
  heldWaited: false,
  venueWaited: false,
  show: (markets, source, write = source === 'hand') => {
    const next = cleanPick(markets)
    if (write) writeMarketPick(next)
    set((s) => (s.ready && s.source === source && samePick(s.markets, next) ? s : { markets: next, source, ready: true }))
  },
  setLensRaw: (m) => set((s) => (s.lensRaw === m ? s : { lensRaw: m })),
}))

// ── Once per page load: the memory, the other tabs, the venue's reads ────────

let booted = false
function bootPick(): void {
  if (booted || typeof window === 'undefined') return
  booted = true
  const st = usePickStore
  st.setState({ memory: readMarketPick(), memoryRead: true })
  // Another tab's hand: the row follows, nothing written back.
  window.addEventListener('storage', (e) => {
    if (e.key !== MARKET_PICK_KEY) return
    const m = parseMarketPick(e.newValue)
    if (m) st.getState().show(m.markets, 'hand', false)
  })
  window.setTimeout(() => st.setState({ heldWaited: true }), PICK_HELD_WAIT_MS)
  window.setTimeout(() => st.setState({ venueWaited: true }), PICK_VENUE_WAIT_MS)
  // The venue answers in 2–3s (measured 2026-10-13 on `/` and /live); a read
  // that comes back empty (a refused or dropped request on a busy page) is
  // tried again, three times, before the fallback trio is all there is.
  const readUniverse = (n: number): void => {
    void readTapeUniverse().then(({ main, xyz }) => {
      const names = [...main, ...xyz].filter((r) => !r.delisted).sort((a, b) => b.volumeUsd - a.volumeUsd).map((r) => r.name)
      if (!names.length) {
        if (n < 3) window.setTimeout(() => readUniverse(n + 1), 2500 * (n + 1))
        return
      }
      // A link spells a market in caps; the venue spells kPEPE with its k.
      const s = st.getState()
      const fixed = s.markets.map((m) => resolveMarket(m, names) ?? m)
      st.setState(samePick(fixed, s.markets) ? { universe: names } : { universe: names, markets: fixed })
    })
  }
  const readVenue = (n: number): void => {
    void readArmyContexts().then((ctx) => {
      const venue = pickList(ctx, 'gainers').slice(0, DEFAULT_PICK).map((r) => r.market)
      if (venue.length) st.setState({ venue })
      else if (n < 3) window.setTimeout(() => readVenue(n + 1), 2500 * (n + 1))
    })
  }
  readUniverse(0)
  readVenue(0)
}

/** Test seam (the drive resets nothing; the pins never touch the store). */
export function pickSnapshot(): { markets: string[]; source: PickSource; lens: string | null; ready: boolean } {
  const s = usePickStore.getState()
  return { markets: s.markets, source: s.source, lens: lensFor(s.lensRaw, s.markets), ready: s.ready }
}

export function useMarketPick(opts: { seat?: PickSeat } = {}): MarketPickState {
  const onPage = (opts.seat ?? 'stage') === 'page'
  const markets = usePickStore((s) => s.markets)
  const source = usePickStore((s) => s.source)
  const lensRaw = usePickStore((s) => s.lensRaw)
  const ready = usePickStore((s) => s.ready)
  const universe = usePickStore((s) => s.universe)
  const memory = usePickStore((s) => s.memory)
  const memoryRead = usePickStore((s) => s.memoryRead)
  const venue = usePickStore((s) => s.venue)
  const heldWaited = usePickStore((s) => s.heldWaited)
  const venueWaited = usePickStore((s) => s.venueWaited)

  useEffect(() => bootPick(), [])

  // The page's own link: `?t=` is a choice (it wins over the memory, never
  // written as one), `?m=` the lens. Read on mount — a client navigation
  // into /live?t=… lands its markets on the store the deck already filled.
  useEffect(() => {
    if (!onPage) return
    const q = new URLSearchParams(window.location.search)
    const t = parsePickParam(q.get(PICK_PARAM))
    if (t.length) {
      const s = usePickStore.getState()
      const spelled = s.universe.length ? t.map((m) => resolveMarket(m, s.universe) ?? m) : t
      if (replacesPick(s.ready ? { markets: s.markets, source: s.source } : null, { markets: spelled, source: 'url' })) s.show(spelled, 'url')
    }
    const m = q.get('m')
    const lens = m ? normalizeMarket(m) : null
    if (lens) usePickStore.getState().setLensRaw(lens)
  }, [onPage])

  // The inputs only a hook can read: the watchlist (no second wallet read)
  // and the wallet's holdings.
  const { signedOut } = useSession()
  const held = useHeld()
  const wl = useWatchlists({ holdings: false })
  const watchSymbols = useMemo(() => {
    if (!wl.ready) return [] as string[]
    const activeId = (wl.active as { id?: string } | null)?.id
    const ordered = [...wl.lists].sort((a, b) => (a.id === activeId ? -1 : b.id === activeId ? 1 : 0))
    const out: string[] = []
    for (const l of ordered) for (const sym of l.symbols) if (!out.includes(sym)) out.push(sym)
    return out
  }, [wl.ready, wl.lists, wl.active])
  const watch = useMemo(() => (universe.length ? watchlistPick(watchSymbols, universe) : []), [watchSymbols, universe])
  // Holdings raise nothing until the universe can spell them (a stock would miss its xyz:).
  const heldMarkets = useMemo(() => (held && universe.length ? heldPick(held, universe) : null), [held, universe])

  // The opening, decided again as each read lands; replacesPick keeps a
  // hand and a link from ever being overwritten by a default.
  useEffect(() => {
    if (!memoryRead) return
    // Defaults wait for the universe (watchlist and holdings resolve against it) or the venue's deadline.
    if (memory === null && !universe.length && !venueWaited) return
    // The link was applied on the page seat's mount (it outranks all of this).
    const d = openingPick({ url: [], memory, watch, held: heldMarkets, venue, waitForHeld: !signedOut && !heldWaited })
    if (!d) return
    if (d.source === 'fallback' && !venueWaited) return
    const s = usePickStore.getState()
    if (!replacesPick(s.ready ? { markets: s.markets, source: s.source } : null, d)) return
    // A memory or a link already holds the venue's spelling once the universe is known.
    const spelled = universe.length ? d.markets.map((m) => resolveMarket(m, universe) ?? m) : d.markets
    // A memory read back is a hand's, but not a new write.
    s.show(spelled, d.source, false)
  }, [memoryRead, memory, watch, heldMarkets, venue, signedOut, heldWaited, venueWaited, universe])

  // The URL mirror (the page seat on /live only): `?t=` is the pick, `?m=` the
  // lens; everything else in the address stays as the view wrote it.
  const lens = lensFor(lensRaw, markets)
  useEffect(() => {
    if (!onPage || !ready || !window.location.pathname.startsWith('/live')) return
    const u = new URL(window.location.href)
    const t = pickParam(markets)
    if (t) u.searchParams.set(PICK_PARAM, t)
    else u.searchParams.delete(PICK_PARAM)
    if (lens) u.searchParams.set('m', lens)
    else u.searchParams.delete('m')
    const next = u.pathname + u.search
    if (next !== window.location.pathname + window.location.search) window.history.replaceState(window.history.state, '', next)
  }, [onPage, ready, markets, lens])

  const set = useCallback((next: readonly string[], by: 'hand' | PickSource) => {
    usePickStore.getState().show(next, by)
  }, [])
  const add = useCallback((raw: string): OwnAdd => {
    const s = usePickStore.getState()
    const r = addToPick(raw, s.universe, s.markets)
    if (r.added.length) s.show([...s.markets, ...r.added], 'hand')
    return r
  }, [])
  const remove = useCallback((market: string) => {
    const s = usePickStore.getState()
    if (!s.markets.includes(market)) return
    s.show(removeFromPick(s.markets, market), 'hand')
    if (s.lensRaw === market) s.setLensRaw(null)
  }, [])
  const setLens = useCallback((m: string | null) => usePickStore.getState().setLensRaw(m ? normalizeMarket(m) : null), [])

  return { markets, source, lens, universe, add, remove, set, setLens, ready }
}
