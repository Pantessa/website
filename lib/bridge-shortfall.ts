// lib/bridge-shortfall.ts — the last chipless wall.
//
// `Swap 5 USDC from Base to Arbitrum` on a wallet holding $342 of USDT ON
// ARBITRUM answered (no-dead-ends squad, QA's `bridge/usdt`, the one red the
// round-1 WRAP left):
//
//   🔄 Nothing to sign yet: this would spend 5 USDC on Base and the wallet
//      holds 0 USDC there. Send USDC to this wallet on Base…
//
// Two things wrong with that, and only one of them is the missing chip:
//
//  1. it never names the $342 — invariant clause 4 says a refusal names every
//     holding ≥ $0.50;
//  2. the visitor asked to move stables TO Arbitrum while already holding
//     stables ON Arbitrum. The bridge they asked for is the expensive way to
//     get something they can have for a venue swap, or already have.
//
// FUND's read was that a bridge-only need has no action to restate, so no
// funding chip can carry it (a plan that funds Base in order to bridge back
// to Arbitrum is a round trip). True — and it is also not the answer. The
// answer is the destination: fix the ORIGIN of the bridge, or skip the bridge
// entirely. Every chip below is composed from the ask and the wallet, never
// invented, and verified against the real ladder before it is offered.
//
// PURE. Balances in, sentences + verified chips out.

import type { ClarifyOption } from '@/lib/clarify'
import type { CrossChainSwapParams } from '@/lib/cross-chain-swap'
import type { FundingSource } from '@/lib/funding-plan'
import { fundChipFor } from '@/lib/onramp'

export interface BridgeChip {
  label: string
  resume: string
}

export interface BridgeAlternatives {
  /** Sentences appended to the refusal — what the wallet DOES hold, and
   *  whether the destination already has what was asked for. */
  lines: string[]
  chips: BridgeChip[]
}

/** Holdings this module will talk about at all. Below it, a balance is dust
 *  that would cost more in gas than it is worth (the funding scan's own
 *  DUST_USD) — and invariant clause 4's floor. */
export const BRIDGE_NAME_FLOOR_USD = 0.5

/** The smallest move worth offering. Below the funding layer's own minimum
 *  plan a leg costs more than it carries (lib/funding-plan
 *  FUNDING_MIN_PLAN_USD), so a chip for it would be a button that refuses. */
export const MIN_MOVE_USD = 2

/** A dollar-pegged token — the parity rule's whole basis. */
export const isStableSymbol = (symbol: string): boolean => /^(?:usd[ctgse]?|usdc\.e|usdt0|dai|frax|pyusd)$/i.test(symbol)

const norm = (s: string) => s.trim().toLowerCase()
const money = (usd: number) => (usd >= 100 ? `$${Math.round(usd)}` : `$${usd.toFixed(2)}`)

/** The chain word a resume must use, from the scan's own vocabulary. */
const chainWordOf = (s: FundingSource) => s.chainWord

/** Does this source's chain match the name the ask used? The scan words and
 *  the parser's words are both free text ("robinhood chain" / "arbitrum"),
 *  so compare on the significant prefix. */
function sameChain(word: string, asked: string): boolean {
  const a = norm(word).replace(/\s+chain$/, '')
  const b = norm(asked).replace(/\s+chain$/, '')
  // An empty name is not a chain: a prefix test against '' matches every
  // chain there is, which silently excluded every source from the re-origin
  // rule when the caller had no origin to give (audit:funding's bridge-only
  // cells, where the need names a destination and nothing else).
  if (!a || !b) return false
  return a === b || a.startsWith(b) || b.startsWith(a)
}

/**
 * What to say and what to offer when a cross-chain move can't be paid for.
 *
 * Four readings, in the order a person would think of them:
 *
 *  1. the destination ALREADY holds the token asked for → say so first; the
 *     cheapest move is the one you don't make;
 *  2. the token is held on ANOTHER chain → bridge it from where it actually
 *     is (the ask, re-origined);
 *  3. another stable sits ON the destination → swap it there, no bridge at
 *     all;
 *  4. another stable sits on another chain → bridge that one instead.
 *
 * `verify` is the ladder (`buildsNatively`): a chip that would land in the
 * planner is never offered, so this can't replace one dead end with another.
 */
