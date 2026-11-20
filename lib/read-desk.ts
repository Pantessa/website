// THE DESK — THE READ, built from tokens (2026-11-20).
//
// Nate, 2026-11-20: "our main markets splash seems to be a bit too heavy on
// traditional, and we should probably lean more crypto, maybe we make this
// page up with tokens in the user's watch list if they have some and if not
// let's come up with a more powerful visual to show an overview of the system
// and its actions with charts. full creativity".
//
// The read (lib/read) was nine macro tiles with bitcoin and ether last. It is
// now a DESK of tokens:
//
//   • YOURS — the open watchlist's symbols are the tiles, the line is about
//     them ("13 of your 16 are down. NEAR slumps 11%, …"), and a short list
//     is filled out with the crypto desk's tokens, each one press from joining
//     the list.
//   • THE CRYPTO DESK — nobody's list yet: eight tokens lead (bitcoin, ether,
//     solana, HYPE and the DeFi names the app builds orders on), and the line
//     is bitcoin, the desk's biggest surprise, then the macro market that
//     surprised most ("Bitcoin falls 3.1%, HYPE jumps 6.2%, stocks slump 3.5%.").
//
// The nine macro instruments are still here: whichever of them is not a tile
// rides ONE row under the tiles (the backdrop), every one a button onto the
// same chart.
//
// And the chart is the order form, drawn that way: what can be done about the
// pick is a list of ACTS (buy, buy lower with a resting limit, long, short),
// each naming the venue it routes through, and each act that has a price is a
// LEVEL on the chart: a line at that price with its button on the price rail.
// The alert's band (the price moving 5% either way) is drawn the same way.
//
// Pure like lib/read (no fetch, no clock, no DOM). Pinned by
// scripts/read-pins.ts; read by lib/read-server.ts and components/home/TheRead.tsx.

import { chartIndexFor, chartPairFor, indexSymbolForHost, isChartOnlyPair, type ChartPair } from '@/lib/charts'
import { symbolName } from '@/lib/markets'
import { SPOT_CHAINS, venuesFor, type VenueRoute } from '@/lib/symbol-venues'
import { fmtQuotePrice } from '@/lib/watchlists'
import {
  READ_INDEX_VENUE_LINE,
  READ_INSTRUMENTS,
  READ_RANGES,
  READ_WAITING,
  fmtReadAmount,
  fmtReadValue,
  fmtReadValueFull,
  readBasisWords,
  readOwnPair,
  readPageHref,
  readScore,
  readTileTag,
  readTone,
  readVenueLine,
  readVerb,
  type ReadId,
  type ReadInstrument,
  type ReadMover,
  type ReadNear,
  type ReadPoint,
  type ReadQuote,
  type ReadRange,
  type ReadSnapshot,
  type ReadTone,
  type ReadUnit,
} from '@/lib/read'

// ── The items ────────────────────────────────────────────────────────────────

export type DeskKind = 'crypto' | 'perp' | 'stock' | 'macro'

export interface DeskItem {
  /** The symbol as its page spells it (`/t/<key>`): BTC, NEAR, US10Y, SP500. */
  key: string
  /** The tile's label: the ticker for a token or a stock, the market's name for a macro one. */
  label: string
  /** The chart header's name. */
  name: string
  /** The headline's subject as it would start a sentence. */
  subject: string
  /** The subject is a common word ("stocks", "bitcoin"): lower-cased inside a sentence. A ticker never is. */
  common: boolean
  plural: boolean
  unit: ReadUnit
  /** A typical day's absolute move (percent, or basis points for a yield): the verb's measure. */
  typical: number
  kind: DeskKind
  /** The macro instrument, when this is one of the read's nine. */
  inst: ReadInstrument | null
  /** The symbol whose mark the tile wears; null for a macro market (no token mark). */
  icon: string | null
}

