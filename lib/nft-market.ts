// ─────────────────────────────────────────────────────────────────────────
//  The NFT MARKET reads — "what are my NFTs worth?" and "is anyone bidding?"
//
//  lib/nft-gallery.ts's sibling. The gallery answers what the wallet HOLDS;
//  these two answer what the market says about it. Both splash chips on the
//  OpenSea tile asked exactly these questions and both fell to the planner,
//  which — holding no market reads — answered "I can't check real-time floor
//  prices" and handed the funnel away (the same miss lib/nft-gallery.ts was
//  born from, one question over).
//
//  Shape rules, all inherited:
//   • ONE owned-NFT scan (scanOwnedNfts) — the gallery and the market answers
//     can never disagree about what the wallet holds.
//   • A chain whose read FAILED is reported as unknown, never as empty.
//   • A collection with no floor / an NFT with no bid is COUNTED as unpriced
//     and named — never silently dropped, never counted as zero.
//   • Every number leaves here PRE-FORMATTED (the splash tile contract).
//   • Row actions come from nftRowActions, so a chip round-trips parseNftAsk
//     into a real build — the answer is a doorway, not a dead end.
//
//  A floor is an ESTIMATE (the cheapest one LISTED, not a bid), so the total
//  ships with an "≈" and the copy says so out loud — never a quote. That
//  distinction is the whole reason the offers read sits next to it: a bid is
//  a real price someone is standing behind.
// ─────────────────────────────────────────────────────────────────────────

import { usdCompact } from '@/lib/format'
import { nftPromptName, nftRowActions, scanOwnedNfts, type OwnedNft } from '@/lib/nft-gallery'
import { fetchBestOfferForNft, fetchFloorEth, openseaAssetUrl, type OpenseaOffer } from '@/lib/opensea'
import type { NftMarketDisplay, NftMarketRow } from '@/lib/nft-display'
import { usdPerToken } from '@/lib/usd-probe'

/** ETH amounts span floors from 0.000025 (ENS names) to 8.45 (BAYC) — keep
 *  significant digits at the bottom and stay readable at the top. */
export function ethLabel(eth: number): string {
  if (!Number.isFinite(eth) || eth <= 0) return '0 ETH'
  const s = eth >= 1 ? eth.toFixed(2) : eth >= 0.001 ? eth.toFixed(4) : eth.toPrecision(2)
  return `${Number(s)} ETH`
}

/** "≈ $12.4K", or null when ETH is honestly unpriceable (never a guess). */
export function usdLabel(eth: number, ethUsd: number | null): string | null {
  if (ethUsd === null || !Number.isFinite(eth) || eth <= 0) return null
  const usd = eth * ethUsd
  return usd >= 0.01 ? `≈ ${usdCompact(usd)}` : null
}

/** "Pudgy Penguins" out of a slug — the gallery's own row-label rule. */
const collectionLabel = (slug: string) => slug.replace(/-/g, ' ')

const nftUrl = (n: OwnedNft) => n.opensea_url ?? openseaAssetUrl(n.chainId, n.contract, n.identifier)

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** "51 NFTs · 8 of 19 collections" — what the read actually covered. Both
 *  answers cap their live lookups (one API call per collection), so a capped
 *  read must never present itself as the whole wallet. */
export function scannedLine(found: number, shown: number, collectionsFound: number): string {
  const cols = shown < collectionsFound ? `${shown} of ${plural(collectionsFound, 'collection')}` : plural(shown, 'collection')
  return `${plural(found, 'NFT')} · ${cols}`
}

// ── "What are my NFTs worth?" ──────────────────────────────────────────────

export interface CollectionGroup {
  /** collection slug + chain — the valuation's unit (a slug can be listed on
   *  more than one chain, and their floors are different markets). */
  key: string
  collection: string
  chainLabel: string
  count: number
  /** One NFT from the group — what a Sell chip is built against. */
  sample: OwnedNft
}

/** Pure: group a scan by collection-per-chain, biggest holding first. Ties
 *  break on the key so the order is STABLE — the live lookups are capped, so
 *  an arbitrary tie-break would silently change which collections get priced
 *  (and therefore the total) between two identical asks. */
