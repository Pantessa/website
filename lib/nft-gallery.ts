// ─────────────────────────────────────────────────────────────────────────
//  The NFT gallery READ — "what does this wallet own?", once, for both
//  surfaces that ask it.
//
//  The splash card (lib/splash/sources.ts, render:'nfts') and the native
//  gallery turn (the chat route's "show my NFTs" layer) used to be one
//  read and one planner shrug; now they are the SAME read. Rows, prompt
//  names, and Sell/Transfer actions are built here so the two can never
//  drift — a row's prompts must round-trip parseNftAsk → resolveNft, and
//  that contract is only checkable in one place.
//
//  Reads OpenSea's API directly with the server key (same as the native NFT
//  build layer) rather than through the opensea MCP: the answer works on
//  any set, before any deploy, exactly like the Alchemy-backed wallet card.
//  A chain whose read throws is reported as FAILED, never as empty — the
//  funding-scan discipline ("a failed origin is unknown, not zero").
// ─────────────────────────────────────────────────────────────────────────

import { fetchFloorEth, fetchOwnedNfts, openseaAssetUrl, type OpenseaNft } from '@/lib/opensea'
import type { AppChain } from '@/lib/chains'
import type { NftGalleryDisplay } from '@/lib/nft-display'
import type { NftRow, SuggestedPrompt } from '@/lib/splash/types'

/** The chains OpenSea and the registry share, in display order. */
export const NFT_GALLERY_CHAINS: { id: number; label: string }[] = [
  { id: 1, label: 'Ethereum' },
  { id: 8453, label: 'Base' },
  { id: 42161, label: 'Arbitrum' },
]

/** Scope a gallery read to the chain picker's selection. A picker parked on
 *  a chain OpenSea doesn't cover (Robinhood) has nothing to show — empty
 *  list, and the caller says so rather than silently scanning elsewhere. */
export function nftGalleryChains(chain?: AppChain | null): { id: number; label: string }[] {
  if (!chain) return NFT_GALLERY_CHAINS
  const hit = NFT_GALLERY_CHAINS.find((c) => c.id === chain.id)
  return hit ? [hit] : []
}

/** The prompt-facing NFT name: must round-trip parseNftAsk → resolveNft, so
 *  short token ids get "#id" appended for an exact-id match. Huge ids (ENS
 *  hashes) stay name-only — the name is the unique handle there. */
export function nftPromptName(n: { name: string | null; identifier: string }): string {
  const name = n.name ?? `#${n.identifier}`
  if (name.includes('#') || n.identifier.length > 8) return name
  return `${name} #${n.identifier}`
}

export function nftRowActions(n: { name: string | null; identifier: string }, chainLabel: string, floorEth: number | null): SuggestedPrompt[] {
  const pn = nftPromptName(n)
  const sellPrompt =
    floorEth != null
      ? `Sell my ${pn} NFT on ${chainLabel} for ${Number(floorEth.toFixed(4))} ETH`
      : `Sell my ${pn} NFT on ${chainLabel}`
  return [
    { label: 'Sell', prompt: sellPrompt },
    // The recipient is deliberately blank — the user appends an address (or
    // sends as-is and the native layer asks for the full one-liner).
    { label: 'Transfer', prompt: `Send my ${pn} NFT on ${chainLabel} to ` },
  ]
}

export interface NftGalleryOptions {
  /** Chains to scan (default: all three). */
  chainIds?: { id: number; label: string }[]
  /** Per-chain fetch size. */
  perChain?: number
  /** Rows returned after the merge + sort. */
  max?: number
  /** How many distinct collections get a floor lookup (rate-limit hygiene —
   *  rows without a floor still sell, the layer just asks for a price). */
  floorCollections?: number
}

/**
 * The wallet's NFTs across the scanned chains, newest activity first, shaped
 * into gallery rows with per-row Sell / Transfer prompts. Never throws: a
 * chain that errors lands in `failedChains` and the rest still answer.
 */
export async function readNftGallery(address: string, opts: NftGalleryOptions = {}): Promise<NftGalleryDisplay> {
  const chainIds = opts.chainIds ?? NFT_GALLERY_CHAINS
  const perChain = opts.perChain ?? 12
  const max = opts.max ?? 6
  const floorCollections = opts.floorCollections ?? 3

  const owned: (OpenseaNft & { chainLabel: string; chainId: number })[] = []
  const failedChains: string[] = []
  await Promise.all(
    chainIds.map(async ({ id, label }) => {
      try {
        for (const n of await fetchOwnedNfts(id, address, perChain)) owned.push({ ...n, chainLabel: label, chainId: id })
      } catch {
        failedChains.push(label)
      }
    }),
  )
  owned.sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))
  const top = owned.slice(0, max)

  const collections = [...new Set(top.map((n) => n.collection))].slice(0, floorCollections)
  const floors = new Map<string, number | null>()
  await Promise.all(collections.map(async (slug) => floors.set(slug, await fetchFloorEth(slug).catch(() => null))))

  const nfts: NftRow[] = top.map((n) => {
    const floorEth = floors.get(n.collection) ?? null
    return {
      name: n.name ?? `#${n.identifier.slice(0, 8)}`,
      collection: n.collection,
      collectionName: n.collection.replace(/-/g, ' '),
      imageUrl: n.display_image_url ?? n.image_url ?? null,
      chain: n.chainLabel,
      contract: n.contract,
      tokenId: n.identifier,
      standard: n.token_standard === 'erc1155' ? 'erc1155' : 'erc721',
      floor: floorEth != null ? `floor ${Number(floorEth.toFixed(4))} ETH` : null,
      actions: nftRowActions(n, n.chainLabel, floorEth),
      infoUrl: n.opensea_url ?? openseaAssetUrl(n.chainId, n.contract, n.identifier),
      infoLabel: 'View on OpenSea',
    }
  })

  return {
    owner: address,
    chains: chainIds.map((c) => c.label),
    failedChains,
    nfts,
    found: owned.length,
  }
}

/** "Ethereum, Base, or Arbitrum" — the honest scope line both the empty and
 *  the failure answers name, so a wallet is never told "you have none"
 *  without being told where we looked. */
export function chainListSentence(labels: string[], join: 'and' | 'or' = 'or'): string {
  if (labels.length === 0) return ''
  if (labels.length === 1) return labels[0]
  if (labels.length === 2) return `${labels[0]} ${join} ${labels[1]}`
  return `${labels.slice(0, -1).join(', ')}, ${join} ${labels[labels.length - 1]}`
}
