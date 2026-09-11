// lib/watchlists.ts — the PURE, client-safe half of the watchlist surface
// (MARKETS/WATCH, 2026-09-11). Symbol normalization, the TradingView export
// parser, the add-ticker resolver, guest (localStorage) lists, and the alert
// rules. Nothing here touches the DB — lib/watchlists-store.ts does — so the
// rail, the import modal, the cron and the harness all read ONE rulebook.
//
// THE VALUE PROP (BUSINESS-MODEL-chart-first §0): unlimited lists, unlimited
// tickers per list, unlimited alerts, at every tier, forever. There is no cap
// constant in this file on purpose. Never add one.

import { chartPairFor, normalizeChartSymbol, parseChartAsk, type ChartPair, type ChartSource } from '@/lib/charts'
import { ROBINHOOD_TICKERS } from '@/lib/robinhood-tickers'

// ── Shapes (README "Watchlists" contract) ───────────────────────────────────

export interface WatchlistSection {
  name: string
  symbols: string[]
}

export interface WatchlistShape {
  id: string
  /** Lowercased owner wallet, or null for a guest-local list. */
  owner: string | null
  name: string
  /** Public handle (/lists/<slug>); null until shared. */
  slug: string | null
  /** Every symbol in list order (sectioned or not). */
  symbols: string[]
  /** Section headers in order; symbols outside any section are unsectioned. */
  sections?: WatchlistSection[]
  isPublic: boolean
  forkOf?: string | null
  createdAt: string
}

export const WATCHLIST_NAME_MAX = 60
/** The first list's name on every side (the rail's first add, the holdings
 *  autofill, adoption's merge-by-name). */
export const DEFAULT_LIST_NAME = 'My watchlist'
export const WATCHLIST_SECTION_MAX = 40
/** Symbol shape the store accepts — lib/charts' normalized form. */
export const WATCH_SYMBOL_RE = /^[A-Z0-9]{1,12}$/

/** Canonical stored symbol: charted tokens collapse to their chart symbol
 *  (WETH → ETH, cbBTC → BTC); anything else keeps the normalized ticker so a
 *  list can hold a not-yet-chartable name and light it up later. */
export function normalizeWatchSymbol(raw: string): string | null {
  const norm = normalizeChartSymbol(String(raw ?? ''))
  if (!norm || !WATCH_SYMBOL_RE.test(norm)) return null
  return chartPairFor(norm)?.symbol ?? norm
}

export function cleanListName(raw: unknown, fallback = 'Watchlist'): string {
  const s = String(raw ?? '').replace(/\s+/g, ' ').trim().slice(0, WATCHLIST_NAME_MAX)
  return s || fallback
}

export function cleanSectionName(raw: unknown): string | null {
  const s = String(raw ?? '').replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, WATCHLIST_SECTION_MAX)
  return s || null
}

/** Dedupe while keeping first-seen order; drops anything that doesn't normalize. */
export function dedupeSymbols(list: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of list) {
    const s = normalizeWatchSymbol(raw)
    if (!s || seen.has(s)) continue
    seen.add(s)
    out.push(s)
  }
  return out
}

/** Public slug: 3–32 lowercase [a-z0-9-], no leading/trailing dash. */
export const LIST_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])?$/
export function slugify(raw: string): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '')
}

// ── TradingView export import ───────────────────────────────────────────────
// TradingView exports a watchlist as a flat text list: entries separated by
// commas and/or newlines, each `EXCHANGE:SYMBOL` (`NASDAQ:AAPL`,
// `COINBASE:ETHUSD`, `BINANCE:BTCUSDT.P`), with `###Section` entries marking
// section headers. We keep the sections, map crypto pairs onto their base
// symbol, and split the result into what charts here today vs "not yet".

export interface ImportEntry {
  /** What the export said, verbatim. */
  input: string
  exchange: string | null
  /** Our normalized symbol (null when the entry isn't a symbol at all). */
  symbol: string | null
  section: string | null
  /** True when chartPairFor knows a feed for it. */
  tradable: boolean
  pair: ChartPair | null
}

export interface ImportResult {
  entries: ImportEntry[]
  /** Chartable symbols, deduped, in export order. */
  tradable: string[]
  /** Recognizable symbols we hold no feed for (yet). */
  notYet: string[]
  sections: WatchlistSection[]
  /** Entries we could not read as a symbol at all (futures `ES1!`, indices…). */
  skipped: string[]
}

