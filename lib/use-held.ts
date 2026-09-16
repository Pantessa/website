'use client'

// The connected wallet's holdings, for a chip deciding whether to render
// (lib/sell-gate) and the header's YOU HOLD pill. One shared read per wallet
// (lib/held-read), re-read once a minute while the tab is visible and when it
// comes back into view. Null = no wallet connected, or no successful read yet;
// a Sell chip waits on null. The connected wallet is the one that signs, so
// it is the one whose holdings count.

import { useEffect, useState } from 'react'
import { useSession } from '@/lib/session'
import { HELD_EVERY_MS, peekHeld, readHeld } from '@/lib/held-read'
import type { HeldSymbol } from '@/lib/watchlists'

export function useHeld(): readonly HeldSymbol[] | null {
  const { walletAddress } = useSession()
  const [got, setGot] = useState<{ address: string; held: readonly HeldSymbol[] } | null>(null)

  useEffect(() => {
    if (!walletAddress) return
    let alive = true
    const read = async (maxAgeMs?: number) => {
      const held = await readHeld(walletAddress, maxAgeMs)
      // A failed read keeps what was known; it never clears a holding.
      if (alive && held) setGot({ address: walletAddress, held })
    }
    void read()
    // Half the window: by the next tick the last read is a minute old.
    const refresh = () => {
      if (!document.hidden) void read(HELD_EVERY_MS / 2)
    }
    const tick = setInterval(refresh, HELD_EVERY_MS)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      alive = false
      clearInterval(tick)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [walletAddress])

  if (!walletAddress) return null
  // Another wallet's holdings never answer for this one (a switch, a reconnect).
  if (got?.address === walletAddress) return got.held
  return peekHeld(walletAddress)
}
