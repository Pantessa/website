// A SHARE THAT CARRIES THE PICK (GTM squad 2026-10-13, lane CARD). Pure: no
// React, no fetch, no window — the share control (components/live/ShareLive),
// the page's metadata (app/live/page.tsx generateMetadata) and the card
// (app/api/og/live) all read these rules, and scripts/card-pins.ts pins them.
//
// The object a person sends is the URL: `/live?view=front&t=ZK,OP,AZTEC&since=4h`
// — the view, the pick (lib/market-pick's `?t=`, ≤8 markets) and, for a
// battle view, the window. The card that unfurls from it draws the picked
// markets from the venue's own context rows: last price, the 24h move, open
// interest. A battle's live window (percent since the anchor, strength of the
// last minute's fills) exists only in the viewer's browser, so the card ranks
// by the venue's 24h move as the proxy AND SAYS "24h" — it never claims the
// window's standings.

import { DEFAULT_WINDOW, FRONT_WINDOWS, LIVE_VIEWS, MAX_ARMIES, isBattleView, liveUrl, parseFrontWindow, parseLiveView, rankArmies, type FrontWindow, type LiveView } from '@/lib/battle'
import { MAX_PICK, armiesOf, parsePickParam, pickParam } from '@/lib/market-pick'
import { SITE_URL } from '@/lib/site-url'
import { tapeMarket } from '@/lib/tape'

/** The longest `?t=` a card reads. Eight `xyz:`-prefixed twelve-letter
 *  tickers and their commas fit in 143; anything longer is not a pick a hand
 *  made, and the card answers with the generic composition. */
export const MAX_T_CHARS = 256

/** The card route. */
export const CARD_PATH = '/api/og/live'

/** The battle views' five inks, dark theme (the card is always dark): the
 *  same hexes as `--army-1..5` in components/live/battle.css — pinned. */
export const ARMY_INKS = ['#e6b84a', '#5ad1e6', '#f06aa8', '#a6e35a', '#b39cff'] as const

export interface LiveShare {
  view: LiveView
  /** The markets the card draws: the whole pick on the tape, the first five
   *  on a battle view (the field marches five). */
  markets: string[]
  /** The whole pick as the URL carried it (≤ MAX_PICK). */
  pick: string[]
  /** The battle window; the tape has none (always DEFAULT_WINDOW). */
  since: FrontWindow
}

type Param = string | string[] | null | undefined

/** A search param as Next hands it (a repeated key arrives as an array). */
export function firstParam(v: Param): string | null {
  if (Array.isArray(v)) return typeof v[0] === 'string' ? v[0] : null
  return typeof v === 'string' ? v : null
}

/** The share a URL names, or null when it names no market (no `t`, garbage,
 *  or a `t` longer than any pick) — the caller then serves the generic card. */
export function parseLiveShare(q: { view?: Param; t?: Param; since?: Param }): LiveShare | null {
  const rawT = firstParam(q.t)
  if (!rawT || rawT.length > MAX_T_CHARS) return null
  const pick = parsePickParam(rawT)
  if (pick.length === 0) return null
  const view = parseLiveView(firstParam(q.view))
  const since = isBattleView(view) ? parseFrontWindow(firstParam(q.since)) : DEFAULT_WINDOW
  return { view, markets: isBattleView(view) ? armiesOf(pick) : pick.slice(0, MAX_PICK), pick, since }
}

/** The path a share sends: the view, the whole pick, a battle's window (the
 *  tape drops `since` — it has no window). Nothing default spelled out. */
export function liveSharePath(view: LiveView, markets: readonly string[], since: FrontWindow = DEFAULT_WINDOW): string {
  const pick = parsePickParam(pickParam(markets))
  // Commas and the dex colon are legal in a query: a pasted link reads
  // `t=ZK,OP,xyz:NVDA`, not `t=ZK%2COP%2Cxyz%3ANVDA` (the markets are shape-
  // checked, so nothing else needs escaping).
  return liveUrl(view, pick, isBattleView(view) ? since : DEFAULT_WINDOW).replace(/%2C/gi, ',').replace(/%3A/gi, ':')
}

/** THE share URL: absolute, on the canonical origin (lib/site-url). */
export function shareUrlFor(view: LiveView, markets: readonly string[], since: FrontWindow = DEFAULT_WINDOW, origin: string = SITE_URL): string {
  return `${origin.replace(/\/+$/, '')}${liveSharePath(view, markets, since)}`
}