const CRYPTO_EXCHANGES = new Set([
  'COINBASE', 'BINANCE', 'BINANCEUS', 'KRAKEN', 'BITSTAMP', 'BYBIT', 'OKX', 'OKEX', 'KUCOIN', 'GEMINI',
  'BITFINEX', 'CRYPTO', 'CRYPTOCOM', 'MEXC', 'GATEIO', 'HTX', 'HUOBI', 'BITGET', 'UNISWAP', 'HYPERLIQUID',
  'BITMEX', 'DERIBIT', 'POLONIEX', 'UPBIT', 'BITHUMB', 'WHITEBIT', 'PHEMEX', 'INDEX', 'CRYPTOCAP',
])
/** Quote-currency suffixes TradingView glues onto crypto pairs. Longest first. */
const QUOTE_SUFFIXES = ['USDT', 'USDC', 'BUSD', 'FDUSD', 'TUSD', 'USD', 'EUR', 'GBP', 'BTC', 'ETH', 'PERP']

function stripCryptoQuote(sym: string): string {
  const base = sym.replace(/\.P$/i, '').replace(/PERP$/i, '')
  for (const q of QUOTE_SUFFIXES) {
    if (base.length > q.length + 1 && base.endsWith(q)) return base.slice(0, -q.length)
  }
  return base
}

/** One export entry → exchange + our symbol. Futures (`ES1!`), spreads and
 *  indices with punctuation we can't map return symbol:null. */
export function parseImportEntry(entryRaw: string): { exchange: string | null; symbol: string | null } {
  const entry = entryRaw.trim()
  if (!entry) return { exchange: null, symbol: null }
  const colon = entry.indexOf(':')
  const exchange = colon > 0 ? entry.slice(0, colon).trim().toUpperCase() : null
  let sym = (colon > 0 ? entry.slice(colon + 1) : entry).trim().toUpperCase()
  if (!sym || /[!]/.test(sym)) return { exchange, symbol: null }
  // Class shares: BRK.B → BRKB (our normalizer drops punctuation anyway).
  if (exchange && CRYPTO_EXCHANGES.has(exchange)) sym = stripCryptoQuote(sym)
  else if (!exchange && /^[A-Z0-9]+(?:USDT|USDC|USD)(?:\.P)?$/.test(sym) && sym.length > 5) {
    // A bare "ETHUSD" pasted from a crypto tab — still a pair.
    const guess = stripCryptoQuote(sym)
    if (chartPairFor(guess)) sym = guess
  }
  const symbol = normalizeWatchSymbol(sym)
  return { exchange, symbol }
}

export function parseTradingViewExport(text: string): ImportResult {
  const entries: ImportEntry[] = []
  const skipped: string[] = []
  let section: string | null = null
  const tokens = String(text ?? '')
    .slice(0, 64_000)
    .split(/[\n\r,]+/)
    .map((t) => t.trim())
    .filter(Boolean)
  for (const tok of tokens) {
    if (tok.startsWith('###')) {
      section = cleanSectionName(tok)
      continue
    }
    const { exchange, symbol } = parseImportEntry(tok)
    if (!symbol) {
      skipped.push(tok)
      continue
    }
    const pair = chartPairFor(symbol)
    entries.push({ input: tok, exchange, symbol, section, tradable: !!pair, pair })
  }
  const seen = new Set<string>()
  const tradable: string[] = []
  const notYet: string[] = []
  const sections: WatchlistSection[] = []
  const sectionIndex = new Map<string, WatchlistSection>()
  for (const e of entries) {
    if (!e.symbol || seen.has(e.symbol)) continue
    seen.add(e.symbol)
    ;(e.tradable ? tradable : notYet).push(e.symbol)
    if (e.section) {
      let s = sectionIndex.get(e.section)
      if (!s) {
        s = { name: e.section, symbols: [] }
        sectionIndex.set(e.section, s)
        sections.push(s)
      }
      s.symbols.push(e.symbol)
    }
  }
  return { entries, tradable, notYet, sections, skipped }
}

// ── Add-ticker search ───────────────────────────────────────────────────────
// The resolver the rail's search box uses: company names resolve through the
// chart-ask parser ("apple" → AAPL, "bitcoin" → BTC — one vocabulary with the
// voice door), tickers match by prefix, company names by substring. Every hit
// is chartable by construction (chartPairFor gates the coin/perp table and the
// stock list is the charted-stock set).