export function bridgeAlternatives(input: {
  parsed: Pick<CrossChainSwapParams, 'amount' | 'originToken' | 'originChain' | 'destinationToken' | 'destinationChain'>
  /** Movable holdings (FundingScan.sources). */
  sources: FundingSource[]
  /** Holdings with no gas on their chain to move them (FundingScan.stranded).
   *  Named, never planned — the #499 rule. */
  stranded?: FundingSource[]
  verify: (ask: string) => boolean
}): BridgeAlternatives {
  const { parsed, sources, verify } = input
  const stranded = input.stranded ?? []
  const from = parsed.originToken.toUpperCase()
  const want = parsed.destinationToken.toUpperCase()
  const dest = parsed.destinationChain
  const asked = Number(parsed.amount)
  const lines: string[] = []
  const chips: BridgeChip[] = []
  const push = (resume: string, label: string) => {
    if (chips.length >= 3) return
    if (chips.some((c) => norm(c.resume) === norm(resume))) return
    if (verify(resume)) chips.push({ label, resume })
  }
  const movable = sources.filter((s) => s.usd >= MIN_MOVE_USD).sort((a, b) => b.usd - a.usd)
  /**
   * How much of THIS source to move, in ITS OWN units.
   *
   * The parity rule: an amount is never carried from one symbol to another by
   * substitution. "5 USDC" may become "5 USDT" because both are dollars — it
   * must never become "5 ETH", which is what a naive rewrite would put on a
   * chip for a wallet holding ETH. So the dollars come from the ask (the short
   * token is dollar-pegged, which is the only branch that reaches here) and
   * the units come from the scan's own measured usd ÷ balance for that
   * holding. A source that can't cover the whole ask offers what it HAS: a
   * smaller move is still a next step that works, and it is the funding
   * layer's own "all my X" idiom.
   */
  const sizeOf = (s: FundingSource) => {
    if (!Number.isFinite(asked) || asked <= 0 || s.usd < MIN_MOVE_USD || !(s.balance > 0)) return null
    const takeUsd = Math.min(asked, s.usd)
    const perUnit = s.usd / s.balance
    if (!Number.isFinite(perUnit) || perUnit <= 0) return null
    const units = takeUsd / perUnit
    const amount = isStableSymbol(s.token) ? (Math.floor(units * 100) / 100).toFixed(2).replace(/\.?0+$/, '') : String(Number(units.toPrecision(4)))
    if (!(Number(amount) > 0)) return null
    return { amount, all: takeUsd < asked - 0.01 }
  }
  const partly = (all: boolean) => (all ? ' (what you have)' : '')

  // 1. Already there. The destination holding is the answer to the ask.
  const atDest = sources
    .concat(stranded)
    .find((s) => sameChain(chainWordOf(s), dest) && s.token.toUpperCase() === want && (!Number.isFinite(asked) || s.balance >= asked))
  if (atDest) {
    lines.push(
      `And you may already have what you asked for: this wallet holds ${money(atDest.usd)} of ${atDest.token} on ${atDest.chainWord} — the chain you asked to move it to.`,
    )
  }

  // 2. The SAME token, somewhere else: the ask with its origin corrected.
  const elsewhere = movable.find(
    (s) => s.token.toUpperCase() === from && !sameChain(chainWordOf(s), dest) && !sameChain(chainWordOf(s), parsed.originChain),
  )
  const es = elsewhere ? sizeOf(elsewhere) : null
  if (elsewhere && es) {
    const tail = want === from ? dest : `${want} on ${dest}`
    push(`Swap ${es.amount} ${from} from ${elsewhere.chainWord} to ${tail}`, `Move it from ${elsewhere.chainWord} instead${partly(es.all)}`)
  }

  // 3. A different stable already ON the destination: a venue swap, no bridge.
  const atDestOther = movable.find((s) => sameChain(chainWordOf(s), dest) && s.token.toUpperCase() !== want)
  const as_ = atDestOther ? sizeOf(atDestOther) : null
  if (atDestOther && as_) {
    push(
      `Swap ${as_.amount} ${atDestOther.token} for ${want} on ${atDestOther.chainWord}`,
      `Swap the ${atDestOther.token} you already hold on ${atDestOther.chainWord}${partly(as_.all)}`,
    )
  }

  // 4. A different stable elsewhere: bridge that one instead.
  const otherElsewhere = movable.find((s) => !sameChain(chainWordOf(s), dest) && s.token.toUpperCase() !== from)
  const os = otherElsewhere ? sizeOf(otherElsewhere) : null
  if (otherElsewhere && os) {
    push(
      `Swap ${os.amount} ${otherElsewhere.token} from ${otherElsewhere.chainWord} to ${want} on ${dest}`,
      `Send ${otherElsewhere.token} from ${otherElsewhere.chainWord} instead${partly(os.all)}`,
    )
  }

  return { lines, chips }
}

