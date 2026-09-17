// The trade-ask grammar — pure, no React. Which sides a chart pair can
// honestly offer, the ONE sentence each side composes (every string is a
// parser's own example phrasing — memory chip-send-contract: the chip IS the
// contract), and the default chip row. Shared by the Trade panel, the symbol
// page's header strip, the site-wide ask door and the harness.

import type { ChartPair } from '@/lib/charts'
import { tokenHome } from '@/lib/token-home'

// No DCA side (2026-09-16, Nate): a recurring buy in confirm mode only
// reminds the wallet to sign each period, so no chart surface offers one.
// The grammar still works when someone types it (lib/dca).
export type TradeSide = 'buy' | 'sell' | 'protect'

// ── MK2/EXEC: the honest EXTENDED side set for the header ExecStrip ────────
// The TradeSides above are byte-compatible (MARKETS + the ask door import
// tradeAsks / sideOf / AMOUNTS / STOPS). The strip adds
// perp long/short beside spot buy/sell for coins the venue lists, Lido stake
// for ETH, Aave supply for listed reserves — each a parser's own phrasing,
// each pinned through the ladder. Nothing here reaches the planner.
export type ExecSide = TradeSide | 'long' | 'short' | 'stake' | 'supply'

export interface ExecAsk {
  side: ExecSide
  label: string
  ask: string
  /** Chip colouring: sell-side chips wear the sell colour. */
  tone: 'buy' | 'sell' | 'neutral'
  /** The row kind the RouteTable groups it under (VenueKind). */
  kind: 'spot' | 'perp' | 'stake' | 'lend' | 'protect' | 'stock'
}

export interface TradeAsk {
  side: TradeSide
  label: string
  /** The sentence that gets sent — must round-trip an existing parser. */
  ask: string
}

export type InjectedPrompt = { text: string; send: boolean; at: number }

export const AMOUNTS = [10, 25, 100] as const
export const STOPS = [5, 10, 15] as const

/** Which sides a pair can honestly offer. Stocks: buy/sell on 4663 (the
 *  Spot Guardian runs on Base only — no protect chip, never a chip that
 *  walls). Perps: long/short live on the venue; protect = HL Guardian.
 *  Coins whose home isn't an EVM chain (SOL, XRP…) keep Buy/Sell (the route
 *  answers with the Hyperliquid door) and drop the protect chip that could
 *  only ever guard a Base squat (lib/token-home). */
export function sidesFor(pair: ChartPair): TradeSide[] {
  if (pair.source === 'robinhood') return ['buy', 'sell']
  if (pair.source === 'hyperliquid') return ['buy', 'sell', 'protect']
  if (tokenHome(pair.symbol)) return ['buy', 'sell']
  return ['buy', 'sell', 'protect']
}

/** Compose the sentence for a side. Every string here is a parser's own
 *  example phrasing (memory chip-send-contract: the chip IS the contract). */
export function composeAsk(pair: ChartPair, side: TradeSide, opts: { usd?: number; pct?: number } = {}): string {
  const sym = pair.symbol
  const usd = opts.usd ?? 10
  switch (side) {
    case 'buy':
      // The HL parser DEMANDS the venue word ("long eth" alone is ambiguous).
      return pair.source === 'hyperliquid' ? `Long $${usd} of ${sym} on Hyperliquid` : `Buy $${usd} of ${sym}`
    case 'sell':
      return pair.source === 'hyperliquid' ? `Short $${usd} of ${sym} on Hyperliquid` : `Sell $${usd} of ${sym}`
    case 'protect':
      return pair.source === 'hyperliquid'
        ? `Protect my ${sym} long with a ${opts.pct ?? 5}% stop`
        : `Protect my ${sym} in my wallet with a ${opts.pct ?? 5}% stop`
  }
}

export const SIDE_LABEL: Record<TradeSide, (pair: ChartPair) => string> = {
  buy: (p) => (p.source === 'hyperliquid' ? `Long ${p.symbol}` : `Buy ${p.symbol}`),
  sell: (p) => (p.source === 'hyperliquid' ? `Short ${p.symbol}` : `Sell ${p.symbol}`),
  protect: () => 'Protect with a stop',
}

/** The Overview chip row: one default ask per side the pair can offer. */
export function tradeAsks(pair: ChartPair): TradeAsk[] {
  return sidesFor(pair).map((side) => ({
    side,
    label: SIDE_LABEL[side](pair),
    ask: composeAsk(pair, side, { usd: 50 }),
  }))
}


/** Recover the side from a sentence (a chip fired from Overview lands the
 *  panel on the matching tab). */
export function sideOf(text: string): TradeSide {
  if (/^\s*protect/i.test(text)) return 'protect'
  if (/^\s*(?:sell|short)/i.test(text)) return 'sell'
  return 'buy'
}


