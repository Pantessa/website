// MACRO — the board and the words for the markets that explain every other
// market (2026-11-09; Nate: "our system is lacking view of many other stocks
// and indexes like the US10Y").
//
// Two families share one board:
//   • LOOK-ONLY INDEXES (lib/charts CHART_INDEXES): the 10-year yield, the
//     VIX, the dollar index, the Nasdaq 100, the Dow, the Russell 2000.
//     Delayed index data with a full chart and no order: nothing listed here
//     trades an index, so the page names the closest thing that IS listed
//     (SPY, QQQ, SHY…) the way the home's read does, and never a dead chip.
//   • HYPERLIQUID MACRO MARKETS the app already charts and listed on no
//     board until now: the S&P 500, long Treasuries, the euro, the yen, gold,
//     silver, crude and natural gas — round-the-clock builder markets.
//
// The rows are STATIC DATA on purpose. The Hyperliquid half resolves through
// the venue's live universe (lib/charts chartPairFor is cold in a browser
// and on a fresh server), so a board built from the resolver would render
// one set of rows on the server and another in the browser. Instead the
// board lists these names, the quotes route says when the venue stops
// listing one (`unlisted`, lib/quotes), and the board drops that row: a
// delisted market never sits there as a dash.
//
// Pure and client-safe (no fetch, no DOM). Pinned by scripts/macro-pins.ts.

import { CHART_INDEXES, chartIndexFor, chartUnitOf, isLookOnlyPair, lookOnlyRefusal, type ChartPair, type ChartUnit } from '@/lib/charts'
import { fmtReadChange, fmtReadValue, fmtReadValueFull, READ_INDEX_VENUE_LINE, READ_INSTRUMENTS, type ReadNear, type ReadTone, readTone } from '@/lib/read'

// ── The board ────────────────────────────────────────────────────────────────

export type MacroGroup = 'stocks' | 'rates' | 'dollar' | 'commodities'

export const MACRO_GROUP_LABEL: Readonly<Record<MacroGroup, string>> = {
  stocks: 'Stocks',
  rates: 'Rates',
  dollar: 'Dollar',
  commodities: 'Commodities',
}

export interface MacroRow {
  symbol: string
  name: string
  /** `index`: look-only index data. `hyperliquid`: a round-the-clock builder market. */
  source: 'index' | 'hyperliquid'
  unit: ChartUnit
  group: MacroGroup
  /** Decimals for a level that needs more than two (an FX rate). */
  dp?: number
  /** Other words a visitor searches by, lower case. */
  keywords: string
}

const indexRow = (symbol: string, group: MacroGroup, keywords: string): MacroRow => {
  const ix = CHART_INDEXES.find((i) => i.symbol === symbol)!
  return { symbol: ix.symbol, name: ix.name, source: 'index', unit: ix.unit, group, keywords }
}

/** Fourteen rows, grouped the way a macro desk reads them. */
export const MACRO_ROWS: readonly MacroRow[] = [
  { symbol: 'SP500', name: 'S&P 500', source: 'hyperliquid', unit: 'level', group: 'stocks', keywords: 'spx s&p sp 500 us500 stocks index' },
  indexRow('NDX', 'stocks', 'nasdaq 100 nas100 us100 tech index'),
  indexRow('DJI', 'stocks', 'dow jones djia us30 industrials index'),
  indexRow('RUT', 'stocks', 'russell 2000 small caps us2000 rty index'),
  indexRow('VIX', 'stocks', 'volatility fear cboe index'),
  indexRow('US10Y', 'rates', '10 year 10-year 10y tnx treasury treasuries yield yields rates bonds'),
  { symbol: 'TLT', name: 'Long Treasuries, 20+ years', source: 'hyperliquid', unit: 'usd', group: 'rates', keywords: 'treasury treasuries bonds rates 20 year long bond' },
  indexRow('DXY', 'dollar', 'dollar index usd dx fx currency'),
  { symbol: 'EUR', name: 'Euro / US dollar', source: 'hyperliquid', unit: 'level', group: 'dollar', dp: 4, keywords: 'euro eurusd fx currency' },
  { symbol: 'JPY', name: 'US dollar / Japanese yen', source: 'hyperliquid', unit: 'level', group: 'dollar', keywords: 'yen usdjpy japan fx currency' },
  { symbol: 'GOLD', name: 'Gold', source: 'hyperliquid', unit: 'usd', group: 'commodities', keywords: 'xau metal commodity' },
  { symbol: 'SILVER', name: 'Silver', source: 'hyperliquid', unit: 'usd', group: 'commodities', keywords: 'xag metal commodity' },
  { symbol: 'CL', name: 'Crude oil (WTI)', source: 'hyperliquid', unit: 'usd', group: 'commodities', keywords: 'oil crude wti energy commodity' },
  { symbol: 'NATGAS', name: 'Natural gas', source: 'hyperliquid', unit: 'usd', group: 'commodities', dp: 3, keywords: 'nat gas ng energy commodity' },
]