/** The card's own path for a share (the page's og:image + twitter:image). */
export function cardPathFor(share: Pick<LiveShare, 'view' | 'pick' | 'since'>): string {
  const q = new URLSearchParams()
  q.set('view', share.view)
  q.set('t', pickParam(share.pick))
  if (isBattleView(share.view) && share.since !== DEFAULT_WINDOW) q.set('since', share.since)
  return `${CARD_PATH}?${q.toString()}`
}

export function cardUrlFor(share: Pick<LiveShare, 'view' | 'pick' | 'since'>, origin: string = SITE_URL): string {
  return `${origin.replace(/\/+$/, '')}${cardPathFor(share)}`
}

// ── The words ────────────────────────────────────────────────────────────────

/** A market as a sentence names it: the bare ticker (`xyz:NVDA` → `NVDA`). */
export function shareName(market: string): string {
  return tapeMarket(market).ticker
}

/** `ZK` · `ZK and OP` · `ZK, OP and AZTEC`. */
export function listWords(markets: readonly string[]): string {
  const n = markets.map(shareName)
  if (n.length <= 1) return n[0] ?? ''
  return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`
}

export function viewLabel(view: LiveView): string {
  return LIVE_VIEWS.find((v) => v.id === view)?.label ?? 'Tape'
}

/** `1h` · `since open` — the window pill's own label. */
export function windowLabel(since: FrontWindow): string {
  return FRONT_WINDOWS.find((w) => w.id === since)?.label ?? since
}

const WINDOW_PHRASE: Record<FrontWindow, string> = {
  open: 'from the moment you open it',
  '15m': 'over the last 15 minutes',
  '1h': 'over the last hour',
  '4h': 'over the last 4 hours',
  '24h': 'over the last 24 hours',
}

/** The plain line (the title, and the text a phone's share sheet carries):
 *  `ZK · OP · AZTEC on The Front · 1h` · `ZK · OP on the live tape`. */
export function shareTitle(view: LiveView, markets: readonly string[], since: FrontWindow = DEFAULT_WINDOW): string {
  const names = markets.map(shareName).join(' · ')
  if (!isBattleView(view)) return `${names} on the live tape`
  return `${names} on ${viewLabel(view)} · ${windowLabel(since)}`
}

export function shareDescription(view: LiveView, markets: readonly string[], since: FrontWindow = DEFAULT_WINDOW): string {
  const who = listWords(markets)
  if (!isBattleView(view)) {
    return `${who} on the live tape: every fill as it lands, with the sentence that does the same at the end of every row. Free to look; your wallet signs.`
  }
  const ground =
    view === 'siege' ? 'the most ground holds the hill' : view === 'map' ? 'land as wide as open interest, as high as the move' : 'percent move is the ground, the last minute of fills the strength'
  return `Watch ${who} fight on ${viewLabel(view)} ${WINDOW_PHRASE[since]}: ${ground}, live in your browser. Every print is a button; your wallet signs.`
}

/** The card's alt text — what the picture shows, in words (never the live window). */
export function cardAlt(view: LiveView, markets: readonly string[]): string {
  const who = listWords(markets)
  if (!isBattleView(view)) return `Pantessa Live — the tape for ${who}: last price, 24h move and open interest from Hyperliquid.`
  return `Pantessa Live — ${viewLabel(view)}: ${who}, ranked by the venue's 24h move, with last price and open interest from Hyperliquid.`
}

/** The card's eyebrow over the names. */
export function cardEyebrow(view: LiveView, since: FrontWindow): string {
  if (!isBattleView(view)) return 'THE TAPE · YOUR MARKETS'
  return `${viewLabel(view).toUpperCase()} · ${since === 'open' ? 'SINCE OPEN' : `${windowLabel(since).toUpperCase()} WINDOW`}`
}

/** The lines that say what the standings are and are not (a battle), or what
 *  the columns are (the tape). */
export function cardRankNote(view: LiveView, since: FrontWindow): string[] {
  if (!isBattleView(view)) return ['LAST · 24H MOVE · OPEN INTEREST', 'EVERY PRINT IS A BUTTON']
  const fight = since === 'open' ? 'THE FIGHT ITSELF' : `THE ${windowLabel(since).toUpperCase()} FIGHT ITSELF`
  return ["STANDINGS BY THE VENUE'S 24H MOVE", `${fight} RUNS LIVE IN YOUR BROWSER`]
}

