// The trade-ask grammar — pure, no React. Which sides a chart pair can
// honestly offer, the ONE sentence each side composes (every string is a
// parser's own example phrasing — memory chip-send-contract: the chip IS the
// contract), and the default chip row. Shared by the Trade panel, the symbol
// page's header strip, the site-wide ask door and the harness.

import type { ChartPair } from '@/lib/charts'
import { tokenHome } from '@/lib/token-home'

export type TradeSide = 'buy' | 'sell' | 'dca' | 'protect'

export interface TradeAsk {
  side: TradeSide
  label: string
  /** The sentence that gets sent — must round-trip an existing parser. */
  ask: string
}

export type InjectedPrompt = { text: string; send: boolean; at: number }

export const AMOUNTS = [10, 25, 100] as const
export const STOPS = [5, 10, 15] as const
export const CADENCES = ['daily', 'weekly', 'monthly'] as const
export type Cadence = (typeof CADENCES)[number]

/** Which sides a pair can honestly offer. Stocks: buy/sell/DCA on 4663
 *  (the Spot Guardian runs on Base only — no protect chip, never a chip
 *  that walls). Perps: long/short live on the venue; protect = HL Guardian.
 *  Coins whose home isn't an EVM chain (SOL, XRP…) keep Buy/Sell (the route
 *  answers with the Hyperliquid door) and drop the standing chips that
 *  could only ever buy a Base squat (lib/token-home). */
export function sidesFor(pair: ChartPair): TradeSide[] {
  if (pair.source === 'robinhood') return ['buy', 'sell', 'dca']
  if (pair.source === 'hyperliquid') return ['buy', 'sell', 'protect']
  if (tokenHome(pair.symbol)) return ['buy', 'sell']
  return ['buy', 'sell', 'dca', 'protect']
}

/** Compose the sentence for a side. Every string here is a parser's own
 *  example phrasing (memory chip-send-contract: the chip IS the contract). */
export function composeAsk(pair: ChartPair, side: TradeSide, opts: { usd?: number; pct?: number; cadence?: Cadence } = {}): string {
  const sym = pair.symbol
  const usd = opts.usd ?? 10
  switch (side) {
    case 'buy':
      // The HL parser DEMANDS the venue word ("long eth" alone is ambiguous).
      return pair.source === 'hyperliquid' ? `Long $${usd} of ${sym} on Hyperliquid` : `Buy $${usd} of ${sym}`
    case 'sell':
      return pair.source === 'hyperliquid' ? `Short $${usd} of ${sym} on Hyperliquid` : `Sell $${usd} of ${sym}`
    case 'dca':
      return `DCA $${usd} into ${sym} ${opts.cadence ?? 'weekly'}`
    case 'protect':
      return pair.source === 'hyperliquid'
        ? `Protect my ${sym} long with a ${opts.pct ?? 5}% stop`
        : `Protect my ${sym} in my wallet with a ${opts.pct ?? 5}% stop`
  }
}

export const SIDE_LABEL: Record<TradeSide, (pair: ChartPair) => string> = {
  buy: (p) => (p.source === 'hyperliquid' ? `Long ${p.symbol}` : `Buy ${p.symbol}`),
  sell: (p) => (p.source === 'hyperliquid' ? `Short ${p.symbol}` : `Sell ${p.symbol}`),
  dca: () => 'DCA weekly',
  protect: () => 'Protect with a stop',
}

/** The Overview chip row: one default ask per side the pair can offer. */
export function tradeAsks(pair: ChartPair): TradeAsk[] {
  return sidesFor(pair).map((side) => ({
    side,
    label: SIDE_LABEL[side](pair),
    ask: composeAsk(pair, side, { usd: side === 'dca' ? 10 : 50 }),
  }))
}


/** Recover the side from a sentence (a chip fired from Overview lands the
 *  panel on the matching tab). */
export function sideOf(text: string): TradeSide {
  if (/^\s*(?:dca|dollar)/i.test(text)) return 'dca'
  if (/^\s*protect/i.test(text)) return 'protect'
  if (/^\s*(?:sell|short)/i.test(text)) return 'sell'
  return 'buy'
}
