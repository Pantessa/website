// The pool-price wire shape + the one pure helper the chart needs —
// client-safe on purpose. lib/pool-price.ts (server: viem clients, quoters)
// produces it; components/markets/chart/MarketChart consumes it. Keeping
// the type here means the client bundle never pulls the quoter module.

export interface PoolPrice {
  symbol: string
  chainId: number
  /** Which side of the pool: a buy spends USDG, a sell sells shares (the
   *  chart reads buys; absent on older payloads = buy). */
  side?: 'buy' | 'sell'
  /** Buy: dollars quoted in (USDG). Sell: the USDG the shares fetch. */
  quoteUsd: number
  /** Buy: token units those dollars buy. Sell: the shares sold. */
  tokenOut: number
  /** Effective USD per token for that order — "you'd pay" on a buy, "you'd
   *  get" on a sell. */
  usdPerToken: number
  /** Which venue answered (traced like usd-probe). */
  via: string
  asOf: number
}

/** "+0.4%" — pool vs tape, signed; null when either side is missing. */
export function poolPremiumPct(pool: PoolPrice | null, tapeLast: number | null): number | null {
  if (!pool || tapeLast === null || !Number.isFinite(tapeLast) || tapeLast <= 0) return null
  return ((pool.usdPerToken - tapeLast) / tapeLast) * 100
}
