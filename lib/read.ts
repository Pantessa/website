// THE READ — the home's lead: the market as one sentence (2026-11-09).
//
// Nate, 2026-11-09: "our system is lacking view of many other stocks and
// indexes like the US10Y … the flyover and the front just seem a bit too
// gimmicky", then "rethink the home page as well, max creativity to you".
//
// The product's unit is a sentence ("Buy $25 of AAPL" is the order). So the
// front door speaks the same way: the market is written as ONE headline —
// "Stocks rise 0.9%, oil slumps 4.1%, bitcoin slips 1.6%." — composed by the
// rules below from live quotes (no model writes it, nothing is rounded into
// an adjective the number doesn't earn). Every clause is a button: tap one
// and the chart under the line is that market. Under the headline rides the
// MACRO LINE (nine tiles: the S&P 500, the Nasdaq 100, the 10-year yield,
// the VIX, the dollar, gold, oil, bitcoin, ether) and under that the chart
// of the selection with what can be done about it here.
//
// Where the numbers come from (measured 2026-11-09):
//   • `app` instruments are symbols the app already quotes and charts
//     (lib/quotes + lib/candles-server): the S&P 500, gold and crude are
//     Hyperliquid's round-the-clock markets (`/t/SP500`, `/t/GOLD`, `/t/CL`
//     exist since the live universe landed), bitcoin and ether are Coinbase.
//   • `index` instruments are look-only index data (the Nasdaq 100, the
//     10-year yield, the VIX, the dollar index) from the same chart API the
//     stock candles already fall back to; delayed, closed with their
//     exchange, and SAID to be.
//
// Honesty rules: a clause with no quote is omitted (never a guessed "flat");
// a verb is chosen by the move over that market's own typical day, so "oil
// slumps" and "stocks slump" mean the same size of surprise; a look-only
// market never wears a trade button — it names the nearest thing listed
// here that can be bought, and offers that sentence instead.
//
// This module is pure (no fetch, no clock it isn't handed, no DOM). Pinned
// by scripts/read-pins.ts; read by lib/read-server.ts (the snapshot), the
// route app/api/markets/read and components/home/TheRead.tsx.

// ── The instruments ──────────────────────────────────────────────────────────

export type ReadId = 'spx' | 'ndx' | 'us10y' | 'vix' | 'dxy' | 'gold' | 'oil' | 'btc' | 'eth'

/** `app`: quoted + charted by the app's own readers (it has a /t page).
 *  `index`: look-only index data (no page, no order). */
export type ReadSource = 'app' | 'index'

/** How a value prints: dollars, a bare index level, or a yield in percent
 *  (whose change is stated in basis points). */
export type ReadUnit = 'usd' | 'level' | 'yield'

export interface ReadNear {
  /** A symbol listed here (it has a /t page). */
  symbol: string
  /** What it is, in the sentence "…the closest thing here is X, <as>". */
  as: string
}

export interface ReadInstrument {
  id: ReadId
  /** The tile's label. */
  label: string
  /** The chart header's name. */
  name: string
  /** The headline's subject as it would start a sentence; null = a tile only. */
  subject: string | null
  plural: boolean
  source: ReadSource
  /** The app symbol (source `app`) or the index data symbol (source `index`). */
  symbol: string
  unit: ReadUnit
  /** A typical day's absolute move: percent, or basis points for a yield.
   *  The headline's verb is the move measured in these. */
  typical: number
  /** Whose number it is, for the tile's tag and the foot. */
  venue: 'Hyperliquid' | 'Coinbase' | 'Index data'
  /** Orders on the symbol itself build here: a coin with a spot venue, or a
   *  Hyperliquid builder-dex perp the order layer builds on (the S&P 500, gold
   *  and oil are `xyz:` markets — lib/hl-dex; tradable since 2026-11-09). The
   *  card offers its own market first and still names the nearest listed
   *  thing (`near`) for anyone who would rather hold the fund than a perp. */
  direct: boolean
  /** The nearest things listed here, nearest first. */
  near: readonly ReadNear[]
  /** The venue's own market name when the instrument is a Hyperliquid perp
   *  that only the live universe knows (`xyz:SP500`). The card runs on `/`,
   *  where the browser holds no live perp table (only a symbol page is handed
   *  one), so the pair its chips are composed from is stated here: the server
   *  and the browser then offer the same chips. */
  coin?: string
}

