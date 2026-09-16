// What a wallet holds, read once and shared across the page (client). The
// watchlist rail's position column and card door, the symbol header's YOU HOLD
// pill and every Sell chip (lib/sell-gate) read GET /api/watchlists/holdings
// through here, so a page makes one read per wallet per window, not one per
// chip. Module-level on purpose: it outlives the rail remounting on every
// client navigation between /markets and /t pages. A wallet doesn't change that
// fast, and the server rides the Wallet panel's cache anyway.

import type { HeldSymbol } from '@/lib/watchlists'

export const HELD_EVERY_MS = 60_000

/** One holdings read: what the wallet holds, whether it holds nothing at all,
 *  and whether this deployment can sell it funds by card (the rail's door). */
export interface HeldRead {
  held: HeldSymbol[]
  empty: boolean
  cardFunding: boolean
}

const heldReads = new Map<string, { at: number; read: Promise<HeldRead | null> }>()
const lastRead = new Map<string, HeldRead>()

/** A read younger than `maxAgeMs` is shared, not repeated. `fresh` skips the
 *  share and asks the server past its cache too (bounded there to one fresh
 *  read per address every 8s). Null = the read failed. */
export function readHeld(address: string, maxAgeMs = HELD_EVERY_MS, fresh = false): Promise<HeldRead | null> {
  const hit = heldReads.get(address)
  if (!fresh && hit && Date.now() - hit.at < maxAgeMs) return hit.read
  const read = fetch(`/api/watchlists/holdings?address=${encodeURIComponent(address)}${fresh ? '&fresh=1' : ''}`, { cache: 'no-store' })
    .then(async (r) => {
      if (!r.ok) return null
      const b = (await r.json()) as { held?: HeldSymbol[]; empty?: boolean; cardFunding?: boolean }
      return { held: b.held ?? [], empty: b.empty === true, cardFunding: b.cardFunding === true }
    })
    .catch(() => null)
  heldReads.set(address, { at: Date.now(), read })
  void read.then((v) => {
    // A failed read retries on the next ask instead of waiting out the window.
    if (v === null) {
      if (heldReads.get(address)?.read === read) heldReads.delete(address)
    } else {
      lastRead.set(address, v)
    }
  })
  return read
}

/** The last read that answered for this wallet, synchronously, so a chip
 *  mounted after the read settled starts right (null before any read). */
export function peekHeld(address: string): HeldRead | null {
  return lastRead.get(address) ?? null
}
