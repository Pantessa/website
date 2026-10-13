'use client'

// The frame's side column: the ask + account strip on top, the docked
// watchlist rail under it. ONE grid item (area `rail`, spanning the data
// and footer rows) so both children can ride sticky in the column — the
// strip at the top edge, the rail just under it — from the first board to
// the last footer line. At ≤1023px the wrapper is `display: contents`: the
// strip takes the frame's `top` row (a sticky bar over the page, the phone's
// nav) and the rail drops under the boards as a card, as before.
//
// The column owns the one alerts read (watchlist/alerts-context): the strip's
// bell (RailAlerts) and the rail's "Set an alert" form act on the same
// instance, so a rule set from a row shows on the bell at once.
//
// `data-slot="watchlist"` inside the aside is the frame's contract with the
// harness; the aside keeps its class + label.

import MarketsTopStrip from '@/components/markets/shell/MarketsTopStrip'
import { AlertsContext } from '@/components/markets/watchlist/alerts-context'
import { useAlerts } from '@/components/markets/watchlist/useWatchlists'
import { useSession } from '@/lib/session'

export default function MarketsSide({ label, children }: { label: string; children: React.ReactNode }) {
  const { status, address } = useSession()
  const alerts = useAlerts(status === 'authed' && !!address)
  return (
    <AlertsContext.Provider value={alerts}>
      <div className="mkt-frame__side">
        <MarketsTopStrip />
        <aside className="mkt-frame__rail" aria-label={label}>
          {children}
        </aside>
      </div>
    </AlertsContext.Provider>
  )
}
