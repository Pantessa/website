// ─────────────────────────────────────────────────────────────────────────
//  The creator's share, paid INSIDE the swap (2026-10-01).
//
//  Until now a link creator's half of the fee was a ledger entry: the whole
//  fee landed in the treasury and the creator claimed USDC later, past a $10
//  floor. On Uniswap the router can pay two parties in one transaction, so
//  the creator's half now leaves the swap itself and lands in their wallet
//  when it fills. Nothing to claim, nothing for us to hold.
//
//  The share is paid on the STABLE side of the pair wherever one exists
//  (Nate, 2026-10-01): a creator should receive dollars, not slivers of
//  AAPL. A pair with no stable side keeps the ledger.
//
//    stable IN  (a buy)   the router pulls the creator's cut of the input
//                         and hands it over, then swaps the rest; the
//                         treasury's half still comes off the output.
//    stable OUT (a sell)  the output parks on the router and is split
//                         three ways: creator, treasury, the seller.
//
//  WHO the creator is never comes from the client. It is read here, from
//  the link row (a link-born turn) or the wallet's write-once first-touch
//  referral (every later trade). The builders take the resolved address and
//  their guards pin it.
// ─────────────────────────────────────────────────────────────────────────

import { chainById } from '@/lib/chains'
import { CREATOR_FEE_SPLIT, TREASURY_ADDRESS } from '@/lib/fees'
import { INTENT_SLUG_RE } from '@/lib/intent-links'

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/

/** Kill switch: CREATOR_SPLIT_ONCHAIN=off sends every creator share back to
 *  the ledger (the pre-2026-10-01 behaviour) without a deploy of code. */
export function creatorSplitEnabled(): boolean {
  return (process.env.CREATOR_SPLIT_ONCHAIN ?? 'on').toLowerCase() !== 'off'
}

/** The creator's share of a fee tier, in whole bps (20 → 10, 50 → 25). The
 *  treasury keeps the remainder, so the two always sum to the tier. */
export function creatorBpsFor(feeBps: number): number {
  if (!Number.isInteger(feeBps) || feeBps <= 0) return 0
  return Math.floor(feeBps * CREATOR_FEE_SPLIT)
}

export type StableSide = 'in' | 'out'

/** Which side of a same-chain pair is a registry stable. Input wins when
 *  both are (a stable-for-stable swap). `nativeOut` rules the output side
 *  out: native ETH is never the stable. null → no stable side, no split. */
export function stableSideOf(chainId: number, sellAddr: string, buyAddr: string, nativeOut = false): StableSide | null {
  const stables = chainById(chainId)?.stables
  if (!stables) return null
  if (stables[sellAddr.toLowerCase()] !== undefined) return 'in'
  if (!nativeOut && stables[buyAddr.toLowerCase()] !== undefined) return 'out'
  return null
}

/** What a built swap pays its creator on-chain. Rides the built result, the
 *  refresh recipe (as a stamp) and the money row. */
export interface CreatorPaid {
  address: string
  bps: number
  side: StableSide
}

/** A resolved creator is payable only when it is a real, distinct party:
 *  never the trader (no self-rebate), never the treasury, never a router or
 *  the zero address. Pure — the builders and their guards both call it. */
export function payableCreator(creator: string | null | undefined, trader: string, also: readonly string[] = []): string | null {
  if (!creator || !ADDR_RE.test(creator)) return null
  const c = creator.toLowerCase()
  if (/^0x0{38}[0-9a-f]{2}$/.test(c)) return null // zero + the router sentinels
  const banned = [trader, TREASURY_ADDRESS, ...also].map((a) => a.toLowerCase())
  return banned.includes(c) ? null : c
}

/**
 * The creator this wallet's swap pays, or null (→ the whole fee goes to the
 * treasury and the ledger decides, exactly as before).
 *
 * A live link slug wins (the trade was born on that link); otherwise the
 * wallet's first-touch referral. Internal (harness) links and revoked links
 * pay nobody. Any lookup failure falls back to null: a database hiccup must
 * never change who a transaction pays in a way nobody can audit later.
 */
export async function resolveCreatorPayout(input: { wallet: string; linkSlug?: string | null }): Promise<string | null> {
  if (!creatorSplitEnabled()) return null
  if (!ADDR_RE.test(input.wallet)) return null
  try {
    const { default: prisma } = await import('@/lib/db')
    if (input.linkSlug && INTENT_SLUG_RE.test(input.linkSlug)) {
      const link = await prisma.intentLink.findUnique({
        where: { id: input.linkSlug },
        select: { creator: true, revoked: true, isInternal: true },
      })
      if (link && !link.revoked && !link.isInternal && link.creator) return payableCreator(link.creator, input.wallet)
      // A slug that names no payable link falls through to the referral.
    }
    const ref = await prisma.referredWallet.findUnique({ where: { wallet: input.wallet.toLowerCase() }, select: { creator: true } })
    return ref ? payableCreator(ref.creator, input.wallet) : null
  } catch {
    return null
  }
}