export const MACRO_SYMBOLS: readonly string[] = MACRO_ROWS.map((r) => r.symbol)

export function macroRow(symbol: string | null | undefined): MacroRow | null {
  const sym = (symbol ?? '').toUpperCase()
  return MACRO_ROWS.find((r) => r.symbol === sym) ?? null
}

export const MACRO_SECTION = {
  id: 'macro' as const,
  title: 'Macro',
  blurb: 'Indexes, rates, the dollar and commodities. The index rows are delayed data, here to read. The rest are Hyperliquid markets that never close.',
}

/** The board's rows: every row, minus the Hyperliquid markets the quotes
 *  read said the venue no longer lists. An index row never drops (its page
 *  is static), and a row whose feed merely did not answer keeps its dash. */
export function macroBoardRows(unlisted: readonly string[] = []): MacroRow[] {
  const gone = new Set(unlisted.map((s) => s.toUpperCase()))
  return MACRO_ROWS.filter((r) => r.source === 'index' || !gone.has(r.symbol))
}

/** The display name of a macro symbol the other name maps do not carry
 *  ("S&P 500" for SP500, "US 10-year Treasury yield" for US10Y), or null. */
export function macroName(symbol: string): string | null {
  return chartIndexFor(symbol)?.name ?? macroRow(symbol)?.name ?? null
}

/** Does a typed query find this row? Its symbol by prefix, or any word of
 *  its name or keywords. Hyphens and spaces read alike ("10 year" finds
 *  "10-year"). */
export function macroRowMatches(row: MacroRow, queryRaw: string): boolean {
  const fold = (s: string) => s.toLowerCase().replace(/[^a-z0-9&]+/g, ' ').trim()
  const q = fold(queryRaw.replace(/^\$/, ''))
  if (!q) return false
  if (row.symbol.toLowerCase().startsWith(q.replace(/\s+/g, ''))) return true
  return ` ${fold(row.name)} ${fold(row.keywords)} `.includes(` ${q}`)
}

// ── Numbers ──────────────────────────────────────────────────────────────────

interface Unitful {
  unit: ChartUnit
  dp?: number
}

/** A row's last as a board prints it: "4.84%" · "27,495" · "101.86" · "1.1200" · "$4,123" · "$3.290". */
export function fmtMacroLast(row: Unitful, last: number | null | undefined): string {
  if (last == null || !Number.isFinite(last)) return '—'
  if (row.dp != null && row.unit !== 'yield') {
    const body = last.toLocaleString('en-US', { minimumFractionDigits: row.dp, maximumFractionDigits: row.dp })
    return row.unit === 'usd' ? `$${body}` : body
  }
  return fmtReadValue(row, last)
}

/** A quote's move in the row's own unit: basis points for a yield (its `chg`
 *  is in percentage points), percent for everything else. */
export function macroChangeOf(row: Unitful, q: { chg: number; chgPct: number } | null | undefined): number | null {
  if (!q) return null
  const v = row.unit === 'yield' ? q.chg * 100 : q.chgPct
  return Number.isFinite(v) ? v : null
}

/** "+0.86%" · "−2.3 bp" · "—". */
export function fmtMacroChange(row: Unitful, q: { chg: number; chgPct: number } | null | undefined): string {
  return fmtReadChange(row, macroChangeOf(row, q))
}

export function macroTone(row: Unitful, q: { chg: number; chgPct: number } | null | undefined): ReadTone {
  return readTone(macroChangeOf(row, q), row.unit)
}

/** A row's tag: what kind of number this is, and whether it is moving now. */
export function macroRowTag(row: MacroRow, session: 'open' | 'closed' | '24/7' | null | undefined): { text: string; tone: 'always' | 'open' | 'closed' } {
  if (row.source === 'hyperliquid') return { text: '24/7', tone: 'always' }
  return session === 'closed' ? { text: 'closed', tone: 'closed' } : { text: 'delayed', tone: 'open' }
}

// ── A pair's value on its own page ───────────────────────────────────────────