// ── MK2/EXEC: the header strip's honest side set ────────────────────────────
import { fmtAskUnits } from '@/lib/chart-actions'
import { hasAaveReserveCold, hasPerpCold } from '@/lib/symbol-venues'

/** Which extended sides a pair can honestly offer, in strip order. Stocks:
 *  Buy · Sell (4663 only). Perp charts: Long · Short · Protect.
 *  Non-EVM homes: Long · Short (perps are the honest whole). Coins: Buy ·
 *  Sell · Long · Short (if the venue lists a perp) · Stake (ETH) · Supply
 *  (Aave reserve) · Protect. */
export function execSidesFor(pair: ChartPair): ExecSide[] {
  if (pair.source === 'robinhood') return ['buy', 'sell']
  if (pair.source === 'hyperliquid') return ['long', 'short', 'protect']
  if (tokenHome(pair.symbol)) return ['long', 'short']
  const out: ExecSide[] = ['buy', 'sell']
  if (hasPerpCold(pair.symbol)) out.push('long', 'short')
  if (pair.symbol === 'ETH') out.push('stake')
  if (hasAaveReserveCold(pair.symbol)) out.push('supply')
  out.push('protect')
  return out
}

/** Compose the sentence for an extended side. `last` sizes the Lido stake
 *  in ETH units (the stake grammar reads units) — without it the stake
 *  side is skipped by execAsks. */
export function composeExecAsk(pair: ChartPair, side: ExecSide, opts: { usd?: number; pct?: number; leverage?: number; last?: number } = {}): string | null {
  const sym = pair.symbol
  const usd = opts.usd ?? 10
  const lev = opts.leverage && opts.leverage > 1 ? `${opts.leverage}x ` : ''
  switch (side) {
    case 'long':
      return `${lev}Long $${usd} of ${sym} on Hyperliquid`
    case 'short':
      return `${lev}Short $${usd} of ${sym} on Hyperliquid`
    case 'stake': {
      if (sym !== 'ETH' || !opts.last) return null
      const units = fmtAskUnits(usd, opts.last)
      return units ? `Stake ${units} ETH on Lido` : null
    }
    case 'supply':
      return `Supply $${usd} of ${sym} to Aave`
    default:
      return composeAsk(pair, side, opts)
  }
}

export const EXEC_SIDE_LABEL: Record<ExecSide, (pair: ChartPair) => string> = {
  buy: (p) => `Buy ${p.symbol}`,
  sell: (p) => `Sell ${p.symbol}`,
  long: (p) => `Long ${p.symbol}`,
  short: (p) => `Short ${p.symbol}`,
  stake: () => 'Stake on Lido',
  supply: () => 'Supply on Aave',
  protect: () => 'Protect with a stop',
}

const EXEC_KIND: Record<ExecSide, ExecAsk['kind']> = {
  buy: 'spot', sell: 'spot', long: 'perp', short: 'perp', stake: 'stake', supply: 'lend', protect: 'protect',
}

/** The header strip: one default ask per extended side. A perp chart's
 *  buy/sell ARE long/short (composeAsk already says so) — the strip lists
 *  them once, as long/short. */
export function execAsks(pair: ChartPair, opts: { usd?: number; last?: number; leverage?: number } = {}): ExecAsk[] {
  const usd = opts.usd ?? 50
  const out: ExecAsk[] = []
  for (const side of execSidesFor(pair)) {
    const isPerpBuy = pair.source === 'hyperliquid' && (side === 'buy' || side === 'sell')
    const ask = composeExecAsk(pair, side, { usd, last: opts.last, leverage: side === 'long' || side === 'short' ? opts.leverage : undefined })
    if (!ask || isPerpBuy) continue
    const tone: ExecAsk['tone'] = side === 'sell' || side === 'short' ? 'sell' : side === 'buy' || side === 'long' ? 'buy' : 'neutral'
    const kind = pair.source === 'robinhood' && EXEC_KIND[side] === 'spot' ? 'stock' : EXEC_KIND[side]
    out.push({ side, label: EXEC_SIDE_LABEL[side](pair), ask, tone, kind })
  }
  return out
}

/** Recover the extended side from a sentence. */
export function execSideOf(text: string): ExecSide {
  if (/^\s*(?:\d+(?:\.\d+)?x\s+)?long\b/i.test(text)) return 'long'
  if (/^\s*(?:\d+(?:\.\d+)?x\s+)?short\b/i.test(text)) return 'short'
  if (/^\s*stake\b/i.test(text)) return 'stake'
  if (/^\s*supply\b/i.test(text)) return 'supply'
  return sideOf(text)
}
