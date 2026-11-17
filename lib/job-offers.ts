// JOB OFFERS (squad lane1, the jobs audit, 2026-11-17; lane OFFERS).
//
// Prod, 2026-11-17: a new account holding 0 USDC on Base pressed the JOBS
// rail's empty-state button. The button was one hard-coded sentence ("Fund
// Robinhood Chain with $12 from Base including gas, then buy $10 of AAPL")
// offered to every wallet, and the job it made failed on step 1. Nate: "I
// just don't want broken suggestions happening anymore."
//
// The rule this file holds: a job the product SUGGESTS is one the wallet in
// front of it can run now, or it is not suggested. `jobOfferFor(facts)` reads
// what the wallet holds and returns the first catalog job it can run, worded
// from the chain where its money is and sized to it, or null.
//
// PURE and client-safe: no React, no chain reads, no server imports. The
// floors below are copies of lib/lifi-bridge's (a server module: grants, the
// DB), pinned equal by scripts/jobs-offers-pins.ts, where every sentence this
// file can emit is also compiled by lib/jobs compileJobAsk.
//
// THE CATALOG, on purpose one entry. It is the shape with the longest record
// of real completed runs on prod (fund -> wait -> buy on Robinhood Chain from
// Base, Ethereum and Optimism; last done 2026-11-03):
//
//   "Fund Robinhood Chain with $X from <origin> [including gas], then buy $10 of AAPL"
//
//   needs  USDC on ONE of Base / Arbitrum / Optimism >= X, and ETH there to
//          sign the legs. (Mainnet is left out: see JOB_OFFER_ORIGINS.)
//   X      = lib/lifi-bridge fundingNeedUsd(10, gas): $12.5 with the gas leg,
//            $10.5 without.
//   gas    "including gas" only when the wallet has no ETH on Robinhood Chain
//          (or that read failed: a spare $2 of gas is harmless, a buy with no
//          gas stalls).
//
// NOT in the catalog, and why:
//   - "2x Long $12 of HYPE on Hyperliquid, then protect my HYPE long with a
//     5% stop" has completed on prod, but it needs collateral on the wallet's
//     Hyperliquid account and no client hook knows that (prod's real failure:
//     "No withdrawable collateral on the Hyperliquid account"). It is never a
//     default. Typing it still works.
//   - a recurring buy: retired as a suggestion on 2026-09-16.
//   - other sizes: one size keeps the offer a sentence that has actually run.

import { FUNDING_ORIGIN_WORD } from '@/lib/funding-origins'
import { jobExpired } from '@/lib/job-status'
import { ROBINHOOD_CHAIN_ID } from '@/lib/lifi-destinations'

// ── Floors (copies of lib/lifi-bridge, pinned equal) ────────────────────────

/** The gas leg's dollars (lib/lifi-bridge GAS_LEG_USD). */
export const OFFER_GAS_LEG_USD = 2
/** The smallest value leg that fills (lib/lifi-bridge MIN_VALUE_LEG_USD). */
export const OFFER_MIN_VALUE_LEG_USD = 3
/** Bridge-fee headroom over the buy (lib/lifi-bridge FUNDING_MARGIN_BPS). */
export const OFFER_FUNDING_MARGIN_BPS = 400
/** ETH on Robinhood Chain under which a plan carries its own gas leg
 *  (lib/lifi-bridge RH_GAS_FLOOR_WEI, 0.0002 ETH). */
export const OFFER_DEST_GAS_FLOOR_ETH = 0.0002
/** ETH an origin needs before its USDC can be signed for there
 *  (lib/lifi-bridge ORIGIN_MIN_GAS_ETH, the offer's three chains). */
export const OFFER_ORIGIN_MIN_GAS_ETH: Readonly<Record<number, number>> = { 8453: 0.00003, 42161: 0.00003, 10: 0.00003 }

/** lib/lifi-bridge fundingNeedUsd, to the cent: the buy plus headroom, the
 *  gas leg when asked, rounded up to the next $0.50. */
