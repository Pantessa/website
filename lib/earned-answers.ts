// Every trade you sign refills your chat (pricing v2).
//
// A VERIFIED signed receipt grants banked answers from the fee it paid:
// 1 answer per EARN_CENTS_PER_ANSWER cents of NET fee (lib/plans). COGS ≤ fee
// by construction — that is the whole point of the rate.
//
// WHAT THE GRANT TRUSTS. The `signed` beacon is the browser's word. The
// receipt verifier (lib/link-receipt-verify) already proves the hard parts —
// the tx succeeded, the signer sent it, it is single-use, and its `to` +
// selector match an artifact WE built for that wallet. What it does NOT prove
// is the beacon's `valueUsd`, `buildPath` or `feeBps`: a real $1 swap could
// claim $1,000,000 and mint 100,000 answers. So the grant re-derives both
// from the chain:
//
//   - FEE-BEARING: the tx's `to` must be one of OUR fee-carrying venue
//     routers on that chain (Uniswap v3 SwapRouter02, the v4 Universal
//     Router). A send, an approval, a supply or a bridge leg can claim any
//     build path it likes; its `to` is not a router, so it earns nothing.
//   - NOTIONAL: min(claimed, what the receipt shows the SIGNER moved) — the
//     largest stable transfer in or out of the wallet, the native value sent,
//     or the wrapped-native leg, priced on-chain. Unreadable = no grant.
//   - A per-receipt ceiling and a per-wallet daily ceiling bound what any
//     trick that survives the above can mint. A flash-loaned wash pays pool
//     fees far above the inference it could earn under those ceilings.
//
// The grant is a BONUS, never money owed: every doubt resolves to zero, and
// nothing here can fail a beacon. CoW orders, Hyperliquid fills and LiFi
// settlements have no single EVM receipt carrying our fee (verdict
// `attested`), so they do not earn yet — said plainly on /pricing.

import { decodeEventLog, erc20Abi, formatUnits } from 'viem'
import { chainById, gasIsStable } from '@/lib/chains'
import { answersEarnedByFee } from '@/lib/plans'
import { CREATOR_FEE_SPLIT, LINK_SWAP_FEE_BPS, SWAP_FEE_BPS } from '@/lib/fees'

/** No single receipt earns more than this (a $2,500 organic swap). */
export const MAX_ANSWERS_PER_RECEIPT = 250
/** No wallet banks more than this per UTC day from trading. */
export const MAX_EARNED_PER_WALLET_DAY = 500

/** OUR fee-carrying routers on a chain, lowercased. */
export function feeRoutersFor(chainId: number): Set<string> {
  const chain = chainById(chainId)
  const out = new Set<string>()
  if (chain?.uniswap) out.add(chain.uniswap.swapRouter02.toLowerCase())
  if (chain?.uniswapV4) out.add(chain.uniswapV4.universalRouter.toLowerCase())
  return out
}

export interface EarnInputs {
  /** The beacon's claim (guardrail-priced client side, self-reported). */
  claimedUsd: number
  /** What the receipt shows the signer moved; null = unreadable. */
  onChainUsd: number | null
  /** The tx's `to` is one of our fee-carrying routers. */
  viaFeeRouter: boolean
  /** The turn rode an intent link (the 0.50% tier, half to the creator). */
  linkTier: boolean
}

/** Pure: how many answers a receipt earns. */
export function answersForReceipt(i: EarnInputs): number {
  if (!i.viaFeeRouter || i.onChainUsd === null || !(i.onChainUsd > 0) || !(i.claimedUsd > 0)) return 0
  // 5% grace: the client prices at build time, the chain at read time.
  const usd = Math.min(i.claimedUsd, i.onChainUsd * 1.05)
  // NET to Pantessa: the organic tier whole; the link tier minus the creator's
  // half. Read from the tier, never from the beacon's feeBps.
  const netBps = i.linkTier ? LINK_SWAP_FEE_BPS * (1 - CREATOR_FEE_SPLIT) : SWAP_FEE_BPS
  return Math.min(MAX_ANSWERS_PER_RECEIPT, answersEarnedByFee((usd * netBps) / 10_000))
}

const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b0fc378daa952ba7f163c4a11628f55a4df523b3ef'