/** Nine instruments, in tile order. */
export const READ_INSTRUMENTS: readonly ReadInstrument[] = [
  { id: 'spx', label: 'S&P 500', name: 'S&P 500', subject: 'Stocks', plural: true, source: 'app', symbol: 'SP500', unit: 'level', typical: 0.8, venue: 'Hyperliquid', coin: 'xyz:SP500', direct: true, near: [{ symbol: 'SPY', as: 'the S&P 500 fund' }] },
  { id: 'ndx', label: 'Nasdaq 100', name: 'Nasdaq 100', subject: null, plural: false, source: 'index', symbol: '^NDX', unit: 'level', typical: 1.1, venue: 'Index data', direct: false, near: [{ symbol: 'QQQ', as: 'the Nasdaq 100 fund' }] },
  { id: 'us10y', label: '10-yr yield', name: 'US 10-year Treasury yield', subject: 'Yields', plural: true, source: 'index', symbol: '^TNX', unit: 'yield', typical: 6, venue: 'Index data', direct: false, near: [{ symbol: 'SHY', as: 'a short Treasuries fund' }, { symbol: 'TLT', as: 'long Treasuries' }] },
  { id: 'vix', label: 'VIX', name: 'VIX volatility index', subject: null, plural: false, source: 'index', symbol: '^VIX', unit: 'level', typical: 6, venue: 'Index data', direct: false, near: [] },
  { id: 'dxy', label: 'Dollar', name: 'US dollar index', subject: 'The dollar', plural: false, source: 'index', symbol: 'DX-Y.NYB', unit: 'level', typical: 0.4, venue: 'Index data', direct: false, near: [{ symbol: 'EUR', as: 'the euro' }, { symbol: 'JPY', as: 'the yen' }] },
  { id: 'gold', label: 'Gold', name: 'Gold', subject: 'Gold', plural: false, source: 'app', symbol: 'GOLD', unit: 'usd', typical: 1, venue: 'Hyperliquid', coin: 'xyz:GOLD', direct: true, near: [{ symbol: 'GLD', as: 'the gold fund' }] },
  { id: 'oil', label: 'Oil', name: 'Crude oil (WTI)', subject: 'Oil', plural: false, source: 'app', symbol: 'CL', unit: 'usd', typical: 2, venue: 'Hyperliquid', coin: 'xyz:CL', direct: true, near: [{ symbol: 'USO', as: 'the oil fund' }] },
  { id: 'btc', label: 'Bitcoin', name: 'Bitcoin', subject: 'Bitcoin', plural: false, source: 'app', symbol: 'BTC', unit: 'usd', typical: 2.5, venue: 'Coinbase', direct: true, near: [] },
  { id: 'eth', label: 'Ether', name: 'Ether', subject: null, plural: false, source: 'app', symbol: 'ETH', unit: 'usd', typical: 3.2, venue: 'Coinbase', direct: true, near: [] },
]

export const READ_IDS: readonly ReadId[] = READ_INSTRUMENTS.map((i) => i.id)
export const READ_DEFAULT_ID: ReadId = 'spx'

export function readInstrument(id: ReadId): ReadInstrument {
  return READ_INSTRUMENTS.find((i) => i.id === id) ?? READ_INSTRUMENTS[0]
}

export function parseReadId(raw: string | null | undefined): ReadId | null {
  return READ_INSTRUMENTS.some((i) => i.id === raw) ? (raw as ReadId) : null
}

/** The app symbols the snapshot quotes (source `app`). */
export const READ_APP_SYMBOLS: readonly string[] = READ_INSTRUMENTS.filter((i) => i.source === 'app').map((i) => i.symbol)

/** The symbol page of an instrument, when it has one. */
export function readPageHref(inst: ReadInstrument): string | null {
  return inst.source === 'app' ? `/t/${inst.symbol}` : null
}

// ── The snapshot ─────────────────────────────────────────────────────────────

/** One point of a series: unix seconds, value. */
export type ReadPoint = readonly [t: number, v: number]

export interface ReadQuote {
  last: number
  /** The value the change is measured from (24h ago, or the last close); null = no change stated. */
  prev: number | null
  /** Percent — or BASIS POINTS for a yield. Null when `prev` is. */
  chg: number | null
  /** When the price printed, ms. */
  asOf: number
  /** The market is trading now (a round-the-clock venue, or an index inside its session). */
  live: boolean
  /** Today's series (24h of 15-minute closes, or the latest session's). */
  points: ReadPoint[]
}

