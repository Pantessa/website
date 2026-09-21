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

import type { CrossChainSwapParams } from '@/lib/cross-chain-swap'
import type { FundingSource } from '@/lib/funding-plan'

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
  const amount = parsed.amount
  const want = parsed.destinationToken.toUpperCase()
  const dest = parsed.destinationChain
  const lines: string[] = []
  const chips: BridgeChip[] = []
  const push = (resume: string, label: string) => {
    if (chips.length >= 3) return
    if (chips.some((c) => norm(c.resume) === norm(resume))) return
    if (verify(resume)) chips.push({ label, resume })
  }
  const wanted = Number(amount)
  const enough = (s: FundingSource) => !Number.isFinite(wanted) || s.balance >= wanted

  // 1. Already there. The destination holding is the answer to the ask.
  const atDest = sources.concat(stranded).find((s) => sameChain(chainWordOf(s), dest) && s.token.toUpperCase() === want && enough(s))
  if (atDest) {
    lines.push(
      `And you may already have what you asked for: this wallet holds ${money(atDest.usd)} of ${atDest.token} on ${atDest.chainWord} — the chain you asked to move it to.`,
    )
  }

  // 2. The same token, somewhere else: the ask with its origin corrected.
  const elsewhere = sources
    .filter((s) => s.token.toUpperCase() === want && !sameChain(chainWordOf(s), dest) && !sameChain(chainWordOf(s), parsed.originChain) && enough(s))
    .sort((a, b) => b.usd - a.usd)[0]
  if (elsewhere) push(`Swap ${amount} ${want} from ${elsewhere.chainWord} to ${dest}`, `Move it from ${elsewhere.chainWord} instead`)

  // 3. A different stable already ON the destination: a venue swap, no bridge.
  const otherAtDest = sources
    .filter((s) => sameChain(chainWordOf(s), dest) && s.token.toUpperCase() !== want && enough(s))
    .sort((a, b) => b.usd - a.usd)[0]
  if (otherAtDest) push(`Swap ${amount} ${otherAtDest.token} for ${want} on ${otherAtDest.chainWord}`, `Swap ${otherAtDest.token} you already hold on ${otherAtDest.chainWord}`)

  // 4. A different stable elsewhere: bridge that one instead.
  const otherElsewhere = sources
    .filter((s) => !sameChain(chainWordOf(s), dest) && s.token.toUpperCase() !== want && enough(s))
    .sort((a, b) => b.usd - a.usd)[0]
  if (otherElsewhere) push(`Swap ${amount} ${otherElsewhere.token} from ${otherElsewhere.chainWord} to ${want} on ${dest}`, `Send ${otherElsewhere.token} from ${otherElsewhere.chainWord} instead`)

  return { lines, chips }
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
