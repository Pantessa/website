// ─────────────────────────────────────────────────────────────────────────
//  Native NFT layer — the deterministic, guardrailed path from "sell my
//  Pudgy Penguin #2489 for 4.2 ETH" / "send my Cool Cat NFT to 0x…" to a
//  SIGNABLE artifact. ERC-721 and ERC-1155, on every chain OpenSea and the
//  registry share (Ethereum/Base/Arbitrum).
//
//  Trust shape (the standing invariants):
//    · parse is deterministic regex — the layer only CLAIMS a turn that
//      names an NFT (the word "nft"/"opensea", a "#id", or a quoted name),
//      so token swaps ("sell 1 ETH for USDC") never land here.
//    · the NFT resolves against the wallet's REAL holdings (OpenSea reads),
//      then ownership re-verifies on-chain before any build.
//    · transfers: locally-encoded safeTransferFrom, re-decoded by an
//      independent guard; refuses zero-address/self/over-balance.
//    · sells: Seaport 1.6 order assembled from the collection's LIVE fee
//      schedule, guarded by guardListingComponents, offered as an EIP-712
//      artifact; the submit relay re-derives the payout set independently.
//    · buys: the ask resolves against LIVE OpenSea listings, OpenSea's
//      fulfillment is re-encoded LOCALLY (never opaque calldata), the target
//      pinned to Seaport 1.6, price re-checked vs the collection floor and
//      any explicit ETH cap.
//    · every artifact runs the venue-neutral guardrails (policy gate at
//      OPENSEA_POLICY_HOST) — unpriceable + policy-on = refused.
// ─────────────────────────────────────────────────────────────────────────

import { decodeFunctionData, encodeFunctionData, formatEther, parseEther } from 'viem'
import { normalize } from 'viem/ens'
import { APP_CHAINS, chainById, chainNamedIn, publicClientFor } from '@/lib/chains'
import {
  OPENSEA_CONDUIT,
  OPENSEA_POLICY_HOST,
  SEAPORT_1_6,
  SEAPORT_EIP712_TYPES,
  buildListingComponents,
  collectionSlugCandidates,
  fetchBestListingForNft,
  fetchCheapestListing,
  fetchCollectionFees,
  fetchFloorEth,
  fetchListingFulfillment,
  fetchNftMeta,
  fetchOwnedNfts,
  fulfillmentToCalldata,
  guardBuyFulfillment,
  guardListingComponents,
  openseaEnabled,
  openseaSlugOf,
  randomListingSalt,
  seaportDomain,
  type OpenseaListing,
  type OpenseaNft,
  type SeaportOrderComponents,
} from '@/lib/opensea'
import { buildReport, policyCheck, policyCheckInflow, validityCheck, type GuardrailCheck, type GuardrailReport } from '@/lib/tx-guardrails'
import { getActiveGrant, recordLedger, spentTodayUsd, toPolicy } from '@/lib/grant-store'
import { usdPerToken } from '@/lib/usd-probe'
import type { EvmTxRequest, Eip712OrderRequest } from '@/lib/transaction-layer'

export const ERC721_ABI = [
  { name: 'ownerOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'tokenId', type: 'uint256' }], outputs: [{ name: '', type: 'address' }] },
  { name: 'isApprovedForAll', type: 'function', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'operator', type: 'address' }], outputs: [{ name: '', type: 'bool' }] },
  { name: 'setApprovalForAll', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'operator', type: 'address' }, { name: 'approved', type: 'bool' }], outputs: [] },
  { name: 'safeTransferFrom', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'tokenId', type: 'uint256' }], outputs: [] },
] as const

export const ERC1155_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }, { name: 'id', type: 'uint256' }], outputs: [{ name: '', type: 'uint256' }] },
  { name: 'isApprovedForAll', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }, { name: 'operator', type: 'address' }], outputs: [{ name: '', type: 'bool' }] },
  { name: 'setApprovalForAll', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'operator', type: 'address' }, { name: 'approved', type: 'bool' }], outputs: [] },
  { name: 'safeTransferFrom', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'id', type: 'uint256' }, { name: 'amount', type: 'uint256' }, { name: 'data', type: 'bytes' }], outputs: [] },
] as const

const SEAPORT_COUNTER_ABI = [
  { name: 'getCounter', type: 'function', stateMutability: 'view', inputs: [{ name: 'offerer', type: 'address' }], outputs: [{ name: 'counter', type: 'uint256' }] },
] as const

/** Chains the NFT layer serves — the registry ∩ OpenSea. */
const NFT_CHAIN_IDS = [1, 8453, 42161]

// ── Parse ──────────────────────────────────────────────────────────────────

export interface NftAskBase {
  /** The NFT reference as typed: "Pudgy Penguin #2489", "0xbd35… #2489", "Edition 77". */
  ref: string
  /** Explicit "#1234" token id when present in the ref. */
  tokenId: string | null
  /** 0x contract when the ref is address-shaped. */
  contract: string | null
  /** Chain named in the message, or null (resolve across all three). */
  chainId: number | null
  /** ERC-1155 unit count ("send 2 of …"), default 1. */
  amount: string
}

export type NftAsk =
  | (NftAskBase & { kind: 'transfer'; to: string })
  | (NftAskBase & { kind: 'sell'; priceEth: string | null; durationHours: number })
  | (NftAskBase & { kind: 'buy'; maxPriceEth: string | null })
  | { kind: 'problem'; problem: string }

