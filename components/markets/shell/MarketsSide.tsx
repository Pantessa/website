'use client'

// The frame's side column: the ask + account strip on top, the docked
// watchlist rail under it. ONE grid item (area `rail`, spanning the data
// and footer rows) so both children can ride sticky in the column — the
// strip at the top edge, the rail just under it — from the first board to
// the last footer line. At ≤1023px the wrapper is `display: contents`: the
// strip takes the frame's `top` row (a sticky bar over the page, the phone's
// nav) and the rail drops under the boards as a card, as before.
//
// `data-slot="watchlist"` / `data-slot="symbol-card"` inside the aside are
// the frame's contract with the harness; the aside keeps its class + label.

import MarketsTopStrip from '@/components/markets/shell/MarketsTopStrip'

export default function MarketsSide({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mkt-frame__side">
      <MarketsTopStrip />
      <aside className="mkt-frame__rail" aria-label={label}>
        {children}
      </aside>
    </div>
  )
}
