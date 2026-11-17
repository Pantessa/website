// The apps page's TRADE lane: the pure rules behind the Snapshot, Hyperliquid
// and CoW Protocol sections (squad apps-page, 2026-11-17). Words and shapes
// only: no React, no fetch. Pinned in scripts/apps-trade-pins.ts.
//
// Every number here comes from a tile the splash scan returned or a venue
// context row Hyperliquid publishes; a value that is unknown is left out,
// never printed as 0.

import type { PageTiles } from '@/lib/apps-page'
import type { ProposalRow, RowsTile, SplashTile, StatRow, TileViz } from '@/lib/splash/types'
import { fmtAskPrice, fmtAskUnits } from '@/lib/chart-actions'

// ── Shared words ────────────────────────────────────────────────────────────

const COUNT_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve']

/** "One", "Two" … "Twelve", then digits. Capitalised: it opens a sentence. */
export function countWord(n: number): string {
  return n >= 0 && n < COUNT_WORDS.length ? COUNT_WORDS[n] : String(n)
}

/** "$1,204" for a whole number of dollars at or over $100, "$41.20" under. */
export function fmtUsdPlain(n: number): string {
  const abs = Math.abs(n)
  const s = abs >= 100 ? Math.round(abs).toLocaleString('en-US') : abs.toFixed(2)
  return `${n < 0 ? '-' : ''}$${s}`
}

/** A price as a trader reads it: "$65,182" · "$1,847.60" · "$5.198" · "$0.04521". */
export function fmtPrice(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return ''
  if (p >= 10_000) return `$${Math.round(p).toLocaleString('en-US')}`
  if (p >= 100) return `$${p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  if (p >= 10) return `$${p.toFixed(2)}`
  if (p >= 1) return `$${p.toFixed(3)}`
  return `$${p.toPrecision(4)}`
}

/** "$3.19B" · "$707M" · "$8.2M" · "$412K". */
export function fmtCompactUsd(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return ''
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e8) return `$${Math.round(n / 1e6)}M`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${Math.round(n / 1e3)}K`
  return `$${Math.round(n)}`
}

/** "+0.7%" · "-0.4%" (a plain hyphen-minus; new copy carries no typographic dashes). */
export function fmtSignedPct(pct: number | null, places = 1): string {
  if (pct == null || !Number.isFinite(pct)) return ''
  const v = Number(pct.toFixed(places))
  return `${v > 0 ? '+' : ''}${v.toFixed(places)}%`
}

// ── Time left on a vote ─────────────────────────────────────────────────────

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Calendar parts of a moment in a time zone (UTC when none is given, so a
 *  pin is deterministic; the page passes the reader's own zone). */
function partsOf(ms: number, timeZone?: string): { y: number; m: number; d: number; wd: number } {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: timeZone ?? 'UTC', year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' })
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday)
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), wd }
}

/** Whole calendar days between two moments in a zone (0 = same day). */
function calendarDaysBetween(fromMs: number, toMs: number, timeZone?: string): number {
  const a = partsOf(fromMs, timeZone)
  const b = partsOf(toMs, timeZone)
  return Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86_400_000)
}

/** When a vote closes, for a sentence: "in 40 minutes" · "in 5 hours" ·
 *  "tomorrow" · "on Friday" · "on 2 Dec". "has closed" once it is past.
 *  `endsAt` is unix SECONDS (Snapshot's own unit). */
export function closesWhen(endsAt: number, nowMs = Date.now(), timeZone?: string): string {
  const endMs = endsAt * 1000
  const left = endMs - nowMs
  if (!Number.isFinite(left)) return ''
  if (left <= 0) return 'has closed'
  if (left < 60 * 60_000) {
    const m = Math.max(1, Math.round(left / 60_000))
    return `in ${m} ${m === 1 ? 'minute' : 'minutes'}`
  }
  if (left < 12 * 3_600_000) {
    const h = Math.round(left / 3_600_000)
    return `in ${h} ${h === 1 ? 'hour' : 'hours'}`
  }
  const days = calendarDaysBetween(nowMs, endMs, timeZone)
  if (days <= 0) return 'later today'
  if (days === 1) return 'tomorrow'
  const p = partsOf(endMs, timeZone)
  if (days < 7) return `on ${WEEKDAYS[p.wd]}`
  return `on ${p.d} ${MONTHS[p.m - 1]}`
}