/** Does the message talk about an NFT at all? The layer's cheap claim gate:
 *  the word nft/opensea, a "#123" id, or an address#id pair. Token swaps,
 *  stock sells, and bare "send 1 eth" asks never pass. */
export function mentionsNft(message: string): boolean {
  return /\bnfts?\b|\bopensea\b|#\d+|\bcollectible\b/i.test(message)
}

const REF = String.raw`(.+?)`
const RECIPIENT = String.raw`(0x[0-9a-fA-F]{40}|[a-zA-Z0-9][a-zA-Z0-9-]*\.eth)`
const COUNT = String.raw`(?:(\d+)\s+(?:of|x|×)\s+)?`
const CHAIN_TAIL = String.raw`(?:\s+on\s+(?:ethereum|mainnet|base|arbitrum|opensea))*`

const TRANSFER_RE = new RegExp(String.raw`\b(?:transfer|send|gift)\s+${COUNT}(?:my\s+)?${REF}\s+(?:nft\s+)?to\s+${RECIPIENT}`, 'i')
// Buys have no required terminator ("to …"/"for … eth"), so the grammar
// anchors to the end of the message — deterministic layers stay narrow.
const BUY_RE = new RegExp(
  String.raw`\b(?:buy|purchase)\s+${COUNT}(?:an?\s+|the\s+)?(?:cheapest\s+|floor\s+)?${REF}(?:\s+for\s+(?:up\s+to\s+|at\s+most\s+|max\s+)?(\d+(?:\.\d+)?)\s*(?:eth|Ξ))?${CHAIN_TAIL}\s*[.!?]*\s*$`,
  'i',
)
const SELL_RE = new RegExp(String.raw`\b(?:sell|list)\s+${COUNT}(?:my\s+)?${REF}\s+(?:nft\s+)?for\s+(\d+(?:\.\d+)?)\s*(?:eth|Ξ)\b`, 'i')
const SELL_NO_PRICE_RE = new RegExp(String.raw`\b(?:sell|list)\s+${COUNT}(?:my\s+)?${REF}(?:\s+nft)?\s*(?:$|on\s+opensea)`, 'i')
const DURATION_RE = /\bfor\s+(\d+)\s*(day|days|week|weeks|hour|hours)\b/i

