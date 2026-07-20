// ─────────────────────────────────────────────────────────────────────────
//  OpenSea surface for the native NFT layer: the v2 API reads the splash
//  card + NFT builders anchor on, and the PURE Seaport 1.6 order math
//  (fee splits, OrderComponents, EIP-712 typed data, guards). The impure
//  build/parse turns live in lib/nft-layer.ts; the pure helpers here are
//  what the standing harness exercises offline.
//
//  Trust shape (same as every native venue): the model never supplies
//  addresses — collections' fee schedules come from OpenSea's API, ownership
//  from the chain, and a listing's payout set is re-derived independently at
//  submit time (app/api/opensea/submit) before anything is relayed.
// ─────────────────────────────────────────────────────────────────────────

/** Spend-policy host every OpenSea/Seaport action is attributed to. */
export const OPENSEA_POLICY_HOST = 'opensea.io'

/** Seaport 1.6 + the OpenSea conduit — CREATE2, same address on every chain
 *  OpenSea supports (verified live on ethereum/base/arbitrum 2026-07-17). */
export const SEAPORT_1_6 = '0x0000000000000068F116a894984e2DB1123eB395' as const
export const OPENSEA_CONDUIT = '0x1E0049783F008A0085193E00003D00cd54003c71' as const
export const OPENSEA_CONDUIT_KEY = '0x0000007b02230091a7ed01230072f7006a004d60a8d4e71d599b8104250f0000' as const
export const OPENSEA_FEE_RECIPIENT = '0x0000a26b00c1f0Df003000390027140000fAa719' as const
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const ZERO_HASH = '0x0000000000000000000000000000000000000000000000000000000000000000'

/** ChainId ↔ OpenSea chain slug (the three chains OpenSea + Yeetful share). */
export const OPENSEA_CHAINS: Record<number, string> = { 1: 'ethereum', 8453: 'base', 42161: 'arbitrum' }
export const openseaSlugOf = (chainId: number): string | null => OPENSEA_CHAINS[chainId] ?? null
export const openseaChainIdOf = (slug: string): number | null => {
  const hit = Object.entries(OPENSEA_CHAINS).find(([, s]) => s === slug)
  return hit ? Number(hit[0]) : null
}

/** Canonical OpenSea item page for an NFT — the splash rows' ⓘ target when
 *  the API response didn't carry `opensea_url`. Null off OpenSea's chains. */
export function openseaAssetUrl(chainId: number, contract: string, tokenId: string): string | null {
  const slug = openseaSlugOf(chainId)
  if (!slug || !/^0x[0-9a-fA-F]{40}$/.test(contract) || !tokenId) return null
  return `https://opensea.io/assets/${slug}/${contract}/${tokenId}`
}

// ── API reads (server-side; OPENSEA_API_KEY) ───────────────────────────────

export interface OpenseaNft {
  identifier: string
  collection: string
  contract: string
  token_standard: string
  name: string | null
  image_url?: string | null
  display_image_url?: string | null
  opensea_url?: string | null
  updated_at?: string
}

export interface OpenseaCollectionFee {
  fee: number // percent
  recipient: string
  required: boolean
}

export function openseaEnabled(): boolean {
  return !!process.env.OPENSEA_API_KEY
}

async function osGet(path: string): Promise<unknown> {
  const key = process.env.OPENSEA_API_KEY
  if (!key) throw new Error('OPENSEA_API_KEY is not configured on the server.')
  const res = await fetch(`https://api.opensea.io/api/v2${path}`, {
    headers: { accept: 'application/json', 'x-api-key': key },
    cache: 'no-store',
  })
  if (!res.ok) throw new Error(`OpenSea API ${res.status} on ${path.split('?')[0]}`)
  return res.json()
}

export async function osPost(path: string, body: unknown): Promise<{ ok: boolean; status: number; data: unknown }> {
  const key = process.env.OPENSEA_API_KEY
  if (!key) return { ok: false, status: 401, data: 'OPENSEA_API_KEY is not configured on the server.' }
  const res = await fetch(`https://api.opensea.io/api/v2${path}`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'x-api-key': key },
    body: JSON.stringify(body),
    cache: 'no-store',
  })
  const text = await res.text()
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }
  return { ok: res.ok, status: res.status, data }
}

/** NFTs an address owns on one chain (most recently active first). */
export async function fetchOwnedNfts(chainId: number, address: string, limit = 20): Promise<OpenseaNft[]> {
  const slug = openseaSlugOf(chainId)
  if (!slug) return []
  const d = (await osGet(`/chain/${slug}/account/${address}/nfts?limit=${Math.min(limit, 50)}`)) as { nfts?: OpenseaNft[] }
  return Array.isArray(d.nfts) ? d.nfts : []
}