/** The desk's words for the nine: the page symbol, the tile's label, the line's subject. */
const INST_WORDS: Readonly<Record<ReadId, { label: string; subject: string; kind: DeskKind; icon: string | null }>> = {
  spx: { label: 'S&P 500', subject: 'Stocks', kind: 'macro', icon: null },
  ndx: { label: 'Nasdaq 100', subject: 'The Nasdaq', kind: 'macro', icon: null },
  us10y: { label: '10-yr yield', subject: 'Yields', kind: 'macro', icon: null },
  vix: { label: 'VIX', subject: 'The VIX', kind: 'macro', icon: null },
  dxy: { label: 'Dollar', subject: 'The dollar', kind: 'macro', icon: null },
  gold: { label: 'Gold', subject: 'Gold', kind: 'macro', icon: null },
  oil: { label: 'Oil', subject: 'Oil', kind: 'macro', icon: null },
  btc: { label: 'BTC', subject: 'Bitcoin', kind: 'crypto', icon: 'BTC' },
  eth: { label: 'ETH', subject: 'Ether', kind: 'crypto', icon: 'ETH' },
}

function instKey(inst: ReadInstrument): string {
  return inst.source === 'app' ? inst.symbol : (indexSymbolForHost(inst.symbol) ?? inst.symbol)
}

function fromInstrument(inst: ReadInstrument): DeskItem {
  const w = INST_WORDS[inst.id]
  return { key: instKey(inst), label: w.label, name: inst.name, subject: w.subject, common: true, plural: inst.plural, unit: inst.unit, typical: inst.typical, kind: w.kind, inst, icon: w.icon }
}

/** The nine as desk items, in the read's tile order. */
export const DESK_MACRO_ITEMS: readonly DeskItem[] = READ_INSTRUMENTS.map(fromInstrument)
const MACRO_BY_KEY: ReadonlyMap<string, DeskItem> = new Map(DESK_MACRO_ITEMS.map((i) => [i.key, i]))

/** A typical day's move by kind of market, for anything that is not one of the nine. */
export const DESK_TYPICAL = { crypto: 4.5, perp: 5.5, dexPerp: 2.2, stock: 1.8, index: 1 } as const

/**
 * The desk item a symbol names, or null when the app has no chart for it (a
 * stablecoin, an unknown ticker): a tile that could never draw is not a tile.
 * An alias collapses to its market (WETH → ETH), and a symbol that is one of
 * the nine IS that instrument, so its quote, its words and its chips are the
 * read's own.
 */
export function deskItemFor(symbolRaw: string | null | undefined): DeskItem | null {
  const up = String(symbolRaw ?? '').trim().toUpperCase()
  if (!up || !/^[A-Z0-9$._:-]{1,16}$/.test(up)) return null
  const direct = MACRO_BY_KEY.get(up)
  if (direct) return direct
  const ix = chartIndexFor(up)
  if (ix) return MACRO_BY_KEY.get(ix.symbol) ?? { key: ix.symbol, label: ix.symbol, name: ix.name, subject: ix.symbol, common: false, plural: false, unit: ix.unit, typical: DESK_TYPICAL.index, kind: 'macro', inst: null, icon: null }
  const pair = chartPairFor(up)
  if (!pair) return null
  const sym = pair.symbol.toUpperCase()
  const again = MACRO_BY_KEY.get(sym)
  if (again) return again
  const base = { key: sym, label: sym, name: symbolName(sym), subject: sym, common: false, plural: false, unit: 'usd' as const, inst: null, icon: sym }
  if (pair.source === 'robinhood') return { ...base, typical: DESK_TYPICAL.stock, kind: 'stock' }
  if (pair.source === 'hyperliquid') return { ...base, typical: pair.pair.includes(':') ? DESK_TYPICAL.dexPerp : DESK_TYPICAL.perp, kind: 'perp' }
  if (pair.source === 'index') return { ...base, typical: DESK_TYPICAL.index, kind: 'macro', icon: null }
  return { ...base, typical: DESK_TYPICAL.crypto, kind: 'crypto' }
}

/** The crypto desk: what leads when nobody's list does. Majors first, then the DeFi names orders build on. */
export const READ_DESK_DEFAULT: readonly string[] = ['BTC', 'ETH', 'SOL', 'HYPE', 'UNI', 'AAVE', 'LINK', 'DOGE']

/** The desk's symbols the snapshot must quote beside the nine (bitcoin and ether already are). */
export const READ_DESK_SERVER_SYMBOLS: readonly string[] = READ_DESK_DEFAULT.filter((s) => !MACRO_BY_KEY.has(s))

