// SYMBOL SEARCH (2026-11-17, Nate on /t/UNI: "I should be able to search for
// a new asset on the asset page") — the pure half: what a typed query finds,
// in what order, and what the door shows before anything is typed.
//
// One universe, the charts' own: the coins lib/watchlists names, every
// Robinhood Chain ticker, the look-only indexes, the macro rows (found by a
// desk's words: "treasury", "crude", "dow") and, when the browser holds it,
// Hyperliquid's live perp table. Every hit clears chartPairFor, so a result
// always opens a chart. A search only navigates: it never fires a turn.

import { create } from 'zustand'
import { CHART_INDEXES, chartPairFor, liveHlPerpNames, pairTicker, parseChartAsk, perpTwinOf, type ChartPair } from '@/lib/charts'
import { MACRO_ROWS, macroRow, macroRowMatches } from '@/lib/macro'
import { ROBINHOOD_TICKERS } from '@/lib/robinhood-tickers'
import { COIN_NAMES, symbolName } from '@/lib/watchlists'

export type SearchKind = 'stock' | 'coin' | 'perp' | 'macro'
export type SearchFilter = 'all' | SearchKind

export const SEARCH_FILTERS: readonly { id: SearchFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'stock', label: 'Stocks' },
  { id: 'coin', label: 'Crypto' },
  { id: 'perp', label: 'Perps' },
  { id: 'macro', label: 'Macro' },
]

export const SEARCH_KIND_LABEL: Readonly<Record<SearchKind, string>> = { stock: 'Stock', coin: 'Crypto', perp: 'Perp', macro: 'Macro' }

export interface SearchHit {
  /** The chart symbol: what the row opens (`/t/<symbol>`) and is keyed by. */
  symbol: string
  /** What the row SHOWS. The symbol, except a stock's perp twin (`ANTPERP`),
   *  which reads as the share's ticker beside its Perp tag (lib/charts). */
  ticker: string
  name: string
  kind: SearchKind
  pair: ChartPair
}

/** A symbol's class in the search: a macro row or an index is Macro whatever
 *  feeds it (the S&P 500 is a Hyperliquid builder market, and still macro). */
export function searchKindOf(pair: ChartPair): SearchKind {
  if (pair.source === 'index' || macroRow(pair.symbol)) return 'macro'
  if (pair.source === 'robinhood') return 'stock'
  if (pair.source === 'hyperliquid') return 'perp'
  return 'coin'
}

export function searchHitFor(symbol: string): SearchHit | null {
  const pair = chartPairFor(symbol)
  if (!pair) return null
  const name = macroRow(pair.symbol)?.name ?? symbolName(pair.symbol)
  return { symbol: pair.symbol, ticker: pairTicker(pair), name, kind: searchKindOf(pair), pair }
}

/** A stock found this well also lists its perp twin (the exact ticker, the
 *  company's name, a ticker or name prefix). A looser match stays one row. */
export const SEARCH_TWIN_MIN_SCORE = 66

/** The names a query is matched against: [symbol, name]. */
function candidates(): (readonly [string, string])[] {
  const out: (readonly [string, string])[] = [
    ...COIN_NAMES,
    ...ROBINHOOD_TICKERS,
    ...CHART_INDEXES.map((ix) => [ix.symbol, ix.name] as const),
    ...MACRO_ROWS.map((r) => [r.symbol, r.name] as const),
  ]
  const live = liveHlPerpNames()
  if (live) {
    for (const n of live.main) out.push([n, n])
    for (const n of live.xyz) out.push([n.replace(/^xyz:/i, ''), n.replace(/^xyz:/i, '')])
  }
  return out
}

const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9&]+/g, ' ').trim()

/** How well a candidate answers the query; 0 = it does not. Pure. */
export function searchScore(symbol: string, name: string, queryRaw: string): number {
  const q = fold(queryRaw.replace(/^\$/, ''))
  if (!q) return 0
  const sym = symbol.toLowerCase()
  const tight = q.replace(/\s+/g, '')
  const nm = fold(name)
  if (sym === tight) return 100
  if (nm === q) return 92
  // A shorter ticker is the closer answer to a short prefix ("so" → SOL before SOFI is a tie broken by length).
  if (sym.startsWith(tight)) return 80 - Math.min(sym.length - tight.length, 9)
  if (nm.startsWith(q)) return 66
  if (` ${nm}`.includes(` ${q}`)) return 56
  if (tight.length >= 3 && nm.includes(q)) return 40
  if (tight.length >= 2 && sym.includes(tight)) return 30
  return 0
}