/** What the receipt shows `wallet` moved, in USD. null when it cannot tell. */
export async function onChainNotionalUsd(chainId: number, txHash: string, wallet: string): Promise<{ usd: number | null; to: string | null }> {
  const chain = chainById(chainId)
  if (!chain) return { usd: null, to: null }
  const { receiptClientFor } = await import('@/lib/link-receipt-verify')
  const client = receiptClientFor(chainId)
  if (!client) return { usd: null, to: null }
  const who = wallet.toLowerCase()
  const [tx, receipt] = await Promise.all([
    client.getTransaction({ hash: txHash as `0x${string}` }),
    client.getTransactionReceipt({ hash: txHash as `0x${string}` }),
  ])
  if (!tx || !receipt || receipt.status !== 'success' || tx.from.toLowerCase() !== who) return { usd: null, to: tx?.to?.toLowerCase() ?? null }

  const wrapped = chain.wrappedNative.toLowerCase()
  let stableUsd = 0
  let wrappedAtoms = BigInt(0)
  for (const log of receipt.logs) {
    if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC || log.topics.length !== 3) continue
    const token = log.address.toLowerCase()
    const stableDecimals = chain.stables[token]
    if (stableDecimals === undefined && token !== wrapped) continue
    let args: { from: string; to: string; value: bigint }
    try {
      args = decodeEventLog({ abi: erc20Abi, data: log.data, topics: log.topics, eventName: 'Transfer' }).args as typeof args
    } catch {
      continue
    }
    if (args.from.toLowerCase() !== who && args.to.toLowerCase() !== who) continue
    if (stableDecimals !== undefined) stableUsd = Math.max(stableUsd, Number(formatUnits(args.value, stableDecimals)))
    else if (args.value > wrappedAtoms) wrappedAtoms = args.value
  }

  // Native value sent with the call (an ETH-in swap), or the wrapped leg.
  const nativeAtoms = tx.value > wrappedAtoms ? tx.value : wrappedAtoms
  let nativeUsd = 0
  if (nativeAtoms > BigInt(0)) {
    if (gasIsStable(chain)) nativeUsd = Number(formatUnits(nativeAtoms, 18))
    else {
      const { usdPerToken } = await import('@/lib/usd-probe')
      const probe = await usdPerToken(chainId, 'ETH').catch(() => null)
      const px = probe?.usd ?? null
      if (px) nativeUsd = Number(formatUnits(nativeAtoms, 18)) * px
    }
  }
  const usd = Math.max(stableUsd, nativeUsd)
  return { usd: usd > 0 ? usd : null, to: tx.to?.toLowerCase() ?? null }
}

/**
 * Grant what a VERIFIED signed turn earned. Call only after the verifier said
 * `verified`, and never for an internal run. Fire-and-forget safe: resolves
 * to the number granted, 0 on any doubt, and never throws.
 */
export async function grantEarnedAnswers(turn: {
  id: string
  /** Who banks them: the embed host for a keyed embed turn, else the signer. */
  beneficiary: string
  wallet: string
  chainId: number
  txHash: string
  claimedUsd: number
  linkTier: boolean
}): Promise<number> {
  try {
    const { usd, to } = await onChainNotionalUsd(turn.chainId, turn.txHash, turn.wallet)
    const answers = answersForReceipt({
      claimedUsd: turn.claimedUsd,
      onChainUsd: usd,
      viaFeeRouter: !!to && feeRoutersFor(turn.chainId).has(to),
      linkTier: turn.linkTier,
    })
    if (answers <= 0) return 0
    const { default: prisma } = await import('@/lib/db')
    const { dayStartUTC } = await import('@/lib/inference-fuse')
    const today = await prisma.creditLedgerEntry.aggregate({
      where: { ownerAddress: turn.beneficiary.toLowerCase(), createdAt: { gte: dayStartUTC() }, delta: { gt: 0 }, reason: 'earned-by-trading' },
      _sum: { delta: true },
    })
    const room = MAX_EARNED_PER_WALLET_DAY - (today._sum.delta ?? 0)
    if (room <= 0) return 0
    const { grantAnswers } = await import('@/lib/billing')
    return await grantAnswers(turn.beneficiary, Math.min(answers, room), 'earned-by-trading', `earned:${turn.id}`)
  } catch {
    return 0
  }
}
