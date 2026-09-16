// ─────────────────────────────────────────────────────────────────────────
//  Tape parity for Robinhood Chain stock swaps (chain 4663).
//
//  A tokenized stock has two prices: Robinhood's tape (the 24/7 historicals
//  the chart draws, Yahoo as the fallback) and the pool the swap fills in.
//  Every swap builder's slippage bound is measured from its OWN pool quote,
//  so a pool far from the tape produced a fully "guarded" swap that lost the
//  money anyway. 2026-09-16: "Buy $50 of AMAT" built through a Uniswap v3 1%
//  pool quoting ~$33k a share against a $421.84 tape — about 0.0015 AMAT
//  (~$0.64) for $50. The same day 22 curated listings had v3 pools more than
//  150× the tape on a buy (and paying under 1% of it on a sell), and CLOV,
//  FLY and RUN sat 35–83% off on one side.
//
//  The rule, in one place, for every builder (v3, v4, LiFi):
//   · A 4663 swap with a stock on either side prices both legs — the stock
//     at the tape (lib/quotes: Robinhood's batch, Yahoo per symbol when it's
//     down), a stable at face value, wrapped ETH (or cbBTC) at Coinbase — and
//     compares the fill's per-share price with the tape.
//   · More than STOCK_TAPE_BOUND_PCT away, EITHER side, is off tape: the
//     builder throws OffTapeError before any calldata leaves it. The cascade
//     (lib/swap-exec, the chat route) falls through to the chain's own
//     settlement venue via LiFi, and refuses by name when that is off tape
//     too. Symmetric on purpose: a pool paying far MORE than the tape is the
//     thin side of the same broken pool, or a token that isn't the share we
//     think it is.
//   · Past STOCK_TAPE_WARN_PCT the fill still builds, with a warning naming
//     the gap.
//   · No tape, no build (fail closed). A listing Robinhood's market data has
//     no price for (CASHCAT, SATS) refuses by name, permanently. A feed that
//     didn't answer, or a last print older than STOCK_TAPE_MAX_AGE_MS, is
//     transient: chat holds ("try again in a moment"), the jobs runner
//     withholds and retries, and /api/tx/refresh falls back to the card's own
//     still-live quote, which was checked against the tape when it was built.
//
//  Why 10%: measured at a $100 order on 2026-09-16, every working pool sat
//  within 3.8% of the tape and the thin-but-real ones (SOUN +8.6% / −7.1%,
//  AVAV −8.1% on a sell) inside 9%; every broken one was 35% or more off. The
//  bound refuses all of those and none of these, and leaves room for a pool
//  that trades through the weekend to lead a tape that doesn't.
// ─────────────────────────────────────────────────────────────────────────

import { chainById } from '@/lib/chains'
import { chartPairFor } from '@/lib/charts'
import { resolveToken, tokenDecimals } from '@/lib/cow'
import { cleanQuoteSymbols, readQuotes } from '@/lib/quotes'
import { ROBINHOOD_TICKER_SET } from '@/lib/robinhood-tickers'
import { isRobinhoodStockSymbol } from '@/lib/stock-list'
import { dynamicTokenByAddress, ensureTokenList } from '@/lib/token-list'
import type { GuardrailCheck } from '@/lib/tx-guardrails'

export const STOCK_TAPE_CHAIN_ID = 4663
/** A fill further than this from the tape, either side, is refused. */
export const STOCK_TAPE_BOUND_PCT = 10
/** A fill further than this still builds, with a warning that names the gap. */
export const STOCK_TAPE_WARN_PCT = 3
/** A last print older than this is no tape: 96h spans the 24-hour market's
 *  weekend close (Fri 8pm → Sun 8pm ET) plus a holiday. */
export const STOCK_TAPE_MAX_AGE_MS = 96 * 60 * 60 * 1000

// ── Legs ────────────────────────────────────────────────────────────────────

export type SwapLegKind = 'stock' | 'stable' | 'coin' | 'other'

export interface SwapLeg {
  /** Ticker as the tape knows it (AMAT), the stable's symbol, or the coin
   *  (wrapped gas reads as ETH). */
  symbol: string
  address: string
  decimals: number
  kind: SwapLegKind
}

export interface PricedLeg extends SwapLeg {
  usd: number
  /** Which feed priced it: robinhood | yahoo | coinbase | hyperliquid | face value. */
  feed: string
  asOf: number
}

