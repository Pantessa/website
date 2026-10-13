// DUNE'S REAL-TIME FEEDS (2026-10-13): the pure half.
//
// Dune streams executed trades per venue over an authenticated WebSocket
// (`X-Dune-Api-Key` on the upgrade request — a browser cannot send it, so
// lib/dune-feed-server.ts holds the upstream socket and app/api/live/stream
// relays it to the page as Server-Sent Events). Two wire schemas, measured
// live against the onboarding runbooks in ~/pantessa/dune/docs:
//
//   • perp-trades.json.v1 — HyperCore (Hyperliquid's perps incl. the xyz
//     HIP-3 dex), Lighter mainnet (USDC-settled) and Lighter Robinhood
//     (USDG-settled: OPENAI, ANTHROPIC, CRCL, MSFT …). One execution per
//     record, the taker's side AND its position effect (open · increase ·
//     decrease · close · flip), the block, a Chainlink/venue USD value.
//   • dex-trades.json.v1 — the spot trial: Uniswap v2/v3/v4, Aerodrome,
//     Curve, Balancer, Camelot, GMX swaps on Ethereum, Base and Arbitrum,
//     fifteen tokens (WETH, USDC, USDT, WBTC, AAVE, UNI, LINK, cbBTC …).
//
// Every message is one block envelope: `op` INSERT or UPDATE (a complete
// replacement of that block's trades), `incarnation_version`, and a
// `sequence_number` cursor for `?resume_after=`. This module turns a frame
// into lib/tape TapeFills and nothing else — no network, no browser, no
// store. Pinned by scripts/tape-pins.ts.
//
// Rules kept from the tape: a field the wire does not carry is null, never
// guessed; prices, sizes and values are the venue's decimal strings and are
// read as numbers for DISPLAY only (nothing here settles money); `side` is
// the TAKER's direction, never long or short.

import type { TapeEffect, TapeFill, TapeSide, TapeVenue } from '@/lib/tape'

// ── The key ──────────────────────────────────────────────────────────────────

/** The feed credential. `DUNE_API_KEY` (the older Analytics key) is NOT a
 *  feed key — probed 2026-10-13: the perp endpoint refuses it (close 1006)
 *  exactly as it refuses no key — so the feed never falls back to it. */
export const DUNE_FEED_KEY_ENV = 'DUNE_BETA_API_KEY'

export function duneFeedKey(env: Record<string, string | undefined> = process.env): string | null {
  const k = env[DUNE_FEED_KEY_ENV]?.trim()
  return k ? k : null
}

// ── The venues ───────────────────────────────────────────────────────────────

export type DuneVenueId = 'hypercore' | 'lighter' | 'lighter-robinhood' | 'dex-ethereum' | 'dex-base' | 'dex-arbitrum'

export interface DuneVenue {
  id: DuneVenueId
  /** The words on the page. */
  label: string
  kind: 'perp' | 'spot'
  url: string
  /** The envelope's `chain` pair this socket speaks for. */
  chain: { type: string; id: number }
  /** How a fill from it is tagged (lib/tape TapeVenue). */
  venue: TapeVenue
  /** The EVM chain id for spot swaps (the ask names the chain). */
  chainId: number | null
}

export const DUNE_VENUES: readonly DuneVenue[] = [
  { id: 'hypercore', label: 'Hyperliquid perps', kind: 'perp', url: 'wss://api.dune.com/api/feed/perp/trades/1', chain: { type: 'hypercore', id: 1 }, venue: 'hyperliquid', chainId: null },
  { id: 'lighter', label: 'Lighter perps', kind: 'perp', url: 'wss://api.dune.com/api/feed/perp/trades/lighter/1', chain: { type: 'lighter', id: 1 }, venue: 'lighter', chainId: null },
  { id: 'lighter-robinhood', label: 'Lighter · Robinhood perps', kind: 'perp', url: 'wss://api.dune.com/api/feed/perp/trades/lighter/2', chain: { type: 'lighter', id: 2 }, venue: 'lighter-robinhood', chainId: null },
  { id: 'dex-ethereum', label: 'DEX swaps · Ethereum', kind: 'spot', url: 'wss://api.dune.com/api/trial/feed/dex/trades/evm/1', chain: { type: 'evm', id: 1 }, venue: 'dex', chainId: 1 },
  { id: 'dex-base', label: 'DEX swaps · Base', kind: 'spot', url: 'wss://api.dune.com/api/trial/feed/dex/trades/evm/8453', chain: { type: 'evm', id: 8453 }, venue: 'dex', chainId: 8453 },
  { id: 'dex-arbitrum', label: 'DEX swaps · Arbitrum', kind: 'spot', url: 'wss://api.dune.com/api/trial/feed/dex/trades/evm/42161', chain: { type: 'evm', id: 42161 }, venue: 'dex', chainId: 42161 },
]