export interface TickerHit {
  symbol: string
  name: string
  kind: 'stock' | 'coin' | 'perp'
  pair: ChartPair
}

/** Coin + perp display names for the charted set (validated against
 *  chartPairFor in the harness — a stale entry fails a gate, never renders). */
export const COIN_NAMES: ReadonlyArray<readonly [string, string]> = [
  ['ETH', 'Ethereum'], ['BTC', 'Bitcoin'], ['SOL', 'Solana'], ['DOGE', 'Dogecoin'], ['XRP', 'XRP'],
  ['ADA', 'Cardano'], ['AVAX', 'Avalanche'], ['DOT', 'Polkadot'], ['ATOM', 'Cosmos'], ['NEAR', 'NEAR'],
  ['LINK', 'Chainlink'], ['UNI', 'Uniswap'], ['AAVE', 'Aave'], ['LDO', 'Lido'], ['CRV', 'Curve'],
  ['COMP', 'Compound'], ['MKR', 'Maker'], ['SNX', 'Synthetix'], ['MORPHO', 'Morpho'], ['ARB', 'Arbitrum'],
  ['OP', 'Optimism'], ['POL', 'Polygon'], ['SUI', 'Sui'], ['APT', 'Aptos'], ['INJ', 'Injective'],
  ['TIA', 'Celestia'], ['FIL', 'Filecoin'], ['ONDO', 'Ondo'], ['ENA', 'Ethena'], ['PEPE', 'Pepe'],
  ['SHIB', 'Shiba Inu'], ['WLD', 'Worldcoin'], ['JTO', 'Jito'], ['JUP', 'Jupiter'], ['AERO', 'Aerodrome'],
  ['EIGEN', 'EigenLayer'], ['HYPE', 'Hyperliquid'], ['SYRUP', 'Maple Syrup'], ['FARTCOIN', 'Fartcoin'],
]

function kindOf(source: ChartSource): TickerHit['kind'] {
  return source === 'robinhood' ? 'stock' : source === 'hyperliquid' ? 'perp' : 'coin'
}

/** Display name for a symbol (company for stocks, coin name otherwise). */
export function symbolName(symbol: string): string {
  const coin = COIN_NAMES.find(([s]) => s === symbol)
  if (coin) return coin[1]
  const stock = ROBINHOOD_TICKERS.find(([s]) => s === symbol)
  return stock ? stock[1] : symbol
}

function hitFor(symbol: string): TickerHit | null {
  const pair = chartPairFor(symbol)
  if (!pair) return null
  return { symbol: pair.symbol, name: symbolName(pair.symbol), kind: kindOf(pair.source), pair }
}

export function searchTickers(queryRaw: string, limit = 8): TickerHit[] {
  const q = String(queryRaw ?? '').trim()
  if (!q) return []
  const out: TickerHit[] = []
  const seen = new Set<string>()
  const push = (sym: string | null | undefined) => {
    if (!sym || seen.has(sym) || out.length >= limit) return
    const hit = hitFor(sym)
    if (!hit || seen.has(hit.symbol)) return
    seen.add(hit.symbol)
    out.push(hit)
  }
  const upper = q.toUpperCase().replace(/^\$/, '')
  // 1. Exact ticker.
  if (/^[A-Z0-9]{1,12}$/.test(upper)) push(upper)
  // 2. Company / coin name through the chart-ask resolver (one vocabulary).
  const ask = parseChartAsk(`show me the ${q} chart`)
  if (ask?.pair) push(ask.symbol)
  // 3. Ticker prefix, then name substring.
  const ql = q.toLowerCase()
  const candidates: (readonly [string, string])[] = [...COIN_NAMES, ...ROBINHOOD_TICKERS]
  for (const [s] of candidates) if (s.startsWith(upper)) push(s)
  for (const [s, n] of candidates) if (n.toLowerCase().includes(ql)) push(s)
  return out
}

// ── Guest lists (localStorage) ──────────────────────────────────────────────
// A stranger can build lists before signing in; on SIWE the hook POSTs them
// to /api/watchlists/adopt (the adoptLocalChat idiom) and clears the key.
// Guest ids are prefixed so a server id can never collide with one.

