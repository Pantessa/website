// What a wallet holds, read once and shared across the page (client). The
// watchlist rail's position column, the symbol header's YOU HOLD pill and
// every Sell chip (lib/sell-gate) read GET /api/watchlists/holdings through
// here, so a page makes one read per wallet per window, not one per chip.
// Module-level on purpose: it outlives the rail remounting on every client
// navigation between /markets and /t pages. A wallet doesn't change that
// fast, and the server rides the Wallet panel's cache anyway.

import type { HeldSymbol } from '@/lib/watchlists'

export const HELD_EVERY_MS = 60_000

const heldReads = new Map<string, { at: number; read: Promise<HeldSymbol[] | null> }>()
const lastHeld = new Map<string, HeldSymbol[]>()

/** A read younger than `maxAgeMs` is shared, not repeated. Null = the read failed. */
export function readHeld(address: string, maxAgeMs = HELD_EVERY_MS): Promise<HeldSymbol[] | null> {
  const hit = heldReads.get(address)
  if (hit && Date.now() - hit.at < maxAgeMs) return hit.read
  const read = fetch(`/api/watchlists/holdings?address=${encodeURIComponent(address)}`, { cache: 'no-store' })
    .then(async (r) => (r.ok ? (((await r.json()) as { held?: HeldSymbol[] }).held ?? []) : null))
    .catch(() => null)
  heldReads.set(address, { at: Date.now(), read })
  void read.then((v) => {
    // A failed read retries on the next ask instead of waiting out the window.
    if (v === null) {
      if (heldReads.get(address)?.read === read) heldReads.delete(address)
    } else {
      lastHeld.set(address, v)
    }
  })
  return read
}

/** The last holdings a read returned for this wallet, synchronously, so a
 *  chip mounted after the read settled starts right (null before any read). */
export function peekHeld(address: string): HeldSymbol[] | null {
  return lastHeld.get(address) ?? null
}