/** What a query finds, best first. `filter` narrows to one class. */
export function searchSymbols(queryRaw: string, opts: { filter?: SearchFilter; limit?: number } = {}): SearchHit[] {
  const q = String(queryRaw ?? '').trim()
  if (!q || q.length > 40) return []
  const filter = opts.filter ?? 'all'
  const limit = opts.limit ?? 24
  const scored = new Map<string, { hit: SearchHit; score: number }>()
  const put = (hit: SearchHit, score: number) => {
    if (filter !== 'all' && hit.kind !== filter) return
    const prev = scored.get(hit.symbol)
    if (!prev || prev.score < score) scored.set(hit.symbol, { hit, score })
  }
  const offer = (symbol: string, score: number) => {
    if (score <= 0) return
    const hit = searchHitFor(symbol)
    if (!hit) return
    put(hit, score)
    // One share, two instruments (2026-11-19, Nate on ANT: "one for perps
    // and one for robinhood and let the user decide"): a stock the venue
    // also lists as a perp is TWO rows, the stock token and its perp twin
    // right under it. Each opens its own page; the Stocks and Perps filters
    // keep one each.
    if (hit.pair.source !== 'robinhood' || score < SEARCH_TWIN_MIN_SCORE) return
    const twin = perpTwinOf(hit.symbol)
    const twinHit = twin ? searchHitFor(twin) : null
    if (twinHit) put(twinHit, score - 0.5)
  }
  // `ANT-PERP` is how a perp twin is typed; the symbol carries no hyphen.
  const upper = q.toUpperCase().replace(/^\$/, '').replace(/-(?=PERP$)/, '')
  // The exact ticker, live table included (a perp nobody listed by hand).
  if (/^[A-Z0-9]{1,12}$/.test(upper)) offer(upper, 100)
  // The chart-ask resolver's vocabulary: "apple" → AAPL, "bitcoin" → BTC, an index alias.
  const ask = parseChartAsk(`show me the ${q} chart`)
  if (ask?.pair) offer(ask.symbol, 94)
  for (const [s, n] of candidates()) offer(s, searchScore(s, n, q))
  // A macro row answers to a desk's words too ("treasury", "crude", "fear").
  for (const row of MACRO_ROWS) if (macroRowMatches(row, q)) offer(row.symbol, 58)
  return [...scored.values()]
    .sort((a, b) => b.score - a.score || a.hit.symbol.length - b.hit.symbol.length || a.hit.symbol.localeCompare(b.hit.symbol))
    .slice(0, limit)
    .map((s) => s.hit)
}

/** The ranges of `text` the query matched, for the highlight: [start, end). */
export function matchRange(text: string, queryRaw: string): [number, number] | null {
  const q = queryRaw.trim().replace(/^\$/, '').toLowerCase()
  if (!q) return null
  const at = text.toLowerCase().indexOf(q)
  return at < 0 ? null : [at, at + q.length]
}

/** Shown before anything is typed, after the visitor's own rows. One per
 *  class a desk opens first; each must clear chartPairFor to be drawn. */
export const SEARCH_POPULAR: readonly string[] = ['BTC', 'ETH', 'SOL', 'HYPE', 'NVDA', 'AAPL', 'TSLA', 'SP500', 'GOLD', 'US10Y']

export function hitsFor(symbols: readonly string[], filter: SearchFilter = 'all', skip: ReadonlySet<string> = new Set()): SearchHit[] {
  const out: SearchHit[] = []
  const seen = new Set<string>(skip)
  for (const s of symbols) {
    const hit = searchHitFor(s)
    if (!hit || seen.has(hit.symbol) || (filter !== 'all' && hit.kind !== filter)) continue
    seen.add(hit.symbol)
    out.push(hit)
  }
  return out
}

// ── Recents (this browser) ───────────────────────────────────────────────────

export const SEARCH_RECENT_KEY = 'pantessa.search.recent.v1'
export const SEARCH_RECENT_MAX = 8

/** Newest first, no repeats, capped. Pure. */
export function pushRecent(list: readonly string[], symbol: string): string[] {
  const sym = symbol.trim().toUpperCase()
  if (!/^[A-Z0-9]{1,12}$/.test(sym)) return [...list]
  return [sym, ...list.filter((s) => s !== sym)].slice(0, SEARCH_RECENT_MAX)
}

export function parseRecent(raw: string | null): string[] {
  if (!raw) return []
  try {
    const v: unknown = JSON.parse(raw)
    if (!Array.isArray(v)) return []
    return v.filter((s): s is string => typeof s === 'string' && /^[A-Z0-9]{1,12}$/.test(s)).slice(0, SEARCH_RECENT_MAX)
  } catch {
    return []
  }
}

export function readRecent(): string[] {
  try {
    return parseRecent(window.localStorage.getItem(SEARCH_RECENT_KEY))
  } catch {
    return []
  }
}

export function writeRecent(symbol: string): void {
  try {
    window.localStorage.setItem(SEARCH_RECENT_KEY, JSON.stringify(pushRecent(readRecent(), symbol)))
  } catch {
    /* a private window keeps no recents */
  }
}

// ── The door ─────────────────────────────────────────────────────────────────

interface SymbolSearchState {
  open: boolean
  /** What the box opens holding (a key typed on the page lands in it). */
  seed: string
  openSearch: (seed?: string) => void
  closeSearch: () => void
}

export const useSymbolSearch = create<SymbolSearchState>()((set) => ({
  open: false,
  seed: '',
  openSearch: (seed = '') => set({ open: true, seed }),
  closeSearch: () => set({ open: false, seed: '' }),
}))

/** Does a key press on the page open the search? `/` anywhere outside a
 *  text field, with no modifier (⌘K is the Ask door's). Pure. */
export function isSearchKey(e: { key: string; metaKey?: boolean; ctrlKey?: boolean; altKey?: boolean }, target: { tagName?: string; isContentEditable?: boolean } | null): boolean {
  if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return false
  const tag = (target?.tagName ?? '').toUpperCase()
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return false
  return true
}