export interface ReadMover {
  symbol: string
  chgPct: number
}

export interface ReadSnapshot {
  /** When the snapshot was composed, ms. */
  asOf: number
  quotes: Partial<Record<ReadId, ReadQuote>>
  /** The biggest moves among the household stocks listed here, largest first (at most four). */
  movers: ReadMover[]
}

export const EMPTY_READ: ReadSnapshot = { asOf: 0, quotes: {}, movers: [] }

/** A quote from a last and the value it is measured from. Yields change in
 *  basis points (4.84% from 4.86% is −2 bp); everything else in percent. */
export function readQuoteOf(inst: ReadInstrument, last: number, prev: number | null, asOf: number, live: boolean, points: ReadPoint[]): ReadQuote | null {
  if (!Number.isFinite(last) || !(last > 0)) return null
  const okPrev = prev != null && Number.isFinite(prev) && prev > 0 ? prev : null
  const chg = okPrev == null ? null : inst.unit === 'yield' ? (last - okPrev) * 100 : (last / okPrev - 1) * 100
  return { last, prev: okPrev, chg, asOf, live, points }
}

// ── The verbs ────────────────────────────────────────────────────────────────

export type ReadTone = 'up' | 'down' | 'flat'

/** The move in typical days: +1 is an ordinary up day for THAT market. */
export function readScore(inst: ReadInstrument, chg: number | null | undefined): number | null {
  if (chg == null || !Number.isFinite(chg) || !(inst.typical > 0)) return null
  return chg / inst.typical
}

/** The ladder, low edge inclusive on the way up and high edge inclusive on
 *  the way down: under a fifth of a typical day nothing happened. */
export const READ_VERB_EDGES = { steady: 0.2, edge: 0.6, jump: 1.75 } as const

export interface ReadVerb {
  /** As a plural subject takes it ("stocks rise"). */
  plural: string
  /** As a singular subject takes it ("oil rises"). */
  singular: string
  tone: ReadTone
  /** Whether the amount follows the verb ("rise 0.9%"; "hold steady" stands alone). */
  amount: boolean
}

export function readVerb(score: number): ReadVerb {
  const a = Math.abs(score)
  if (a < READ_VERB_EDGES.steady) return { plural: 'hold steady', singular: 'holds steady', tone: 'flat', amount: false }
  if (score > 0) {
    if (a < READ_VERB_EDGES.edge) return { plural: 'edge up', singular: 'edges up', tone: 'up', amount: true }
    if (a < READ_VERB_EDGES.jump) return { plural: 'rise', singular: 'rises', tone: 'up', amount: true }
    return { plural: 'jump', singular: 'jumps', tone: 'up', amount: true }
  }
  if (a < READ_VERB_EDGES.edge) return { plural: 'slip', singular: 'slips', tone: 'down', amount: true }
  if (a < READ_VERB_EDGES.jump) return { plural: 'fall', singular: 'falls', tone: 'down', amount: true }
  return { plural: 'slump', singular: 'slumps', tone: 'down', amount: true }
}

/** The size of a move as a headline states it: "0.9%" · "12%" · "3 bp" · "0.5 bp". Never signed — the verb is the sign. */
export function fmtReadAmount(inst: ReadInstrument, chg: number): string {
  const a = Math.abs(chg)
  if (inst.unit === 'yield') return `${a >= 10 ? a.toFixed(0) : trimZero(a.toFixed(1))} bp`
  return `${a >= 10 ? a.toFixed(0) : a.toFixed(1)}%`
}

function trimZero(s: string): string {
  return s.endsWith('.0') ? s.slice(0, -2) : s
}

// ── The headline ─────────────────────────────────────────────────────────────

export interface ReadClause {
  id: ReadId
  /** "Stocks" first in the line, "oil" after it. */
  subject: string
  verb: string
  /** "0.9%" — empty when the verb stands alone. */
  amount: string
  tone: ReadTone
}

/** Clauses in a headline. */
export const READ_HEADLINE_CLAUSES = 3

/** What the line says before any quote has landed. */
export const READ_WAITING = 'Reading the markets'

function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s
}

/**
 * The headline's clauses: stocks lead when they are quoted (the anchor a
 * reader looks for first), then the markets that surprised most today, by
 * their own typical day — at most three in all. A market with no stated
 * change never appears, and neither does one that is CLOSED: its change is
 * a session that already ended (Friday's yields are not Sunday's news), so
 * it keeps its tile and stays out of the line. Ties keep tile order.
 */