/** A row's short time left: "40 min left" · "5 hours left" · "3 days left" · "closed". */
export function timeLeftShort(endsAt: number, nowMs = Date.now()): string {
  const left = endsAt * 1000 - nowMs
  if (!Number.isFinite(left)) return ''
  if (left <= 0) return 'closed'
  if (left < 60 * 60_000) return `${Math.max(1, Math.round(left / 60_000))} min left`
  if (left < 48 * 3_600_000) {
    const h = Math.round(left / 3_600_000)
    return `${h} ${h === 1 ? 'hour' : 'hours'} left`
  }
  const d = Math.round(left / 86_400_000)
  return `${d} days left`
}

// ── Snapshot ────────────────────────────────────────────────────────────────

export interface SnapshotView {
  /** Open votes, soonest to close first. Closed ones are dropped. */
  proposals: ProposalRow[]
  spaces: { id: string; name: string; avatarUrl: string; open: number }[]
  /** True when the scan returned the "follows nothing" preview. */
  followsNothing: boolean
  error: string | null
}

export function snapshotView(tiles: SplashTile[], nowMs = Date.now()): SnapshotView {
  const t = tiles.find((x) => x.render === 'proposals')
  const err = tiles.find((x) => x.render === 'error')
  if (!t || t.render !== 'proposals') {
    return { proposals: [], spaces: [], followsNothing: !err, error: err && err.render === 'error' ? err.message : null }
  }
  const proposals = t.proposals.filter((p) => p.endsAt * 1000 > nowMs).sort((a, b) => a.endsAt - b.endsAt)
  const counts = new Map<string, number>()
  for (const p of proposals) counts.set(p.spaceId, (counts.get(p.spaceId) ?? 0) + 1)
  const spaces = t.spaces.map((s) => ({ ...s, open: counts.get(s.id) ?? 0 })).sort((a, b) => b.open - a.open)
  return { proposals, spaces, followsNothing: false, error: null }
}

/** "One Uniswap vote is open. It closes on Friday." · "Three votes are open
 *  in two spaces. The first closes tomorrow." · "No votes are open in the
 *  spaces you follow." */
export function snapshotHeadline(v: SnapshotView, nowMs = Date.now(), timeZone?: string): string {
  if (v.error && v.proposals.length === 0) return 'Snapshot did not answer just now.'
  if (v.followsNothing) return 'You follow no Snapshot space yet.'
  const n = v.proposals.length
  if (n === 0) return 'No votes are open in the spaces you follow.'
  const first = v.proposals[0]
  const when = closesWhen(first.endsAt, nowMs, timeZone)
  const spaceIds = new Set(v.proposals.map((p) => p.spaceId))
  if (n === 1) return `One ${first.spaceName} vote is open. It closes ${when}.`
  if (spaceIds.size === 1) return `${countWord(n)} ${first.spaceName} votes are open. The first closes ${when}.`
  return `${countWord(n)} votes are open in ${countWord(spaceIds.size).toLowerCase()} spaces. The first closes ${when}.`
}

/** The one-line posture's sentence. */
export function snapshotLine(v: SnapshotView): string {
  if (v.error && v.proposals.length === 0) return v.error
  if (v.followsNothing) return 'You follow no Snapshot space yet.'
  const n = v.proposals.length
  if (n === 0) return 'No votes are open in the spaces you follow.'
  return n === 1 ? `1 vote is open: ${v.proposals[0].title}` : `${n} votes are open. Next to close: ${v.proposals[0].title}`
}

/** The vote asks, in the grammar the snapshot tile's own prompts use (the
 *  chat routes "Prepare my vote" to the native EIP-712 vote card). */
export function voteAsk(p: Pick<ProposalRow, 'spaceName' | 'title'>): string {
  return `Prepare my vote on the ${p.spaceName} proposal "${p.title}" — show me the choices.`
}
export function summarizeAsk(p: Pick<ProposalRow, 'spaceName' | 'title'>): string {
  return `Summarize the ${p.spaceName} proposal "${p.title}" and tell me what's at stake.`
}

// ── Hyperliquid ─────────────────────────────────────────────────────────────

export type HlPositionItem = Extract<TileViz, { kind: 'positions' }>['items'][number]

export interface HlView {
  accountUsd: number | null
  /** Positions the venue priced (the viz). */
  positions: HlPositionItem[]
  /** The tile's own rows (one per position, up to five) for small print. */
  rows: StatRow[]
  /** True when the scan found no Hyperliquid account at all. */
  noAccount: boolean
  error: string | null
}