// ── The plan: which tiles ────────────────────────────────────────────────────

export type DeskMode = 'yours' | 'desk'

/** Tiles a list shows before "show all"; one seat of them becomes the "more" door when the list is longer. */
export const DESK_TILES_MAX = 12
/** A short list is filled out to this many tiles with the crypto desk's tokens. */
export const DESK_FILL_TO = 8
/** Symbols one list read asks the server for. */
export const DESK_SYMBOLS_MAX = 40

export interface DeskTile {
  item: DeskItem
  /** On the visitor's list (false: a token the desk suggests, one press from joining it). */
  own: boolean
}

export interface DeskPlan {
  mode: DeskMode
  tiles: DeskTile[]
  /** Every list symbol the desk can chart, in list order. */
  owned: DeskItem[]
  /** List symbols behind "show all". */
  hidden: number
}

/** Tokens lead the wall, then stocks, then macro markets (the rail keeps the list's own order). */
const KIND_RANK: Readonly<Record<DeskKind, number>> = { crypto: 0, perp: 0, stock: 1, macro: 2 }

/**
 * The tiles for a list. No chartable symbol on it (or no list) → the crypto
 * desk, every tile a suggestion. Otherwise the list's own symbols, TOKENS
 * FIRST (then stocks, then macro markets; the list's own order inside each),
 * at most DESK_TILES_MAX until "show all", and a list shorter than
 * DESK_FILL_TO is filled out with the desk's tokens it lacks. `owned` keeps
 * the list's order: the line and the breadth read the whole list.
 */
export function deskPlan(listSymbols: readonly string[] | null | undefined, opts: { all?: boolean } = {}): DeskPlan {
  const owned: DeskItem[] = []
  const seen = new Set<string>()
  for (const s of listSymbols ?? []) {
    const item = deskItemFor(s)
    if (!item || seen.has(item.key)) continue
    seen.add(item.key)
    owned.push(item)
  }
  const fill = (have: ReadonlySet<string>, room: number): DeskTile[] =>
    READ_DESK_DEFAULT.filter((s) => !have.has(s))
      .map((s) => deskItemFor(s))
      .filter((i): i is DeskItem => i !== null)
      .slice(0, Math.max(0, room))
      .map((item) => ({ item, own: false }))
  if (owned.length === 0) return { mode: 'desk', tiles: fill(seen, READ_DESK_DEFAULT.length), owned, hidden: 0 }
  const led = owned.map((item, i) => ({ item, i })).sort((a, b) => KIND_RANK[a.item.kind] - KIND_RANK[b.item.kind] || a.i - b.i).map((r) => r.item)
  const shown = opts.all || led.length <= DESK_TILES_MAX ? led : led.slice(0, DESK_TILES_MAX - 1)
  const tiles: DeskTile[] = shown.map((item) => ({ item, own: true }))
  if (owned.length < DESK_FILL_TO) tiles.push(...fill(seen, DESK_FILL_TO - owned.length))
  return { mode: 'yours', tiles, owned, hidden: owned.length - shown.length }
}

/** The nine that are not already a tile: the backdrop row. */
export function deskBackdrop(plan: DeskPlan): DeskItem[] {
  const on = new Set(plan.tiles.map((t) => t.item.key))
  for (const i of plan.owned) on.add(i.key)
  return DESK_MACRO_ITEMS.filter((i) => !on.has(i.key))
}

/** The symbols a plan needs quoted that the snapshot does not carry: everything that is not one of the nine. */
export function deskFetchSymbols(plan: DeskPlan, snap: ReadSnapshot, also: readonly DeskItem[] = []): string[] {
  const out: string[] = []
  for (const item of [...plan.owned, ...plan.tiles.map((t) => t.item), ...also]) {
    if (item.inst || out.includes(item.key)) continue
    // The crypto desk's own tokens ride the snapshot; a list's are read for the list.
    if (plan.mode === 'desk' && snap.desk?.[item.key]) continue
    out.push(item.key)
  }
  return out.slice(0, DESK_SYMBOLS_MAX)
}

// ── Quotes ───────────────────────────────────────────────────────────────────

export type DeskQuotes = Readonly<Record<string, ReadQuote | undefined>>

