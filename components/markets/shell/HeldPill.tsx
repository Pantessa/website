'use client'

// "What you hold" in the symbol header (MK2/MARKETS, 2026-09-15): one pill —
// value over token amount — when the connected wallet holds the symbol,
// nothing otherwise. Reads the SAME holdings the watchlist rail's position
// column and every Sell chip read (lib/use-held → GET
// /api/watchlists/holdings?address=, public by address, wallet-cached
// server-side, one shared read per page) and values the amount at the
// header's own live price (lib/watchlists heldPosition) so the pill and the
// quote agree as it ticks. Connect to act: no wallet, no read, no pill. The
// pill and the Sell chips agree: Sell shows exactly when the wallet holds it
// (lib/sell-gate). EXEC's PositionPanel carries the venue-by-venue detail;
// this is the one line.

import { heldPosition } from '@/lib/watchlists'
import { useHeld } from '@/lib/use-held'

export default function HeldPill({ symbol, last, onClick }: { symbol: string; last: number | null; onClick?: () => void }) {
  const held = useHeld()
  const pos = heldPosition(held?.find((h) => h.symbol === symbol), last != null ? { last } : null)
  if (!pos) return null
  const Tag = onClick ? 'button' : 'span'
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className="mk-held"
      data-held={symbol}
      title={pos.title}
    >
      <span className="mk-held__k mono">YOU HOLD</span>
      <span className="mk-held__v mono">{pos.value ?? '—'}</span>
      <span className="mk-held__amt mono">{pos.amount}</span>
    </Tag>
  )
}