/** The panel's foot. */
export function cardFoot(view: LiveView): string {
  return isBattleView(view) ? 'OPEN THE LINK · WATCH IT LIVE' : 'THE TAPE STREAMS IN YOUR BROWSER'
}

// ── The rows ─────────────────────────────────────────────────────────────────

/** One venue row the card reads (Hyperliquid metaAndAssetCtxs). */
export interface VenueRow {
  name: string
  markPx: number | null
  prevDayPx: number | null
  /** Open interest in coins. */
  openInterest: number | null
  delisted?: boolean
}

export interface CardRow {
  /** The venue's spelling when listed, else the pick's. */
  market: string
  /** 1-based slot in the pick — the army's ink on a battle view. */
  slot: number
  listed: boolean
  delisted: boolean
  last: number | null
  chgPct: number | null
  oiUsd: number | null
  /** 1-based rank by the 24h move on a battle view; null on the tape, and for
   *  a market with no move (a miss, an unlisted market) — no place is claimed. */
  rank: number | null
}

/** The pick against the venue's names, case-insensitively (`?t=` upper-cases,
 *  so `KPEPE` is the venue's `kPEPE`). */
export function matchVenue(pick: readonly string[], rows: readonly VenueRow[]): (VenueRow | null)[] {
  const byLower = new Map(rows.map((r) => [r.name.toLowerCase(), r] as const))
  return pick.map((m) => byLower.get(m.toLowerCase()) ?? null)
}

/**
 * The card's rows. `venue` null = the feed missed (every number a dash, the
 * card says so); an empty array = the venue answered with nothing. A battle
 * ranks by the 24h move (lib/battle rankArmies — no move ranks last, in pick
 * order); the tape keeps the pick's order.
 */
export function cardRows(share: Pick<LiveShare, 'view' | 'markets'>, venue: readonly VenueRow[] | null): CardRow[] {
  const markets = isBattleView(share.view) ? share.markets.slice(0, MAX_ARMIES) : share.markets.slice(0, MAX_PICK)
  const hits = venue ? matchVenue(markets, venue) : markets.map(() => null)
  const rows: CardRow[] = markets.map((m, i) => {
    const v = hits[i]
    const last = v && v.markPx != null && Number.isFinite(v.markPx) && v.markPx > 0 ? v.markPx : null
    const prev = v && v.prevDayPx != null && Number.isFinite(v.prevDayPx) && v.prevDayPx > 0 ? v.prevDayPx : null
    const oi = v && v.openInterest != null && Number.isFinite(v.openInterest) && last != null ? v.openInterest * last : null
    return {
      market: v ? v.name : m,
      slot: i + 1,
      listed: !!v,
      delisted: !!v?.delisted,
      last,
      chgPct: last != null && prev != null ? (last / prev - 1) * 100 : null,
      oiUsd: oi,
      rank: null,
    }
  })
  if (!isBattleView(share.view)) return rows
  // A market with no move has no place: it sorts last and prints no rank.
  return rankArmies(rows, (r) => r.chgPct).map((r) => ({ ...r.army, rank: r.pct === null ? null : r.rank }))
}

/** A ground bar: the move as a signed share of the largest |move| on the card,
 *  −1..1 (drawn from a centre line: gained ground right, lost ground left). */
export function groundShare(pct: number | null, rows: readonly CardRow[]): number {
  if (pct == null || !Number.isFinite(pct)) return 0
  const max = Math.max(0, ...rows.map((r) => (r.chgPct == null ? 0 : Math.abs(r.chgPct))))
  return max > 0 ? Math.max(-1, Math.min(1, pct / max)) : 0
}

/** Row height in the panel: the rows share ~360px, inside a band per view. */
export function cardRowHeight(view: LiveView, n: number): number {
  const fit = Math.floor(360 / Math.max(1, n))
  return isBattleView(view) ? Math.max(64, Math.min(96, fit)) : Math.max(44, Math.min(58, fit))
}

/** The headline's size: the names fill the left column, never past it. */
export function headlineSize(markets: readonly string[], battle: boolean): number {
  const chars = markets.map(shareName).join(battle ? ' vs ' : ' · ').length
  if (chars <= 12) return 88
  if (chars <= 20) return 72
  if (chars <= 30) return 58
  if (chars <= 44) return 46
  return 38
}