export function hlView(tiles: SplashTile[]): HlView {
  const t = tiles.find((x) => x.render === 'rows') as RowsTile | undefined
  const err = tiles.find((x) => x.render === 'error')
  if (!t) return { accountUsd: null, positions: [], rows: [], noAccount: !err, error: err && err.render === 'error' ? err.message : null }
  const viz = t.viz?.kind === 'positions' ? t.viz : null
  const fromHead = t.headline ? Number(t.headline.value.replace(/[^0-9.]/g, '')) : NaN
  const accountUsd = viz?.accountUsd ?? (Number.isFinite(fromHead) && fromHead > 0 ? fromHead : null)
  return { accountUsd, positions: viz?.items ?? [], rows: t.rows, noAccount: false, error: null }
}

export function hlTotalPnl(positions: HlPositionItem[]): number | null {
  if (positions.length === 0) return null
  return positions.reduce((n, p) => n + (Number.isFinite(p.pnlUsd) ? p.pnlUsd : 0), 0)
}

/** The closest liquidation among the positions, in percent away, or null. */
export function hlClosestLiq(positions: HlPositionItem[]): { coin: string; pct: number } | null {
  let best: { coin: string; pct: number } | null = null
  for (const p of positions) if (p.liqDistancePct != null && (best == null || p.liqDistancePct < best.pct)) best = { coin: p.coin, pct: p.liqDistancePct }
  return best
}

/** "Two positions open, up $41.20 so far." · "One position open, down $3.10
 *  so far." · "$120 in the account, nothing open." · "Nothing open. Any
 *  market is one sentence away." */
export function hlHeadline(v: HlView): string {
  if (v.error && v.positions.length === 0) return 'Hyperliquid did not answer just now.'
  const n = v.positions.length
  if (n === 0) {
    if (v.accountUsd != null && v.accountUsd > 0) return `${fmtUsdPlain(v.accountUsd)} in the account, nothing open.`
    return 'Nothing open. Any market is one sentence away.'
  }
  const pnl = hlTotalPnl(v.positions) ?? 0
  const lead = `${countWord(n)} ${n === 1 ? 'position' : 'positions'} open`
  if (Math.abs(pnl) < 0.005) return `${lead}, flat so far.`
  return `${lead}, ${pnl > 0 ? 'up' : 'down'} ${fmtUsdPlain(Math.abs(pnl))} so far.`
}

export function hlLine(v: HlView): string {
  if (v.error && v.positions.length === 0) return v.error
  return hlHeadline(v)
}

/** The position asks, in the tile's own grammar (lib/splash/sources). */
export function hlCloseAsk(p: Pick<HlPositionItem, 'coin' | 'side'>): string {
  return `Close my ${p.coin} ${p.side} on Hyperliquid`
}
export function hlProtectAsk(p: Pick<HlPositionItem, 'coin' | 'side'>, stopPct = 10): string {
  return `Protect my ${p.coin} ${p.side} with a ${stopPct}% stop loss`
}

/** Funding as a yearly percent: the venue quotes it per HOUR as a fraction
 *  (0.0000125 = 0.00125% an hour), and a year is 24 × 365 hours. */
export function fundingYearlyPct(perHour: number): number | null {
  if (!Number.isFinite(perHour)) return null
  return perHour * 24 * 365 * 100
}

/** "11.0% a year" · "-1.5% a year". */
export function fmtFundingYearly(perHour: number): string {
  const y = fundingYearlyPct(perHour)
  if (y == null) return ''
  const v = Number(y.toFixed(1))
  return `${v.toFixed(1)}% a year`
}

export interface HlMarketCtx {
  markPx: number
  prevDayPx: number
  funding: number
  dayNtlVlm: number
}

export interface HlMarketRow {
  coin: string
  mark: number
  changePct: number | null
  fundingPerHour: number
  volumeUsd: number
}

/** The main book's busiest markets by 24h volume. The builder dexes
 *  ("xyz:NVDA") are left out: the perp layer the chat runs is the main book. */
export function topHlMarkets(ctx: ReadonlyMap<string, HlMarketCtx>, n = 8): HlMarketRow[] {
  const out: HlMarketRow[] = []
  for (const [coin, c] of ctx) {
    if (coin.includes(':')) continue
    if (!(c.markPx > 0) || !(c.dayNtlVlm > 0)) continue
    out.push({
      coin,
      mark: c.markPx,
      changePct: c.prevDayPx > 0 ? (c.markPx / c.prevDayPx - 1) * 100 : null,
      fundingPerHour: c.funding,
      volumeUsd: c.dayNtlVlm,
    })
  }
  return out.sort((a, b) => b.volumeUsd - a.volumeUsd).slice(0, n)
}

// ── CoW Protocol ────────────────────────────────────────────────────────────

export interface CowOrder {
  pair: string
  kind: string
  chain: string
  /** 0 to 100, or null when the book gave no fill. */
  filledPct: number | null
  /** The tile's own words for the row's value ("42% filled", "open"). */
  value: string
  actions: { label: string; prompt: string }[]
}