/**
 * What a swap token is on Robinhood Chain. Sync: reads the warmed 4663 token
 * list (callers `await ensureTokenList(4663)` first). Null when the token
 * doesn't resolve there at all.
 */
export function swapLegOf(token: string, chainId: number = STOCK_TAPE_CHAIN_ID): SwapLeg | null {
  const chain = chainById(chainId)
  const address = resolveToken(token, chainId)?.toLowerCase()
  if (!chain || !address) return null
  const decimals = tokenDecimals(token, chainId) ?? dynamicTokenByAddress(address, chainId)?.decimals ?? 18
  const stableDec = chain.stables[address]
  if (stableDec !== undefined) {
    const sym = Object.entries(chain.tokens).find(([, t]) => t.address.toLowerCase() === address)?.[0] ?? token.trim().toUpperCase()
    return { symbol: sym, address, decimals: stableDec, kind: 'stable' }
  }
  if (address === chain.wrappedNative.toLowerCase()) return { symbol: 'ETH', address, decimals: 18, kind: 'coin' }
  const listed = dynamicTokenByAddress(address, chainId)
  const symbol = (listed?.symbol ?? token).trim().toUpperCase()
  // The equity snapshot is the stock list. A live listing that isn't in it
  // yet (a new stock) is still a stock, unless it charts as a coin (cbBTC).
  const chart = chartPairFor(symbol)
  const coin = !ROBINHOOD_TICKER_SET.has(symbol) && (chart?.source === 'coinbase' || chart?.source === 'hyperliquid')
  if (coin) return { symbol, address, decimals, kind: 'coin' }
  const isStock = ROBINHOOD_TICKER_SET.has(symbol) || (!!listed && isRobinhoodStockSymbol(symbol))
  return { symbol, address, decimals, kind: isStock ? 'stock' : 'other' }
}

// ── The fill, priced (pure) ─────────────────────────────────────────────────

export interface TapeFill {
  /** "Robinhood Chain's Uniswap v3 pool", "…own settlement venue (via LiFi)". */
  venue: string
  /** The stock the per-share price is for. */
  symbol: string
  side: 'buy' | 'sell'
  /** This fill's USD per share (Infinity when it returns no shares). */
  sharePx: number
  tapeUsd: number
  feed: string
  asOf: number
  /** (sharePx − tape) / tape × 100. */
  devPct: number
}

/**
 * Price a quoted fill per share against the tape. A buy (stock out) pays
 * `in × price(in) / shares`; a sell (stock in) receives `out × price(out) /
 * shares`; stock-for-stock reads the stock bought. Null when neither leg is a
 * stock.
 */
export function tapeFillOf(venue: string, sell: PricedLeg, buy: PricedLeg, amountIn: bigint, amountOut: bigint): TapeFill | null {
  const sellHuman = Number(amountIn) / 10 ** sell.decimals
  const buyHuman = Number(amountOut) / 10 ** buy.decimals
  let fill: Omit<TapeFill, 'devPct'> | null = null
  if (buy.kind === 'stock') {
    const px = buyHuman > 0 ? (sellHuman * sell.usd) / buyHuman : Number.POSITIVE_INFINITY
    fill = { venue, symbol: buy.symbol, side: 'buy', sharePx: px, tapeUsd: buy.usd, feed: buy.feed, asOf: buy.asOf }
  } else if (sell.kind === 'stock') {
    const px = sellHuman > 0 ? (buyHuman * buy.usd) / sellHuman : 0
    fill = { venue, symbol: sell.symbol, side: 'sell', sharePx: px, tapeUsd: sell.usd, feed: sell.feed, asOf: sell.asOf }
  }
  if (!fill) return null
  return { ...fill, devPct: ((fill.sharePx - fill.tapeUsd) / fill.tapeUsd) * 100 }
}

export type TapeBand = 'ok' | 'warn' | 'off'

/** Within the warn line, past it, or past the refusal bound. Non-finite = off. */
export function tapeBand(devPct: number): TapeBand {
  if (!Number.isFinite(devPct)) return 'off'
  const d = Math.abs(devPct)
  if (d > STOCK_TAPE_BOUND_PCT) return 'off'
  return d > STOCK_TAPE_WARN_PCT ? 'warn' : 'ok'
}

const tapeName = (feed: string) => (feed === 'yahoo' ? 'the Yahoo Finance tape' : "Robinhood's tape")