/** An item's quote: the snapshot's own for one of the nine, else the list read's, else the desk's seat in the snapshot. */
export function deskQuote(item: DeskItem, snap: ReadSnapshot, extra: DeskQuotes = {}): ReadQuote | undefined {
  if (item.inst) return snap.quotes[item.inst.id]
  return extra[item.key] ?? snap.desk?.[item.key]
}

/** A value as a tile prints it. The read's own format from a dollar up; a
 *  token under a dollar keeps the digits that carry its price ("$0.4208",
 *  "$0.000672": the rail's format, lib/watchlists fmtQuotePrice). */
export function fmtDeskValue(item: Pick<DeskItem, 'unit'>, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  if (item.unit === 'usd' && v > 0 && v < 1) return `$${fmtQuotePrice(v)}`
  return fmtReadValue(item, v)
}

/** A value as the chart's header prints it. */
export function fmtDeskValueFull(item: Pick<DeskItem, 'unit'>, v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  if (item.unit === 'usd' && v > 0 && v < 1) return `$${fmtQuotePrice(v)}`
  return fmtReadValueFull(item, v)
}

/** A tile's tag: lit for a market that never closes, hollow for one outside its session. */
export function deskTileTag(item: DeskItem, q: ReadQuote | undefined): '24/7' | 'closed' | '' {
  if (item.inst) return readTileTag(item.inst, q)
  if (item.kind === 'crypto' || item.kind === 'perp') return '24/7'
  return q && !q.live ? 'closed' : ''
}

/** What a 1D change is measured over, said under the number. */
export function deskBasisWords(item: DeskItem, range: ReadRange = '1d', live = true): string {
  if (item.inst) return readBasisWords(item.inst, range, live)
  if (range !== '1d') return READ_RANGES.find((r) => r.id === range)?.words ?? ''
  if (item.kind === 'crypto' || item.kind === 'perp') return 'in 24 hours'
  return live ? 'since the last close' : 'in its last session'
}

/** A series' own change (first value to last), in the item's unit. */
export function deskSeriesChange(item: DeskItem, points: readonly ReadPoint[]): number | null {
  if (points.length < 2) return null
  const first = points[0][1]
  const last = points[points.length - 1][1]
  if (!(first > 0) || !Number.isFinite(last)) return null
  return item.unit === 'yield' ? (last - first) * 100 : (last / first - 1) * 100
}

/** Whose number it is, one sentence, for the panel beside the chart. */
export function deskVenueLine(item: DeskItem, pair: ChartPair | null): string {
  if (item.inst) return readVenueLine(item.inst)
  if (item.kind === 'macro') return READ_INDEX_VENUE_LINE
  if (pair?.source === 'robinhood') return `${item.name}, tokenized on Robinhood Chain. It trades here around the clock.`
  if (pair?.source === 'hyperliquid') return `Hyperliquid's round-the-clock ${item.key} market.`
  return 'Coinbase spot, round the clock.'
}

export function deskPageHref(item: DeskItem): string | null {
  return item.inst ? readPageHref(item.inst) : `/t/${item.key}`
}

// ── The line ─────────────────────────────────────────────────────────────────

export interface DeskClause {
  key: string
  subject: string
  verb: string
  amount: string
  tone: ReadTone
}

export interface DeskHeadline {
  /** YOURS only: the list's breadth as its own sentence ("13 of your 16 are down."), or ''. */
  lead: string
  clauses: DeskClause[]
}

/** Clauses in a line. */
export const DESK_CLAUSES = 3
/** A list says its breadth from this many quoted symbols up. */
export const DESK_BREADTH_MIN = 3

interface Scored {
  item: DeskItem
  order: number
  chg: number
  score: number
  live: boolean
}

function scored(items: readonly DeskItem[], quoteOf: (i: DeskItem) => ReadQuote | undefined): Scored[] {
  const out: Scored[] = []
  items.forEach((item, order) => {
    const q = quoteOf(item)
    const chg = q?.chg ?? null
    const score = chg === null ? null : readScore({ typical: item.typical } as ReadInstrument, chg)
    if (chg === null || score === null) return
    out.push({ item, order, chg, score, live: q?.live !== false })
  })
  return out
}

