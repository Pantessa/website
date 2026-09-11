'use client'

// The watchlist rail SLOT. The WATCH lane ships the real component
// (components/markets/watchlist/*: unlimited lists, guest-local → adopted on
// sign-in, TradingView import, public /lists/<slug>). Until integration
// this card names what lands here and shows the house starter list as live
// rows — so the frame is honest about the gap and still useful. QA swaps
// the body for WATCH's component; the props are the contract.

import { chartPairFor } from '@/lib/charts'
import { FEATURED, symbolName, type MarketRow as Row } from '@/lib/markets'
import { useQuotes } from '@/lib/markets-quotes'
import MarketRow from './MarketRow'

/** The starter rows the slot shows — the household names across all three
 *  boards. WATCH's default list will replace this. */
export function starterWatchlist(): Row[] {
  const symbols = [...FEATURED.equities.slice(0, 4), ...FEATURED.crypto.slice(0, 3), FEATURED.perps[0]]
  const out: Row[] = []
  for (const s of symbols) {
    const pair = chartPairFor(s)
    if (pair) out.push({ symbol: pair.symbol, name: symbolName(pair.symbol), source: pair.source })
  }
  return out
}

export default function WatchlistSlot({ current }: { current?: string }) {
  const rows = starterWatchlist()
  const { quotes } = useQuotes(rows.map((r) => r.symbol))
  return (
    <section className="mkt-card" aria-label="Watchlist" data-slot="watchlist">
      <header className="mkt-card__head">
        <h2 className="mkt-card__title">Watchlist</h2>
        <span className="mkt-card__eyebrow mono">STARTER · UNLIMITED LISTS, FREE</span>
      </header>
      <div className="mkt-card__rows">
        {rows.map((r) => (
          <MarketRow key={r.symbol} row={r} quote={quotes[r.symbol]} compact />
        ))}
      </div>
      <p className="mkt-card__note">
        Your own lists, alerts and imports land here{current ? ` — ${current} included` : ''}. No caps, at any tier.
      </p>
    </section>
  )
}
