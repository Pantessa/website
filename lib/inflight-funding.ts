// ─────────────────────────────────────────────────────────────────────────
//  In-flight funding awareness — the settlement-window blind spot.
//
//  Live 2026-07-21: a user signed a NEAR Intents deposit moving $12 of USDC
//  Base → Arbitrum, asked to buy stock ~60 seconds later, and the funding
//  scan (a plain balance read) saw an empty destination and told them
//  "no USDC on Base, Ethereum, or Arbitrum" — asserting money they had just
//  sent didn't exist. The scan wasn't wrong about the chain state; it was
//  wrong to present a mid-settlement snapshot as the whole truth.
//
//  The fix is awareness, not action: when the conversation's working context
//  carries a just-built cross-chain deposit toward a funding origin (the
//  `xchain` pending from lib/cross-chain-swap.ts, or the same facts forwarded
//  on a `rh-funding` pending), the refusal copy names the transfer as
//  possibly-still-settling and points at "check again" (which the rh-funding
//  pending already turns into a deterministic re-scan). Optionally we probe
//  the NEAR Intents one-click status by deposit address — the exact read the
//  jobs runner's `oneclick` wait predicate does — to say WHERE it is:
//  settling, settled (balance reads lag), never funded, or refunded.
//
//  Everything here is fail-soft and read-only. A failed probe degrades to
//  hedged copy; nothing here builds, signs, or blocks the refusal itself.
// ─────────────────────────────────────────────────────────────────────────

import { isAddress } from 'viem'
import { callMcpTool } from '@/lib/mcp-call'

/** Same service the jobs runner polls (lib/jobs-runner.ts kind 'oneclick'). */
const NEAR_INTENTS_MCP = 'https://near-intents.yeetful.com/mcp'

/** A cross-chain deposit the user recently built toward a funding origin. */
export interface InflightDeposit {
  /** The one-time deposit address — the status key on the one-click API. */
  depositAddress: string
  /** Human amount + token as the user asked ("12", "USDC"). */
  amount: string
  token: string
  /** Display words for the route ("Base" → "Arbitrum"). */
  originChain: string
  destinationChain: string
}

// The chain words the cross-chain grammar can put in `destinationChain`
// (lib/cross-chain-swap.ts CHAIN_ALT), narrowed to the FUNDING ORIGINS a
// Robinhood scan reads (lib/lifi-bridge.ts FUNDING_ORIGIN_CHAINS). A deposit
// toward any other chain can't explain an empty funding scan, so it never
// produces a note.
const FUNDING_DEST_WORD: Record<string, string> = {
  base: 'Base',
  arbitrum: 'Arbitrum',
  arb: 'Arbitrum',
  arbitum: 'Arbitrum',
  arbitrium: 'Arbitrum',
  ethereum: 'Ethereum',
  mainnet: 'Ethereum',
  'eth mainnet': 'Ethereum',
  ethmainnet: 'Ethereum',
}

const displayChain = (word: string) => {
  const w = word.trim().toLowerCase().replace(/\s+/g, ' ')
  return FUNDING_DEST_WORD[w] ?? word.trim().replace(/^./, (c) => c.toUpperCase())
}

/**
 * Read a recently-built cross-chain deposit out of the echoed pending, when
 * (and only when) its destination is a funding origin. Two shapes carry one:
 *   · kind 'xchain' — lib/cross-chain-swap.ts crossChainPending, written when
 *     the deposit transfer was built (the user may have signed it seconds
 *     before this turn);
 *   · kind 'rh-funding' — a funding refusal that already knew about the
 *     deposit forwarded its facts (rhFundingPending's `inflight` param), so
 *     "check again" turns keep the awareness instead of losing it when the
 *     xchain pending is replaced.
 * Pure and conservative: no valid deposit address or a non-origin destination
 * → null, and the caller says nothing new.
 */
export function inflightDepositFromPending(
  pending: { kind: string; data: Record<string, string> } | undefined,
): InflightDeposit | null {
  if (!pending) return null
  const d = pending.data
  let raw: { depositAddress?: string; amount?: string; token?: string; origin?: string; dest?: string } | null = null
  if (pending.kind === 'xchain') {
    raw = { depositAddress: d.depositAddress, amount: d.amount, token: d.originToken, origin: d.originChain, dest: d.destinationChain }
  } else if (pending.kind === 'rh-funding') {
    raw = { depositAddress: d.inDeposit, amount: d.inAmount, token: d.inToken, origin: d.inOrigin, dest: d.inDest }
  }
  if (!raw?.depositAddress || !isAddress(raw.depositAddress)) return null
  if (!raw.amount || !raw.token || !raw.dest) return null
  const destKey = raw.dest.trim().toLowerCase().replace(/\s+/g, ' ')
  if (!FUNDING_DEST_WORD[destKey]) return null
  return {
    depositAddress: raw.depositAddress,
    amount: raw.amount,
    token: raw.token.toUpperCase(),
    originChain: displayChain(raw.origin ?? ''),
    destinationChain: FUNDING_DEST_WORD[destKey],
  }
}

