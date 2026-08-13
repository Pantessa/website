'use client'

// The ask reel — ONE source for every surface that performs intents by
// typing them (the landing hero's h1 and the mint stage's ghost
// placeholder), so the sentences the site writes in front of a visitor
// never drift between surfaces. Every entry is a shape a native layer
// parses to a real artifact (the same family the house links carry) — a
// typed example must never be an ask that dead-ends when pasted.

import { useEffect, useState } from 'react'

export const STARTER_ASKS = [
  'Buy $12 of AAPL',
  'DCA $25 into ETH weekly',
  'Stake 0.05 ETH with Lido',
  'Tile my wallet 50% ETH, 30% USDC, 20% wstETH',
]

/** The hero types at display size, where a long ask wraps mid-cycle and
 *  bounces the layout — it takes only the reel's short sentences. The mint
 *  stage's card runs the full reel. */
export const HERO_ASKS = STARTER_ASKS.filter((a) => a.length <= 26)

/** Typewriter over the reel: starts on the FULL first ask (so SSR paints a
 *  real sentence, never an empty slot), holds, wipes, types the next.
 *  Reduced-motion readers keep the static first ask. Deactivating (the
 *  creator started writing their own sentence) clears it. */
export function useTypedAsk(active: boolean, asks: string[] = STARTER_ASKS): string {
  const [typed, setTyped] = useState(asks[0])
  useEffect(() => {
    if (!active) {
      setTyped('')
      return
    }
    setTyped(asks[0])
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let idx = 0
    let len = asks[0].length
    let dir: 1 | -1 = -1
    let t: ReturnType<typeof setTimeout>
    const tick = () => {
      const full = asks[idx]
      len += dir
      setTyped(full.slice(0, len))
      let delay = dir === 1 ? 52 : 18
      if (dir === 1 && len === full.length) {
        dir = -1
        delay = 2100
      } else if (dir === -1 && len === 0) {
        dir = 1
        idx = (idx + 1) % asks.length
        delay = 420
      }
      t = setTimeout(tick, delay)
    }
    t = setTimeout(tick, 2100)
    return () => clearTimeout(t)
  }, [active, asks])
  return typed
}
