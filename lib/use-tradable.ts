'use client'

// The measured venue verdicts, for a chip deciding whether to render
// (lib/trade-venue-gate). One shared read per page (lib/tradable-read),
// re-read every few minutes while the tab is visible and when it comes back
// into view. An empty map = nothing measured yet, which OFFERS everything:
// a cold cache must never make a tradable market look closed.

import { useEffect, useState } from 'react'
import { onTradable, peekTradable, readTradable, TRADABLE_EVERY_MS } from '@/lib/tradable-read'
import type { TradabilityMap } from '@/lib/tradability'

export function useTradable(): TradabilityMap {
  const [map, setMap] = useState<TradabilityMap>(peekTradable)

  useEffect(() => {
    const sync = () => setMap(peekTradable())
    const off = onTradable(sync)
    void readTradable().then(sync)
    const refresh = () => {
      if (!document.hidden) void readTradable(TRADABLE_EVERY_MS / 2).then(sync)
    }
    const tick = setInterval(refresh, TRADABLE_EVERY_MS)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      off()
      clearInterval(tick)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  return map
}