const bySurprise = (a: Scored, b: Scored) => Math.abs(b.score) - Math.abs(a.score) || a.order - b.order

function lowerFirst(s: string): string {
  return s ? s[0].toLowerCase() + s.slice(1) : s
}

function clauseOf(r: Scored, opensSentence: boolean): DeskClause {
  const v = readVerb(r.score)
  return {
    key: r.item.key,
    subject: opensSentence || !r.item.common ? r.item.subject : lowerFirst(r.item.subject),
    verb: r.item.plural ? v.plural : v.singular,
    amount: v.amount ? fmtReadAmount(r.item, r.chg) : '',
    tone: v.tone,
  }
}

/**
 * The list's breadth: how many of the symbols with a stated change are up and
 * how many down, as one sentence. Under DESK_BREADTH_MIN symbols it says
 * nothing (two tokens are not a breadth).
 */
export function deskBreadth(owned: readonly DeskItem[], quoteOf: (i: DeskItem) => ReadQuote | undefined): { n: number; up: number; down: number; text: string } {
  let n = 0
  let up = 0
  let down = 0
  for (const item of owned) {
    const chg = quoteOf(item)?.chg
    if (chg == null || !Number.isFinite(chg)) continue
    n += 1
    const t = readTone(chg, item.unit)
    if (t === 'up') up += 1
    else if (t === 'down') down += 1
  }
  let text = ''
  if (n >= DESK_BREADTH_MIN) {
    if (up === n) text = `All ${n} on your list are up.`
    else if (down === n) text = `All ${n} on your list are down.`
    else if (down > up) text = `${down} of your ${n} are down.`
    else if (up > down) text = `${up} of your ${n} are up.`
    else if (up === 0) text = 'Your list is flat.'
    else text = `Your list is split, ${up} up and ${down} down.`
  }
  return { n, up, down, text }
}

/**
 * The line.
 *
 * YOURS: the breadth, then the list's three biggest surprises by each
 * market's own typical day (a list's change is the row the rail shows, open
 * or closed).
 *
 * THE CRYPTO DESK: bitcoin leads when it is quoted (the anchor a crypto
 * reader looks for first), then the desk token that surprised most, then the
 * macro market that surprised most among those trading now. A market with no
 * stated change never appears; a closed one keeps its tile and stays out.
 */
export function deskHeadline(plan: DeskPlan, quoteOf: (i: DeskItem) => ReadQuote | undefined, n = DESK_CLAUSES): DeskHeadline {
  if (plan.mode === 'yours') {
    const rows = scored(plan.owned, quoteOf).sort(bySurprise).slice(0, Math.max(1, n))
    return { lead: deskBreadth(plan.owned, quoteOf).text, clauses: rows.map((r) => clauseOf(r, false)).map((c, i) => (i === 0 ? { ...c, subject: capFirst(c.subject) } : c)) }
  }
  const desk = scored(plan.tiles.map((t) => t.item), quoteOf).filter((r) => r.live)
  const anchor = desk.find((r) => r.item.key === 'BTC')
  const tokens = desk.filter((r) => r !== anchor).sort(bySurprise)
  const onDesk = new Set(plan.tiles.map((t) => t.item.key))
  const macro = scored(DESK_MACRO_ITEMS.filter((i) => i.inst?.subject !== null && !onDesk.has(i.key)), quoteOf).filter((r) => r.live).sort(bySurprise)
  const picked: Scored[] = []
  if (anchor) picked.push(anchor)
  if (tokens[0]) picked.push(tokens[0])
  if (macro[0]) picked.push(macro[0])
  for (const r of tokens.slice(1)) if (picked.length < n) picked.push(r)
  return { lead: '', clauses: picked.slice(0, Math.max(1, n)).map((r, i) => clauseOf(r, i === 0)) }
}