export function readHeadline(snap: ReadSnapshot, n = READ_HEADLINE_CLAUSES): ReadClause[] {
  const scored = READ_INSTRUMENTS.filter((i) => i.subject !== null && snap.quotes[i.id]?.live !== false)
    .map((inst, order) => ({ inst, order, chg: snap.quotes[inst.id]?.chg ?? null }))
    .map((r) => ({ ...r, score: readScore(r.inst, r.chg) }))
    .filter((r): r is typeof r & { chg: number; score: number } => r.score !== null && r.chg !== null)
  if (scored.length === 0) return []
  const anchor = scored.find((r) => r.inst.id === 'spx')
  const rest = scored.filter((r) => r !== anchor).sort((a, b) => Math.abs(b.score) - Math.abs(a.score) || a.order - b.order)
  const picked = (anchor ? [anchor, ...rest] : rest).slice(0, Math.max(1, n))
  return picked.map((r, i) => {
    const v = readVerb(r.score)
    const subject = r.inst.subject as string
    return {
      id: r.inst.id,
      subject: i === 0 ? subject : lowerFirst(subject),
      verb: r.inst.plural ? v.plural : v.singular,
      amount: v.amount ? fmtReadAmount(r.inst, r.chg) : '',
      tone: v.tone,
    }
  })
}

/** One clause as text: "Stocks rise 0.9%". */
export function readClauseText(c: ReadClause): string {
  return c.amount ? `${c.subject} ${c.verb} ${c.amount}` : `${c.subject} ${c.verb}`
}

/** The whole line as plain text (the page's own words for a crawler, a
 *  screen reader and the share text): "Stocks rise 0.9%, oil slumps 4.1%,
 *  bitcoin slips 1.6%." — or the waiting words. */
export function readHeadlineText(clauses: readonly ReadClause[]): string {
  if (clauses.length === 0) return `${READ_WAITING}.`
  return `${clauses.map(readClauseText).join(', ')}.`
}

// ── The movers ───────────────────────────────────────────────────────────────

/** The household stocks the movers line reads (each is offered only while it
 *  is listed here — the server filters through the chart pair table). */
export const READ_MOVER_POOL: readonly string[] = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'AMD', 'NFLX', 'ORCL', 'TSM', 'ASML', 'INTC', 'MU', 'PLTR', 'COIN', 'MSTR', 'HOOD', 'BA', 'BABA', 'UBER', 'CRM', 'ADBE', 'SMCI', 'ARM']

/** A stock under this absolute move is not a "biggest move". */
export const READ_MOVER_FLOOR_PCT = 1.5
export const READ_MOVERS_MAX = 4

/** The biggest absolute moves at or past the floor, largest first. Unquoted rows never rank. */
export function rankReadMovers(rows: readonly { symbol: string; chgPct: number | null | undefined }[], max = READ_MOVERS_MAX, floor = READ_MOVER_FLOOR_PCT): ReadMover[] {
  return rows
    .filter((r): r is { symbol: string; chgPct: number } => r.chgPct != null && Number.isFinite(r.chgPct) && Math.abs(r.chgPct) >= floor)
    .sort((a, b) => Math.abs(b.chgPct) - Math.abs(a.chgPct) || a.symbol.localeCompare(b.symbol))
    .slice(0, max)
    .map((r) => ({ symbol: r.symbol, chgPct: r.chgPct }))
}

// ── Numbers ──────────────────────────────────────────────────────────────────

export function readTone(chg: number | null | undefined, unit: ReadUnit = 'usd'): ReadTone {
  if (chg == null || !Number.isFinite(chg)) return 'flat'
  const eps = unit === 'yield' ? 0.05 : 0.005
  return chg > eps ? 'up' : chg < -eps ? 'down' : 'flat'
}

const group = (n: number, min: number, max: number): string => n.toLocaleString('en-US', { minimumFractionDigits: min, maximumFractionDigits: max })

/** A value as a TILE prints it (narrow): "7,445" · "101.85" · "4.84%" · "$74,587" · "$86.68". */
export function fmtReadValue(inst: ReadInstrument, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  if (inst.unit === 'yield') return `${v.toFixed(2)}%`
  const body = v >= 1000 ? group(v, 0, 0) : group(v, 2, 2)
  return inst.unit === 'usd' ? `$${body}` : body
}