/** One NFT (metadata + standard + collection slug), or null when unindexed. */
export async function fetchNftMeta(chainId: number, contract: string, tokenId: string): Promise<OpenseaNft | null> {
  const slug = openseaSlugOf(chainId)
  if (!slug) return null
  try {
    const d = (await osGet(`/chain/${slug}/contract/${contract}/nfts/${tokenId}`)) as { nft?: OpenseaNft }
    return d.nft ?? null
  } catch {
    return null
  }
}

/** Collection fee schedule + required zone — the sell-flow anchor. */
export async function fetchCollectionFees(slug: string): Promise<{ fees: OpenseaCollectionFee[]; requiredZone: string | null; name: string } | null> {
  try {
    const d = (await osGet(`/collections/${slug}`)) as { fees?: OpenseaCollectionFee[]; required_zone?: string | null; name?: string }
    return { fees: d.fees ?? [], requiredZone: d.required_zone ?? null, name: d.name ?? slug }
  } catch {
    return null
  }
}

/** Floor price in ETH for a collection, or null. */
export async function fetchFloorEth(slug: string): Promise<number | null> {
  try {
    const d = (await osGet(`/collections/${slug}/stats`)) as { total?: { floor_price?: number; floor_price_symbol?: string } }
    const floor = d.total?.floor_price
    const sym = d.total?.floor_price_symbol ?? 'ETH'
    return typeof floor === 'number' && floor > 0 && /ETH/i.test(sym) ? floor : null
  } catch {
    return null
  }
}

// ── Seaport order math (pure) ──────────────────────────────────────────────

export const SEAPORT_ITEM = { NATIVE: 0, ERC20: 1, ERC721: 2, ERC1155: 3 } as const
export const SEAPORT_ORDER_TYPE = { FULL_OPEN: 0, FULL_RESTRICTED: 2 } as const

export interface SeaportItem {
  itemType: number
  token: string
  identifierOrCriteria: string
  startAmount: string
  endAmount: string
}
export interface SeaportConsideration extends SeaportItem {
  recipient: string
}
export interface SeaportOrderComponents {
  offerer: string
  zone: string
  offer: SeaportItem[]
  consideration: SeaportConsideration[]
  orderType: number
  startTime: string
  endTime: string
  zoneHash: string
  salt: string
  conduitKey: string
  counter: string
}

export const SEAPORT_EIP712_TYPES = {
  OrderComponents: [
    { name: 'offerer', type: 'address' },
    { name: 'zone', type: 'address' },
    { name: 'offer', type: 'OfferItem[]' },
    { name: 'consideration', type: 'ConsiderationItem[]' },
    { name: 'orderType', type: 'uint8' },
    { name: 'startTime', type: 'uint256' },
    { name: 'endTime', type: 'uint256' },
    { name: 'zoneHash', type: 'bytes32' },
    { name: 'salt', type: 'uint256' },
    { name: 'conduitKey', type: 'bytes32' },
    { name: 'counter', type: 'uint256' },
  ],
  OfferItem: [
    { name: 'itemType', type: 'uint8' },
    { name: 'token', type: 'address' },
    { name: 'identifierOrCriteria', type: 'uint256' },
    { name: 'startAmount', type: 'uint256' },
    { name: 'endAmount', type: 'uint256' },
  ],
  ConsiderationItem: [
    { name: 'itemType', type: 'uint8' },
    { name: 'token', type: 'address' },
    { name: 'identifierOrCriteria', type: 'uint256' },
    { name: 'startAmount', type: 'uint256' },
    { name: 'endAmount', type: 'uint256' },
    { name: 'recipient', type: 'address' },
  ],
} as const

export const seaportDomain = (chainId: number) => ({ name: 'Seaport', version: '1.6', chainId, verifyingContract: SEAPORT_1_6 })

/** Split a price across the collection's fee schedule (required fees always;
 *  optional creator fees only when asked). Fee amounts floor; the seller
 *  keeps the remainder, so the splits sum to exactly priceWei. */
export function splitListingPrice(priceWei: bigint, fees: OpenseaCollectionFee[], includeOptional = false): { sellerWei: bigint; splits: { recipient: string; basisPoints: number; amountWei: bigint }[] } {
  const splits: { recipient: string; basisPoints: number; amountWei: bigint }[] = []
  let feeTotal = BigInt(0)
  for (const f of fees) {
    if (!f.required && !includeOptional) continue
    const basisPoints = Math.round(f.fee * 100)
    if (basisPoints <= 0) continue
    const amountWei = (priceWei * BigInt(basisPoints)) / BigInt(10000)
    if (amountWei <= BigInt(0)) continue
    splits.push({ recipient: f.recipient, basisPoints, amountWei })
    feeTotal += amountWei
  }
  return { sellerWei: priceWei - feeTotal, splits }
}