export const GUEST_LISTS_KEY = 'pantessa.watchlists.v1'
export const GUEST_ID_PREFIX = 'g_'

export function isGuestListId(id: string): boolean {
  return id.startsWith(GUEST_ID_PREFIX)
}

function randomId(len: number): string {
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'
  const bytes = new Uint8Array(len)
  globalThis.crypto.getRandomValues(bytes)
  let s = ''
  for (let i = 0; i < len; i++) s += alphabet[bytes[i] % alphabet.length]
  return s
}

export function newGuestList(name: string, symbols: string[] = [], sections?: WatchlistSection[]): WatchlistShape {
  return {
    id: GUEST_ID_PREFIX + randomId(10),
    owner: null,
    name: cleanListName(name),
    slug: null,
    symbols: dedupeSymbols(symbols),
    ...(sections?.length ? { sections } : {}),
    isPublic: false,
    createdAt: new Date().toISOString(),
  }
}

/** Strict reader — a corrupt key reads as no lists, never throws. */
export function parseGuestLists(raw: unknown): WatchlistShape[] {
  if (typeof raw !== 'string' || !raw) return []
  try {
    const v = JSON.parse(raw) as unknown
    if (!Array.isArray(v)) return []
    const out: WatchlistShape[] = []
    for (const x of v) {
      if (!x || typeof x !== 'object') continue
      const o = x as Partial<WatchlistShape>
      if (typeof o.id !== 'string' || !isGuestListId(o.id) || typeof o.name !== 'string') continue
      const sections = Array.isArray(o.sections)
        ? o.sections
            .filter((s): s is WatchlistSection => !!s && typeof s.name === 'string' && Array.isArray(s.symbols))
            .map((s) => ({ name: cleanSectionName(s.name) ?? 'Section', symbols: dedupeSymbols(s.symbols) }))
        : undefined
      out.push({
        id: o.id,
        owner: null,
        name: cleanListName(o.name),
        slug: null,
        symbols: dedupeSymbols(Array.isArray(o.symbols) ? o.symbols : []),
        ...(sections?.length ? { sections } : {}),
        isPublic: false,
        createdAt: typeof o.createdAt === 'string' ? o.createdAt : new Date().toISOString(),
      })
    }
    return out
  } catch {
    return []
  }
}

export function readGuestLists(): WatchlistShape[] {
  if (typeof window === 'undefined') return []
  try {
    return parseGuestLists(window.localStorage.getItem(GUEST_LISTS_KEY))
  } catch {
    return []
  }
}

export function writeGuestLists(lists: WatchlistShape[]): void {
  if (typeof window === 'undefined') return
  try {
    if (lists.length) window.localStorage.setItem(GUEST_LISTS_KEY, JSON.stringify(lists))
    else window.localStorage.removeItem(GUEST_LISTS_KEY)
  } catch {
    /* private mode / quota — the in-memory copy still renders */
  }
}

// ── Holdings autofill ───────────────────────────────────────────────────────
// A connected wallet's watchlist fills itself with what the wallet holds
// (Nate, 2026-09-11). ONE rule for the account path (lib/watchlists-store
// syncHeldSymbols) and the guest path (useWatchlists): add the held symbols
// that are on no list and not in the SEEN ledger, then remember every held
// symbol. Removing a symbol also lands it in the ledger, so a removed holding
// stays off until the owner adds it back by hand. It runs on every visit, not
// only the first connect: a wallet connected before this shipped fills too,
// and a token bought next week joins the list the next time the rail loads.

/** One watchable symbol a wallet holds (GET /api/watchlists/holdings). */
export interface HeldSymbol {
  symbol: string
  /** Summed USD value across chains; null when no row could be priced. */
  valueUsd: number | null
  /** Chain names it sits on ('Base', 'Robinhood Chain', …). */
  chains: string[]
}

export interface HeldAutofillPlan {
  /** Held symbols to append to the primary list, in holdings order. */
  add: string[]
  /** Held symbols the ledger doesn't know yet — record every one of them. */
  newlySeen: string[]
}

export function planHeldAutofill(input: { held: readonly string[]; watched: Iterable<string>; seen: Iterable<string> }): HeldAutofillPlan {
  const watched = new Set(input.watched)
  const seen = new Set(input.seen)
  // Chartable only: a list row must always quote (the add-ticker contract).
  const held = dedupeSymbols(input.held).filter((s) => !!chartPairFor(s))
  const newlySeen = held.filter((s) => !seen.has(s))
  return { add: newlySeen.filter((s) => !watched.has(s)), newlySeen }
}