export interface CowFill {
  pair: string
  chain: string
  actions: { label: string; prompt: string }[]
}

export interface CowView {
  open: CowOrder[]
  fills: CowFill[]
  /** Lifetime trades, when the tile says it (a wallet with history and nothing recent). */
  lifetime: number | null
  /** True when the scan found no CoW history at all. */
  noHistory: boolean
  error: string | null
}

/** Read the cow-activity tile's rows back into orders and fills. The source
 *  writes `<pair> · <kind>` with `open on <chain>` for an open order and
 *  `recent trade on <chain>` for a fill (lib/splash/sources cowSource). */
export function cowView(tiles: SplashTile[]): CowView {
  const t = tiles.find((x) => x.render === 'rows') as RowsTile | undefined
  const err = tiles.find((x) => x.render === 'error')
  if (!t) return { open: [], fills: [], lifetime: null, noHistory: !err, error: err && err.render === 'error' ? err.message : null }
  const open: CowOrder[] = []
  const fills: CowFill[] = []
  let lifetime: number | null = null
  for (const r of t.rows) {
    const sub = r.sub ?? ''
    const openOn = sub.match(/^open on (.+)$/)
    const fillOn = sub.match(/^recent trade on (.+)$/)
    if (openOn) {
      const [pair, kind] = r.label.split(' · ')
      open.push({ pair: pair.trim(), kind: (kind ?? '').trim(), chain: openOn[1], filledPct: r.progressPct ?? null, value: r.value ?? '', actions: r.actions ?? [] })
    } else if (fillOn) {
      fills.push({ pair: r.label.trim(), chain: fillOn[1], actions: r.actions ?? [] })
    } else if (/^lifetime trades$/i.test(r.label)) {
      const n = Number(r.value)
      lifetime = Number.isFinite(n) ? n : null
    }
  }
  return { open, fills, lifetime, noHistory: false, error: null }
}

/** "Two orders resting." · "One order resting, 42% filled." · "No orders
 *  resting. Name a price and let it wait." */
export function cowHeadline(v: CowView): string {
  if (v.error && v.open.length === 0) return 'CoW Protocol did not answer just now.'
  const n = v.open.length
  if (n === 0) return 'No orders resting. Name a price and let it wait.'
  if (n === 1) {
    const f = v.open[0].filledPct
    return f != null && f > 0 ? `One order resting, ${Math.round(f)}% filled.` : 'One order resting.'
  }
  return `${countWord(n)} orders resting.`
}

export function cowLine(v: CowView): string {
  if (v.error && v.open.length === 0) return v.error
  const n = v.open.length
  if (n === 0) return v.fills.length > 0 ? `No orders resting. Last fill: ${v.fills[0].pair}.` : 'No orders resting.'
  return n === 1 ? `1 order resting: ${v.open[0].pair}.` : `${n} orders resting. First: ${v.open[0].pair}.`
}

/** A limit BUY a few percent under the price now, in the CoW limit grammar
 *  the chat builds (lib/chart-actions, lib/symbol-venues limitAtLevel):
 *  `limit order: buy 0.01353 ETH for at most 25 USDC on Base`. Null when the
 *  price is unknown: never a made-up price. */
export function cowBuyLowerAsk(symbol: string, price: number, opts: { usd?: number; pct?: number; chainWord?: string | null } = {}): { ask: string; at: number; units: string } | null {
  const usd = opts.usd ?? 25
  const pct = opts.pct ?? 5
  if (!(price > 0) || !(usd > 0) || !(pct > 0 && pct < 50)) return null
  const at = price * (1 - pct / 100)
  const units = fmtAskUnits(usd, at)
  if (!units) return null
  const usdc = fmtAskPrice(Number(units) * at)
  const sym = symbol.toUpperCase()
  return { ask: `limit order: buy ${units} ${sym} for at most ${usdc} USDC${opts.chainWord ? ` on ${opts.chainWord}` : ''}`, at, units }
}

/** A limit SELL of a holding a few percent over the price now:
 *  `limit order: sell 0.0123 ETH for at least 27.5 USDC on Base`. Sized to
 *  what is held (never more), null when the price or the holding is unknown. */