/**
 * The card door for a move nothing in the wallet can pay for — the empty-wallet
 * half of the same wall (#791/#795's chip, on the one layer that never got it).
 *
 * A bridge has no follow-up segment to restate, which is why the funding layer
 * has always left this door to the surface (audit:funding's 8 documented
 * bridge-only cells). The surface is here, and the resume it can honestly give
 * is the move itself, re-origined onto the chain the card delivers to: the
 * money lands as ETH on the on-ramp's lane, and that ETH goes where the
 * visitor asked it to go.
 *
 * Returns null when the on-ramp is off, when the composed resume doesn't
 * round-trip the ladder, or when the amount isn't a number — never a button
 * that can't do what it says.
 */
export function bridgeCardChip(input: {
  amount: string
  destToken: string
  destChain: string
  /** The on-ramp's landing chain, in the funding vocabulary ('ethereum'). */
  landsOn: string
  /** What the scan priced ETH at (FundingScan.ethUsd). A move is sized in the
   *  token it moves — the cross-chain grammar has no dollar form for ETH —
   *  so with no price there is no honest resume and no chip. */
  ethUsd: number | null | undefined
  verify: (ask: string) => boolean
}): ClarifyOption | null {
  const usd = Number(input.amount)
  if (!Number.isFinite(usd) || usd <= 0) return null
  const want = input.destToken.toUpperCase()
  const dest = input.destChain
  // Same chain as the delivery = a venue swap, and that grammar takes dollars.
  // Anywhere else = the move, sized in ETH at the price the scan just read.
  // The preset's own headroom (planFundUsd: +10% +$1) is what covers a price
  // move between composing this and the visitor coming back; if it moves
  // further than that, the refusal they land on carries "move what you have".
  let resume: string
  if (sameChain(input.landsOn, dest)) {
    resume = `Swap $${Math.round(usd)} of ETH for ${want} on ${dest}`
  } else {
    const eth = Number(input.ethUsd)
    if (!Number.isFinite(eth) || eth <= 0) return null
    resume = `Swap ${Number((usd / eth).toPrecision(3))} ETH from ${input.landsOn} to ${want} on ${dest}`
  }
  if (!input.verify(resume)) return null
  return fundChipFor({ needUsd: usd, actionLabel: `move it to ${dest}`, resume })
}

/**
 * Invariant clause 4 as a sentence: every holding ≥ $0.50 the scan actually
 * read, named out loud. A refusal that stays silent about $342 is the bug
 * this squad exists for, whatever else it offers.
 *
 * Stranded holdings are named WITH their reason (no gas to move them), never
 * quietly dropped (#499).
 */
export function heldElsewhereLine(input: { sources: FundingSource[]; stranded?: FundingSource[]; failedChains?: string[] }): string | null {
  const say = (s: FundingSource) => `${money(s.usd)} of ${s.token} on ${s.chainWord}`
  const movable = input.sources.filter((s) => s.usd >= BRIDGE_NAME_FLOOR_USD).sort((a, b) => b.usd - a.usd)
  const stuck = (input.stranded ?? []).filter((s) => s.usd >= BRIDGE_NAME_FLOOR_USD).sort((a, b) => b.usd - a.usd)
  const parts: string[] = []
  if (movable.length) parts.push(`What this wallet does hold: ${movable.slice(0, 5).map(say).join(', ')}.`)
  if (stuck.length) parts.push(`${stuck.slice(0, 3).map(say).join(', ')} ${stuck.length > 1 ? 'are' : 'is'} there too, with no ETH on that chain to move ${stuck.length > 1 ? 'them' : 'it'}.`)
  if (!parts.length && (input.failedChains ?? []).length) {
    parts.push(`I couldn't read ${(input.failedChains ?? []).join(', ')} just now, so there may be more there than I can see.`)
  }
  return parts.length ? parts.join(' ') : null
}