/** How a pair's value prints in a page header: an index in its own unit
 *  ("4.837%", "27,495.25", "23.22"); anything else is handed back to the
 *  caller's live-price ladder with or without the dollar sign. */
export function fmtIndexValue(pair: ChartPair, v: number | null | undefined): string {
  return fmtReadValueFull({ unit: chartUnitOf(pair) }, v)
}

/** A header stat (a day's high or low) in the pair's unit. */
export function fmtIndexStat(pair: ChartPair, v: number | null | undefined): string {
  return fmtReadValue({ unit: chartUnitOf(pair) }, v)
}

// ── Look-only words ──────────────────────────────────────────────────────────

/** The venue chip beside an index's symbol. */
export const LOOK_ONLY_VENUE = 'Index data'
/** Whose number it is, one sentence (the home's read says the same words). */
export const LOOK_ONLY_SOURCE_LINE = READ_INDEX_VENUE_LINE
/** The rail card's head, where the order ticket sits on a tradable page. */
export const LOOK_ONLY_HEAD = 'HERE TO READ'
export const LOOK_ONLY_SUB = 'NOTHING TO SIGN'

/** The spoken name inside a sentence: "the VIX", "the 10-year yield". */
const SPOKEN: Readonly<Record<string, string>> = {
  US10Y: 'the 10-year yield',
  VIX: 'the VIX',
  DXY: 'the dollar index',
  NDX: 'the Nasdaq 100',
  DJI: 'the Dow',
  RUT: 'the Russell 2000',
}
export function lookOnlySpoken(symbol: string): string {
  const ix = chartIndexFor(symbol)
  return ix ? (SPOKEN[ix.symbol] ?? ix.name) : symbol.toUpperCase()
}

/** The nearest things listed here for the two indexes the home's read does
 *  not carry. No fund here tracks the Dow or the Russell 2000 (DIA and IWM
 *  are not listed, measured 2026-11-09), so the closest listing is the broad
 *  US stock fund — said as what it is, never as a tracker. */
const NEAR_EXTRA: Readonly<Record<string, readonly ReadNear[]>> = {
  DJI: [{ symbol: 'SPY', as: 'the S&P 500 fund' }],
  RUT: [{ symbol: 'SPY', as: 'the S&P 500 fund (large caps, not small)' }],
}

/** The nearest things listed here for an index, nearest first; [] when
 *  nothing is (the VIX). The four the home's read shows keep ITS list, so
 *  the home and the page can never name different neighbours. */
export function lookOnlyNear(symbol: string): readonly ReadNear[] {
  const ix = chartIndexFor(symbol)
  if (!ix) return []
  const read = READ_INSTRUMENTS.find((i) => i.source === 'index' && i.symbol === ix.host)
  return read ? read.near : (NEAR_EXTRA[ix.symbol] ?? [])
}

/** What the page says where an order ticket would be. */
export function lookOnlyNoActLine(symbol: string): string {
  return lookOnlyNear(symbol).length === 0 ? `Nothing listed here trades ${lookOnlySpoken(symbol)}. It is here to read.` : `Nothing here trades ${lookOnlySpoken(symbol)} directly.`
}

/** A header's words for the session, from the quote's own print: trading
 *  (delayed), or closed on its last session's numbers. Null quote → the
 *  neutral words. */
export function lookOnlySessionLine(session: 'open' | 'closed' | '24/7' | null | undefined): string {
  if (session === 'closed') return 'Index data · closed, showing its last session'
  if (session === 'open') return 'Index data · trading, delayed up to 15 minutes'
  return 'Index data · delayed up to 15 minutes'
}

/** What a model is told about an index's numbers (the AI brief and Ask the
 *  chart read bare values): the unit, and that it is delayed look-only data.
 *  Null for anything that is not a look-only index. */
export function lookOnlyUnitNote(pair: ChartPair | null | undefined): string | null {
  if (!isLookOnlyPair(pair)) return null
  const unit = chartUnitOf(pair)
  const values = unit === 'yield' ? 'its values are a yield in percent (4.84 means 4.84%) and its moves are stated in basis points' : 'its values are index points'
  return `units: ${values}, never a dollar price; it is delayed look-only index data, and the "24h" figures are measured over its trading sessions`
}

/** What a change on an index page is measured from. */
export function lookOnlyBasis(session: 'open' | 'closed' | '24/7' | null | undefined): string {
  return session === 'closed' ? 'in its last session' : 'since the last close'
}

/** Re-exported for a surface that only has a pair in hand. */
export { isLookOnlyPair, lookOnlyRefusal }