export interface ListingOrderInput {
  offerer: string
  token: string
  identifier: string
  standard: 'erc721' | 'erc1155'
  amount: string
  priceWei: bigint
  fees: OpenseaCollectionFee[]
  requiredZone: string | null
  counter: string
  startTime: number
  endTime: number
  salt: string
}

/** Assemble the OrderComponents for a fixed-price native-ETH listing. Throws
 *  when the fee schedule consumes the entire price. */
export function buildListingComponents(input: ListingOrderInput): SeaportOrderComponents {
  const { sellerWei, splits } = splitListingPrice(input.priceWei, input.fees)
  if (sellerWei <= BigInt(0)) throw new Error('The collection fee schedule consumes the entire price.')
  return {
    offerer: input.offerer,
    zone: input.requiredZone ?? ZERO_ADDRESS,
    offer: [
      {
        itemType: input.standard === 'erc721' ? SEAPORT_ITEM.ERC721 : SEAPORT_ITEM.ERC1155,
        token: input.token,
        identifierOrCriteria: input.identifier,
        startAmount: input.amount,
        endAmount: input.amount,
      },
    ],
    consideration: [
      { itemType: SEAPORT_ITEM.NATIVE, token: ZERO_ADDRESS, identifierOrCriteria: '0', startAmount: sellerWei.toString(), endAmount: sellerWei.toString(), recipient: input.offerer },
      ...splits.map((s) => ({ itemType: SEAPORT_ITEM.NATIVE, token: ZERO_ADDRESS, identifierOrCriteria: '0', startAmount: s.amountWei.toString(), endAmount: s.amountWei.toString(), recipient: s.recipient })),
    ],
    orderType: input.requiredZone ? SEAPORT_ORDER_TYPE.FULL_RESTRICTED : SEAPORT_ORDER_TYPE.FULL_OPEN,
    startTime: String(input.startTime),
    endTime: String(input.endTime),
    zoneHash: ZERO_HASH,
    salt: input.salt,
    conduitKey: OPENSEA_CONDUIT_KEY,
    counter: input.counter,
  }
}

/** A 32-byte random salt as a decimal uint256 string. */
export function randomListingSalt(): string {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  let hex = '0x'
  for (const b of bytes) hex += b.toString(16).padStart(2, '0')
  return BigInt(hex).toString()
}

/**
 * Independent listing guard (pure, fail-closed) — verify a built order pays
 * ONLY the offerer + the collection's published fee recipients, offers
 * exactly the intended NFT, rides the OpenSea conduit, and totals exactly
 * the asked price. Run at build time AND re-run against the live fee
 * schedule at submit time.
 */
export function guardListingComponents(
  order: SeaportOrderComponents,
  exp: { offerer: string; token: string; identifier: string; priceWei: bigint; feeRecipients: string[]; requiredZone: string | null },
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (order.offerer.toLowerCase() !== exp.offerer.toLowerCase()) reasons.push('The order offerer is not your wallet.')
  if (order.offer.length !== 1) reasons.push('The order must offer exactly one NFT item.')
  const item = order.offer[0]
  if (item && item.token.toLowerCase() !== exp.token.toLowerCase()) reasons.push('The offered token is not the intended NFT contract.')
  if (item && item.identifierOrCriteria !== exp.identifier) reasons.push('The offered token id is not the intended NFT.')
  if (item && item.itemType !== SEAPORT_ITEM.ERC721 && item.itemType !== SEAPORT_ITEM.ERC1155) reasons.push('The offered item is not an NFT.')
  if (order.conduitKey.toLowerCase() !== OPENSEA_CONDUIT_KEY.toLowerCase()) reasons.push('The order does not ride the OpenSea conduit.')
  const zone = order.zone.toLowerCase()
  if (zone !== ZERO_ADDRESS && zone !== (exp.requiredZone ?? '').toLowerCase()) reasons.push("The order zone is neither open nor the collection's required zone.")
  const allowed = new Set([exp.offerer.toLowerCase(), OPENSEA_FEE_RECIPIENT.toLowerCase(), ...exp.feeRecipients.map((r) => r.toLowerCase())])
  let total = BigInt(0)
  let sellerWei = BigInt(0)
  for (const c of order.consideration) {
    if (c.itemType !== SEAPORT_ITEM.NATIVE) reasons.push('A consideration leg is not native ETH.')
    if (!allowed.has(c.recipient.toLowerCase())) reasons.push(`Consideration pays ${c.recipient} — not you and not a published fee recipient.`)
    total += BigInt(c.startAmount)
    if (c.recipient.toLowerCase() === exp.offerer.toLowerCase()) sellerWei += BigInt(c.startAmount)
  }
  if (total !== exp.priceWei) reasons.push('The consideration legs do not sum to the asked price.')
  if (sellerWei <= BigInt(0)) reasons.push('You receive nothing from this order.')
  return { ok: reasons.length === 0, reasons }
}