export const DUNE_VENUE_IDS: readonly DuneVenueId[] = DUNE_VENUES.map((v) => v.id)

/** What /live opens on: every venue the key reaches. */
export const DEFAULT_LIVE_VENUES: readonly DuneVenueId[] = DUNE_VENUE_IDS

/** What the splash's pulse and the battle views read: the perp venues
 *  (their fills carry a taker side and a position effect; a spot swap has
 *  no position, and the battle's armies are perp markets). */
export const PERP_VENUES: readonly DuneVenueId[] = ['hypercore', 'lighter', 'lighter-robinhood']

export function duneVenue(id: string): DuneVenue | null {
  return DUNE_VENUES.find((v) => v.id === id) ?? null
}

/** `?venues=hypercore,lighter` → the known ids, in table order, deduped;
 *  nothing recognisable → the default list. */
export function parseVenueList(raw: string | null | undefined, fallback: readonly DuneVenueId[] = DEFAULT_LIVE_VENUES): DuneVenueId[] {
  if (!raw) return [...fallback]
  const want = new Set(raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean))
  const out = DUNE_VENUE_IDS.filter((id) => want.has(id))
  return out.length ? out : [...fallback]
}

/** `?markets=BTC,xyz:NVDA` → the venue spellings, capped; empty = every market. */
export const MARKET_PARAM_RE = /^[A-Za-z0-9:]{1,24}$/
export function parseMarketList(raw: string | null | undefined, cap = 64): string[] {
  if (!raw) return []
  const out: string[] = []
  for (const m of raw.split(',')) {
    const t = m.trim()
    if (!MARKET_PARAM_RE.test(t) || out.includes(t)) continue
    out.push(t)
    if (out.length >= cap) break
  }
  return out
}

/** The reconnect URL: strictly after the last cursor this process handled.
 *  A cursor is per endpoint — never reuse one across venues. */
export function resumeUrl(url: string, cursor: string | null): string {
  if (!cursor || !/^\d+$/.test(cursor)) return url
  return `${url}${url.includes('?') ? '&' : '?'}resume_after=${cursor}`
}

// ── The wire ─────────────────────────────────────────────────────────────────

export interface DuneEnvelope<T> {
  schema_version: string
  chain: { type: string; id: number }
  block_number: number
  block_timestamp?: string
  op: 'INSERT' | 'UPDATE' | string
  incarnation_version?: number | string
  sequence_number: string
  block_notification_time?: string
  trades: T[]
}

interface DuneParty {
  address: string | null
  account_id: string | null
  position_side?: string | null
  position_effect?: string | null
}

/** One perp execution (perp-trades.json.v1), the fields the tape reads. */
export interface DunePerpTrade {
  trade_id: string
  venue: { name: string; protocol?: string; id?: string; market: string; market_id?: string }
  kind: string
  mechanism?: string
  base_symbol?: string
  side: 'buy' | 'sell' | null
  size: string
  executed_price: string
  executed_at: string
  value_usd?: { amount: string | null; source?: string; stale?: boolean } | null
  taker?: DuneParty | null
  maker?: DuneParty | null
  tx?: { hash?: string | null } | null
  instrument_code?: string
}

/** One spot swap (dex-trades.json.v1). `tokens` carries both legs; the leg
 *  with `amount_in` is what the taker PAID, the one with `amount_out` what
 *  it RECEIVED. `base`/`quote` are addresses, `side` is the taker's on the base. */
export interface DuneDexTrade {
  trade_id: string
  base: string
  quote: string
  side: 'buy' | 'sell' | string
  executed_price?: number | string | null
  taker?: string | null
  tokens: { address: string; symbol: string; decimals?: number; amount_in: number | string; amount_out: number | string }[]
  tx?: { hash?: string | null; from?: string | null } | null
  value?: { notional_usd?: number | string | null; price_source?: string; stale_usd_price?: boolean } | null
  venue?: { id?: string; name?: string; protocol?: string; pool?: string }
  instrument_code?: string
}

export type DuneFrame = DuneEnvelope<DunePerpTrade> | DuneEnvelope<DuneDexTrade>

export const PERP_SCHEMA = 'perp-trades.json.v1'
export const DEX_SCHEMA = 'dex-trades.json.v1'