function joinAnd(items: readonly string[]): string {
  if (items.length <= 1) return items.join('')
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** The one line the rail says when the autofill adds something. */
export function heldAutofillNote(added: readonly string[], listName: string): string {
  const names = added.length <= 3 ? joinAnd(added) : `${added.slice(0, 3).join(', ')} and ${added.length - 3} more`
  return `Added ${names} from your wallet to ${listName}. Remove any and it stays off.`
}

/** The row marker's words: "In your wallet · $11.89 · Robinhood Chain". */
export function heldTitle(h: HeldSymbol): string {
  const value = h.valueUsd == null ? null : h.valueUsd >= 1000 ? `$${Math.round(h.valueUsd).toLocaleString('en-US')}` : `$${h.valueUsd.toFixed(2)}`
  return ['In your wallet', value, h.chains.join(', ')].filter(Boolean).join(' · ')
}

// The guest half of the ledger lives in the browser, like guest lists.
//   seen    — held symbols this browser has reconciled, plus anything removed
//             from a guest list (the guest's "stays off" memory)
//   auto    — symbols the autofill itself placed on a guest list; sign-in
//             re-checks those against the ACCOUNT's ledger, so a holding the
//             owner removed on another device is not carried back in
//   pending — removals made here that no account has heard about yet;
//             sign-in hands them to the account's ledger, then clears them
export const HELD_LEDGER_KEY = 'pantessa.watchlists.held.v1'

export interface HeldLedger {
  seen: string[]
  auto: string[]
  pending: string[]
}

const emptyLedger = (): HeldLedger => ({ seen: [], auto: [], pending: [] })
const symbolArray = (x: unknown): string[] => dedupeSymbols(Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : [])

/** Strict reader — a corrupt key reads as an empty ledger, never throws. */
export function parseHeldLedger(raw: unknown): HeldLedger {
  if (typeof raw !== 'string' || !raw) return emptyLedger()
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof HeldLedger, unknown>> | null
    if (!v || typeof v !== 'object' || Array.isArray(v)) return emptyLedger()
    return { seen: symbolArray(v.seen), auto: symbolArray(v.auto), pending: symbolArray(v.pending) }
  } catch {
    return emptyLedger()
  }
}

export function readHeldLedger(): HeldLedger {
  if (typeof window === 'undefined') return emptyLedger()
  try {
    return parseHeldLedger(window.localStorage.getItem(HELD_LEDGER_KEY))
  } catch {
    return emptyLedger()
  }
}

export function writeHeldLedger(ledger: HeldLedger): void {
  if (typeof window === 'undefined') return
  try {
    if (ledger.seen.length || ledger.auto.length || ledger.pending.length) window.localStorage.setItem(HELD_LEDGER_KEY, JSON.stringify(ledger))
    else window.localStorage.removeItem(HELD_LEDGER_KEY)
  } catch {
    /* private mode / quota — the next visit re-plans from the holdings */
  }
}

/** What sign-in hands the account alongside the guest lists: the
 *  autofill-placed symbols still on a guest list (the server keeps each one
 *  only if the account has never seen it) and the removals made here. */
export function guestHeldAdoption(ledger: HeldLedger, lists: readonly Pick<WatchlistShape, 'symbols'>[]): { auto: string[]; dismissed: string[] } {
  const onLists = new Set(lists.flatMap((l) => l.symbols))
  return { auto: ledger.auto.filter((s) => onLists.has(s)), dismissed: [...ledger.pending] }
}

/** After an account sync, the browser ledger forgets what the account now
 *  watches and learns what the account removed — so a signed-out visit in
 *  this browser shows the kept holdings and never resurrects a removed one. */
export function mirrorAccountLedger(ledger: HeldLedger, accountWatched: Iterable<string>, accountDismissed: readonly string[]): HeldLedger {
  const watched = new Set(accountWatched)
  return { ...ledger, seen: dedupeSymbols([...ledger.seen.filter((s) => !watched.has(s)), ...accountDismissed]) }
}

// ── Sections ────────────────────────────────────────────────────────────────

/** Sectioned view of a list: named sections in order, then the unsectioned
 *  tail. A symbol claimed by no section lands in the tail; a section naming a
 *  symbol the list doesn't hold is dropped (the list is the truth). */