export function offerFundUsd(buyUsd: number, includeGas: boolean): number {
  const value = Math.max(buyUsd * (1 + OFFER_FUNDING_MARGIN_BPS / 10_000), OFFER_MIN_VALUE_LEG_USD)
  return Math.ceil((value + (includeGas ? OFFER_GAS_LEG_USD : 0)) * 2) / 2
}

// ── The catalog ─────────────────────────────────────────────────────────────

/** Origins an offer may draw from, in tie order. The L2 funding origins only:
 *  Ethereum is a funding origin too, but its legs pay real L1 gas (dollars on
 *  a $10 buy, and the signing floor moves with the gas price), and the audit
 *  drive only ever built a mainnet-origin job for a rich wallet. A default
 *  must not depend on that margin, so mainnet is never offered. Typing a
 *  mainnet sentence still works. Among these the richest wins. */
export const JOB_OFFER_ORIGINS: readonly number[] = [8453, 42161, 10]

export const JOB_OFFER_BUY = { usd: 10, symbol: 'AAPL' } as const

/** The catalog's one sentence, for one origin and one gas state. The grammar
 *  is lib/jobs parseRobinhoodFunding's ("fund robinhood chain with $X from
 *  <origin>[ including gas]") followed by the funded buy. */
export function fundBuySentence(originChainId: number, includeGas: boolean): string {
  const origin = FUNDING_ORIGIN_WORD[originChainId]
  const fund = offerFundUsd(JOB_OFFER_BUY.usd, includeGas)
  return `Fund Robinhood Chain with $${fund} from ${origin}${includeGas ? ' including gas' : ''}, then buy $${JOB_OFFER_BUY.usd} of ${JOB_OFFER_BUY.symbol}`
}

/** Every sentence jobOfferFor can return (the pins compile each one). */
export const JOB_OFFER_SENTENCES: readonly string[] = JOB_OFFER_ORIGINS.flatMap((id) => [fundBuySentence(id, true), fundBuySentence(id, false)])

/** The sentence shown as an EXAMPLE (text, never a button) where no wallet
 *  is known: the hero reel's own shape, from Base, with the gas leg. */
export const JOB_OFFER_EXAMPLE: string = fundBuySentence(8453, true)

// ── Wallet facts ────────────────────────────────────────────────────────────

/** One chain of GET /api/wallet/balances, as the offer reads it. */
export interface JobOfferChain {
  chainId: number
  /** False = the read failed: unknown, never "empty". */
  ok: boolean
  /** The chain's primary stable and its balance in units (a stable: dollars). */
  stable?: { symbol: string; balance: number } | null
  nativeEth?: number
}

export interface JobOfferFacts {
  chains: readonly JobOfferChain[]
}

export interface JobOffer {
  id: 'fund-buy'
  /** The exact sentence the button sends. */
  ask: string
  originChainId: number
  originName: string
  fundUsd: number
  buyUsd: number
  symbol: string
  gasIncluded: boolean
  /** Steps the compiler makes of it (gas leg, value leg, wait, buy). */
  steps: number
  /** "Try a 4-step job" */
  label: string
  /** What the wallet holds that makes this one runnable, in plain words. */
  why: string
}

