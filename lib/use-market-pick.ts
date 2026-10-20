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
//
// THE READS (2026-10-13, after the squad's QA FINAL counted one GET
// /api/watchlists per `useMarketPick()` instance — six on `/`, two on /live):
// the two inputs only a hook can read, the watchlist and the wallet's
// holdings, are read by ONE subscriber per page — components/live/PickReads,
// mounted once by the deck and once by /live's surface — and published here
// (`publishPickReads`). Every instance reads the store, and the opening is
// decided HERE, once, as each input lands (`decide`) — no instance runs an
// opening effect of its own.

import { useCallback, useEffect } from 'react'
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
import type { HeldSymbol } from '@/lib/watchlists'

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

/** What the page's one subscriber publishes (components/live/PickReads): the
 *  watchlist's symbols in list order (the active list first), the wallet's
 *  holdings (null = no wallet, or no read yet), and whether nobody is here. */
export interface PickReads {
  watchSymbols: readonly string[]
  held: readonly HeldSymbol[] | null
  signedOut: boolean
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
  /** The subscriber's reads as published (raw) … */
  watchSymbols: readonly string[]
  held: readonly HeldSymbol[] | null
  signedOut: boolean
  /** …and resolved against the universe: the opening's own inputs. */
  watch: string[]
  heldMarkets: string[] | null
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
  watchSymbols: [],
  held: null,
  // Until the subscriber says otherwise, a wallet may still answer: the opening holds (≤4s) rather than guess.
  signedOut: false,
  watch: [],
  heldMarkets: null,
  show: (markets, source, write = source === 'hand') => {
    const next = cleanPick(markets)
    if (write) writeMarketPick(next)
    set((s) => (s.ready && s.source === source && samePick(s.markets, next) ? s : { markets: next, source, ready: true }))
  },
  setLensRaw: (m) => set((s) => (s.lensRaw === m ? s : { lensRaw: m })),
}))

// ── The opening, decided here as each input lands ────────────────────────────

/** The opening's two resolved inputs, from the raw reads and the universe. */
function resolvedReads(s: Pick<PickStore, 'watchSymbols' | 'held' | 'universe'>): Pick<PickStore, 'watch' | 'heldMarkets'> {
  const { watchSymbols, held, universe } = s
  return {
    watch: universe.length ? watchlistPick(watchSymbols, universe) : [],
    // Holdings raise nothing until the universe can spell them (a stock would miss its xyz:).
    heldMarkets: held && universe.length ? heldPick(held, universe) : null,
  }
}

/** The rule every instance used to run in its own effect, run once here;
 *  replacesPick keeps a hand and a link from ever being overwritten by a default. */
function decide(): void {
  const s = usePickStore.getState()
  if (!s.memoryRead) return
  const { memory, universe, venue, watch, heldMarkets, signedOut, heldWaited, venueWaited } = s
  // Defaults wait for the universe (watchlist and holdings resolve against it) or the venue's deadline.
  if (memory === null && !universe.length && !venueWaited) return
  // The link was applied on the page seat's mount (it outranks all of this).
  const d = openingPick({ url: [], memory, watch, held: heldMarkets, venue, waitForHeld: !signedOut && !heldWaited })
  if (!d) return
  if (d.source === 'fallback' && !venueWaited) return
  if (!replacesPick(s.ready ? { markets: s.markets, source: s.source } : null, d)) return
  // A memory or a link already holds the venue's spelling once the universe is known.
  const spelled = universe.length ? d.markets.map((m) => resolveMarket(m, universe) ?? m) : d.markets
  // A memory read back is a hand's, but not a new write.
  s.show(spelled, d.source, false)
}

/** Take an input, then decide again. */
function take(patch: Partial<PickStore>): void {
  usePickStore.setState(patch)
  decide()
}

/** The one subscriber's publish (components/live/PickReads): the raw reads,
 *  resolved against whatever universe the page knows by now. */
export function publishPickReads(r: PickReads): void {
  const s = usePickStore.getState()
  if (s.watchSymbols === r.watchSymbols && s.held === r.held && s.signedOut === r.signedOut) return
  take({ watchSymbols: r.watchSymbols, held: r.held, signedOut: r.signedOut, ...resolvedReads({ watchSymbols: r.watchSymbols, held: r.held, universe: s.universe }) })
}

/** The published reads, for a surface that lists them itself (the first-run
 *  sheet fills "From your watchlist" / "From your wallet" from these): the raw
 *  symbols and holdings — the store's resolved lists are the opening's own. */
export function usePickReads(): { watchSymbols: readonly string[]; held: readonly HeldSymbol[] | null } {
  const watchSymbols = usePickStore((s) => s.watchSymbols)
  const held = usePickStore((s) => s.held)
  return { watchSymbols, held }
}

// ── Once per page load: the memory, the other tabs, the venue's reads ────────

let booted = false
function bootPick(): void {
  if (booted || typeof window === 'undefined') return
  booted = true
  const st = usePickStore
  take({ memory: readMarketPick(), memoryRead: true })
  // Another tab's hand: the row follows, nothing written back.
  window.addEventListener('storage', (e) => {
    if (e.key !== MARKET_PICK_KEY) return
    const m = parseMarketPick(e.newValue)
    if (m) st.getState().show(m.markets, 'hand', false)
  })
  window.setTimeout(() => take({ heldWaited: true }), PICK_HELD_WAIT_MS)
  window.setTimeout(() => take({ venueWaited: true }), PICK_VENUE_WAIT_MS)
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
      // The reads resolve against the universe, so they are re-read with it.
      take({ universe: names, ...(samePick(fixed, s.markets) ? {} : { markets: fixed }), ...resolvedReads({ watchSymbols: s.watchSymbols, held: s.held, universe: names }) })
    })
  }
  const readVenue = (n: number): void => {
    void readArmyContexts().then((ctx) => {
      const venue = pickList(ctx, 'gainers').slice(0, DEFAULT_PICK).map((r) => r.market)
      if (venue.length) take({ venue })
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

/** A link's `?t=` lands on the store as a choice (it wins over the memory,
 *  never written as one). /live's page seat reads it on mount; the home deck
 *  reads `/`'s (2026-10-20). Returns whether the link named any market. */
export function applyPickLink(raw: string | null | undefined): boolean {
  const t = parsePickParam(raw)
  if (!t.length) return false
  const s = usePickStore.getState()
  const spelled = s.universe.length ? t.map((m) => resolveMarket(m, s.universe) ?? m) : t
  if (replacesPick(s.ready ? { markets: s.markets, source: s.source } : null, { markets: spelled, source: 'url' })) s.show(spelled, 'url')
  return true
}

export function useMarketPick(opts: { seat?: PickSeat } = {}): MarketPickState {
  const onPage = (opts.seat ?? 'stage') === 'page'
  const markets = usePickStore((s) => s.markets)
  const source = usePickStore((s) => s.source)
  const lensRaw = usePickStore((s) => s.lensRaw)
  const ready = usePickStore((s) => s.ready)
  const universe = usePickStore((s) => s.universe)

  useEffect(() => bootPick(), [])

  // The page's own link: `?t=` is a choice (it wins over the memory, never
  // written as one), `?m=` the lens. Read on mount — a client navigation
  // into /live?t=… lands its markets on the store the deck already filled.
  useEffect(() => {
    if (!onPage) return
    const q = new URLSearchParams(window.location.search)
    applyPickLink(q.get(PICK_PARAM))
    const m = q.get('m')
    const lens = m ? normalizeMarket(m) : null
    if (lens) usePickStore.getState().setLensRaw(lens)
  }, [onPage])

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
