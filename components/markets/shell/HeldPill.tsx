'use client'

// "What you hold" in the symbol header (MK2/MARKETS, 2026-09-15): one pill —
// value over token amount — when the connected wallet holds the symbol,
// nothing otherwise. Reads the SAME holdings route the watchlist rail's
// position column reads (GET /api/watchlists/holdings?address=, public by
// address, wallet-cached server-side) and values the amount at the header's
// own live price (lib/watchlists heldPosition) so the pill and the quote
// agree as it ticks. Connect to act: no wallet, no read, no pill. EXEC's
// PositionPanel carries the venue-by-venue detail; this is the one line.

import { useEffect, useState } from 'react'
import { useSession } from '@/lib/session'
import { heldPosition, type HeldSymbol } from '@/lib/watchlists'

export default function HeldPill({ symbol, last, onClick }: { symbol: string; last: number | null; onClick?: () => void }) {
  const { walletAddress } = useSession()
  const [held, setHeld] = useState<HeldSymbol | null>(null)
  useEffect(() => {
    setHeld(null)
    if (!walletAddress) return
    let alive = true
    const run = async () => {
      try {
        const res = await fetch(`/api/watchlists/holdings?address=${walletAddress}`, { cache: 'no-store' })
        if (!res.ok) return
        const body = (await res.json()) as { held?: HeldSymbol[] }
        if (!alive) return
        setHeld(body.held?.find((h) => h.symbol === symbol) ?? null)
      } catch {
        /* no pill this visit */
      }
    }
    void run()
    const id = setInterval(() => void run(), 60_000)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [walletAddress, symbol])

  const pos = heldPosition(held ?? undefined, last != null ? { last } : null)
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