const money = (n: number): string => (Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`)

/** Does the wallet need the gas leg? No ETH on Robinhood Chain, or a read
 *  that failed (unknown is treated as "none": a spare gas leg is harmless). */
export function offerNeedsGas(facts: JobOfferFacts): boolean {
  const dest = facts.chains.find((c) => c.chainId === ROBINHOOD_CHAIN_ID)
  if (!dest || !dest.ok) return true
  return (dest.nativeEth ?? 0) < OFFER_DEST_GAS_FLOOR_ETH
}

/** USDC this origin can put behind a job right now, or 0. */
function spendableUsdc(c: JobOfferChain | undefined): number {
  if (!c || !c.ok || !c.stable || c.stable.symbol.toUpperCase() !== 'USDC') return 0
  if ((c.nativeEth ?? 0) < (OFFER_ORIGIN_MIN_GAS_ETH[c.chainId] ?? 0.002)) return 0
  return Number.isFinite(c.stable.balance) ? c.stable.balance : 0
}

/** The first catalog job this wallet can run right now, or null. */
export function jobOfferFor(facts: JobOfferFacts | null | undefined): JobOffer | null {
  if (!facts) return null
  const gas = offerNeedsGas(facts)
  const fundUsd = offerFundUsd(JOB_OFFER_BUY.usd, gas)
  const able = JOB_OFFER_ORIGINS.map((id) => ({ id, usdc: spendableUsdc(facts.chains.find((c) => c.chainId === id)) })).filter((o) => o.usdc >= fundUsd)
  if (able.length === 0) return null
  // Richest first; the list order breaks a tie.
  const pick = [...able].sort((a, b) => b.usdc - a.usdc)[0]
  const originName = FUNDING_ORIGIN_WORD[pick.id]
  const steps = gas ? 4 : 3
  return {
    id: 'fund-buy',
    ask: fundBuySentence(pick.id, gas),
    originChainId: pick.id,
    originName,
    fundUsd,
    buyUsd: JOB_OFFER_BUY.usd,
    symbol: JOB_OFFER_BUY.symbol,
    gasIncluded: gas,
    steps,
    label: `Try a ${steps}-step job`,
    why: `Sized to this wallet: it holds ${money(Math.floor(pick.usdc * 100) / 100)} of USDC on ${originName}.`,
  }
}

// ── What a surface shows ────────────────────────────────────────────────────

export type JobOfferView =
  /** No wallet: the explanation, the connect door, the example as text. */
  | { state: 'connect'; example: string }
  /** Balances not read yet: no button that could be wrong. */
  | { state: 'loading' }
  /** A read failed where it matters and nothing else qualifies: unknown. */
  | { state: 'unread'; note: string }
  /** This wallet can run one: offer exactly that sentence. */
  | { state: 'offer'; offer: JobOffer }
  /** Read, and it can run none: say what a first job needs + the funding door. */
  | { state: 'fund'; needUsd: number; note: string }

const ORIGIN_LIST = 'Base, Arbitrum or Optimism'

export function jobOfferView(walletAddress: string | null | undefined, facts: JobOfferFacts | null | undefined): JobOfferView {
  if (!walletAddress) return { state: 'connect', example: JOB_OFFER_EXAMPLE }
  if (!facts) return { state: 'loading' }
  const offer = jobOfferFor(facts)
  if (offer) return { state: 'offer', offer }
  const origins = JOB_OFFER_ORIGINS.map((id) => facts.chains.find((c) => c.chainId === id))
  if (origins.some((c) => !c || !c.ok)) {
    return { state: 'unread', note: 'Some balances could not be read just now, so no job is suggested. It checks again within a minute.' }
  }
  const needUsd = offerFundUsd(JOB_OFFER_BUY.usd, offerNeedsGas(facts))
  // Money that is there but cannot sign: say so, it is not "nothing".
  const stuck = origins.find((c) => c && c.stable && c.stable.symbol.toUpperCase() === 'USDC' && c.stable.balance >= needUsd && spendableUsdc(c) === 0)
  const note = stuck
    ? `This wallet holds USDC on ${FUNDING_ORIGIN_WORD[stuck.chainId]} but no ETH there to sign with. Add a little ETH on ${FUNDING_ORIGIN_WORD[stuck.chainId]} and a first job is offered here.`
    : `A first job moves about ${money(needUsd)} of USDC from ${ORIGIN_LIST}. This wallet does not hold that much on any of them yet.`
  return { state: 'fund', needUsd, note }
}

// ── Expired, not failed ─────────────────────────────────────────────────────

/** A job that was offered and never signed until it lapsed is stored as
 *  `failed` with a reason that starts "expired". It is not a failure: the
 *  rail shows it in a neutral colour and never counts it as needing you. */
export function isExpiredJob(j: { status: string; failReason?: string | null }): boolean {
  // ONE rule: lib/job-status owns it (the card, the overlay and the rail agree).
  return jobExpired(j)
}