/** A value as the chart's header prints it (two places from a thousand up): "7,444.70" · "$74,587.25" · "4.841%". */
export function fmtReadValueFull(inst: ReadInstrument, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  if (inst.unit === 'yield') return `${v.toFixed(3)}%`
  const body = group(v, 2, 2)
  return inst.unit === 'usd' ? `$${body}` : body
}

/** A signed change: "+0.86%" · "−4.12%" · "−1.8 bp". A true minus sign, so a column of them aligns. */
export function fmtReadChange(inst: ReadInstrument, chg: number | null | undefined): string {
  if (chg == null || !Number.isFinite(chg)) return '—'
  const sign = chg > 0 ? '+' : chg < 0 ? '−' : ''
  const a = Math.abs(chg)
  if (inst.unit === 'yield') return `${sign}${a >= 10 ? a.toFixed(0) : a.toFixed(1)} bp`
  return `${sign}${a.toFixed(2)}%`
}

export function fmtReadPct(chgPct: number): string {
  const sign = chgPct > 0 ? '+' : chgPct < 0 ? '−' : ''
  return `${sign}${Math.abs(chgPct).toFixed(2)}%`
}

// ── Ranges ───────────────────────────────────────────────────────────────────

export type ReadRange = '1d' | '1w' | '1m' | '6m'

export const READ_RANGES: readonly { id: ReadRange; label: string; words: string }[] = [
  { id: '1d', label: '1D', words: 'today' },
  { id: '1w', label: '1W', words: 'over a week' },
  { id: '1m', label: '1M', words: 'over a month' },
  { id: '6m', label: '6M', words: 'over six months' },
]

export const READ_DEFAULT_RANGE: ReadRange = '1d'

export function parseReadRange(raw: string | null | undefined): ReadRange | null {
  return READ_RANGES.some((r) => r.id === raw) ? (raw as ReadRange) : null
}

/** What a 1D change is measured over, said under the number: a round-the-clock
 *  market states its last 24 hours; an index its move since the last close
 *  while it trades, and its last session's move once it has closed (the price
 *  is then that session's close, measured from the one before). */
export function readBasisWords(inst: ReadInstrument, range: ReadRange = '1d', live = true): string {
  if (range !== '1d') return READ_RANGES.find((r) => r.id === range)?.words ?? ''
  if (inst.source !== 'index') return 'in 24 hours'
  return live ? 'since the last close' : 'in its last session'
}

/** The change a series states by itself: first value to last (a longer range's own move). */
export function readSeriesChange(inst: ReadInstrument, points: readonly ReadPoint[]): number | null {
  if (points.length < 2) return null
  const first = points[0][1]
  const last = points[points.length - 1][1]
  if (!(first > 0) || !Number.isFinite(last)) return null
  return inst.unit === 'yield' ? (last - first) * 100 : (last / first - 1) * 100
}

// ── The chart's geometry ─────────────────────────────────────────────────────

/** The chart is drawn in a stretched viewBox (the plot's CSS box sets the
 *  size), so the server renders the final frame with no measurement. */
export const READ_CHART_W = 1000
export const READ_CHART_H = 300
/** Air above and below the series, as a share of its span. */
export const READ_CHART_PAD = 0.08

export interface ReadChart {
  /** The series' line. */
  line: string
  /** The same line closed to the floor, for the fill. */
  area: string
  min: number
  max: number
  /** The baseline's y (the value the change is measured from), when it sits inside the plot. */
  baseY: number | null
  /** Per point: x and y in viewBox units. */
  xs: number[]
  ys: number[]
}

/**
 * A series as SVG paths. x is the point's ORDER, not its clock time: an
 * index's weekend and overnight gaps would otherwise draw as long flat
 * lines. `base` (the previous close / the value 24h ago) widens the scale so
 * the baseline is always on the plot. Fewer than two points draw nothing.
 */