export function cowSellHigherAsk(symbol: string, price: number, heldUnits: number, opts: { usd?: number; pct?: number; chainWord?: string | null } = {}): { ask: string; at: number; units: string } | null {
  const usd = opts.usd ?? 25
  const pct = opts.pct ?? 10
  if (!(price > 0) || !(heldUnits > 0) || !(pct > 0 && pct < 200)) return null
  const at = price * (1 + pct / 100)
  const want = Math.min(usd / at, heldUnits)
  const units = fmtAskUnits(want * at, at)
  if (!units || Number(units) > heldUnits) return null
  const usdc = fmtAskPrice(Number(units) * at)
  const sym = symbol.toUpperCase()
  return { ask: `limit order: sell ${units} ${sym} for at least ${usdc} USDC${opts.chainWord ? ` on ${opts.chainWord}` : ''}`, at, units }
}

/** The chains CoW runs on, as the limit grammar names them. */
export const COW_CHAIN_WORDS: Record<string, string> = { ethereum: 'Ethereum', mainnet: 'Ethereum', base: 'Base', arbitrum: 'Arbitrum', 'arbitrum one': 'Arbitrum' }

export function cowChainWord(chain: string | null | undefined): string | null {
  if (!chain) return null
  return COW_CHAIN_WORDS[chain.trim().toLowerCase()] ?? null
}

/** Token aliases: the price of WETH is the price of ETH; cbBTC/WBTC are BTC. */
export function priceSymbolFor(symbol: string): string {
  const s = symbol.toUpperCase()
  if (s === 'WETH') return 'ETH'
  if (s === 'CBBTC' || s === 'WBTC') return 'BTC'
  return s
}

export const STABLES = new Set(['USDC', 'USDT', 'DAI', 'USDG', 'USDE', 'PYUSD', 'FDUSD', 'USDS', 'GHO', 'USDBC', 'USDC.E'])

// ── What the wallet holds, from the other apps on the page ───────────────────

export interface Held {
  symbol: string
  units: number
  valueUsd: number | null
  chainWord: string
}

export function heldOnCowChains(page: PageTiles): Held[] {
  const out: Held[] = []
  for (const group of page.bySlug.values()) {
    for (const t of group) {
      if (t.render !== 'holdings') continue
      for (const h of t.holdings) {
        const chainWord = cowChainWord(h.chain ?? t.chain)
        const units = Number(String(h.balance).replace(/,/g, ''))
        if (!chainWord || !(units > 0)) continue
        out.push({ symbol: h.symbol.toUpperCase(), units, valueUsd: h.valueUsd, chainWord })
      }
    }
  }
  return out
}

export interface PlaceRow {
  symbol: string
  price: number
  buy: { ask: string; at: number } | null
  sell: { ask: string; at: number } | null
  /** The dollars the buy pays: $25, or less when the wallet holds less USDC. */
  buyUsd: number
}

/** ETH first (always quotable), then up to two held tokens worth $5 or more
 *  that the marks price. A buy pays USDC on the chain that holds the most of
 *  it, sized to that USDC (at most $25; none under $1, since CoW refuses an
 *  order the wallet cannot fund); a sell is sized to the holding and rests on
 *  its own chain. Nothing known about USDC: a $25 buy with no chain named. */
export function placeRows(held: Held[], marks: ReadonlyMap<string, { markPx: number }>): PlaceRow[] {
  const usdc = held.filter((h) => h.symbol === 'USDC').sort((a, b) => (b.valueUsd ?? b.units) - (a.valueUsd ?? a.units))[0]
  const payChain = usdc?.chainWord ?? null
  const buyUsd = usdc ? Math.min(25, Math.floor(usdc.units)) : 25
  const rows: PlaceRow[] = []
  const seen = new Set<string>()
  const add = (symbol: string, h: Held | null) => {
    const key = priceSymbolFor(symbol)
    if (seen.has(key)) return
    const price = marks.get(key)?.markPx
    if (!(price && price > 0)) return
    seen.add(key)
    const buy = buyUsd >= 1 ? cowBuyLowerAsk(symbol, price, { usd: buyUsd, chainWord: payChain ?? h?.chainWord ?? null }) : null
    // Native ETH is not an ERC-20: CoW sells WETH, so a native balance offers no sell.
    const sell = h && h.symbol !== 'ETH' && (h.valueUsd ?? 0) >= 5 ? cowSellHigherAsk(symbol, price, h.units, { chainWord: h.chainWord }) : null
    rows.push({ symbol, price, buy, sell, buyUsd })
  }
  const tokens = held
    .filter((h) => !STABLES.has(h.symbol) && (h.valueUsd ?? 0) >= 5)
    .sort((a, b) => (b.valueUsd ?? 0) - (a.valueUsd ?? 0))
  const eth = tokens.find((h) => priceSymbolFor(h.symbol) === 'ETH') ?? null
  add(eth?.symbol ?? 'ETH', eth)
  for (const h of tokens) {
    if (rows.length >= 3) break
    add(h.symbol, h)
  }
  return rows
}

