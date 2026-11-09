// THE WORDS A TRADE PROOF MAY WEAR (QA-SECURITY S1, S2, S9) — pure, client-safe.
//
// One rule, everywhere a trade post is printed (the card, the post page, the
// Discord embed, the Telegram message, the composer's picker, the default
// title): "verified" sits ONLY beside what the chain confirmed at post time —
// that this wallet sent a successful transaction on this chain that moved
// this many dollars (read from the transaction's own transfers). The market
// and the side are the AUTHOR'S TAG, recorded by the app at signing and never
// checked against the chain; they are printed as the author's words
// ("Tagged by the author: bought ETH"), never under the verified mark.

import { chainById } from '@/lib/chains'
import type { TradeProof } from './spec'

export const TX_HASH_RE = /^0x[0-9a-f]{64}$/

/** The registry's explorer link for a hash on a chain (S2: the ONLY tx link we
 *  emit). null = not a registry chain or not a hash. */
export function explorerTxFor(chainId: number | null | undefined, txHash: string | null | undefined): string | null {
  const c = typeof chainId === 'number' ? chainById(chainId) : null
  const h = typeof txHash === 'string' ? txHash.toLowerCase() : ''
  if (!c || !c.explorerTx || !TX_HASH_RE.test(h)) return null
  return `${c.explorerTx}${h}`
}

/** The registry's name for a chain id (never a stored label). */
export function chainNameFor(chainId: number | null | undefined): string | null {
  return typeof chainId === 'number' ? chainById(chainId)?.name ?? null : null
}

/** true = this proof's link is exactly the registry's rebuild of its own chain + hash. */
export function proofLinkIsRebuilt(p: Pick<TradeProof, 'chainId' | 'txHash' | 'txUrl'>): boolean {
  const r = explorerTxFor(p.chainId, p.txHash)
  return !!r && p.txUrl === r
}

/** "$25.00", "$1,250.00" — the on-chain size, to the cent. */
export function fmtProofDollars(n: number): string {
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** The chain-confirmed line: "Verified on-chain: this wallet moved $25.00 on Base"
 *  (or "moved funds on Base" when the author hid the size). */
export function proofFactLine(p: Pick<TradeProof, 'sizeUsd' | 'chain'>): string {
  const size = typeof p.sizeUsd === 'number' && Number.isFinite(p.sizeUsd) && p.sizeUsd > 0 ? fmtProofDollars(p.sizeUsd) : null
  return `Verified on-chain: this wallet moved ${size ?? 'funds'} on ${p.chain}`
}

const SIDE_WORD: Record<NonNullable<TradeProof['side']>, string> = { buy: 'bought', sell: 'sold', long: 'went long', short: 'went short' }

/** The market the author's tag names ("buy:ETH" → "ETH"), or ''. */
export function tagMarket(p: Pick<TradeProof, 'symbols'>): string {
  const tagged = (p.symbols ?? []).find((s) => typeof s === 'string' && /^(buy|sell):[A-Za-z0-9.:]{1,24}$/.test(s))
  return tagged ? tagged.split(':').slice(1).join(':') : ''
}

/** The author's own tag in plain words ("bought ETH"), or null when there is none. */
export function proofTag(p: Pick<TradeProof, 'symbols' | 'side'>): string | null {
  const market = tagMarket(p)
  if (!market) return null
  return `${p.side ? SIDE_WORD[p.side] : 'traded'} ${market}`
}

/** "Tagged by the author: bought ETH" — the tag, worded as the author's. */
export function proofTagLine(p: Pick<TradeProof, 'symbols' | 'side'>, who = 'the author'): string | null {
  const tag = proofTag(p)
  return tag ? `Tagged by ${who}: ${tag}` : null
}

/** A trade post's DEFAULT title (the author typed none): built from the proof,
 *  in the same two-part wording. ≤ 120 characters. */
export function defaultTradeTitle(p: Pick<TradeProof, 'symbols' | 'side' | 'sizeUsd' | 'chain'>): string {
  const tag = proofTagLine(p)
  return `${tag ? `${tag}. ` : ''}${proofFactLine(p)}.`.slice(0, 120)
}