const EFFECTS = new Set<TapeEffect>(['open', 'increase', 'decrease', 'close', 'flip'])
const ZERO_HASH = /^0x0+$/
const EVM_HASH = /^0x[0-9a-f]{64}$/i

function num(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN
  return Number.isFinite(n) ? n : NaN
}

/**
 * A perp execution → a tape fill. Only `kind: 'trade'` on the order book
 * is a print (a liquidation is too — it has a taker side; settlement and
 * deleverage carry no side and are skipped by the side check). The USD
 * value is the venue's/Chainlink's when it is there and fresh, else size ×
 * price (every listed perp quotes in a dollar stable).
 */
export function fillFromDunePerp(t: DunePerpTrade, env: Pick<DuneEnvelope<unknown>, 'block_number' | 'chain'>, venue: TapeVenue): TapeFill | null {
  const market = t.venue?.market || t.base_symbol
  if (!market || typeof market !== 'string') return null
  if (t.side !== 'buy' && t.side !== 'sell') return null
  const price = num(t.executed_price)
  const size = num(t.size)
  if (!(price > 0) || !(size > 0)) return null
  const at = Date.parse(t.executed_at)
  if (!Number.isFinite(at)) return null
  const value = t.value_usd && !t.value_usd.stale ? num(t.value_usd.amount) : NaN
  const effRaw = t.taker?.position_effect
  const effect = typeof effRaw === 'string' && EFFECTS.has(effRaw as TapeEffect) ? (effRaw as TapeEffect) : null
  const hash = t.tx?.hash && EVM_HASH.test(t.tx.hash) && !ZERO_HASH.test(t.tx.hash) ? t.tx.hash.toLowerCase() : null
  const block = num(env.block_number)
  return {
    id: `dune:${t.trade_id}`,
    market,
    side: t.side as TapeSide,
    size,
    price,
    usd: value > 0 ? value : size * price,
    at,
    taker: partyId(t.taker),
    maker: partyId(t.maker),
    hash,
    effect,
    block: Number.isFinite(block) ? block : null,
    source: 'dune',
    venue,
    chainId: null,
  }
}

/** HyperCore names a party by address; Lighter by account id (address
 *  null). The venue's own form is kept, lowercased when it is hex. */
function partyId(p: DuneParty | null | undefined): string | null {
  if (!p) return null
  if (p.address) return p.address.toLowerCase()
  if (p.account_id) return `acct:${p.account_id}`
  return null
}

/** Display symbol → the ticker the ask grammar knows (lib/token-home: a
 *  buy of "ETH" is the native coin; cbBTC/WBTC are the BTC the cascade
 *  swaps). Anything else keeps its symbol. */
export const DEX_ASK_TICKER: Readonly<Record<string, string>> = { WETH: 'ETH', WBTC: 'BTC', CBBTC: 'BTC' }

export function dexAskTicker(symbol: string): string {
  return DEX_ASK_TICKER[symbol.toUpperCase()] ?? symbol.toUpperCase()
}

/**
 * A spot swap → a tape fill on its BASE token: the taker's side on the
 * base is Dune's own `side`; size is the base amount that moved; price is
 * dollars per base unit (the venue's `notional_usd` over the size when the
 * value is there, else the executed quote price only when the quote is a
 * dollar stable). No position, no effect; the tx hash, the sender and the
 * block are the chain's. Tagged with the chain so the row can say "Base".
 */
export function fillFromDuneDex(t: DuneDexTrade, env: Pick<DuneEnvelope<unknown>, 'block_number' | 'chain'>): TapeFill | null {
  if (t.side !== 'buy' && t.side !== 'sell') return null
  if (!Array.isArray(t.tokens) || !t.base) return null
  const base = t.tokens.find((k) => k.address?.toLowerCase() === t.base.toLowerCase())
  const quote = t.tokens.find((k) => k.address?.toLowerCase() === t.quote?.toLowerCase())
  if (!base?.symbol) return null
  const size = t.side === 'buy' ? num(base.amount_out) : num(base.amount_in)
  if (!(size > 0)) return null
  const notional = num(t.value?.notional_usd)
  const quoteIsDollar = !!quote && DOLLAR_QUOTES.has(quote.symbol.toUpperCase())
  const execPrice = num(t.executed_price)
  const price = notional > 0 ? notional / size : quoteIsDollar && execPrice > 0 ? execPrice : NaN
  if (!(price > 0)) return null
  const block = num(env.block_number)
  const hash = t.tx?.hash && EVM_HASH.test(t.tx.hash) ? t.tx.hash.toLowerCase() : null
  const sender = t.tx?.from && /^0x[0-9a-f]{40}$/i.test(t.tx.from) ? t.tx.from.toLowerCase() : null
  return {
    id: `dune:${env.chain.type}-${env.chain.id}-${t.trade_id}`,
    market: base.symbol,
    side: t.side,
    size,
    price,
    usd: notional > 0 ? notional : size * price,
    at: NaN, // the envelope's block time; set by fillsFromDuneFrame
    taker: sender,
    maker: null,
    hash,
    effect: null,
    block: Number.isFinite(block) ? block : null,
    source: 'dune',
    venue: 'dex',
    chainId: Number.isFinite(env.chain.id) ? env.chain.id : null,
  }
}

