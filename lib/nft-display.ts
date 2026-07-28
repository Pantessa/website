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

import type { NftRow, SuggestedPrompt } from '@/lib/splash/types'

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

// ── The MARKET read (floors + a value estimate, or live offers) ─────────────
// The gallery answers "what do I own"; this answers "what is it worth" and
// "is anyone bidding" — the two splash chips that used to fall to the
// planner ("I can't check real-time floor prices"). Same discipline: every
// number is pre-formatted server-side (the splash tile contract — a raw
// number where a string was expected once crashed /chat), and anything we
// could NOT price is counted, never silently dropped.

export interface NftMarketRow {
  /** Collection name (worth) or NFT name (offers). */
  name: string
  /** Second line — "3 held · Ethereum" / "Pudgy Penguins · Base". */
  detail: string
  imageUrl: string | null
  /** Right-hand primary, pre-formatted ("4.08 ETH"), or null when unknown. */
  value: string | null
  /** Right-hand secondary, pre-formatted ("≈ $12.4K", "collection bid"). */
  note: string | null
  /** "Act on this" prompts — the same round-tripping contract as NftRow. */
  actions?: SuggestedPrompt[]
  infoUrl?: string | null
  infoLabel?: string
}

export interface NftMarketDisplay {
  /** Which question this answers. */
  kind: 'worth' | 'offers'
  owner: string
  chains: string[]
  failedChains: string[]
  rows: NftMarketRow[]
  /** Pre-formatted headline ("≈ 12.41 ETH", "best 0.30 ETH"), or null. */
  total: string | null
  /** Headline caption ("at current floors · 4 collections"). */
  totalNote: string | null
  /** Rows with no floor / no bid — named in the reply, never counted as 0. */
  unpriced: number
  /** How many NFTs the scan saw (≥ what the rows cover). */
  found: number
  /** Pre-formatted coverage line ("51 NFTs · 8 of 19 collections") — what we
   *  actually looked at, so a capped read never reads as a complete one. */
  scanned: string | null
}

/** Pure: read a market answer back off a chat message's meta, or null. */
export function nftMarketOf(meta: unknown): NftMarketDisplay | null {
  if (!meta || typeof meta !== 'object') return null
  const raw = (meta as Record<string, unknown>).nftMarket
  if (!raw || typeof raw !== 'object') return null
  const g = raw as Record<string, unknown>
  if (typeof g.owner !== 'string' || !Array.isArray(g.rows)) return null
  if (g.kind !== 'worth' && g.kind !== 'offers') return null
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [])
  const str = (v: unknown): string | null => (typeof v === 'string' ? v : null)
  const rows = g.rows.filter((r): r is NftMarketRow => {
    if (!r || typeof r !== 'object') return false
    const o = r as Record<string, unknown>
    // Values are STRINGS by contract — a number here means a producer skipped
    // formatting, and the card must not try to render it.
    return typeof o.name === 'string' && typeof o.detail === 'string' && (o.value == null || typeof o.value === 'string')
  })
  return {
    kind: g.kind,
    owner: g.owner,
    chains: strings(g.chains),
    failedChains: strings(g.failedChains),
    rows,
    total: str(g.total),
    totalNote: str(g.totalNote),
    unpriced: typeof g.unpriced === 'number' ? g.unpriced : 0,
    found: typeof g.found === 'number' ? g.found : rows.length,
    scanned: str(g.scanned),
  }
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
