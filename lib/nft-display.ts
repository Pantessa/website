// ─────────────────────────────────────────────────────────────────────────
//  Display contract — the NFT gallery a chat turn can carry.
//
//  lib/portfolio-display.ts's sibling: a read-only artifact rendered as a
//  rich card under the reply instead of flattened into prose. Pure and
//  client-safe (the card + ChatInterface import ONLY this) — the producing
//  read lives in lib/nft-gallery.ts, server-side.
//
//  Rows reuse the splash gallery's NftRow verbatim: one row shape, one set
//  of Sell/Transfer prompts that round-trip parseNftAsk, whether the NFT is
//  drawn on the splash surface or inside a turn.
// ─────────────────────────────────────────────────────────────────────────

import type { NftRow } from '@/lib/splash/types'

export interface NftGalleryDisplay {
  /** The wallet the gallery was read for. */
  owner: string
  /** Human chain labels the read covered ("Ethereum", "Base", …). */
  chains: string[]
  /** Chains whose read FAILED — unknown, never "nothing there". */
  failedChains: string[]
  /** Rows, most recently active first, already capped. */
  nfts: NftRow[]
  /** How many the scan saw before the cap (≥ nfts.length). */
  found: number
}

/** Pure: read a gallery back off a chat message's meta, or null. Strict on
 *  the load-bearing fields — a malformed payload renders nothing rather
 *  than a broken card. */
export function nftGalleryOf(meta: unknown): NftGalleryDisplay | null {
  if (!meta || typeof meta !== 'object') return null
  const raw = (meta as Record<string, unknown>).nfts
  if (!raw || typeof raw !== 'object') return null
  const g = raw as Record<string, unknown>
  if (typeof g.owner !== 'string' || !Array.isArray(g.nfts)) return null
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [])
  const nfts = g.nfts.filter((n): n is NftRow => {
    if (!n || typeof n !== 'object') return false
    const r = n as Record<string, unknown>
    return typeof r.name === 'string' && typeof r.contract === 'string' && typeof r.tokenId === 'string' && typeof r.chain === 'string'
  })
  return {
    owner: g.owner,
    chains: strings(g.chains),
    failedChains: strings(g.failedChains),
    nfts,
    found: typeof g.found === 'number' ? g.found : nfts.length,
  }
}
