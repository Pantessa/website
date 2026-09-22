// Which symbols a venue can actually fill, read once and shared across the
// page (client). Every chip that asks lib/trade-venue-gate reads through
// here, so a board makes ONE read per window, not one per row. Module-level
// on purpose: it outlives the rail remounting on every client navigation
// between /markets and /t pages.
//
// The /markets server render seeds it (app/markets/tradable → MarketsIndex
// → seedTradable) so the index's chips are right on the FIRST paint: a chip
// that renders and then vanishes is worse than one that was never offered.
//
// Verdicts move on the cron's clock (every 10 minutes), so this re-reads
// every few minutes at most, and never on a hidden tab.

import type { SymbolTradability, TradabilityMap } from '@/lib/tradability'

export const TRADABLE_EVERY_MS = 5 * 60_000

let known: Record<string, SymbolTradability> = {}
let at = 0
let inflight: Promise<TradabilityMap> | null = null
const listeners = new Set<() => void>()

/** What the server already measured, handed straight to the first paint.
 *
 *  Called DURING render (the chips read the store synchronously, so an
 *  effect would flash a chip the server already knew nothing can fill), so
 *  it has to be a true no-op on a re-render: the same server payload is
 *  seeded once, and listeners are told in a microtask — never inside
 *  someone else's render, which would set state during render and loop. */
let lastSeed: unknown = null
export function seedTradable(map: TradabilityMap | null | undefined): void {
  if (!map || map === lastSeed || Object.keys(map).length === 0) return
  lastSeed = map
  known = { ...known, ...map }
  at = Date.now()
  notifySoon()
}

function notifySoon(): void {
  if (listeners.size === 0) return
  queueMicrotask(() => {
    for (const l of listeners) l()
  })
}

/** Everything known right now, synchronously (empty before the first read —
 *  which every caller treats as "offer it"). */
export function peekTradable(): TradabilityMap {
  return known
}

export function onTradable(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** One shared read of the whole measured board. A failure keeps what was
 *  known and retries on the next ask. */
export function readTradable(maxAgeMs = TRADABLE_EVERY_MS): Promise<TradabilityMap> {
  if (inflight) return inflight
  if (at && Date.now() - at < maxAgeMs) return Promise.resolve(known)
  const read = fetch('/api/markets/tradable', { cache: 'no-store' })
    .then(async (r) => {
      if (!r.ok) return null
      const b = (await r.json()) as { map?: Record<string, SymbolTradability> }
      return b.map ?? null
    })
    .catch(() => null)
    .then((map) => {
      inflight = null
      if (map) {
        known = map
        at = Date.now()
        notifySoon()
      }
      return known
    })
  inflight = read
  return read
}