export function readChart(points: readonly ReadPoint[], base: number | null = null, w = READ_CHART_W, h = READ_CHART_H, pad = READ_CHART_PAD): ReadChart | null {
  const vals = points.map((p) => p[1]).filter((v) => Number.isFinite(v))
  if (vals.length < 2 || vals.length !== points.length) return null
  let min = Math.min(...vals)
  let max = Math.max(...vals)
  if (base != null && Number.isFinite(base)) {
    min = Math.min(min, base)
    max = Math.max(max, base)
  }
  if (max === min) {
    max += Math.abs(max) * 0.001 || 1
    min -= Math.abs(min) * 0.001 || 1
  }
  const span = max - min
  const lo = min - span * pad
  const hi = max + span * pad
  const n = vals.length
  const x = (i: number) => (i / (n - 1)) * w
  const y = (v: number) => h - ((v - lo) / (hi - lo)) * h
  const xs = vals.map((_, i) => round2(x(i)))
  const ys = vals.map((v) => round2(y(v)))
  const line = xs.map((px, i) => `${i === 0 ? 'M' : 'L'}${px} ${ys[i]}`).join(' ')
  const area = `${line} L${w} ${h} L0 ${h} Z`
  return { line, area, min, max, baseY: base != null && Number.isFinite(base) ? round2(y(base)) : null, xs, ys }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/** A tile's sparkline: the same points thinned to at most `n`, as a path in a `w`×`h` box. */
export function readSpark(points: readonly ReadPoint[], w = 64, h = 20, n = 32): string {
  if (points.length < 2) return ''
  const step = Math.max(1, Math.ceil(points.length / n))
  const thin = points.filter((_, i) => i % step === 0 || i === points.length - 1)
  return readChart(thin, null, w, h, 0.12)?.line ?? ''
}

/** The point under a pointer at `frac` of the plot's width (0..1). */
export function readPointAt(points: readonly ReadPoint[], frac: number): number | null {
  if (points.length === 0 || !Number.isFinite(frac)) return null
  return Math.min(points.length - 1, Math.max(0, Math.round(frac * (points.length - 1))))
}

// ── Words around the numbers ─────────────────────────────────────────────────

/** The chart pair an instrument's OWN chips are composed from, when the table
 *  states its market (`coin`): a Hyperliquid perp pair, built from static
 *  facts so the server render and the browser agree. Null for everything else
 *  (a coin's pair comes from the static chart table as before). */
export function readOwnPair(inst: ReadInstrument): { symbol: string; source: 'hyperliquid'; pair: string; label: string } | null {
  return inst.coin ? { symbol: inst.symbol, source: 'hyperliquid', pair: inst.coin, label: `${inst.symbol} / USD` } : null
}

/** Whose number it is, one sentence, for the panel beside the chart. */
export function readVenueLine(inst: ReadInstrument): string {
  if (inst.source === 'index') return 'Index data, delayed up to 15 minutes. It closes when its exchange does.'
  if (inst.venue === 'Hyperliquid') return `Hyperliquid's round-the-clock ${inst.name} market.`
  return 'Coinbase spot, round the clock.'
}

/** What to say when nothing listed here can be bought in its place. */
export function readNoActLine(inst: ReadInstrument): string {
  return inst.near.length === 0 ? `Nothing listed here trades ${inst.id === 'vix' ? 'the VIX' : inst.label}. It is here to read.` : 'Nothing here trades it directly.'
}

/** The line under the tiles: whose numbers these are, in one sentence each. */
export const READ_SOURCES_LINE =
  'The S&P 500, gold and oil are Hyperliquid markets that never close. Bitcoin and ether are Coinbase. The Nasdaq, the 10-year, the VIX and the dollar are delayed index data.'

/** A tile's tag: "24/7" for a market that never closes, "closed" for an index outside its session, nothing while it trades. */
export function readTileTag(inst: ReadInstrument, q: ReadQuote | undefined): '24/7' | 'closed' | '' {
  if (inst.source === 'app') return '24/7'
  return q && !q.live ? 'closed' : ''
}

/** How long a snapshot stays fresh on the client before it asks again, and how old a server copy may be served. */
export const READ_REFRESH_MS = 30_000
export const READ_SERVER_TTL_MS = 30_000
/** An index print older than this is outside its session. */
export const READ_LIVE_WINDOW_MS = 20 * 60_000
/** An index session younger than this many bars is drawn with the session before it, so "today" is never a stub. */
export const READ_MIN_SESSION_BARS = 8
/** A longer series is thinned to at most this many points before it is served. */
export const READ_SERIES_MAX_POINTS = 240

/** Every k-th point, always keeping the last: at most `max` points. */
export function thinReadPoints(points: readonly ReadPoint[], max = READ_SERIES_MAX_POINTS): ReadPoint[] {
  if (points.length <= max || max < 2) return [...points]
  const step = Math.ceil(points.length / max)
  return points.filter((_, i) => i % step === 0 || i === points.length - 1)
}