function capFirst(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

export function deskClauseText(c: DeskClause): string {
  return c.amount ? `${c.subject} ${c.verb} ${c.amount}` : `${c.subject} ${c.verb}`
}

/** The whole line as plain text: "13 of your 16 are down. NEAR slumps 11%, DEGEN slumps 9.4%." — or the waiting words. */
export function deskHeadlineText(h: DeskHeadline): string {
  if (h.clauses.length === 0) return h.lead || `${READ_WAITING}.`
  const line = `${h.clauses.map(deskClauseText).join(', ')}.`
  return h.lead ? `${h.lead} ${line}` : line
}

// ── The movers ───────────────────────────────────────────────────────────────

/** A token under this absolute move is not a "biggest move" (a stock's floor is lib/read's 1.5%). */
export const READ_TOKEN_MOVER_FLOOR_PCT = 4
/** Movers the line names, per kind. */
export const DESK_MOVERS_EACH = 3

/** The line's movers: tokens first, then stocks, never one that is already a tile. */
export function deskMovers(snap: ReadSnapshot, plan: DeskPlan): { tokens: ReadMover[]; stocks: ReadMover[] } {
  const on = new Set([...plan.tiles.map((t) => t.item.key), ...plan.owned.map((i) => i.key)])
  const keep = (rows: readonly ReadMover[] | undefined) => (rows ?? []).filter((m) => !on.has(m.symbol)).slice(0, DESK_MOVERS_EACH)
  return { tokens: keep(snap.tokenMovers), stocks: keep(snap.movers) }
}

// ── The acts ─────────────────────────────────────────────────────────────────

/** One act's size, its limit's distance under the market, and the perp's leverage. */
export const DESK_ACT_USD = 25
export const DESK_LIMIT_PCT = 3
export const DESK_LEVERAGE = 2

export interface DeskAct {
  /** The route's own id (`spot:uniswap:8453:buy`), unique in the list. */
  id: string
  label: string
  /** The sentence the door sends: a builder's own grammar (lib/symbol-venues venuesFor). */
  ask: string
  tone: 'buy' | 'sell' | 'neutral'
  /** Where it routes, in words: "Uniswap · Base", "CoW Swap · Base", "Hyperliquid". */
  where: string
  /** The venue's key (components/protocol-marks). */
  venue: string
  /** The price the act rests at (a limit), or null for one that fills at the market. */
  price: number | null
  /** The symbol it trades. */
  symbol: string
}

const VENUE_WORDS: Readonly<Record<string, string>> = { uniswap: 'Uniswap', cow: 'CoW Swap', hyperliquid: 'Hyperliquid', robinhood: 'Robinhood Chain', near: 'NEAR Intents', lifi: 'LI.FI' }

/** Where a route goes, as the act list says it. */
export function deskWhere(row: Pick<VenueRoute, 'venue' | 'chainId' | 'kind'>): string {
  const venue = VENUE_WORDS[row.venue] ?? (row.venue ? row.venue[0].toUpperCase() + row.venue.slice(1) : 'Pantessa')
  if (row.kind !== 'spot' && row.kind !== 'limit') return venue
  const chain = SPOT_CHAINS.find((c) => c.id === row.chainId)?.name
  return chain ? `${venue} · ${chain}` : venue
}

/**
 * Every act on one symbol, each a sentence a builder reads today, each passed
 * by `canAct` (the measured venue verdicts) or left out: buy at the market
 * (the stock's chain, else spot), buy lower (a resting CoW limit
 * DESK_LIMIT_PCT under the price, only with a live price to rest it against),
 * long and short on Hyperliquid.
 */
export function deskActsFor(symbol: string, pair: ChartPair, last: number | null, canAct: (ask: string) => boolean): DeskAct[] {
  const sym = (pair?.symbol ?? symbol).toUpperCase()
  const live = last != null && Number.isFinite(last) && last > 0 ? last : null
  const rows = venuesFor(symbol, pair, { usd: DESK_ACT_USD, leverage: DESK_LEVERAGE, last: live ?? undefined, limitPct: DESK_LIMIT_PCT })
  const pick = (kind: VenueRoute['kind'], side: 'buy' | 'sell') => rows.find((r) => r.kind === kind && r.side === side && canAct(r.ask))
  const out: DeskAct[] = []
  const add = (row: VenueRoute | undefined, label: string, tone: DeskAct['tone'], price: number | null) => {
    if (row) out.push({ id: row.id, label, ask: row.ask, tone, where: deskWhere(row), venue: row.venue, price, symbol: sym })
  }
  const buy = pick('stock', 'buy') ?? pick('spot', 'buy')
  add(buy, `Buy $${DESK_ACT_USD}`, 'buy', null)
  if (live) add(pick('limit', 'buy'), `Buy ${DESK_LIMIT_PCT}% lower`, 'neutral', live * (1 - DESK_LIMIT_PCT / 100))
  add(pick('perp', 'buy'), `Long ${DESK_LEVERAGE}x`, buy ? 'neutral' : 'buy', null)
  add(pick('perp', 'sell'), `Short ${DESK_LEVERAGE}x`, 'sell', null)
  return out
}

/**
 * What can be done about an item here. A token, a stock or a perp wears its
 * own acts. One of the nine keeps the read's rule: its own market first when
 * orders build on it (every act), then the nearest thing listed here (its
 * first act, named), and a door to that thing's chart.
 *
 * `hasQuote` is the server's own quote for the item: a Hyperliquid builder
 * market states its pair (lib/read readOwnPair) and is offered only while the
 * venue lists it.
 */
export function deskActs(item: DeskItem, last: number | null, hasQuote: boolean, canAct: (ask: string) => boolean): { acts: DeskAct[]; charts: ReadNear[] } {
  const acts: DeskAct[] = []
  const charts: ReadNear[] = []
  const inst = item.inst
  const targets: readonly ReadNear[] = inst ? (inst.direct ? [{ symbol: inst.symbol, as: '' }, ...inst.near] : inst.near) : [{ symbol: item.key, as: '' }]
  for (const n of targets) {
    const own = inst ? inst.direct && n.symbol === inst.symbol : true
    const stated = own && inst ? readOwnPair(inst) : null
    const pair = stated ? (hasQuote ? stated : null) : chartPairFor(n.symbol)
    const found = pair && !isChartOnlyPair(pair) ? deskActsFor(n.symbol, pair, own ? last : null, canAct) : []
    if (found.length === 0) {
      if (!own) charts.push(n)
      continue
    }
    if (own) acts.push(...found)
    else {
      acts.push({ ...found[0], label: `${found[0].label} of ${n.symbol}` })
      charts.push(n)
    }
  }
  return { acts, charts }
}

// ── The levels: acts drawn on the chart ──────────────────────────────────────

/** The alert's distance, both ways (lib/pick-alerts DEFAULT_ALERT_PCT; the pin holds them equal). */
export const DESK_ALERT_PCT = 5
/** A level joins the chart's scale only while the series keeps this share of the plot's height. */
export const DESK_SERIES_MIN_SHARE = 0.45
/** Tags on the price rail keep this much of the plot's height between them. */
export const DESK_TAG_GAP = 11

export interface DeskLevelSpec {
  id: string
  kind: 'now' | 'limit' | 'alert'
  value: number
  /** The tag's words. */
  label: string
  /** The act a press on the tag runs (a limit), or null. */
  act: DeskAct | null
}

/**
 * The levels for a pick: the price now, each act that rests at a price, and
 * (when an alert can be armed on it) the band DESK_ALERT_PCT either way.
 */
export function deskLevelSpecs(item: DeskItem, last: number | null, acts: readonly DeskAct[], alertable: boolean): DeskLevelSpec[] {
  if (last == null || !Number.isFinite(last) || !(last > 0)) return []
  const out: DeskLevelSpec[] = [{ id: 'now', kind: 'now', value: last, label: fmtDeskValue(item, last), act: null }]
  for (const a of acts) if (a.price != null && a.price > 0 && a.price !== last) out.push({ id: a.id, kind: 'limit', value: a.price, label: `Buy at ${fmtDeskValue(item, a.price)}`, act: a })
  if (alertable && item.unit === 'usd') {
    const up = last * (1 + DESK_ALERT_PCT / 100)
    const down = last * (1 - DESK_ALERT_PCT / 100)
    out.push({ id: 'alert-up', kind: 'alert', value: up, label: `+${DESK_ALERT_PCT}% ${fmtDeskValue(item, up)}`, act: null })
    out.push({ id: 'alert-down', kind: 'alert', value: down, label: `−${DESK_ALERT_PCT}% ${fmtDeskValue(item, down)}`, act: null })
  }
  return out
}

/**
 * The level values the chart's scale makes room for: the acts (the price now,
 * a resting limit), nearest the series first, each only while the series
 * itself keeps DESK_SERIES_MIN_SHARE of the height (a quiet day is not
 * squashed flat to show a line 3% away; that level is pinned to the plot's
 * edge instead). The alert's band never widens the scale: it is drawn when
 * the range in view reaches it.
 */
export function deskScaleAlso(points: readonly ReadPoint[], base: number | null, specs: readonly DeskLevelSpec[], minShare = DESK_SERIES_MIN_SHARE): number[] {
  const vals = points.map((p) => p[1]).filter((v) => Number.isFinite(v))
  if (vals.length < 2) return []
  let min = Math.min(...vals)
  let max = Math.max(...vals)
  if (base != null && Number.isFinite(base)) {
    min = Math.min(min, base)
    max = Math.max(max, base)
  }
  const own = max - min
  if (!(own > 0)) return []
  const dist = (v: number) => (v > max ? v - max : v < min ? min - v : 0)
  const out: number[] = []
  for (const s of specs.filter((x) => x.kind !== 'alert').sort((a, b) => dist(a.value) - dist(b.value))) {
    const lo = Math.min(min, s.value)
    const hi = Math.max(max, s.value)
    if (own / (hi - lo) < minShare) continue
    min = lo
    max = hi
    out.push(s.value)
  }
  return out
}

export interface DeskLevel extends DeskLevelSpec {
  /** The line's place, percent from the top of the plot (clamped to it). */
  y: number
  /** −1: the level is above the plot (pinned to the top edge); 1: below it; 0: in view. */
  off: -1 | 0 | 1
  /** The tag's place on the rail, percent from the top: the line's, moved only to keep tags apart. */
  tagY: number
}

/**
 * Place levels against the plot's floor and ceiling (lib/read readChart lo /
 * hi), top to bottom. An act outside the plot is pinned to the edge it lies
 * beyond (its tag is still its button); an alert level outside the plot is
 * not drawn, so a label never pushes a button off its own line.
 */
export function placeDeskLevels(specs: readonly DeskLevelSpec[], lo: number, hi: number, gap = DESK_TAG_GAP): DeskLevel[] {
  if (!(hi > lo)) return []
  const rows: DeskLevel[] = specs
    .map((s) => {
      const raw = ((hi - s.value) / (hi - lo)) * 100
      const off: -1 | 0 | 1 = raw < 0 ? -1 : raw > 100 ? 1 : 0
      const y = Math.min(100, Math.max(0, raw))
      return { ...s, y: Math.round(y * 100) / 100, off, tagY: y }
    })
    .filter((l) => l.off === 0 || l.kind !== 'alert')
    .sort((a, b) => a.y - b.y || b.value - a.value)
  const top = 7
  const bottom = 93
  for (let i = 0; i < rows.length; i++) rows[i].tagY = Math.max(i === 0 ? top : rows[i - 1].tagY + gap, Math.min(bottom, rows[i].tagY))
  for (let i = rows.length - 1; i >= 0; i--) rows[i].tagY = Math.min(i === rows.length - 1 ? bottom : rows[i + 1].tagY - gap, rows[i].tagY)
  for (const r of rows) r.tagY = Math.round(r.tagY * 100) / 100
  return rows
}

// ── This browser's memory of the desk ────────────────────────────────────────

/** localStorage: the symbols the read last drew as YOURS, so a return visit opens on them before the lists load. */
export const DESK_MEMORY_KEY = 'pantessa.read.desk.v1'
/** localStorage: 'desk' when the visitor chose the crypto desk over their own list. */
export const DESK_VIEW_KEY = 'pantessa.read.view.v1'

export function parseDeskMemory(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v)) return []
    return v.filter((s): s is string => typeof s === 'string' && /^[A-Za-z0-9$._:-]{1,16}$/.test(s)).slice(0, 200)
  } catch {
    return []
  }
}

/** The line under the tiles: whose numbers these are. */
export const DESK_SOURCES_LINE =
  'Token prices are Coinbase spot or Hyperliquid, round the clock. The S&P 500, gold and oil are Hyperliquid markets that never close. The Nasdaq, the 10-year, the VIX and the dollar are delayed index data.'