export function sectionedRows(list: Pick<WatchlistShape, 'symbols' | 'sections'>): { name: string | null; symbols: string[] }[] {
  const claimed = new Set<string>()
  const rows: { name: string | null; symbols: string[] }[] = []
  const held = new Set(list.symbols)
  for (const s of list.sections ?? []) {
    const syms = s.symbols.filter((x) => held.has(x) && !claimed.has(x))
    syms.forEach((x) => claimed.add(x))
    if (syms.length) rows.push({ name: s.name, symbols: syms })
  }
  const tail = list.symbols.filter((x) => !claimed.has(x))
  if (tail.length || rows.length === 0) rows.push({ name: null, symbols: tail })
  return rows
}

/** Move a symbol into a section (null = unsectioned). Pure. */
export function moveToSection(list: WatchlistShape, symbol: string, section: string | null): WatchlistShape {
  const sections = (list.sections ?? []).map((s) => ({ ...s, symbols: s.symbols.filter((x) => x !== symbol) }))
  if (section) {
    const idx = sections.findIndex((s) => s.name === section)
    if (idx >= 0) sections[idx] = { ...sections[idx], symbols: [...sections[idx].symbols, symbol] }
    else sections.push({ name: section, symbols: [symbol] })
  }
  return { ...list, sections: sections.filter((s) => s.symbols.length > 0) }
}

// ── Session state ───────────────────────────────────────────────────────────
// Robinhood Chain stock tokens trade 24/7 on-chain; the underlying tape does
// not. The quote carries the TAPE's state so the rail can say "token trades
// 24/7 · NYSE closed". Regular session only (09:30–16:00 New York, Mon–Fri);
// exchange holidays are not modelled — they read as "open" for 6.5h, which
// the eyebrow tolerates and the on-chain price does not care about.

export type QuoteSession = 'open' | 'closed' | '24/7'

export function usEquitySession(now: Date = new Date()): 'open' | 'closed' {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour12: false,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  const wd = get('weekday')
  if (wd === 'Sat' || wd === 'Sun') return 'closed'
  const hh = Number(get('hour')) % 24
  const mm = Number(get('minute'))
  const mins = hh * 60 + mm
  return mins >= 9 * 60 + 30 && mins < 16 * 60 ? 'open' : 'closed'
}

export function sessionFor(source: ChartSource, now: Date = new Date()): QuoteSession {
  return source === 'robinhood' ? usEquitySession(now) : '24/7'
}

// ── Quotes (README contract) ────────────────────────────────────────────────

export interface Quote {
  last: number
  chg: number
  chgPct: number
  /** Unix ms. */
  asOf: number
  feed: string
  session: QuoteSession
  chartable: boolean
}

export function fmtQuotePrice(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1000) return n.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })
  if (n >= 1) return n.toFixed(2)
  if (n >= 0.01) return n.toFixed(4)
  return n.toPrecision(3)
}

// ── Alerts ──────────────────────────────────────────────────────────────────
// "Unlimited alerts" is free only if dedup per symbol holds (BUSINESS-MODEL
// §6), so the store is keyed by symbol: groupAlertsBySymbol turns N alerts
// into K ≤ N quote reads and the cron proves it in its response.

export type AlertCondition = 'above' | 'below' | 'pct_move'
export const ALERT_CONDITIONS: readonly AlertCondition[] = ['above', 'below', 'pct_move'] as const

export interface AlertRule {
  symbol: string
  condition: AlertCondition
  /** Price for above/below; percent (absolute, e.g. 5 = ±5%) for pct_move. */
  value: number
  /** pct_move only: the price the alert was armed at. */
  basePrice?: number | null
}

export function isAlertCondition(x: unknown): x is AlertCondition {
  return typeof x === 'string' && (ALERT_CONDITIONS as readonly string[]).includes(x)
}

/** Validate a rule's numbers. Returns a problem string or null. */
export function alertRuleProblem(rule: Partial<AlertRule>): string | null {
  if (!rule.symbol || !normalizeWatchSymbol(rule.symbol)) return 'Name a symbol.'
  if (!isAlertCondition(rule.condition)) return "condition must be 'above' | 'below' | 'pct_move'."
  const v = Number(rule.value)
  if (!Number.isFinite(v) || v <= 0) return 'value must be a positive number.'
  if (rule.condition === 'pct_move' && v >= 100) return 'A percent move must be under 100.'
  if (rule.condition === 'pct_move' && !(Number(rule.basePrice) > 0)) return 'pct_move needs the price it was armed at.'
  return null
}

