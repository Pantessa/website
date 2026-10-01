// ─────────────────────────────────────────────────────────────────────────
//  The ledger's record of a creator share that was paid INSIDE a swap
//  (lib/creator-split). Without it the creator would be paid twice: once by
//  the router, and again when the claim ledger counts the same signed turn.
//
//  The record is a `paid` claim row keyed on the transaction hash, written
//  only from what the CHAIN says: a successful transaction, sent by the
//  signing wallet to the chain's pinned SwapRouter02, whose receipt shows a
//  registry stable moving from the router to the creator the ledger already
//  attributes this turn to. Nothing here trusts the beacon, so a forged
//  "the creator was paid" can never eat a creator's claimable balance.
//
//  Lockstep with the earnings readers (/api/intent-links, /claims): the
//  creator checked here is the one THEY would credit this row to — the row's
//  link, else the wallet's first-touch referral. A swap that paid a creator
//  the ledger does not credit (a link-born job step, whose row carries no
//  slug) records nothing, because the ledger earns nothing for it either.
// ─────────────────────────────────────────────────────────────────────────

import { chainById } from '@/lib/chains'

/** keccak256("Transfer(address,address,uint256)") */
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'

const topicAddr = (t: string | undefined) => (t && t.length === 66 ? `0x${t.slice(26)}`.toLowerCase() : '')

/** Claim-row id for an on-chain payout — one per transaction, so a repeated
 *  beacon (or the lazy re-check) can never record it twice. */
export const onchainClaimId = (txHash: string) => `onchain-${txHash.toLowerCase()}`
export const ONCHAIN_CLAIM_PREFIX = 'onchain-'

/**
 * Dollars of registry stables a receipt moved from the router to the creator.
 * Pure. Stables count at face value, like every other stable-side read.
 */
export function creatorPaidUsdFromLogs(
  logs: readonly { address: string; topics: readonly string[]; data: string }[],
  facts: { router: string; creator: string; stables: Readonly<Record<string, number>> },
): number {
  const router = facts.router.toLowerCase()
  const creator = facts.creator.toLowerCase()
  let usd = 0
  for (const log of logs) {
    const dec = facts.stables[log.address.toLowerCase()]
    if (dec === undefined) continue
    if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC || log.topics.length !== 3) continue
    if (topicAddr(log.topics[1]) !== router || topicAddr(log.topics[2]) !== creator) continue
    try {
      const v = Number(BigInt(log.data)) / 10 ** dec
      if (Number.isFinite(v) && v > 0) usd += v
    } catch {
      /* unreadable amount → not counted */
    }
  }
  return usd
}

/**
 * Record the creator share a verified swap paid on-chain, if it paid one.
 * Returns the dollars recorded (0 = nothing to record). Fail-soft: a miss
 * here leaves the turn on the ordinary ledger and can be retried, since the
 * row id is the transaction hash.
 */
export async function recordCreatorPaidOnchain(turn: {
  /** The embed_turns row's link slug (null for an unattributed turn). */
  intentLinkSlug?: string | null
  wallet: string
  chainId: number
  txHash: string
}): Promise<number> {
  try {
    const chain = chainById(turn.chainId)
    if (!chain?.uniswap || !/^0x[0-9a-fA-F]{64}$/.test(turn.txHash)) return 0
    const wallet = turn.wallet.toLowerCase()
    const { default: prisma } = await import('@/lib/db')
    // The creator the LEDGER credits this row to (see the header).
    let creator: string | null = null
    if (turn.intentLinkSlug) {
      const link = await prisma.intentLink.findUnique({ where: { id: turn.intentLinkSlug }, select: { creator: true } })
      creator = link?.creator ?? null
    } else {
      const ref = await prisma.referredWallet.findUnique({ where: { wallet }, select: { creator: true } })
      creator = ref?.creator ?? null
    }
    if (!creator || creator.toLowerCase() === wallet) return 0

    const { receiptClientFor } = await import('@/lib/link-receipt-verify')
    const client = receiptClientFor(turn.chainId)
    if (!client) return 0
    const receipt = await client.getTransactionReceipt({ hash: turn.txHash as `0x${string}` })
    // The router the transaction was sent to — v3's SwapRouter02 or the v4
    // Universal Router, both registry-pinned. Anything else is not our swap.
    const router = [chain.uniswap.swapRouter02, chain.uniswapV4?.universalRouter].find((r) => r && r.toLowerCase() === receipt.to?.toLowerCase())
    if (receipt.status !== 'success' || receipt.from.toLowerCase() !== wallet || !router) return 0
    const usd = creatorPaidUsdFromLogs(receipt.logs, { router, creator, stables: chain.stables })
    if (!(usd > 0)) return 0

    await prisma.intentLinkClaim.createMany({
      data: [
        {
          id: onchainClaimId(turn.txHash),
          creator: creator.toLowerCase(),
          amountUsd: usd,
          status: 'paid',
          txUrl: chain.explorerTx ? `${chain.explorerTx}${turn.txHash}` : null,
        },
      ],
      skipDuplicates: true,
    })
    return usd
  } catch {
    return 0
  }
}
