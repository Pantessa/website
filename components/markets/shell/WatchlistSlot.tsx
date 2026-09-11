'use client'

// The watchlist rail SLOT (SHELL owns the seat; WATCH owns the body).
// Integration (QA, 2026-09-11): the starter card is gone — WATCH's
// WatchlistRail renders here (unlimited lists, guest-local → adopted on
// sign-in, TradingView import, alerts that act, public /lists/<slug>).
// `data-slot="watchlist"` is the frame's contract with the harness.

import WatchlistRail from '@/components/markets/watchlist/WatchlistRail'

export default function WatchlistSlot({ current, onAsk }: { current?: string; onAsk?: (ask: string) => void }) {
  return (
    <div data-slot="watchlist" className="min-w-0">
      <WatchlistRail symbol={current} onAsk={onAsk} />
    </div>
  )
}