/** "$32,990.65" · "$421.84" · "$0.0132". */
export function fmtSharePx(n: number): string {
  if (!Number.isFinite(n)) return 'no price'
  if (n >= 1) return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  return `$${n.toPrecision(3)}`
}

/** Magnitude only: "7,721" past 100%, "8.58" under it. */
export function fmtTapeGap(devPct: number): string {
  const d = Math.abs(devPct)
  return d >= 100 ? Math.round(d).toLocaleString('en-US') : d.toFixed(2)
}

/** "78× Robinhood's tape ($423.85)" at double or more, else
 *  "8.58% above Robinhood's tape ($5.94)". */
function gapWords(f: TapeFill): string {
  const tape = `${tapeName(f.feed)} (${fmtSharePx(f.tapeUsd)})`
  if (f.devPct >= 100) {
    const x = f.sharePx / f.tapeUsd
    return `${x < 10 ? x.toFixed(1) : Math.round(x).toLocaleString('en-US')}× ${tape}`
  }
  return `${fmtTapeGap(f.devPct)}% ${f.devPct >= 0 ? 'above' : 'below'} ${tape}`
}

/** The refusal sentence: venue, stock, both prices, the gap, the bound. */
export function offTapeSentence(f: TapeFill): string {
  if (!Number.isFinite(f.devPct)) {
    return `${f.venue} returns no ${f.symbol} for this order, against ${tapeName(f.feed)}'s ${fmtSharePx(f.tapeUsd)} a share — outside the ${STOCK_TAPE_BOUND_PCT}% bound.`
  }
  return `${f.venue} fills this ${f.symbol} ${f.side} at ${fmtSharePx(f.sharePx)} a share — ${gapWords(f)}, outside the ${STOCK_TAPE_BOUND_PCT}% bound.`
}

/** The guardrail row a fill inside the bound carries onto the sign card. */
export function tapeCheckOf(f: TapeFill): GuardrailCheck {
  const signed = `${f.devPct >= 0 ? '+' : '−'}${fmtTapeGap(f.devPct)}%`
  if (tapeBand(f.devPct) === 'warn') {
    return {
      id: 'tape',
      level: 'warn',
      ok: false,
      note: `This ${f.symbol} ${f.side} fills at ${fmtSharePx(f.sharePx)} a share, ${gapWords(f)} — inside the ${STOCK_TAPE_BOUND_PCT}% bound, but a real gap.`,
    }
  }
  return {
    id: 'tape',
    level: 'block',
    ok: true,
    note: `Checked against ${tapeName(f.feed)}: this ${f.symbol} ${f.side} fills at ${fmtSharePx(f.sharePx)} a share vs ${fmtSharePx(f.tapeUsd)} (${signed}, within the ${STOCK_TAPE_BOUND_PCT}% bound).`,
  }
}

// ── Errors ──────────────────────────────────────────────────────────────────

/** The venue's fill is past the bound — the cascade tries the next venue. */
export class OffTapeError extends Error {
  constructor(public fill: TapeFill) {
    super(offTapeSentence(fill))
    this.name = 'OffTapeError'
  }
}

export type TapeMissReason = 'no-feed' | 'down' | 'stale'

/** No usable tape for a leg. `permanent` (no feed exists) refuses by name;
 *  the rest are retried by whoever called. */
export class TapeUnavailableError extends Error {
  constructor(
    message: string,
    public symbol: string,
    public reason: TapeMissReason,
    /** Short, for a withheld job step: "no quote from Robinhood or Yahoo". */
    public detail: string,
  ) {
    super(message)
    this.name = 'TapeUnavailableError'
  }
  get permanent(): boolean {
    return this.reason === 'no-feed'
  }
}

export function tapeMissMessage(symbol: string, reason: TapeMissReason, asOf?: number): string {
  if (reason === 'no-feed') {
    return `Robinhood's market data has no price for ${symbol}, so there's nothing to check Robinhood Chain's pool against — Pantessa only builds a stock swap it can check against the tape. Nothing was built.`
  }
  if (reason === 'stale') {
    const when = asOf ? new Date(asOf).toISOString().slice(0, 10) : 'days ago'
    return `The last ${symbol} price on the tape is from ${when} — too old to check Robinhood Chain's pool against, so nothing was built. Try again once it trades.`
  }
  return `I couldn't read the ${symbol} price from Robinhood's tape just now, so I won't build the swap without checking the pool against it — try again in a moment. Nothing was built.`
}

// ── Reading the tape ────────────────────────────────────────────────────────