/** Does this price trip the rule? Pure — the cron and the harness share it. */
export function alertFires(rule: AlertRule, price: number): boolean {
  if (!(price > 0)) return false
  switch (rule.condition) {
    case 'above':
      return price >= rule.value
    case 'below':
      return price <= rule.value
    case 'pct_move': {
      const base = Number(rule.basePrice)
      if (!(base > 0)) return false
      return Math.abs((price - base) / base) * 100 >= rule.value
    }
  }
}

export function alertLabel(rule: AlertRule): string {
  if (rule.condition === 'above') return `${rule.symbol} above $${fmtQuotePrice(rule.value)}`
  if (rule.condition === 'below') return `${rule.symbol} below $${fmtQuotePrice(rule.value)}`
  const base = rule.basePrice ? ` from $${fmtQuotePrice(rule.basePrice)}` : ''
  return `${rule.symbol} moves ${rule.value}%${base}`
}

/** N alerts → the distinct symbols to read, each with its alerts. The size of
 *  this map is the number of price reads a sweep costs. */
export function groupAlertsBySymbol<T extends { symbol: string }>(alerts: readonly T[]): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const a of alerts) {
    const key = normalizeWatchSymbol(a.symbol) ?? a.symbol
    const arr = m.get(key)
    if (arr) arr.push(a)
    else m.set(key, [a])
  }
  return m
}

// ── Alerts that act ─────────────────────────────────────────────────────────
// The alert form offers "Notify me" AND chips whose ask strings round-trip an
// existing parser. Two families: `fires` chips are surfaced on the rail when
// the alert fires and the user SENDS them (the signature is the gate — the
// alert never sends anything for you); `runsItself` chips arm an autonomous
// layer NOW (Spot Guardian / HL Guardian / CoW limit order) instead of an
// alert — the venue watches the price, not our cron.

export interface AlertActionChip {
  kind: 'buy' | 'sell' | 'protect' | 'limit' | 'stop'
  label: string
  /** Round-trips parseSwapIntent / parseSpotGuardArm / parseGuardianArm (harness-pinned). */
  ask: string
  /** True = arms an autonomous layer today (offered by name), false = a chip sent when the alert fires. */
  runsItself: boolean
}

const money = (n: number) => Number(n.toFixed(2))

export function alertActionChips(rule: AlertRule, pair: ChartPair | null, sizeUsd = 50): AlertActionChip[] {
  const sym = rule.symbol
  const price = rule.condition === 'pct_move' ? null : rule.value
  const chips: AlertActionChip[] = []
  // Fired chips — the same two doors the token page offers, sent when it fires.
  chips.push({ kind: 'buy', label: `Buy $${sizeUsd} of ${sym}`, ask: `Buy $${sizeUsd} of ${sym}`, runsItself: false })
  chips.push({ kind: 'sell', label: `Sell $${sizeUsd} of ${sym}`, ask: `Sell $${sizeUsd} of ${sym}`, runsItself: false })
  if (!pair || price == null) return chips
  if (rule.condition === 'below') {
    if (pair.source === 'coinbase') {
      chips.push({
        kind: 'protect',
        label: `Spot Guardian: sell my ${sym} if it drops to $${fmtQuotePrice(price)}`,
        ask: `protect my spot ${sym} if it drops to $${price}`,
        runsItself: true,
      })
    } else if (pair.source === 'hyperliquid') {
      chips.push({
        kind: 'stop',
        label: `Guardian: stop my ${sym} long at $${fmtQuotePrice(price)}`,
        ask: `protect my ${sym} long with stop loss at $${price}`,
        runsItself: true,
      })
    }
  }
  if (rule.condition === 'above' && pair.source === 'coinbase') {
    const units = Math.max(0.0001, Number((sizeUsd / price).toFixed(4)))
    chips.push({
      kind: 'limit',
      label: `Limit order: sell ${units} ${sym} at $${fmtQuotePrice(price)}`,
      ask: `limit order: sell ${units} ${sym} for at least ${money(units * price)} USDC`,
      runsItself: true,
    })
  }
  return chips
}