/** Trim filler off an NFT ref: articles, "nft", chain tails, quotes. */
function cleanRef(raw: string): string {
  return raw
    .replace(/["'“”]/g, '')
    .replace(new RegExp(CHAIN_TAIL + '$', 'i'), '')
    .replace(/\b(?:the|my|nft|token)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function refParts(refRaw: string): { ref: string; tokenId: string | null; contract: string | null } {
  const ref = cleanRef(refRaw)
  const addr = ref.match(/(0x[0-9a-fA-F]{40})/)
  const id = ref.match(/#\s*(\d+)/) ?? (addr ? ref.match(/0x[0-9a-fA-F]{40}\s+(\d+)\b/) : null)
  return { ref, tokenId: id ? id[1] : null, contract: addr ? addr[1] : null }
}

/**
 * Deterministic read of an NFT transfer/sell ask. Returns the intent, a
 * `problem` when it's clearly an NFT ask this layer must answer but can't
 * build yet (missing price/recipient), or null when the message isn't an
 * NFT action at all (not our turn — planner/other layers proceed).
 */
export function parseNftAsk(message: string): NftAsk | null {
  if (!mentionsNft(message)) return null
  const chain = chainNamedIn(message)
  // Robinhood Chain has no OpenSea — an explicit robinhood NFT ask is honest-refused.
  if (chain && !NFT_CHAIN_IDS.includes(chain.id)) {
    if (/\b(?:sell|list|transfer|send|gift|buy|purchase)\b/i.test(message)) {
      return { kind: 'problem', problem: `OpenSea covers Ethereum, Base, and Arbitrum — there's no NFT marketplace on ${chain.name} I can build against.` }
    }
    return null
  }
  const chainId = chain?.id ?? null

  const t = message.match(TRANSFER_RE)
  if (t) {
    const { ref, tokenId, contract } = refParts(t[2])
    if (!ref) return { kind: 'problem', problem: 'Which NFT? Name it like “send my Pudgy Penguin #2489 to 0x…”.' }
    return { kind: 'transfer', ref, tokenId, contract, chainId, amount: t[1] ?? '1', to: t[3] }
  }
  // A transfer-shaped ask with no recipient — ours, but unbuildable yet.
  if (/\b(?:transfer|send|gift)\b/i.test(message) && /\bnfts?\b|#\d+/i.test(message) && !/\bto\s+\S/i.test(message)) {
    return { kind: 'problem', problem: 'Where should it go? Give me the full ask in one line: “send my <NFT name> #<id> to 0x… (or name.eth)”. Transfers are irreversible, so I build only against an explicit recipient.' }
  }

  const s = message.match(SELL_RE)
  if (s) {
    const { ref, tokenId, contract } = refParts(s[2])
    if (!ref) return { kind: 'problem', problem: 'Which NFT? Name it like “sell my Pudgy Penguin #2489 for 4.2 ETH”.' }
    const dur = message.match(DURATION_RE)
    let durationHours = 168
    if (dur) {
      const n = Number(dur[1])
      durationHours = /week/i.test(dur[2]) ? n * 168 : /day/i.test(dur[2]) ? n * 24 : n
      durationHours = Math.max(1, Math.min(durationHours, 720))
    }
    return { kind: 'sell', ref, tokenId, contract, chainId, amount: s[1] ?? '1', priceEth: s[3], durationHours }
  }
  const sNoPrice = message.match(SELL_NO_PRICE_RE)
  if (sNoPrice && /\bnfts?\b|#\d+|\bopensea\b/i.test(message)) {
    const { ref } = refParts(sNoPrice[2])
    if (ref) {
      return { kind: 'problem', problem: `At what price? Say “sell ${ref} for <amount> ETH” — I'll check the collection floor so you can sanity-check the number.` }
    }
  }

  const b = message.match(BUY_RE)
  if (b) {
    const { ref, tokenId, contract } = refParts(b[2])
    if (ref) {
      return { kind: 'buy', ref, tokenId, contract, chainId, amount: b[1] ?? '1', maxPriceEth: b[3] ?? null }
    }
  }
  // A buy-shaped NFT ask the grammar couldn't read — ours, but unbuildable.
  if (/^\s*(?:please\s+|can\s+you\s+)?(?:buy|purchase)\b/i.test(message)) {
    return { kind: 'problem', problem: 'Give me the buy in one line: “buy <collection name> #<id>” or “buy the cheapest <collection> nft”, optionally “for up to <amount> ETH”. I resolve it against live OpenSea listings and you sign the exact Seaport fill.' }
  }
  return null
}

// ── Resolve (anchor the ref against the wallet's real NFTs) ────────────────

export interface ResolvedNft {
  chainId: number
  contract: `0x${string}`
  tokenId: string
  standard: 'erc721' | 'erc1155'
  name: string
  collection: string
  imageUrl: string | null
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** Score a wallet NFT against the typed ref. 0 = no match. */
export function nftMatchScore(nft: { identifier: string; name: string | null; collection: string }, ref: string, tokenId: string | null): number {
  const words = norm(ref.replace(/#\s*\d+/, ''))
  const name = norm(nft.name ?? '')
  const coll = norm(nft.collection.replace(/-/g, ' '))
  if (tokenId && nft.identifier !== tokenId) return 0
  if (tokenId && !words) return 1 // bare "#1234" — id match alone qualifies
  if (!words) return 0
  if (name === words) return 3
  if (name.includes(words) || words.includes(name.replace(/\s*\d+$/, '').trim() || ' ')) return 2
  if (coll.includes(words) || words.includes(coll)) return 2
  const wordSet = words.split(' ').filter((w) => w.length > 2)
  if (wordSet.length && wordSet.every((w) => name.includes(w) || coll.includes(w))) return 1
  return 0
}

/** Resolve the ask's NFT ref against what the wallet actually owns. */
async function resolveNft(ask: NftAskBase, owner: string): Promise<ResolvedNft | { problem: string }> {
  // Address-shaped refs skip the holdings scan — verify directly.
  if (ask.contract && ask.tokenId) {
    for (const chainId of ask.chainId ? [ask.chainId] : NFT_CHAIN_IDS) {
      const meta = await fetchNftMeta(chainId, ask.contract, ask.tokenId)
      if (meta && (meta.token_standard === 'erc721' || meta.token_standard === 'erc1155')) {
        return {
          chainId,
          contract: ask.contract as `0x${string}`,
          tokenId: ask.tokenId,
          standard: meta.token_standard,
          name: meta.name ?? `#${ask.tokenId}`,
          collection: meta.collection,
          imageUrl: meta.display_image_url ?? meta.image_url ?? null,
        }
      }
    }
    return { problem: `I couldn't find token #${ask.tokenId} at ${ask.contract} on ${ask.chainId ? (chainById(ask.chainId)?.name ?? 'that chain') : 'Ethereum, Base, or Arbitrum'}.` }
  }

  const chains = ask.chainId ? [ask.chainId] : NFT_CHAIN_IDS
  const owned: (OpenseaNft & { chainId: number })[] = []
  await Promise.all(
    chains.map(async (chainId) => {
      const nfts = await fetchOwnedNfts(chainId, owner, 50).catch(() => [] as OpenseaNft[])
      for (const n of nfts) owned.push({ ...n, chainId })
    }),
  )
  if (owned.length === 0) {
    return { problem: `I don't see any NFTs in ${owner.slice(0, 6)}… on ${chains.map((c) => chainById(c)?.name).filter(Boolean).join(', ')} (per OpenSea). If it's brand new, give me the contract address and id: “…0x<contract> #<id>”.` }
  }
  const scored = owned
    .map((n) => ({ n, score: nftMatchScore(n, ask.ref, ask.tokenId) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
  if (scored.length === 0) {
    const sample = owned.slice(0, 5).map((n) => `${n.name ?? `#${n.identifier}`}`).join(', ')
    return { problem: `“${ask.ref}” doesn't match an NFT this wallet holds. I can see: ${sample}${owned.length > 5 ? ', …' : ''}. Name one of those (or use “0x<contract> #<id>”).` }
  }
  const best = scored[0]
  const ties = scored.filter((x) => x.score === best.score && !(x.n.contract === best.n.contract && x.n.identifier === best.n.identifier && x.n.chainId === best.n.chainId))
  if (ties.length > 0 && !ask.tokenId) {
    const opts = [best, ...ties].slice(0, 4).map((x) => `${x.n.name ?? `#${x.n.identifier}`} (#${x.n.identifier} on ${chainById(x.n.chainId)?.name})`).join(' · ')
    return { problem: `“${ask.ref}” matches more than one of your NFTs — which one? ${opts}` }
  }
  const n = best.n
  const standard = n.token_standard === 'erc1155' ? 'erc1155' : 'erc721'
  return {
    chainId: n.chainId,
    contract: n.contract as `0x${string}`,
    tokenId: n.identifier,
    standard,
    name: n.name ?? `#${n.identifier}`,
    collection: n.collection,
    imageUrl: n.display_image_url ?? n.image_url ?? null,
  }
}

// ── Transfer guard (pure, fail-closed) ─────────────────────────────────────

/** Re-decode a built NFT transfer independently: right contract/chain, right
 *  function, sender = signer, recipient/id/amount exactly as asked. */
export function guardNftTransfer(
  tx: { to: string; data: string; value: string; chainId: number },
  exp: { contract: string; chainId: number; standard: 'erc721' | 'erc1155'; from: string; to: string; tokenId: string; amount: bigint },
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (tx.to.toLowerCase() !== exp.contract.toLowerCase()) reasons.push('The transaction is not addressed to the NFT contract.')
  if (tx.chainId !== exp.chainId) reasons.push(`The transaction targets chain ${tx.chainId}, not ${exp.chainId}.`)
  if (BigInt(tx.value || '0') !== BigInt(0)) reasons.push('An NFT transfer must carry no ETH value.')
  try {
    const dec = decodeFunctionData({ abi: exp.standard === 'erc721' ? ERC721_ABI : ERC1155_ABI, data: tx.data as `0x${string}` })
    if (dec.functionName !== 'safeTransferFrom') {
      reasons.push(`The calldata calls "${dec.functionName}", not safeTransferFrom — refusing.`)
    } else if (exp.standard === 'erc721') {
      const [from, to, id] = dec.args as [string, string, bigint]
      if (from.toLowerCase() !== exp.from.toLowerCase()) reasons.push('The transfer sender is not the signer.')
      if (to.toLowerCase() !== exp.to.toLowerCase()) reasons.push('The transfer recipient is not the asked recipient.')
      if (id !== BigInt(exp.tokenId)) reasons.push('The transferred token id is not the asked NFT.')
    } else {
      const [from, to, id, amount] = dec.args as unknown as [string, string, bigint, bigint]
      if (from.toLowerCase() !== exp.from.toLowerCase()) reasons.push('The transfer sender is not the signer.')
      if (to.toLowerCase() !== exp.to.toLowerCase()) reasons.push('The transfer recipient is not the asked recipient.')
      if (id !== BigInt(exp.tokenId)) reasons.push('The transferred token id is not the asked NFT.')
      if (amount !== exp.amount) reasons.push('The transferred amount is not the asked amount.')
    }
  } catch {
    reasons.push('Could not decode the transfer calldata — refusing to offer an opaque transaction.')
  }
  return { ok: reasons.length === 0, reasons }
}

// ── Build turns ────────────────────────────────────────────────────────────

export interface NftTransferBuilt {
  summary: string
  guardrails: GuardrailReport
  blocked: boolean
  refusal?: string
  tx: EvmTxRequest
  note: string
}

export interface NftListingBuilt {
  summary: string
  guardrails: GuardrailReport
  blocked: boolean
  refusal?: string
  order: Eip712OrderRequest
  note: string
}

const fmtEth = (wei: bigint) => {
  const n = Number(formatEther(wei))
  return n !== 0 && Math.abs(n) < 1e-6 ? formatEther(wei) : String(Number(n.toFixed(6)))
}

/** Resolve an ENS name (mainnet) or pass a 0x address through. */
async function resolveRecipient(to: string): Promise<`0x${string}` | null> {
  if (/^0x[0-9a-fA-F]{40}$/.test(to)) return to as `0x${string}`
  if (/\.eth$/i.test(to)) {
    const client = publicClientFor(1)
    if (!client) return null
    try {
      return (await client.getEnsAddress({ name: normalize(to) })) ?? null
    } catch {
      return null
    }
  }
  return null
}

/** Estimate the NFT's USD value (floor × ETH price) for the policy gate.
 *  Fail-soft null — the policy check then decides (unpriceable + policy on
 *  = refused, never bypassed). */
async function nftValueUsd(chainId: number, collection: string, units = BigInt(1)): Promise<number | null> {
  const [floor, eth] = await Promise.all([fetchFloorEth(collection), usdPerToken(chainId, 'ETH').catch(() => null)])
  if (floor == null || !eth) return null
  return Number((floor * eth.usd * Number(units)).toFixed(2))
}

async function policyChecks(
  from: string,
  valueUsd: number | null,
  /** 'out' = the wallet gives value (a transfer leaving) → full policy gate.
   *  'in' = the wallet RECEIVES (a sale's proceeds) → kill switches only;
   *  the caps and allowlist govern what agents may PAY, and a sale pays
   *  nothing (the $1,831 listing blocked by a $200 cap was this bug). */
  flow: 'out' | 'in' = 'out',
): Promise<{ check: GuardrailCheck; violation: ReturnType<typeof policyCheck>['violation'] }> {
  const grant = await getActiveGrant(from.toLowerCase())
  const policy = grant ? toPolicy(grant) : null
  const res =
    flow === 'in'
      ? policyCheckInflow(valueUsd, policy)
      : policyCheck(valueUsd, policy, grant ? await spentTodayUsd(grant.id) : 0, OPENSEA_POLICY_HOST)
  if (res.violation && grant) {
    await recordLedger({
      grantId: grant.id,
      orgId: grant.orgId ?? undefined,
      host: OPENSEA_POLICY_HOST,
      serviceName: 'OpenSea',
      amountUsd: 0,
      ok: false,
      note: `blocked: ${res.violation} (nft action)`,
    })
  }
  return res
}

/** Resolve + verify + build a guarded NFT transfer for the USER to sign. */
export async function buildNftTransfer(ask: Extract<NftAsk, { kind: 'transfer' }>, from: string): Promise<NftTransferBuilt | { problem: string }> {
  if (!openseaEnabled()) return { problem: 'The NFT layer needs OPENSEA_API_KEY on the server — it anchors what you own before building. Not configured yet.' }
  const to = await resolveRecipient(ask.to)
  if (!to) return { problem: `I couldn't resolve “${ask.to}” to an address — give me a 0x address (or a registered ENS name).` }
  if (to.toLowerCase() === from.toLowerCase()) return { problem: 'That recipient is your own wallet — nothing to transfer.' }
  const units = BigInt(ask.amount || '1')
  if (units < BigInt(1)) return { problem: 'The amount must be at least 1.' }

  const nft = await resolveNft(ask, from)
  if ('problem' in nft) return nft
  if (nft.standard === 'erc721' && units !== BigInt(1)) return { problem: `${nft.name} is an ERC-721 — it's unique, so the amount can only be 1.` }

  const client = publicClientFor(nft.chainId)
  if (!client) return { problem: 'No RPC client configured for that chain.' }

  // On-chain ownership re-verification — OpenSea's index is the map, the
  // chain is the territory.
  const ownCheck: GuardrailCheck = await (async () => {
    if (nft.standard === 'erc721') {
      const owner = (await client.readContract({ address: nft.contract, abi: ERC721_ABI, functionName: 'ownerOf', args: [BigInt(nft.tokenId)] }).catch(() => null)) as string | null
      const ok = !!owner && owner.toLowerCase() === from.toLowerCase()
      return { id: 'ownership', level: 'block' as const, ok, note: ok ? `On-chain owner verified: ${nft.name} is yours.` : `On-chain, ${nft.name} is owned by ${owner ?? 'nobody (unminted?)'} — not your wallet.` }
    }
    const bal = (await client.readContract({ address: nft.contract, abi: ERC1155_ABI, functionName: 'balanceOf', args: [from as `0x${string}`, BigInt(nft.tokenId)] }).catch(() => null)) as bigint | null
    const ok = bal !== null && bal >= units
    return { id: 'ownership', level: 'block' as const, ok, note: ok ? `On-chain balance verified: you hold ${bal} (sending ${units}).` : `On-chain you hold ${bal ?? 0} of ${nft.name} — fewer than the ${units} asked.` }
  })()

  const data =
    nft.standard === 'erc721'
      ? encodeFunctionData({ abi: ERC721_ABI, functionName: 'safeTransferFrom', args: [from as `0x${string}`, to, BigInt(nft.tokenId)] })
      : encodeFunctionData({ abi: ERC1155_ABI, functionName: 'safeTransferFrom', args: [from as `0x${string}`, to, BigInt(nft.tokenId), units, '0x'] })
  const tx: EvmTxRequest = { to: nft.contract, data, value: '0', chainId: nft.chainId, action: 'nft-transfer' }

  const verdict = guardNftTransfer({ to: tx.to, data, value: '0', chainId: nft.chainId }, { contract: nft.contract, chainId: nft.chainId, standard: nft.standard, from, to, tokenId: nft.tokenId, amount: units })
  const guardCheck: GuardrailCheck = {
    id: 'nft-transfer-guard',
    level: 'block',
    ok: verdict.ok,
    note: verdict.ok ? 'Calldata decoded and verified: safeTransferFrom on the exact NFT, sender pinned to your wallet, recipient exactly as asked.' : verdict.reasons.join(' '),
  }
  const leaveCheck: GuardrailCheck = {
    id: 'recipient',
    level: 'warn',
    ok: true,
    note: `This NFT LEAVES your wallet to ${to}${ask.to !== to ? ` (${ask.to})` : ''} — transfers are irreversible.`,
  }

  const valueUsd = await nftValueUsd(nft.chainId, nft.collection, units)
  const { check: polCheck, violation } = await policyChecks(from, valueUsd)
  const guardrails = buildReport(valueUsd, [ownCheck, guardCheck, leaveCheck, polCheck], violation ? { violation, valueUsd, host: OPENSEA_POLICY_HOST } : null)
  const blocked = !guardrails.ok

  const chainName = chainById(nft.chainId)?.name ?? `chain ${nft.chainId}`
  const what = nft.standard === 'erc1155' && units > BigInt(1) ? `${units}× ${nft.name}` : nft.name
  return {
    summary: `Send ${what} (${nft.standard.toUpperCase()}, ${nft.collection}) to ${ask.to} on ${chainName}.`,
    guardrails,
    blocked,
    ...(blocked ? { refusal: guardrails.checks.filter((c) => !c.ok && c.level === 'block').map((c) => c.note).join(' ') } : {}),
    tx,
    note: valueUsd != null ? `Collection floor values this at ~$${valueUsd.toLocaleString()}.` : 'No floor price found for this collection — value untracked.',
  }
}

/** Resolve + verify + build a guarded Seaport listing for the USER to sign. */
export async function buildNftListing(ask: Extract<NftAsk, { kind: 'sell' }>, from: string): Promise<NftListingBuilt | { problem: string }> {
  if (!openseaEnabled()) return { problem: 'The NFT layer needs OPENSEA_API_KEY on the server — it anchors what you own before building. Not configured yet.' }
  if (!ask.priceEth) return { problem: 'At what price? “sell <NFT> for <amount> ETH”.' }
  const priceWei = parseEther(ask.priceEth)
  if (priceWei <= BigInt(0)) return { problem: 'The price must be positive.' }
  const units = BigInt(ask.amount || '1')

  const nft = await resolveNft(ask, from)
  if ('problem' in nft) return nft
  if (nft.standard === 'erc721' && units !== BigInt(1)) return { problem: `${nft.name} is an ERC-721 — it's unique, so you can only list 1.` }

  const client = publicClientFor(nft.chainId)
  if (!client) return { problem: 'No RPC client configured for that chain.' }

  const [ownerOk, colInfo, floorEth, counter, approved] = await Promise.all([
    nft.standard === 'erc721'
      ? client.readContract({ address: nft.contract, abi: ERC721_ABI, functionName: 'ownerOf', args: [BigInt(nft.tokenId)] }).then((o) => (o as string).toLowerCase() === from.toLowerCase()).catch(() => false)
      : client.readContract({ address: nft.contract, abi: ERC1155_ABI, functionName: 'balanceOf', args: [from as `0x${string}`, BigInt(nft.tokenId)] }).then((b) => (b as bigint) >= units).catch(() => false),
    fetchCollectionFees(nft.collection),
    fetchFloorEth(nft.collection),
    client.readContract({ address: SEAPORT_1_6, abi: SEAPORT_COUNTER_ABI, functionName: 'getCounter', args: [from as `0x${string}`] }),
    client.readContract({ address: nft.contract, abi: ERC721_ABI, functionName: 'isApprovedForAll', args: [from as `0x${string}`, OPENSEA_CONDUIT] }).catch(() => false),
  ])
  if (!colInfo) return { problem: `OpenSea has no fee schedule for “${nft.collection}” — without it I can't build a valid listing.` }

  const startTime = Math.floor(Date.now() / 1000) - 120
  const endTime = startTime + 120 + ask.durationHours * 3600

  let components: SeaportOrderComponents
  try {
    components = buildListingComponents({
      offerer: from,
      token: nft.contract,
      identifier: nft.tokenId,
      standard: nft.standard,
      amount: units.toString(),
      priceWei,
      fees: colInfo.fees,
      requiredZone: colInfo.requiredZone,
      counter: (counter as bigint).toString(),
      startTime,
      endTime,
      salt: randomListingSalt(),
    })
  } catch (e) {
    return { problem: e instanceof Error ? e.message : String(e) }
  }

  const ownCheck: GuardrailCheck = {
    id: 'ownership',
    level: 'block',
    ok: ownerOk,
    note: ownerOk ? `On-chain ownership verified: ${nft.name} is yours to list.` : `On-chain, this wallet doesn't hold ${nft.name} — nothing to list.`,
  }
  const verdict = guardListingComponents(components, {
    offerer: from,
    token: nft.contract,
    identifier: nft.tokenId,
    priceWei,
    feeRecipients: colInfo.fees.map((f) => f.recipient),
    requiredZone: colInfo.requiredZone,
  })
  const orderCheck: GuardrailCheck = {
    id: 'listing-guard',
    level: 'block',
    ok: verdict.ok,
    note: verdict.ok
      ? `Order verified independently: pays only you + the collection's published fee recipients, offers exactly ${nft.name}, rides the OpenSea conduit.`
      : verdict.reasons.join(' '),
  }
  const { sellerWei } = (() => {
    let seller = BigInt(0)
    for (const c of components.consideration) if (c.recipient.toLowerCase() === from.toLowerCase()) seller += BigInt(c.startAmount)
    return { sellerWei: seller }
  })()

  const floorCheck: GuardrailCheck | null =
    floorEth != null && Number(ask.priceEth) < floorEth * 0.5
      ? { id: 'floor-sanity', level: 'warn', ok: false, note: `Asking ${ask.priceEth} ETH but the collection floor is ${floorEth.toFixed(4)} ETH — this would fill instantly at ~${Math.round((1 - Number(ask.priceEth) / floorEth) * 100)}% below floor.` }
      : null

  const eth = await usdPerToken(nft.chainId, 'ETH').catch(() => null)
  const valueUsd = eth ? Number((Number(ask.priceEth) * eth.usd).toFixed(2)) : null
  // A sale is an INFLOW — the seller receives; spend caps don't apply.
  const { check: polCheck, violation } = await policyChecks(from, valueUsd, 'in')
  const checks = [ownCheck, orderCheck, validityCheck(endTime), ...(floorCheck ? [floorCheck] : []), polCheck]
  const guardrails = buildReport(valueUsd, checks, violation ? { violation, valueUsd, host: OPENSEA_POLICY_HOST } : null)
  const blocked = !guardrails.ok

  const chainName = chainById(nft.chainId)?.name ?? `chain ${nft.chainId}`
  const order: Eip712OrderRequest = {
    protocol: 'opensea',
    typedData: {
      domain: seaportDomain(nft.chainId),
      primaryType: 'OrderComponents',
      types: SEAPORT_EIP712_TYPES,
      message: components,
    },
    submitUrl: '/api/opensea/submit',
    chainId: nft.chainId,
    ...(approved
      ? {}
      : {
          prereqTx: {
            to: nft.contract,
            data: encodeFunctionData({ abi: ERC721_ABI, functionName: 'setApprovalForAll', args: [OPENSEA_CONDUIT, true] }),
            value: '0',
            chainId: nft.chainId,
            action: 'approve-opensea',
          },
          prereqTitle: 'Approve OpenSea (one-time per collection)',
        }),
  }

  return {
    summary: `List ${units > BigInt(1) ? `${units}× ` : ''}${nft.name} on OpenSea (${chainName}) at ${ask.priceEth} ETH — you receive ${fmtEth(sellerWei)} ETH after fees; expires in ${ask.durationHours >= 24 ? `${Math.round(ask.durationHours / 24)}d` : `${ask.durationHours}h`}. Signing is gasless${approved ? '' : ' after a one-time approval'}.`,
    guardrails,
    blocked,
    ...(blocked ? { refusal: guardrails.checks.filter((c) => !c.ok && c.level === 'block').map((c) => c.note).join(' ') } : {}),
    order,
    note:
      floorEth != null
        ? `Collection floor: ${floorEth.toFixed(4)} ETH.`
        : 'No floor price found for this collection.',
  }
}

// ── Buy (fill a live listing) ──────────────────────────────────────────────

interface BuyTarget {
  listing: OpenseaListing
  /** Collection slug the listing resolved through. */
  collection: string
  /** Display name: "Pudgy Penguins #2489". */
  name: string
  floorEth: number | null
  /** True when the ask pinned a token id (rarity premiums above floor are
   *  normal); false = "cheapest in the collection" (price ≈ floor expected). */
  specific: boolean
}

/** Resolve a buy ask against LIVE OpenSea listings — an exact order hash or
 *  an honest problem, never a guess. */
async function resolveBuyListing(ask: Extract<NftAsk, { kind: 'buy' }>): Promise<BuyTarget | { problem: string }> {
  // Address-shaped refs: contract (+ #id) → collection slug via metadata.
  if (ask.contract) {
    if (!ask.tokenId) return { problem: `Which token at ${ask.contract}? Give me the id (“0x… #<id>”) — or name the collection and I'll take its cheapest listing.` }
    for (const chainId of ask.chainId ? [ask.chainId] : NFT_CHAIN_IDS) {
      const meta = await fetchNftMeta(chainId, ask.contract, ask.tokenId)
      if (!meta) continue
      const listing = await fetchBestListingForNft(meta.collection, ask.tokenId)
      if (!listing) return { problem: `${meta.name ?? `#${ask.tokenId}`} (${meta.collection}) has no live ETH listing on OpenSea right now.` }
      if (listing.contract.toLowerCase() !== ask.contract.toLowerCase() || listing.tokenId !== ask.tokenId) {
        return { problem: `OpenSea's best listing for that collection points at a different token than ${ask.contract} #${ask.tokenId} — refusing to buy the wrong NFT.` }
      }
      const floorEth = await fetchFloorEth(meta.collection)
      return { listing, collection: meta.collection, name: meta.name ?? `#${ask.tokenId}`, floorEth, specific: true }
    }
    return { problem: `I couldn't find token #${ask.tokenId} at ${ask.contract} on ${ask.chainId ? (chainById(ask.chainId)?.name ?? 'that chain') : 'Ethereum, Base, or Arbitrum'}.` }
  }

  // Name-shaped refs: probe the deterministic slug candidates against the
  // live API. A candidate that exists but has no live listing does NOT stop
  // the scan — squatter slugs shadow the real collection ("pudgy-penguin"
  // exists and is empty; "pudgy-penguins" is the one with listings).
  const nameOnly = ask.ref.replace(/#\s*\d+/, '').trim()
  let firstFound: { slug: string; name: string } | null = null
  for (const slug of collectionSlugCandidates(nameOnly)) {
    const col = await fetchCollectionFees(slug)
    if (!col) continue
    if (!firstFound) firstFound = { slug, name: col.name }
    const listing = ask.tokenId ? await fetchBestListingForNft(slug, ask.tokenId) : await fetchCheapestListing(slug)
    if (!listing) continue
    const floorEth = await fetchFloorEth(slug)
    return { listing, collection: slug, name: `${col.name} #${listing.tokenId}`, floorEth, specific: !!ask.tokenId }
  }
  if (firstFound) {
    return {
      problem: ask.tokenId
        ? `${firstFound.name} #${ask.tokenId} has no live ETH listing on OpenSea right now.`
        : `“${firstFound.name}” has no live ETH listings on OpenSea right now.`,
    }
  }
  return { problem: `I couldn't find an OpenSea collection matching “${nameOnly || ask.ref}”. Give me the collection's OpenSea slug, or the exact NFT as “0x<contract> #<id>”.` }
}

export interface NftBuyBuilt {
  summary: string
  guardrails: GuardrailReport
  blocked: boolean
  refusal?: string
  tx: EvmTxRequest
  note: string
  /** The resolved target — job wait predicates verify ownership of exactly
   *  this NFT once the fill confirms. */
  nft: { chainId: number; contract: string; tokenId: string; name: string; collection: string }
}

/** Resolve a live listing + build a guarded Seaport fill for the USER to
 *  sign. The calldata is re-encoded locally from OpenSea's fulfillment —
 *  target pinned to Seaport 1.6, price capped at the quoted listing (and any
 *  explicit ETH cap), balance and spend policy checked as an OUTFLOW. */
export async function buildNftBuy(ask: Extract<NftAsk, { kind: 'buy' }>, buyer: string): Promise<NftBuyBuilt | { problem: string }> {
  if (!openseaEnabled()) return { problem: 'The NFT layer needs OPENSEA_API_KEY on the server — it anchors live listings before building. Not configured yet.' }
  if (BigInt(ask.amount || '1') !== BigInt(1)) return { problem: 'Buys fill one listing at a time — ask for a single NFT per buy.' }
  const maxWei = ask.maxPriceEth ? parseEther(ask.maxPriceEth) : null
  if (maxWei !== null && maxWei <= BigInt(0)) return { problem: 'The ETH cap must be positive.' }

  const target = await resolveBuyListing(ask)
  if ('problem' in target) return target
  const { listing } = target
  if (ask.chainId && listing.chainId !== ask.chainId) {
    return { problem: `${target.name} is listed on ${chainById(listing.chainId)?.name ?? `chain ${listing.chainId}`}, not ${chainById(ask.chainId)?.name ?? 'the chain you named'}.` }
  }

  const fulfillment = await fetchListingFulfillment(listing.chainId, listing.orderHash, buyer)
  if ('problem' in fulfillment) return fulfillment

  // Pure fail-closed guard: pinned target, fulfill* function, price ceiling.
  const verdict = guardBuyFulfillment(fulfillment, { priceWei: listing.priceWei, maxWei, contract: listing.contract })
  const fulfillCheck: GuardrailCheck = {
    id: 'buy-fulfillment-guard',
    level: 'block',
    ok: verdict.ok,
    note: verdict.ok
      ? `Fulfillment verified: pays exactly ${fmtEth(fulfillment.valueWei)} ETH to the pinned Seaport 1.6, calldata re-encoded locally against the order for ${target.name}.`
      : verdict.reasons.join(' '),
  }

  let data: `0x${string}` | null = null
  try {
    data = fulfillmentToCalldata(fulfillment.functionSig, fulfillment.inputData)
  } catch (e) {
    return { problem: `Couldn't re-encode OpenSea's fulfillment locally (${e instanceof Error ? e.message : String(e)}) — refusing to forward opaque calldata.` }
  }

  const client = publicClientFor(listing.chainId)
  if (!client) return { problem: 'No RPC client configured for that chain.' }
  const balance = await client.getBalance({ address: buyer as `0x${string}` }).catch(() => null)
  const balanceOk = balance !== null && balance >= fulfillment.valueWei
  const balanceCheck: GuardrailCheck = {
    id: 'balance',
    level: 'block',
    ok: balanceOk,
    note: balanceOk
      ? `Wallet holds ${fmtEth(balance!)} ETH on ${chainById(listing.chainId)?.name} — covers the ${fmtEth(fulfillment.valueWei)} ETH fill (plus gas).`
      : `Buying needs ${fmtEth(fulfillment.valueWei)} ETH but the wallet holds ${balance === null ? 'an unreadable balance' : `${fmtEth(balance)} ETH`} on ${chainById(listing.chainId)?.name} (plus gas).`,
  }

  // Floor sanity: a "cheapest in collection" buy should price ≈ floor — a
  // big gap means a stale index, so refuse unless the user set their own cap.
  // A pinned #id legitimately carries a rarity premium → warn only.
  const priceEthNum = Number(formatEther(listing.priceWei))
  const floorCheck: GuardrailCheck | null = (() => {
    if (target.floorEth == null || target.floorEth <= 0) return null
    const ratio = priceEthNum / target.floorEth
    if (!target.specific && maxWei === null && ratio > 1.5) {
      return { id: 'floor-sanity', level: 'block', ok: false, note: `The cheapest listing prices at ${fmtEth(listing.priceWei)} ETH but the collection floor is ${target.floorEth.toFixed(4)} ETH (${ratio.toFixed(1)}× floor) — that gap looks like a stale index. Re-ask with an explicit cap (“for up to X ETH”) if you really want it.` }
    }
    if (ratio > 2) {
      return { id: 'floor-sanity', level: 'warn', ok: false, note: `${target.name} is listed at ${fmtEth(listing.priceWei)} ETH — ${ratio.toFixed(1)}× the ${target.floorEth.toFixed(4)} ETH collection floor.` }
    }
    return { id: 'floor-sanity', level: 'warn', ok: true, note: `Price checked against the collection floor (${target.floorEth.toFixed(4)} ETH).` }
  })()

  const eth = await usdPerToken(listing.chainId, 'ETH').catch(() => null)
  const valueUsd = eth ? Number((priceEthNum * eth.usd).toFixed(2)) : null
  // A buy is an OUTFLOW — the full spend-policy gate applies.
  const { check: polCheck, violation } = await policyChecks(buyer, valueUsd, 'out')
  const checks = [fulfillCheck, balanceCheck, ...(floorCheck ? [floorCheck] : []), polCheck]
  const guardrails = buildReport(valueUsd, checks, violation ? { violation, valueUsd, host: OPENSEA_POLICY_HOST } : null)
  const blocked = !guardrails.ok

  const chainName = chainById(listing.chainId)?.name ?? `chain ${listing.chainId}`
  const tx: EvmTxRequest = { to: SEAPORT_1_6, data, value: fulfillment.valueWei.toString(), chainId: listing.chainId, action: 'nft-buy' }
  return {
    summary: `Buy ${target.name} on OpenSea (${chainName}) for ${fmtEth(fulfillment.valueWei)} ETH — the NFT transfers to your wallet in the same transaction.`,
    guardrails,
    blocked,
    ...(blocked ? { refusal: guardrails.checks.filter((c) => !c.ok && c.level === 'block').map((c) => c.note).join(' ') } : {}),
    tx,
    note: 'Listings can be filled or cancelled by others at any moment — if the transaction reverts, just ask again for a fresh fill.',
    nft: { chainId: listing.chainId, contract: listing.contract, tokenId: listing.tokenId, name: target.name, collection: target.collection },
  }
}