export interface TapePrice {
  usd: number
  feed: string
  asOf: number
}

/** A priced quote, or why there isn't one. Never throws. */
async function readTape(symbol: string, now: number): Promise<TapePrice | { miss: TapeMissReason; asOf?: number }> {
  const pair = chartPairFor(symbol)
  if (!pair) return { miss: 'no-feed' }
  const key = cleanQuoteSymbols([symbol]).symbols[0] ?? pair.symbol
  const read = await readQuotes([key]).catch(() => null)
  const q = read?.quotes[key]
  if (!q || !(q.last > 0)) return { miss: 'down' }
  if (now - q.asOf > STOCK_TAPE_MAX_AGE_MS) return { miss: 'stale', asOf: q.asOf }
  return { usd: q.last, feed: q.feed, asOf: q.asOf }
}

/** The tape for a stock ticker, or null (no feed, no answer, too old). Never throws. */
export async function stockTapeFor(symbol: string, now = Date.now()): Promise<TapePrice | null> {
  const t = await readTape(symbol.trim().toUpperCase(), now)
  return 'miss' in t ? null : t
}

async function priceLeg(leg: SwapLeg, now: number): Promise<PricedLeg> {
  if (leg.kind === 'stable') return { ...leg, usd: 1, feed: 'face value', asOf: now }
  if (leg.kind === 'other') {
    throw new TapeUnavailableError(
      `There's no public price for ${leg.symbol} on Robinhood Chain to check this stock swap against, so nothing was built.`,
      leg.symbol,
      'no-feed',
      `no price for ${leg.symbol}`,
    )
  }
  const t = await readTape(leg.symbol, now)
  if ('miss' in t) {
    const detail = t.miss === 'no-feed' ? `no feed lists ${leg.symbol}` : t.miss === 'stale' ? `last ${leg.symbol} print is too old` : `no ${leg.symbol} quote from Robinhood or Yahoo`
    throw new TapeUnavailableError(tapeMissMessage(leg.symbol, t.miss, t.asOf), leg.symbol, t.miss, detail)
  }
  return { ...leg, ...t }
}

export interface SwapTape {
  sell: PricedLeg
  buy: PricedLeg
}

/**
 * Price both legs of a swap for the tape check. Null when the swap isn't on
 * Robinhood Chain, a token doesn't resolve there, or neither leg is a stock —
 * the guard has nothing to say. Throws TapeUnavailableError when a leg a
 * stock swap needs can't be priced (fail closed).
 */
export async function readSwapTape(p: { chainId: number; sellToken: string; buyToken: string }, now = Date.now()): Promise<SwapTape | null> {
  if (p.chainId !== STOCK_TAPE_CHAIN_ID) return null
  await ensureTokenList(STOCK_TAPE_CHAIN_ID)
  const sell = swapLegOf(p.sellToken, p.chainId)
  const buy = swapLegOf(p.buyToken, p.chainId)
  if (!sell || !buy || (sell.kind !== 'stock' && buy.kind !== 'stock')) return null
  const [s, b] = await Promise.all([priceLeg(sell, now), priceLeg(buy, now)])
  return { sell: s, buy: b }
}

/**
 * The check a builder runs on its quote: null when there's no tape context
 * (not a stock swap), the guardrail row when the fill is inside the bound,
 * and OffTapeError when it isn't.
 */
export function checkFillAgainstTape(tape: SwapTape | null, venue: string, amountIn: bigint, amountOut: bigint): GuardrailCheck | null {
  if (!tape) return null
  const fill = tapeFillOf(venue, tape.sell, tape.buy, amountIn, amountOut)
  if (!fill) return null
  if (tapeBand(fill.devPct) === 'off') throw new OffTapeError(fill)
  return tapeCheckOf(fill)
}

/** A fill's gap from the tape (percent), or null without a stock leg — for a
 *  reference quote the builder only reads, never refuses on. */
export function fillDeviationPct(tape: SwapTape | null, amountIn: bigint, amountOut: bigint): number | null {
  if (!tape) return null
  return tapeFillOf('reference', tape.sell, tape.buy, amountIn, amountOut)?.devPct ?? null
}

/** Start the tape read without an unhandled rejection: await the result
 *  after the quote lands (the read rethrows then). */
export function startSwapTape(p: { chainId: number; sellToken: string; buyToken: string }): Promise<SwapTape | null> {
  const read = readSwapTape(p)
  read.catch(() => undefined)
  return read
}