export function groupCollections(owned: OwnedNft[]): CollectionGroup[] {
  const byKey = new Map<string, CollectionGroup>()
  for (const n of owned) {
    const key = `${n.chainLabel}:${n.collection}`
    const hit = byKey.get(key)
    if (hit) hit.count++
    else byKey.set(key, { key, collection: n.collection, chainLabel: n.chainLabel, count: 1, sample: n })
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
}

/**
 * Pure: the valuation answer from groups + whatever floors came back. A
 * group whose floor is null lands in the rows AND in `unpriced` — the total
 * only ever sums what we actually priced.
 */
export function valuationDisplay(params: {
  owner: string
  chains: string[]
  failedChains: string[]
  groups: CollectionGroup[]
  floors: Map<string, number | null>
  ethUsd: number | null
  found: number
  /** Distinct collections the scan saw BEFORE the lookup cap. */
  collectionsFound: number
}): NftMarketDisplay {
  const { owner, chains, failedChains, groups, floors, ethUsd, found, collectionsFound } = params
  let totalEth = 0
  let priced = 0
  let unpriced = 0
  const rows: NftMarketRow[] = groups.map((g) => {
    const floorEth = floors.get(g.key) ?? null
    const subtotal = floorEth != null ? floorEth * g.count : null
    if (subtotal != null) {
      totalEth += subtotal
      priced++
    } else {
      unpriced++
    }
    const sell = nftRowActions(g.sample, g.chainLabel, floorEth)[0]
    return {
      name: collectionLabel(g.collection),
      detail: `${g.count} held · ${g.chainLabel}${floorEth != null ? ` · floor ${ethLabel(floorEth)}` : ''}`,
      imageUrl: g.sample.display_image_url ?? g.sample.image_url ?? null,
      value: subtotal != null ? ethLabel(subtotal) : 'no floor yet',
      note: subtotal != null ? usdLabel(subtotal, ethUsd) : 'not counted in the total',
      // "Sell one" stays short on purpose — a collection name in the label
      // ("Sell one (Compassionate Libertarian Voting Member #0004)") wrapped
      // the row and shoved the numbers out of alignment. The prompt it sends
      // names the exact token, and the turn it opens shows it before anything
      // is signed.
      actions: [{ label: g.count > 1 ? 'Sell one' : 'Sell', prompt: sell.prompt }],
      infoUrl: nftUrl(g.sample),
      infoLabel: 'View on OpenSea',
    }
  })
  const usd = usdLabel(totalEth, ethUsd)
  return {
    kind: 'worth',
    owner,
    chains,
    failedChains,
    rows,
    total: priced > 0 ? `≈ ${ethLabel(totalEth)}` : null,
    totalNote: priced > 0 ? [usd, `at current floors · ${plural(priced, 'collection')} priced`].filter(Boolean).join(' · ') : null,
    unpriced,
    found,
    scanned: scannedLine(found, groups.length, collectionsFound),
  }
}

// ── The reply sentence (pure — the harness pins every variant) ─────────────
// Kept out of the route for the same reason lib/funding-plan's refusal copy
// is: these sentences make CLAIMS about money ("your NFTs come to X"), and a
// claim that can drift from the artifact under it is a bug you only find in
// production. One function, every outcome, pinned offline.

/** The chat sentence for a market answer. `chainListSentence` is passed in so
 *  this stays free of the gallery module's phrasing helpers. */
export function marketReplyCopy(d: NftMarketDisplay, scanned: string, failedSuffix: string, failedOr: string): string {
  if (d.rows.length === 0) {
    return d.failedChains.length > 0 && d.failedChains.length === d.chains.length
      ? `🖼️ OpenSea didn't answer for ${failedOr} just now, so I can't read the market for you. Ask again in a moment.`
      : `🖼️ No NFTs in your wallet on ${scanned}${failedSuffix} — nothing to price yet.`
  }
  const acted = d.rows.length - d.unpriced
  if (d.kind === 'offers') {
    // Bids are read per COLLECTION (the best bid on an NFT is usually a
    // collection-wide one), so the sentence counts what was actually checked.
    const scope = `${plural(d.rows.length, 'collection')} you hold on ${scanned}`
    return acted > 0
      ? `🤝 ${acted} of the ${scope} ${acted === 1 ? 'has' : 'have'} a live bid — ${d.total}${failedSuffix}. I can't accept a bid for you yet, but "Sell at this price" lists yours at the bid in one signature.`
      : `🤝 No live bids across the ${scope}${failedSuffix}. Bids come and go — ask again later, or list one and let a buyer come to you.`
  }
  // Nothing priced → no number, ever. A floor-less wallet gets pointed at the
  // read that CAN give it a real price rather than a fabricated zero.
  if (d.total === null) {
    return `💰 I found ${plural(d.found, 'NFT')} on ${scanned}${failedSuffix}, but none of their collections has a floor price on OpenSea yet — so I won't put a number on them. Ask about offers instead: a live bid is a real price.`
  }
  const priceless =
    d.unpriced > 0
      ? ` ${plural(d.unpriced, 'collection')} ${d.unpriced === 1 ? "has no floor on OpenSea yet, so it's" : 'have no floor on OpenSea yet, so they are'} not in that total.`
      : ''
  return `💰 At current floors your NFTs come to ${d.total} across ${plural(acted, 'collection')} on ${scanned}${failedSuffix}.${priceless} A floor is the cheapest one listed, not a bid — tap Sell to list yours at that price.`
}

export interface NftMarketOptions {
  chainIds?: { id: number; label: string }[]
  /** Per-chain fetch size for the owned scan. */
  perChain?: number
  /** How many collections (worth) / NFTs (offers) get a live market lookup —
   *  one API call each, so the cap is rate-limit hygiene. Whatever the cap
   *  leaves out is reported in `found`, never pretended away. */
  max?: number
}

/**
 * "What are my NFTs worth right now?" — floors for every collection the
 * wallet holds, a summed estimate, and per-collection rows. Never throws.
 */
export async function readNftWorth(address: string, chainIds: { id: number; label: string }[], opts: NftMarketOptions = {}): Promise<NftMarketDisplay> {
  const { owned, failedChains } = await scanOwnedNfts(address, chainIds, opts.perChain ?? 40)
  const allGroups = groupCollections(owned)
  const groups = allGroups.slice(0, opts.max ?? 8)
  const [floorList, ethProbe] = await Promise.all([
    Promise.all(groups.map(async (g) => [g.key, await fetchFloorEth(g.collection).catch(() => null)] as const)),
    usdPerToken(8453, 'ETH').catch(() => null),
  ])
  return valuationDisplay({
    owner: address,
    chains: chainIds.map((c) => c.label),
    failedChains,
    groups,
    floors: new Map(floorList),
    ethUsd: ethProbe?.usd ?? null,
    found: owned.length,
    collectionsFound: allGroups.length,
  })
}

// ── "Are there any offers on the NFTs I own?" ──────────────────────────────

/** Pure: the offers answer from the collections we checked. `offer === null`
 *  means nobody is bidding there — counted, and the row says so. */
export function offersDisplay(params: {
  owner: string
  chains: string[]
  failedChains: string[]
  checked: { group: CollectionGroup; offer: OpenseaOffer | null }[]
  ethUsd: number | null
  found: number
  /** Distinct collections the scan saw BEFORE the lookup cap. */
  collectionsFound: number
}): NftMarketDisplay {
  const { owner, chains, failedChains, checked, ethUsd, found, collectionsFound } = params
  const bidEth = (o: OpenseaOffer) => Number(o.priceWei) / 1e18
  const withOffer = checked.filter((c) => c.offer !== null)
  const best = withOffer.reduce<number | null>((acc, c) => {
    const v = bidEth(c.offer!)
    return acc === null || v > acc ? v : acc
  }, null)
  // Bid first, biggest bid first — the rows that can be acted on lead.
  const ordered = [...checked].sort((a, b) => (b.offer ? bidEth(b.offer) : -1) - (a.offer ? bidEth(a.offer) : -1))
  const rows: NftMarketRow[] = ordered.map(({ group, offer }) => {
    const eth = offer ? bidEth(offer) : null
    const held = group.count > 1 ? ` · ${group.count} held` : ''
    return {
      // The row names the token a Sell chip would be built against — one of
      // yours, not the collection in the abstract.
      name: nftPromptName(group.sample),
      detail: `${collectionLabel(group.collection)} · ${group.chainLabel}${held}`,
      imageUrl: group.sample.display_image_url ?? group.sample.image_url ?? null,
      value: eth != null ? ethLabel(eth) : 'no bids',
      note: offer ? [usdLabel(eth!, ethUsd), offer.collectionWide ? 'collection bid' : 'bid on this item'].filter(Boolean).join(' · ') : null,
      // Listing AT the bid is the buildable move — the sell layer prices the
      // order and shows the payout after fees.
      actions: offer ? [{ label: 'Sell at this price', prompt: nftRowActions(group.sample, group.chainLabel, eth)[0].prompt }] : undefined,
      infoUrl: nftUrl(group.sample),
      infoLabel: 'View on OpenSea',
    }
  })
  return {
    kind: 'offers',
    owner,
    chains,
    failedChains,
    rows,
    total: best !== null ? `best ${ethLabel(best)}` : null,
    totalNote:
      best !== null
        ? [usdLabel(best, ethUsd), `${withOffer.length} of ${plural(checked.length, 'collection')} with a live bid`].filter(Boolean).join(' · ')
        : null,
    unpriced: checked.length - withOffer.length,
    found,
    scanned: scannedLine(found, checked.length, collectionsFound),
  }
}

/**
 * "Are there any offers on the NFTs I own?" — the best live bid on each
 * COLLECTION the wallet holds. Per-collection, not per-token, because the
 * best bid on an NFT is almost always a collection-wide one: probing the
 * wallet's 8 newest TOKENS answered "no bids" for a wallet that had real
 * bids waiting, because its newest tokens were two collections of airdrop
 * spam. Eight lookups now cover eight markets. Never throws.
 */
export async function readNftOffers(address: string, chainIds: { id: number; label: string }[], opts: NftMarketOptions = {}): Promise<NftMarketDisplay> {
  const { owned, failedChains } = await scanOwnedNfts(address, chainIds, opts.perChain ?? 40)
  const allGroups = groupCollections(owned)
  const groups = allGroups.slice(0, opts.max ?? 8)
  const [checked, ethProbe] = await Promise.all([
    Promise.all(groups.map(async (group) => ({ group, offer: await fetchBestOfferForNft(group.collection, group.sample.identifier) }))),
    usdPerToken(8453, 'ETH').catch(() => null),
  ])
  return offersDisplay({
    owner: address,
    chains: chainIds.map((c) => c.label),
    failedChains,
    checked,
    ethUsd: ethProbe?.usd ?? null,
    found: owned.length,
    collectionsFound: allGroups.length,
  })
}