/** The `data` fields a rh-funding pending carries so the NEXT turn's re-scan
 *  still knows about the deposit (see rhFundingPending in lib/lifi-bridge). */
export function inflightPendingData(dep: InflightDeposit): Record<string, string> {
  return {
    inDeposit: dep.depositAddress,
    inAmount: dep.amount,
    inToken: dep.token,
    inOrigin: dep.originChain,
    inDest: dep.destinationChain,
  }
}

export type InflightStatus = 'settling' | 'settled' | 'awaiting-deposit' | 'refunded' | 'unknown'

/**
 * Map a one-click status payload to what the refusal copy should claim.
 * Same coarse buckets the jobs runner trusts: SUCCESS is settled,
 * REFUNDED/FAILED means the money bounced back, PENDING_DEPOSIT means the
 * deposit was never (or not yet) seen — the user may not have signed — and
 * the known mid-flight states are "settling". Anything unrecognized is
 * 'unknown', which the copy hedges rather than asserts.
 */
export function classifyOneclickStatus(text: string): InflightStatus {
  if (/SUCCESS/.test(text)) return 'settled'
  if (/REFUNDED|FAILED/.test(text)) return 'refunded'
  if (/PENDING_DEPOSIT/.test(text)) return 'awaiting-deposit'
  if (/KNOWN_DEPOSIT_TX|PROCESSING|INCOMPLETE_DEPOSIT/.test(text)) return 'settling'
  return 'unknown'
}

/** Read-only status probe, fail-soft: any transport/tool trouble is
 *  'unknown' — the note hedges instead of blocking the refusal. */
export async function probeInflightStatus(depositAddress: string): Promise<InflightStatus> {
  try {
    const status = await callMcpTool(NEAR_INTENTS_MCP, 'check_status', { depositAddress }, { timeoutMs: 8_000 })
    return classifyOneclickStatus(typeof status === 'string' ? status : JSON.stringify(status))
  } catch {
    return 'unknown'
  }
}

/**
 * The one sentence a funding refusal appends so a mid-settlement snapshot is
 * never presented as the whole truth. Pure — the status decides the claim,
 * and every branch routes the user to "check again" (the rh-funding pending
 * re-runs the scan deterministically) rather than to a fresh ask.
 */
export function inflightSettlingNote(dep: InflightDeposit, status: InflightStatus): string {
  const route = `${dep.amount} ${dep.token} ${dep.originChain} → ${dep.destinationChain}`
  switch (status) {
    case 'settling':
      return `your ${route} transfer is still settling — cross-chain settlements usually land within a couple of minutes. Say “check again” shortly and I'll rescan with it counted.`
    case 'settled':
      return `your ${route} transfer has settled — balance reads can lag a few seconds behind, so say “check again” and I'll rescan.`
    case 'awaiting-deposit':
      return `the ${route} transfer you set up hasn't reported its deposit yet — if you just signed it, give it a minute and say “check again”; if you never signed it, the money hasn't moved.`
    case 'refunded':
      return `heads up — the ${route} transfer was refunded, so those funds are back on ${dep.originChain}.`
    case 'unknown':
      return `you set up a ${route} transfer just now — if you signed it, it may still be settling (a minute or two is normal). Say “check again” and I'll rescan.`
  }
}

/**
 * Detection + probe + copy in one fail-soft read: null when the pending
 * carries no funding-origin deposit, otherwise the deposit, where the
 * one-click API says it is, and the sentence to append to the refusal.
 */
export async function describeInflightDeposit(
  pending: { kind: string; data: Record<string, string> } | undefined,
): Promise<{ dep: InflightDeposit; status: InflightStatus; note: string } | null> {
  const dep = inflightDepositFromPending(pending)
  if (!dep) return null
  const status = await probeInflightStatus(dep.depositAddress)
  return { dep, status, note: inflightSettlingNote(dep, status) }
}