const DOLLAR_QUOTES = new Set(['USDC', 'USDT', 'DAI', 'USDE', 'USDG', 'USD1', 'FDUSD', 'PYUSD'])

/**
 * One envelope → the fills it carries, in wire order, with the venue's tag.
 * A spot swap is stamped with the block's timestamp (the chain's clock; the
 * trade carries none of its own). An unknown schema answers nothing. The
 * `op` and block ride beside the fills so an UPDATE can replace the block
 * downstream (lib/tape-feed retracts, then merges).
 */
export function fillsFromDuneFrame(frame: DuneFrame, venue: DuneVenue): { op: 'INSERT' | 'UPDATE'; block: number | null; fills: TapeFill[] } | null {
  if (!frame || typeof frame !== 'object' || !Array.isArray(frame.trades)) return null
  const op = frame.op === 'UPDATE' ? 'UPDATE' : frame.op === 'INSERT' ? 'INSERT' : null
  if (!op) return null // the runbook: stop on an unknown op; the server logs it
  const block = num(frame.block_number)
  const env = { block_number: frame.block_number, chain: frame.chain }
  const fills: TapeFill[] = []
  if (frame.schema_version === PERP_SCHEMA) {
    for (const t of frame.trades as DunePerpTrade[]) {
      const f = fillFromDunePerp(t, env, venue.venue)
      if (f) fills.push(f)
    }
  } else if (frame.schema_version === DEX_SCHEMA) {
    const at = frame.block_timestamp ? Date.parse(frame.block_timestamp) : NaN
    if (!Number.isFinite(at)) return { op, block: Number.isFinite(block) ? block : null, fills: [] }
    for (const t of frame.trades as DuneDexTrade[]) {
      const f = fillFromDuneDex(t, env)
      if (f) fills.push({ ...f, at })
    }
  } else {
    return null
  }
  return { op, block: Number.isFinite(block) ? block : null, fills }
}

// ── The relay's wire (server → page) ─────────────────────────────────────────

/** One Server-Sent Event of the `/api/live/stream` relay. */
export type LiveStreamEvent =
  | { type: 'hello'; venues: DuneVenueId[]; markets: string[]; keyed: true; closesInMs: number }
  | { type: 'fills'; venue: DuneVenueId; op: 'INSERT' | 'UPDATE'; block: number | null; fills: TapeFill[] }
  | { type: 'status'; venue: DuneVenueId; status: 'connecting' | 'live' | 'reconnecting' | 'closed'; detail?: string }
  | { type: 'bye'; reason: 'max-duration' | 'shutdown' }

/** The relay holds a response this long, then says `bye` so the browser's
 *  EventSource reopens (the function's own limit is a few seconds above). */
export const LIVE_STREAM_HOLD_MS = 285_000
export const LIVE_STREAM_MAX_DURATION_S = 300
export const LIVE_STREAM_HEARTBEAT_MS = 15_000
/** Streams one address may hold at once on one instance, and in all. */
export const LIVE_STREAM_PER_IP = 6
export const LIVE_STREAM_PER_INSTANCE = 400

/** The words for a status line: which venues the page is reading. */
export function venueWords(ids: readonly DuneVenueId[]): string {
  if (ids.length === DUNE_VENUE_IDS.length) return 'every venue'
  const perps = ids.filter((id) => duneVenue(id)?.kind === 'perp').length
  const spots = ids.filter((id) => duneVenue(id)?.kind === 'spot').length
  const parts: string[] = []
  if (perps) parts.push(`${perps} perp venue${perps === 1 ? '' : 's'}`)
  if (spots) parts.push(`${spots} spot chain${spots === 1 ? '' : 's'}`)
  return parts.join(' + ') || 'no venue'
}
