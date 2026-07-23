// ─────────────────────────────────────────────────────────────────────────
//  Universal funding plan — "insufficient funds" is an offer, never a wall.
//
//  The Robinhood funding plan (#438) proved the shape for ONE venue: an
//  unfunded buy scans the wallet, offers chips, and the pick compiles into
//  a job (fund → wait → act). This module is the venue-agnostic version:
//  any native layer that discovers a shortfall ("stake 0.0002 ETH on Lido"
//  with 0 mainnet ETH, "deposit 20 USDC to Hyperliquid" with 3 on Arbitrum)
//  describes WHAT it needs and WHERE, and this module scans the wallet's
//  ETH + USDC across the NEAR-Intents-reachable first-class chains and
//  answers with chips.
//
//  The chips ARE the contract: every resume string round-trips through
//  compileJobAsk as `Swap <amt> <TOK> from <chain> to <TOK> on <chain>,
//  then <followup>` — one NEAR Intents leg (sign → oneclick wait) per
//  source, then the original action rebuilt fresh by its own native layer.
//  No new builders, no new guards: the job rides lib/cross-chain-swap.ts'
//  existing deposit-address guard and each follow-up layer's own gate.
//
//  Honesty rules:
//   · Same-token sources rank first (no swap spread), stables next, ETH
//     last; a source is only viable if its chain also holds gas to sign.
//   · The plan margins UP for solver fees; overshoot lands in the user's
//     own wallet on the destination chain — never stranded, never a fee.
//   · When no single source covers it but several combined do, offer the
//     combined job (one leg per chain).
//   · When the whole wallet can't cover it, say exactly what was seen and
//     what the smallest plan needs — actionable, not a dead end.
// ─────────────────────────────────────────────────────────────────────────

import { erc20Abi, formatEther, formatUnits } from 'viem'
import { chainById, publicClientFor } from '@/lib/chains'
import { chainAlt, canonicalChainWord } from '@/lib/chain-lexicon'
import { fundingNeedUsd, planRobinhoodFundingAdvice, readFundingShortfall } from '@/lib/lifi-bridge'
import { describeInflightDeposit } from '@/lib/inflight-funding'
import { usdPerToken } from '@/lib/usd-probe'

/** Chains the scanner reads — the intersection of lib/chains first-class
 *  chains and NEAR Intents' buildable EVM origins. Robinhood Chain is
 *  deliberately absent: its money moves on the LiFi plan (lib/lifi-bridge). */
export const FUNDING_SCAN_CHAINS = [8453, 42161, 1] as const

/** The chain word each resume string uses — must stay inside
 *  lib/cross-chain-swap's CHAIN_ALT grammar or the chip won't compile. */
export const FUNDING_CHAIN_WORD: Record<number, string> = {
  1: 'Ethereum',
  8453: 'Base',
  42161: 'Arbitrum',
}

/** Solver-fee headroom on the moved amount (NEAR Intents quotes net of fees). */
export const FUNDING_MARGIN_BPS = 1_000
/** Flat headroom for fixed costs (destination delivery gas on mainnet). */
export const FUNDING_FLAT_USD = 1
/** Below this the solver fee dominates the move — the plan floors here. */
export const FUNDING_MIN_PLAN_USD = 2
/** Ignore dust sources below this. */
const DUST_USD = 0.5

/** ETH kept back on a source chain so the transfer itself can be signed —
 *  an "all my ETH" leg must never strand the wallet gasless mid-plan. */
const GAS_RESERVE_ETH: Record<number, number> = { 1: 0.002, 8453: 0.0002, 42161: 0.0002 }
/** Minimum native ETH a chain needs before an ERC-20 source there is signable. */
const MIN_GAS_TO_SEND_ETH: Record<number, number> = { 1: 0.001, 8453: 0.00003, 42161: 0.00003 }
/** Native ETH the DESTINATION wallet needs to sign the follow-up action
 *  (approve + the op). Below it, the plan adds a gas leg — funds that land
 *  where the wallet can't pay gas are stranded, not delivered (live
 *  2026-07-16: a $2 bridge arrived and the stake couldn't fire). */
export const DEST_GAS_FLOOR_ETH: Record<number, number> = { 1: 0.003, 8453: 0.0002, 42161: 0.0002 }
/** The smallest gas leg worth quoting. */
const MIN_GAS_LEG_USD = 1.5

export interface FundingNeed {
  /** Destination chain + token the blocked action needs. */
  chainId: number
  token: string
  /** How much MORE of the token must land there (shortfall, not the ask). */
  amountHuman: number
  /** The segment appended after the funding legs — MUST parse under an
   *  existing native layer (e.g. "stake all my ETH on Lido"). EMPTY = a
   *  bridge-only plan (the generic custom-MCP fallback): a single leg is a
   *  plain cross-chain ask, several legs compile as a pure-bridge job, and
   *  the user re-asks their action once the funds land. */
  followupResume: string
  /** Short human name woven into the copy ("the stake"). */
  actionLabel: string
}

export interface FundingSource {
  chainId: number
  chainWord: string
  token: 'ETH' | 'USDC'
  /** Movable balance (gas reserve already deducted for ETH sources). */
  balance: number
  usd: number
}

export interface FundingChip {
  label: string
  resume: string
}

export type FundingPlan =
  | { kind: 'offer'; needUsd: number; chips: FundingChip[]; sourceSummary: string }
  | { kind: 'short'; needUsd: number; totalUsd: number; sourceSummary: string }

const fmtAmount = (n: number, dp: number, mode: 'up' | 'down'): string => {
  const f = 10 ** dp
  const v = mode === 'up' ? Math.ceil(n * f) / f : Math.floor(n * f) / f
  return v.toFixed(dp).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
}

const usd2 = (n: number) =>
  n.toLocaleString('en-US', { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })

/** Dollars a plan must move: shortfall × price, margined for solver fees,
 *  floored at the minimum sensible move, rounded up to the next $0.50. */
export function fundingPlanUsd(amountHuman: number, tokenUsd: number): number {
  const raw = amountHuman * tokenUsd * (1 + FUNDING_MARGIN_BPS / 10_000) + FUNDING_FLAT_USD
  return Math.max(FUNDING_MIN_PLAN_USD, Math.ceil(raw * 2) / 2)
}

/** Token units of `source` worth `usd` dollars, rounded up so the leg never
 *  arrives short (and never above the movable balance). */
function sourceAmountFor(source: FundingSource, usd: number): string {
  const perUsd = source.balance / source.usd
  const dp = source.token === 'USDC' ? 2 : 6
  const amt = Math.min(usd * perUsd, source.balance)
  return fmtAmount(amt, dp, amt >= source.balance ? 'down' : 'up')
}

// Cross-chain sources ride a NEAR Intents leg ("from X to Y on Z"); a source
// already ON the destination chain converts through the native venue cascade
// instead ("swap A for B on Z" — the jobs same-chain segment, #450): no
// bridge, no solver fee, and it was the missing offer in the live 2026-07-23
// NFT buy (0.007 ETH short on Base while $12 of USDC sat ON Base).
const legResume = (s: FundingSource, amount: string, need: FundingNeed): string =>
  s.chainId === need.chainId
    ? `Swap ${amount} ${s.token} for ${need.token.toUpperCase()} on ${FUNDING_CHAIN_WORD[need.chainId]}`
    : `Swap ${amount} ${s.token} from ${s.chainWord} to ${need.token.toUpperCase()} on ${FUNDING_CHAIN_WORD[need.chainId]}`

/** Rank: destination-chain conversions first (no bridge, no solver fee),
 *  then same token (no swap spread), stables next, ETH last; richest chain
 *  first within each group. */
export function rankFundingSources(need: FundingNeed, sources: FundingSource[]): FundingSource[] {
  const group = (s: FundingSource) =>
    s.chainId === need.chainId ? -1 : s.token.toUpperCase() === need.token.toUpperCase() ? 0 : s.token === 'USDC' ? 1 : 2
  return [...sources].sort((a, b) => group(a) - group(b) || b.usd - a.usd)
}

/** The gas-leg resume segment: same source, delivered as native ETH on the
 *  destination so the follow-up action can actually be signed. */
const gasLegResume = (s: FundingSource, amount: string, need: FundingNeed): string =>
  s.chainId === need.chainId
    ? `Swap ${amount} ${s.token} for ETH on ${FUNDING_CHAIN_WORD[need.chainId]}`
    : `Swap ${amount} ${s.token} from ${s.chainWord} to ETH on ${FUNDING_CHAIN_WORD[need.chainId]}`

/**
 * The pure planner: rank the sources and turn a shortfall into chips (or an
 * honest "the whole wallet can't cover it"). Every chip's resume string is
 * harness-checked to compile under lib/jobs.ts — the chip is the contract.
 *
 * `gasUsd` > 0 means the destination wallet can't pay for the follow-up
 * action itself: every chip gets a gas leg FIRST (source → native ETH on
 * the destination), then the token leg. Funds that land where the wallet
 * can't sign are stranded, not delivered.
 */
export function planFundingChips(need: FundingNeed, needUsd: number, sources: FundingSource[], gasUsd = 0): FundingPlan {
  // Nothing to move at all — never emit a zero-amount leg.
  if (needUsd + gasUsd <= 0) return { kind: 'short', needUsd: 0, totalUsd: 0, sourceSummary: '' }
  // A destination-chain balance of the NEEDED token is not a source (the
  // shortfall already accounts for it) — but a different token sitting on
  // the destination IS: it converts through the native venues, no bridge.
  const ranked = rankFundingSources(
    need,
    sources.filter((s) => s.usd >= DUST_USD && (s.chainId !== need.chainId || s.token.toUpperCase() !== need.token.toUpperCase())),
  )
  const sourceSummary = ranked
    .slice(0, 4)
    .map((s) => `~$${usd2(Number(s.usd.toFixed(2)))} of ${s.token} on ${s.chainWord}`)
    .join(', ')
  const totalUsd = Number(ranked.reduce((a, s) => a + s.usd, 0).toFixed(2))
  const totalNeedUsd = Number((needUsd + gasUsd).toFixed(2))

  /** [gas leg?, token leg] from ONE source, spending `tokenUsd` on the token
   *  leg — the source must hold tokenUsd + gasUsd or this returns null.
   *  tokenUsd 0 = a GAS-ONLY plan (the token need is already covered on the
   *  destination; only the follow-up's gas is missing). */
  const legsFrom = (s: FundingSource, tokenUsd: number): string[] | null => {
    if (s.usd < tokenUsd + gasUsd) return null
    const segs: string[] = []
    let spent = 0
    if (gasUsd > 0) {
      segs.push(gasLegResume(s, sourceAmountFor(s, gasUsd), need))
      spent = gasUsd
    }
    if (tokenUsd > 0) {
      // The token leg's amount comes out of what's left of the source.
      const remaining: FundingSource = { ...s, balance: s.balance * (1 - spent / s.usd), usd: s.usd - spent }
      segs.push(legResume(remaining, sourceAmountFor(remaining, tokenUsd), need))
    }
    return segs.length > 0 ? segs : null
  }

  // Empty followup = bridge-only chips (the generic custom-MCP fallback).
  const withFollowup = (legs: string[]) => (need.followupResume ? `${legs.join(', then ')}, then ${need.followupResume}` : legs.join(', then '))

  const best = ranked.find((s) => s.usd >= totalNeedUsd)
  const chips: FundingChip[] = []
  if (best) {
    const legs = legsFrom(best, needUsd)!
    chips.push({
      label: `Just enough (~$${usd2(totalNeedUsd)} of ${best.token} on ${best.chainWord})`,
      resume: withFollowup(legs),
    })
    // "All of it" only when it's a sensible whole-balance move — a $15k
    // balance covering a $25 need doesn't get an all-in chip.
    if (best.usd >= totalNeedUsd * 1.6 && best.usd <= totalNeedUsd * 10) {
      const allLegs = legsFrom(best, Number((best.usd - gasUsd).toFixed(2)))
      if (allLegs) {
        chips.push({
          label: `All my ${best.token} on ${best.chainWord} (~$${usd2(Number(best.usd.toFixed(2)))})`,
          resume: withFollowup(allLegs),
        })
      }
    }
  } else if (totalUsd >= totalNeedUsd && ranked.length >= 2) {
    // No single source covers it — the richest source carries the gas leg,
    // then legs combine (richest-first) until the token need is covered.
    const byUsd = [...ranked].sort((a, b) => b.usd - a.usd)
    const legs: string[] = []
    let covered = 0
    let gasCarried = 0
    for (const s of byUsd) {
      const spendable = s.usd - (gasCarried === 0 && gasUsd > 0 ? gasUsd : 0)
      if (spendable <= 0) continue
      const segs = gasCarried === 0 && gasUsd > 0 ? legsFrom(s, Math.min(spendable, needUsd - covered)) : [legResume(s, sourceAmountFor(s, Math.min(s.usd, needUsd - covered)), need)]
      if (!segs) continue
      legs.push(...segs)
      if (gasCarried === 0 && gasUsd > 0) gasCarried = gasUsd
      covered += Math.min(spendable, needUsd - covered)
      if (covered >= needUsd) break
    }
    if (covered >= needUsd && (gasUsd === 0 || gasCarried > 0)) {
      chips.push({
        label: `Combine ${legs.length} legs (~$${usd2(totalNeedUsd)} total)`,
        resume: withFollowup(legs),
      })
    }
  }

  if (chips.length === 0) return { kind: 'short', needUsd: totalNeedUsd, totalUsd, sourceSummary }
  chips.push({ label: 'Not now', resume: 'Never mind — leave my funds where they are.' })
  return { kind: 'offer', needUsd: totalNeedUsd, chips: chips.slice(0, 4), sourceSummary }
}

/**
 * The honest-refusal copy when the movable sources can't cover the plan.
 * Pure so the harness pins every variant. Stranded USDC (exists, but its
 * chain holds no gas ETH to sign a move) must be NAMED with its rescue —
 * "I found no movable ETH or USDC" next to a visible $20 reads as a broken
 * product, and the rescue is one dollar of ETH away.
 */
export function shortRefusalCopy(params: {
  /** Human chain list, already joined ("Base, Arbitrum and Ethereum"). */
  chainsRead: string
  need: FundingNeed
  needUsd: number
  /** Movable-source summary from the plan ('' when nothing movable). */
  sourceSummary: string
  stranded: FundingSource[]
  movableTotalUsd: number
}): string {
  const { chainsRead, need, needUsd, sourceSummary, stranded, movableTotalUsd } = params
  const actionLabel = need.actionLabel
  const planLine = `the smallest plan for ${actionLabel} moves ~$${usd2(needUsd)} (solver fees included).`
  // Stranded splits by token: USDC is unstickable with a gas topup; ETH under
  // the keep-back IS the (insufficient) gas — name it, never promise it.
  const usdcStranded = stranded.filter((s) => s.token === 'USDC')
  const ethStranded = stranded.filter((s) => s.token === 'ETH')
  const ethNote =
    ethStranded.length > 0
      ? `${ethStranded.map((s) => `~$${usd2(Number(s.usd.toFixed(2)))} of ETH on ${s.chainWord}`).join(', ')} (under what a move from there costs, so it can't help)`
      : ''
  if (usdcStranded.length === 0) {
    const seen = [sourceSummary, ethNote].filter(Boolean).join(', plus ')
    return (
      (seen ? `Across ${chainsRead} I can see ${seen} — ` : `Across ${chainsRead} I found no movable ETH or USDC — `) +
      `${planLine} Top up any of those chains and ask again.`
    )
  }
  const strandedSummary = usdcStranded.map((s) => `~$${usd2(Number(s.usd.toFixed(2)))} of ${s.token} on ${s.chainWord}`).join(', ')
  // The needed token already ON the destination chain was subtracted from the
  // shortfall by the caller — name it, but never count it toward "enough".
  const coverableUsd = usdcStranded
    .filter((s) => s.chainId !== need.chainId || s.token.toUpperCase() !== need.token.toUpperCase())
    .reduce((a, s) => a + s.usd, 0)
  const gasWords = [...new Set(usdcStranded.map((s) => s.chainWord))].join(' and ')
  const rescue = `Send a little ETH (about a dollar's worth is plenty) to your own address on ${gasWords} and ask again — ${planLine}`
  const alsoEth = ethNote ? ` (Also seen: ${ethNote}.)` : ''
  if (movableTotalUsd + coverableUsd >= needUsd) {
    // The money EXISTS — only origin gas is missing. Lead with that.
    return (
      `Your money's already there: across ${chainsRead} I can see ${sourceSummary ? `${sourceSummary}, plus ` : ''}${strandedSummary} — enough for ${actionLabel} — ` +
      `but there's no ETH on ${gasWords} to sign the move with, so it's stuck where it sits. ${rescue}${alsoEth}`
    )
  }
  return (
    `Across ${chainsRead} I can see ${sourceSummary ? `${sourceSummary}, plus ` : ''}${strandedSummary} that can't move without gas ETH on ${gasWords} — ` +
    `${planLine} Top up any of those chains (and ${gasWords} needs a little ETH before its USDC can move) and ask again.${alsoEth}`
  )
}

/**
 * The donor-topup rescue: gas-stranded USDC + a movable source elsewhere →
 * ONE job that unsticks and finishes. Legs: donor → ETH on the stranded
 * chain (the topup), then (when the destination is gas-short) stranded →
 * ETH on the destination, then stranded → the needed token, then the
 * follow-up. Every leg is an existing cross-chain segment — no new
 * builders, no new guards. Null when no honest rescue exists (no
 * unstickable USDC, it can't cover the need, no donor rich enough, or ETH
 * is unpriceable so the topup can't be sized) — the caller falls back to
 * the named refusal.
 */
export function planStrandedRescue(params: {
  need: FundingNeed
  needUsd: number
  gasUsd: number
  sources: FundingSource[]
  stranded: FundingSource[]
  ethUsd: number | null
}): { chips: FundingChip[]; target: FundingSource; donor: FundingSource; gasLegUsd: number } | null {
  const { need, needUsd, gasUsd, sources, stranded, ethUsd } = params
  if (ethUsd === null || needUsd <= 0) return null
  // Only USDC stuck on a NON-destination chain is rescuable this way — the
  // needed token already on the destination was subtracted from the
  // shortfall, so unsticking it cannot cover the need.
  const target = stranded
    .filter((s) => s.token === 'USDC' && (s.chainId !== need.chainId || need.token.toUpperCase() !== 'USDC'))
    .sort((a, b) => b.usd - a.usd)[0]
  if (!target || target.usd < needUsd + gasUsd) return null
  // Deliver 3× the stranded chain's min-send floor (signature headroom),
  // floored at the smallest leg worth quoting. Mainnet floors are real
  // money — the sizing must say so, not hide it.
  const gasLegUsd = Math.max(MIN_GAS_LEG_USD, Math.ceil((MIN_GAS_TO_SEND_ETH[target.chainId] ?? 0.001) * 3 * ethUsd * 2) / 2)
  // A chain with stranded USDC has no signable ETH, so every source lives
  // elsewhere — the richest one that can carry the topup donates.
  const donor = [...sources].sort((a, b) => b.usd - a.usd).find((s) => s.usd >= gasLegUsd)
  if (!donor) return null
  const legs: string[] = [`Swap ${sourceAmountFor(donor, gasLegUsd)} ${donor.token} from ${donor.chainWord} to ETH on ${target.chainWord}`]
  let src = target
  if (gasUsd > 0) {
    legs.push(gasLegResume(src, sourceAmountFor(src, gasUsd), need))
    src = { ...target, balance: target.balance * (1 - gasUsd / target.usd), usd: target.usd - gasUsd }
  }
  legs.push(legResume(src, sourceAmountFor(src, needUsd), need))
  const resume = need.followupResume ? `${legs.join(', then ')}, then ${need.followupResume}` : legs.join(', then ')
  return {
    chips: [
      { label: `Unstick it (gas via ${donor.chainWord}, then ~$${usd2(Number((needUsd + gasUsd).toFixed(2)))} from ${target.chainWord})`, resume },
      { label: 'Not now', resume: 'Never mind — leave my funds where they are.' },
    ],
    target,
    donor,
    gasLegUsd,
  }
}

// ── I/O: the wallet scan + the offer turn ───────────────────────────────────

export interface FundingScan {
  sources: FundingSource[]
  /** USDC that EXISTS but can't leave its chain — no gas ETH there to sign
   *  the move. Never a plannable source, but any refusal must NAME it: a
   *  scan that dropped it once told a wallet holding $20 of Base USDC
   *  "I found no movable ETH or USDC" (live 2026-07-23, four retries in
   *  five minutes on the HYPE house link). */
  stranded: FundingSource[]
  /** The ETH price the scan classified with (null = unpriceable) — the
   *  rescue planner sizes donor gas legs off it. */
  ethUsd: number | null
  /** Chain words that were actually read — the only chains any copy may
   *  make claims about. */
  readChains: string[]
  /** Chain words whose RPC reads failed (after one retry). A failed chain
   *  means "unknown", NEVER "empty" — a partial scan must not turn into a
   *  confident "you have nothing" (live 2026-07-16: a rate-limited Base RPC
   *  hid $15k of USDC). */
  failedChains: string[]
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** One chain's raw balances, as the RPC shell hands them to the classifier —
 *  and as the scenario audit (scripts/audit-funding.ts) fabricates them. */
export interface FundingBalanceRead {
  chainId: number
  chainWord: string
  nativeEth: number
  usdcBal: number
}

/** The pure classification step: raw balances → movable sources + stranded
 *  funds. Extracted from the RPC scan so any wallet state is constructible
 *  in a costless dry run — the rules here are THE rules, there is no second
 *  copy. `ethUsd` null (unpriceable) skips ETH sources, matching the live
 *  scan's fail-soft. */
export function classifyFundingBalances(reads: FundingBalanceRead[], ethUsd: number | null): Pick<FundingScan, 'sources' | 'stranded'> {
  const sources: FundingSource[] = []
  const stranded: FundingSource[] = []
  for (const r of reads) {
    if (r.usdcBal > 0 && r.nativeEth >= (MIN_GAS_TO_SEND_ETH[r.chainId] ?? 0.001)) {
      sources.push({ chainId: r.chainId, chainWord: r.chainWord, token: 'USDC', balance: r.usdcBal, usd: r.usdcBal })
    } else if (r.usdcBal >= DUST_USD) {
      stranded.push({ chainId: r.chainId, chainWord: r.chainWord, token: 'USDC', balance: r.usdcBal, usd: r.usdcBal })
    }
    const movableEth = r.nativeEth - (GAS_RESERVE_ETH[r.chainId] ?? 0.002)
    if (ethUsd !== null && movableEth > 0) {
      sources.push({ chainId: r.chainId, chainWord: r.chainWord, token: 'ETH', balance: movableEth, usd: movableEth * ethUsd })
    } else if (ethUsd !== null && r.nativeEth * ethUsd >= DUST_USD) {
      // Sub-reserve ETH: real money that can't clear the chain's keep-back —
      // never plannable, but a refusal must name it ($2 on mainnet answered
      // Nate's "would it move that to Base?" probe with silence, 2026-07-23).
      stranded.push({ chainId: r.chainId, chainWord: r.chainWord, token: 'ETH', balance: r.nativeEth, usd: r.nativeEth * ethUsd })
    }
  }
  return { sources, stranded }
}

/** Read movable ETH + USDC across the scan chains, one retry per chain.
 *  Throws only when NOTHING was readable. */
export async function scanFundingSources(user: string): Promise<FundingScan> {
  const ethProbe = await usdPerToken(8453, 'ETH').catch(() => null)
  const reads: FundingBalanceRead[] = []
  const readChains: string[] = []
  const failedChains: string[] = []
  await Promise.all(
    FUNDING_SCAN_CHAINS.map(async (chainId) => {
      const chain = chainById(chainId)
      const client = publicClientFor(chainId)
      const usdc = chain?.tokens.USDC
      const word = FUNDING_CHAIN_WORD[chainId]
      if (!chain || !client || !usdc) return
      const read = () =>
        Promise.all([
          client.getBalance({ address: user as `0x${string}` }),
          client.readContract({ address: usdc.address, abi: erc20Abi, functionName: 'balanceOf', args: [user as `0x${string}`] }),
        ])
      try {
        const [nativeWei, usdcAtoms] = await read().catch(async () => {
          await sleep(400) // public RPCs rate-limit in bursts — one retry
          return read()
        })
        readChains.push(word)
        reads.push({ chainId, chainWord: word, nativeEth: Number(formatEther(nativeWei)), usdcBal: Number(formatUnits(usdcAtoms, usdc.decimals)) })
      } catch {
        failedChains.push(word)
      }
    }),
  )
  if (readChains.length === 0) throw new Error('no funding-scan chain was readable')
  const ethUsd = ethProbe?.usd ?? null
  return { ...classifyFundingBalances(reads, ethUsd), ethUsd, readChains, failedChains }
}

export interface FundingOfferTurn {
  reply: string
  clarify: { question: string; options: { label: string; resume: string }[] }
  buildPath: string
}

/**
 * The whole move: price the shortfall, scan the wallet, plan the chips.
 * Returns the offer turn, `{ insufficient }` honest-refusal text when the
 * wallet genuinely can't cover it, or null when the scan/price is
 * unavailable — the caller falls through to its existing (fail-closed) path.
 */
export async function offerFundingPlan(params: {
  user: string
  need: FundingNeed
  trace?: (event: unknown) => void
}): Promise<FundingOfferTurn | { insufficient: string } | null> {
  const { user, need } = params
  const trace = params.trace ?? (() => {})
  const destChain = chainById(need.chainId)
  // amountHuman 0 is a GAS-ONLY probe: the token need is covered on the
  // destination, but the follow-up action may still be gas-stranded there.
  if (!destChain || !FUNDING_CHAIN_WORD[need.chainId] || !(need.amountHuman >= 0)) return null

  let tokenUsd: number | null = null
  try {
    const probe = (await usdPerToken(need.chainId, need.token)) ?? (await usdPerToken(8453, need.token))
    tokenUsd = probe?.usd ?? null
  } catch {
    tokenUsd = null
  }
  if (!tokenUsd) {
    trace({ type: 'note', level: 'warn', label: `funding layer: couldn't price ${need.token} to size the plan — falling through` })
    return null
  }

  let scan: FundingScan
  try {
    scan = await scanFundingSources(user)
  } catch {
    trace({ type: 'note', level: 'warn', label: 'funding layer: wallet scan unavailable — falling through' })
    return null
  }

  // Destination gas: funds that land where the wallet can't pay for the
  // follow-up action are stranded, not delivered — when the needed token
  // isn't the gas token itself, a short destination wallet gets a gas leg.
  // (ETH needs carry their own gas via the caller's buffer.) An unreadable
  // balance or unpriceable ETH means the plan can't be made honest → fall
  // through to the normal fail-closed build.
  let gasUsd = 0
  if (need.token.toUpperCase() !== 'ETH') {
    try {
      const destClient = publicClientFor(need.chainId)
      if (!destClient) return null
      const nativeWei = await destClient.getBalance({ address: user as `0x${string}` })
      const floor = DEST_GAS_FLOOR_ETH[need.chainId] ?? 0.0002
      const shortEth = Math.max(0, floor - Number(formatEther(nativeWei)))
      if (shortEth > 0) {
        const ethProbe = await usdPerToken(8453, 'ETH').catch(() => null)
        if (!ethProbe) {
          trace({ type: 'note', level: 'warn', label: 'funding layer: destination needs a gas leg but ETH is unpriceable — falling through' })
          return null
        }
        gasUsd = Math.max(MIN_GAS_LEG_USD, Math.ceil(shortEth * ethProbe.usd * 1.15 * 2) / 2)
      }
    } catch {
      trace({ type: 'note', level: 'warn', label: "funding layer: couldn't read the destination gas balance — falling through" })
      return null
    }
  }

  const needUsd = need.amountHuman > 0 ? fundingPlanUsd(need.amountHuman, tokenUsd) : 0
  // Token covered AND gas covered — nothing to fund; the caller proceeds.
  if (needUsd === 0 && gasUsd === 0) return null
  const decision = decideFundingTurn({ need, needUsd, gasUsd, scan, destChainName: destChain.name, trace })
  if (decision.kind === 'fallthrough') return null
  if (decision.kind === 'refusal') return { insufficient: decision.insufficient }
  return decision.turn
}

/** What the funding layer decided to do with a priced shortfall. */
export type FundingDecision =
  | { kind: 'offer'; turn: FundingOfferTurn }
  | { kind: 'refusal'; insufficient: string }
  | { kind: 'fallthrough'; reason: string }

/**
 * The pure decision core of `offerFundingPlan`: priced need + scan result →
 * offer / honest refusal / fall-through. No RPC, no pricing — everything
 * I/O-shaped arrives as arguments, so the scenario audit
 * (scripts/audit-funding.ts) can drive the REAL decision logic across
 * fabricated wallet states.
 */
export function decideFundingTurn(params: {
  need: FundingNeed
  needUsd: number
  gasUsd: number
  scan: Pick<FundingScan, 'sources' | 'stranded' | 'ethUsd' | 'readChains' | 'failedChains'>
  destChainName: string
  trace?: (event: unknown) => void
}): FundingDecision {
  const { need, needUsd, gasUsd, scan, destChainName } = params
  const trace = params.trace ?? (() => {})
  const plan = planFundingChips(need, needUsd, scan.sources, gasUsd)

  if (plan.kind === 'short') {
    // A shortfall claim is only honest over chains that were actually read —
    // when any chain's scan failed, "you have nothing there" may be a lie
    // (a rate-limited RPC once hid $15k), so fall through instead.
    if (scan.failedChains.length > 0) {
      trace({
        type: 'note',
        level: 'warn',
        label: `funding layer: sources look short but ${scan.failedChains.join('/')} didn't scan — falling through rather than claiming an empty wallet`,
      })
      return { kind: 'fallthrough', reason: 'partial scan' }
    }
    // Before refusing: gas-stranded USDC + a donor elsewhere = a one-job
    // rescue, not a wall. (The refusal below still names stranded funds
    // when no honest rescue exists.)
    const rescue = planStrandedRescue({ need, needUsd, gasUsd, sources: scan.sources, stranded: scan.stranded, ethUsd: scan.ethUsd })
    if (rescue) {
      trace({
        type: 'status',
        label: `funding layer claimed the turn: ~$${usd2(Number(rescue.target.usd.toFixed(2)))} USDC gas-stranded on ${rescue.target.chainWord} — offering a donor topup via ${rescue.donor.chainWord} (~$${usd2(rescue.gasLegUsd)} gas leg)`,
      })
      return {
        kind: 'offer',
        turn: {
          reply:
            `**We can make this happen.** Your ~$${usd2(Number(rescue.target.usd.toFixed(2)))} of USDC on ${rescue.target.chainWord} is real — ${rescue.target.chainWord} just has no ETH to sign the move with. ` +
            `One job fixes it: a sliver of your ${rescue.donor.chainWord} ${rescue.donor.token} covers ${rescue.target.chainWord} gas, then the USDC moves over${gasUsd > 0 ? `, ${destChainName} gas gets topped up,` : ''}${need.followupResume ? ` and ${need.actionLabel} finishes` : ''} — every step built and guard-checked when it's your turn to sign.` +
            (need.followupResume ? '' : ` Once it settles, ask again and I'll build ${need.actionLabel} with the funds in place.`),
          clarify: { question: `Unstick the ${rescue.target.chainWord} USDC?`, options: rescue.chips },
          buildPath: 'native-funding-offer',
        },
      }
    }
    const chainsRead = scan.readChains.join(', ').replace(/, ([^,]*)$/, ' and $1')
    trace({
      type: 'note',
      level: 'warn',
      label:
        `funding layer: ${need.actionLabel} needs ~$${plan.needUsd} moved but the wallet holds ~$${plan.totalUsd} movable across ${chainsRead}` +
        (scan.stranded.length > 0
          ? ` (+ $${usd2(Number(scan.stranded.reduce((a, s) => a + s.usd, 0).toFixed(2)))} gas-stranded/sub-reserve on ${scan.stranded.map((s) => `${s.token}·${s.chainWord}`).join('/')}) — naming it`
          : '') +
        ' — honest refusal',
    })
    return {
      kind: 'refusal',
      insufficient: shortRefusalCopy({
        chainsRead,
        need,
        needUsd: plan.needUsd,
        sourceSummary: plan.sourceSummary,
        stranded: scan.stranded,
        movableTotalUsd: plan.totalUsd,
      }),
    }
  }

  trace({
    type: 'status',
    label: `funding layer claimed the turn: ${need.token} short on ${destChainName} for ${need.actionLabel} — offering ${plan.chips.length - 1} funding path(s) (~$${plan.needUsd} needed, NEAR Intents legs)`,
  })
  return {
    kind: 'offer',
    turn: {
      reply:
        `**We can make this happen.** You're holding ${plan.sourceSummary} — ${need.actionLabel} just needs ${needUsd === 0 ? `a little ETH on ${destChainName} for gas` : `more ${need.token.toUpperCase()} on ${destChainName} than the wallet has there yet`}. ` +
        `${plan.chips[0]?.resume.toLowerCase().startsWith('swap') && plan.chips[0].resume.toLowerCase().includes(` for ${need.token.toLowerCase()} on `) ? `I can convert it right there on ${destChainName} (own-wallet venue swap, no bridge)` : 'I can move it over (NEAR Intents, delivered to your own address)'}${gasUsd > 0 ? `, drop in a little ETH so ${destChainName} gas is covered,` : ''} and finish ${need.actionLabel} — one job, every step built and guard-checked when it's your turn to sign.`,
      clarify: { question: `Fund it from what you're holding?`, options: plan.chips },
      buildPath: 'native-funding-offer',
    },
  }
}

// ── The generic fallback: ANY MCP's balance refusal → a funding offer ────────
// User-added MCPs have no native layer, but their build tools refuse with
// recognizable shapes ("Insufficient balance: this needs 20.000000 USDC but
// the wallet holds 3.000000 USDC", "not enough ETH on Ethereum", …). When a
// tool-call failure names a token, a plannable chain, and readable amounts,
// the turn can still end with chips instead of a wall. Bridge-only chips
// (empty followup) — the custom action can't compile as a job step, so the
// user re-asks once the funds land; the reply says exactly that.

const SHORTFALL_TRIGGER_RE = /\binsufficient\b|\bnot enough\b|\bholds only\b|\bbalance too low\b|\btop up\b/i
const TOKEN_SYM = '[A-Z]{2,6}|[A-Z][a-z]?ETH'
// "needs 20 USDC" / "requires ~20.5 USDC" / "staking 0.0002 ETH" / "bridging 1 ETH" / "this needs 20.000000 USDC"
const NEEDED_RE = new RegExp(`\\b(?:needs?|requires?|swapping|staking|bridging|sending|supplying|repaying|depositing|short)\\s+~?\\$?(\\d+(?:\\.\\d+)?)\\s*(${TOKEN_SYM})\\b`)
// The bare-amount fallback ("Insufficient USDG: swapping 5 but …") — only
// consulted when the trigger itself named the token, so the number can
// stand alone without ambiguity about whose unit it is.
const NEEDED_BARE_RE = /\b(?:needs?|requires?|swapping|staking|bridging|sending|supplying|repaying|depositing|short)\s+~?\$?(\d+(?:\.\d+)?)\b/
// "holds 3.000000 USDC" / "wallet holds only 0 ETH" / "has 3 USDC" / "you have 3 USDC"
const HELD_RE = new RegExp(`\\b(?:holds?|have|has)\\s+(?:only\\s+)?~?\\$?(\\d+(?:\\.\\d+)?)\\s*(${TOKEN_SYM})?\\b`)
// "insufficient USDC" / "Insufficient USDG" / "not enough ETH" — the token
// when NEEDED_RE misses. Case-insensitive on the trigger words only; the
// captured symbol is re-validated as a real uppercase token in code (the
// live 2026-07-17 refusal opened with a capital I and silently missed).
const TRIGGER_TOKEN_RE = new RegExp(`\\b(?:insufficient|not enough)\\s+(?:balance\\s+of\\s+)?(${TOKEN_SYM})\\b`, 'i')
const TOKEN_SYM_STRICT_RE = /^(?:[A-Z]{2,6}|[A-Z][a-z]?ETH)$/
const CHAIN_HINT_RE = new RegExp(
  String.raw`\bon\s+(${chainAlt(['base', 'ethereum', 'arbitrum', 'robinhood'])}|arbitrum\s+one)\b`,
  'i',
)

const CHAIN_HINT_IDS: Record<string, number> = {
  base: 8453,
  arbitrum: 42161,
  'arbitrum one': 42161,
  arb: 42161,
  ethereum: 1,
  'eth mainnet': 1,
  mainnet: 1,
  robinhood: 4663,
  'robinhood chain': 4663,
}

export interface DetectedShortfall {
  chainId: number
  token: string
  /** needed − held (held 0 when unreadable), in token units. */
  shortfall: number
}

/**
 * Read a balance-refusal out of an arbitrary tool error. Conservative on
 * purpose: no trigger word, no token, no PLANNABLE chain, or no positive
 * shortfall → null (the failure surfaces as-is). The chain must be named —
 * guessing where a stranger MCP wanted funds is how money gets stranded.
 * The ONE inference allowed: a USDG shortfall with no chain named is
 * Robinhood Chain — USDG exists nowhere else in the registry (live
 * 2026-07-17: the robinhood MCP's "Insufficient USDG" refusal named no
 * chain and a funded wallet hit a wall).
 */
export function detectBalanceShortfall(text: string): DetectedShortfall | null {
  if (!text || !SHORTFALL_TRIGGER_RE.test(text)) return null

  const triggerRaw = text.match(TRIGGER_TOKEN_RE)?.[1] ?? null
  const triggerToken = triggerRaw && TOKEN_SYM_STRICT_RE.test(triggerRaw) ? triggerRaw : null
  const needed = text.match(NEEDED_RE)
  // The bare-amount form is only trusted when the trigger named the token.
  const neededBare = triggerToken ? text.match(NEEDED_BARE_RE) : null
  const token = needed?.[2] ?? triggerToken
  const neededAmt = needed ? Number(needed[1]) : neededBare ? Number(neededBare[1]) : null
  if (!token || neededAmt === null) return null

  const chainHint = text.match(CHAIN_HINT_RE)
  const chainId = chainHint
    ? CHAIN_HINT_IDS[canonicalChainWord(chainHint[1]) ?? chainHint[1].toLowerCase().replace(/\s+/g, ' ')]
    : token.toUpperCase() === 'USDG'
      ? 4663
      : undefined
  if (!chainId || !(FUNDING_CHAIN_WORD[chainId] || chainId === 4663)) return null

  const held = text.match(HELD_RE)
  // A held-match naming a DIFFERENT token is someone else's number.
  const heldAmt = held && (!held[2] || held[2].toUpperCase() === token.toUpperCase()) ? Number(held[1]) : 0
  const shortfall = Number((neededAmt - heldAmt).toFixed(8))
  if (!Number.isFinite(shortfall) || shortfall <= 0) return null
  return { chainId, token: token.toUpperCase(), shortfall }
}

export interface GenericFundingFallback {
  offer: FundingOfferTurn | null
  /** Synthesis-context block explaining what's attached / what was seen. */
  contextBlock: string
  /** The failure this fallback claimed — its "TOOL CALL FAILED" context
   *  block gets softened (softenClaimedFailureBlock) so the model isn't
   *  simultaneously ordered to announce a failure and to frame the plan. */
  claimed?: string
}

// The 2026-07-22 headline fix: with only "TOOL CALL FAILED … tell the user it
// failed" in context, the house model titled a fundable shortfall "❌ Swap
// failed" over a perfectly good set of funding chips. Every funding-offer
// context block now carries this mandatory framing.
const TONE_DIRECTIVE =
  `TONE (mandatory): this is a "here's the plan" moment, NOT an error report. Nothing was attempted on-chain, nothing failed, nothing was lost — the build stopped at a pre-flight balance check. ` +
  `Never open with failure framing: no ❌, no red-X imagery, no "failed"/"error"/"insufficient" headlines. ` +
  `Open with what happens NEXT (e.g. "**We can make this happen** — …" naming what they hold), then ONE line on what's short, then what the chips/plan do.`

/**
 * Replace a claimed failure's "### <name> — TOOL CALL FAILED" context block
 * with pre-flight-check framing. The original error text stays (honesty);
 * only the "tell the user it failed" directive goes — it was making the
 * model headline fundable shortfalls as failures. In-place, fail-soft.
 */
export function softenClaimedFailureBlock(contextBlocks: string[], fallback: GenericFundingFallback | null): void {
  if (!fallback?.claimed) return
  const prefix = `### ${fallback.claimed} — TOOL CALL FAILED\n`
  const i = contextBlocks.findIndex((b) => b.startsWith(prefix))
  if (i === -1) return
  const note = contextBlocks[i].slice(prefix.length).split('\n')[0]
  contextBlocks[i] =
    `### ${fallback.claimed} — stopped at a pre-flight funds check\n${note}\n` +
    `No transaction was attempted, signed, or submitted — the tool checked balances and stopped before building anything. Frame this as prep for the funding plan below, never as a failure.`
}

/**
 * The generic fallback for failed tool calls from ANY MCP: detect a balance
 * refusal in the failure notes, plan bridge-only chips, and hand back both
 * the offer (chips ride the response) and a context block so the
 * synthesized reply narrates it correctly. Null when nothing detectable.
 */
export async function fundingFallbackForFailures(
  user: string,
  failures: { name: string; note: string }[],
  trace?: (event: unknown) => void,
  /** The turn's echoed workingContext.pending — a just-built cross-chain
   *  deposit there (lib/inflight-funding.ts) means the scan may be reading a
   *  mid-settlement snapshot, and the copy must say so instead of asserting
   *  the money doesn't exist (live 2026-07-21). */
  pending?: { kind: string; data: Record<string, string> },
): Promise<GenericFundingFallback | null> {
  for (const f of failures) {
    const detected = detectBalanceShortfall(f.note)
    if (!detected) continue

    // Robinhood Chain shortfalls ride the LiFi funding plan (NEAR Intents
    // doesn't deliver there): scan Base/Ethereum/Arbitrum USDC and offer
    // bridge-only chips — a lone funding segment compiles as a job
    // (lib/jobs.ts), and the user re-asks their action once funds land.
    if (detected.chainId === 4663) {
      if (detected.token !== 'USDG') continue // only the USDG plan is probed there
      let scan: Awaited<ReturnType<typeof readFundingShortfall>>
      try {
        scan = await readFundingShortfall(user)
      } catch {
        trace?.({ type: 'note', level: 'warn', label: 'funding fallback: Robinhood Chain balance reads unavailable — surfacing the failure as-is' })
        return null
      }
      // In-flight settlement awareness — read-only, fail-soft: no deposit in
      // the pending (or a failed status probe) just means no extra sentence.
      const inflight = await describeInflightDeposit(pending).catch(() => null)
      if (inflight) {
        trace?.({
          type: 'status',
          label: `funding fallback: in-flight ${inflight.dep.amount} ${inflight.dep.token} ${inflight.dep.originChain} → ${inflight.dep.destinationChain} deposit noted (one-click status: ${inflight.status}) — the answer names it instead of denying the funds`,
        })
      }
      // The branches that already count landed money (chips / gas-stranded)
      // skip a 'settled' note as noise; the 'none' refusal keeps every status
      // — there, balance-read lag IS the explanation the user needs.
      const unsettled = inflight && inflight.status !== 'settled' ? inflight : null
      const inflightSuffix = unsettled ? ` Also — ${unsettled.note}` : ''
      const inflightStrandedDirective = unsettled
        ? `\nALSO tell the user, with these exact facts: ${unsettled.note}`
        : ''
      const inflightNoneDirective = inflight
        ? `\nALSO tell the user, with these exact facts: ${inflight.note}`
        : ''
      const includeGas = !scan.hasGas
      const needUsd = fundingNeedUsd(detected.shortfall, includeGas)
      const advice = planRobinhoodFundingAdvice({ scan, needUsd, gasIncluded: includeGas, followup: '' })
      const holdings = scan.origins.map((o) => `~$${o.usd} of ${o.token} on ${o.word}`).join(', ')
      if (advice.kind === 'gas-stranded') {
        // The money EXISTS — it just can't sign where it sits. With a donor
        // origin the chips run the whole rescue as one job; without one the
        // model narrates exactly what to send where. Either way the answer
        // names the stranded USDC — a scan that hid it once told a user
        // "none on Base, Ethereum, or Arbitrum" minutes after THEY bridged
        // $12 in.
        trace?.({ type: 'status', label: `funding fallback claimed the turn: USDG short on Robinhood Chain after the ${f.name} failure — ~$${advice.stranded.usd} ${advice.stranded.token} on ${advice.stranded.word} is gas-stranded (${advice.donor ? `offering a topup from ${advice.donor.word}` : 'asking for an ETH topup'})` })
        if (!advice.chips) {
          return {
            claimed: f.name,
            offer: null,
            contextBlock:
              `### Gas-stranded funds found (after the ${f.name} balance check)\n` +
              `The wallet holds ~$${advice.stranded.usd} of ${advice.stranded.token} on ${advice.stranded.word} — enough for this — but no ETH there to pay for the bridge signatures, and no other chain of theirs can donate it. ` +
              `Tell the user exactly that: their money is real and where it is, only ${advice.stranded.word} gas is missing (about a dollar of ETH is plenty), and once they send a little ETH to their own address on ${advice.stranded.word} they should re-ask so the plan rebuilds. ` +
              `Do NOT invent your own bridge instructions, amounts, or addresses.${inflightStrandedDirective}\n${TONE_DIRECTIVE}`,
          }
        }
        return {
          claimed: f.name,
          offer: {
            reply: `**Your money's already in place** — this needs more USDG on Robinhood Chain, and ${advice.copy}${inflightSuffix}`,
            clarify: { question: `Fix the ${advice.stranded.word} gas and bridge it?`, options: advice.chips.slice(0, 4) },
            buildPath: 'native-lifi-fund-offer',
          },
          contextBlock:
            `### Gas-stranded funds found (after the ${f.name} balance check)\n` +
            `The wallet holds ~$${advice.stranded.usd} of ${advice.stranded.token} on ${advice.stranded.word} but no ETH there to sign with. The system RENDERS action chips directly under your reply. ` +
            `Tell the user their money is real and where it is, that only origin-chain gas is missing, and what the chips do. Do NOT invent your own bridge instructions, amounts, or addresses.\n${TONE_DIRECTIVE}`,
        }
      }
      if (advice.kind === 'none') {
        if (scan.failedOrigins.length > 0) return null // partial scan must not claim an empty wallet
        trace?.({ type: 'note', level: 'warn', label: `funding fallback: USDG short on Robinhood Chain and the scan (${advice.copy}) can't cover the ~$${needUsd} plan — honest refusal` })
        return {
          claimed: f.name,
          offer: null,
          contextBlock:
            `### Funding scan (after the ${f.name} balance check)\nAcross Base, Ethereum, and Arbitrum I can see: ${advice.copy} — the smallest plan for this moves ~$${needUsd} onto Robinhood Chain (bridge fees${includeGas ? ' and a gas leg' : ''} included). ` +
            `The user should know exactly what they hold, per chain, and what the smallest plan needs — and what unlocks the buy (topping up any of those chains, then asking again). ` +
            `Frame it as a checkpoint, not an error: nothing was attempted, signed, or lost — no ❌ or "failed" headlines.${inflightNoneDirective}`,
        }
      }
      const chips = [...advice.chips, { label: 'Not now', resume: 'Never mind — leave my USDC where it is.' }]
      trace?.({ type: 'status', label: `funding fallback claimed the turn: USDG short on Robinhood Chain after the ${f.name} failure — offering ${chips.length - 1} LiFi funding path(s) (~$${needUsd} needed)` })
      return {
        claimed: f.name,
        offer: {
          reply:
            `**We can make this happen.** You're holding ${holdings} — this just needs more USDG on Robinhood Chain than the wallet has there yet. ` +
            `I can bridge it over (LiFi-routed, delivered to your own address, arrives in seconds)${includeGas ? ', drop in a little ETH so Robinhood Chain gas is covered,' : ''} — every step built and guard-checked when it's your turn to sign. Once it settles, ask again and I'll build the trade with the funds in place.${inflightSuffix}`,
          clarify: { question: 'Fund Robinhood Chain from another chain?', options: chips.slice(0, 4) },
          buildPath: 'native-lifi-fund-offer',
        },
        contextBlock:
          `### Funding path ready (after the ${f.name} balance check)\n` +
          `The call stopped at a pre-flight balance check — more USDG is needed on Robinhood Chain — and the wallet holds ${holdings || 'USDC on other chains'}. The system RENDERS funding chips directly under your reply (this is guaranteed — never hedge about whether they appear, never add placeholder lines about them). ` +
          `Tell the user the chips below bridge the money over (they sign, delivered to their own address, arrives in seconds), and that once it settles they should re-ask so the action rebuilds with funds in place. ` +
          `Do NOT invent your own bridge instructions, amounts, or addresses.\n${TONE_DIRECTIVE}`,
      }
    }

    const offer = await offerFundingPlan({
      user,
      need: {
        chainId: detected.chainId,
        token: detected.token,
        amountHuman: detected.shortfall,
        followupResume: '', // bridge-only: the custom action re-runs after funds land
        actionLabel: `the ${f.name} action`,
      },
      trace,
    })
    if (!offer) return null
    if ('insufficient' in offer) {
      return {
        claimed: f.name,
        offer: null,
        contextBlock:
          `### Funding scan (after the ${f.name} balance check)\n${offer.insufficient}\n` +
          `The user should know exactly what they hold, per chain, and what the smallest plan needs — and that topping up any of those chains and asking again unlocks it. ` +
          `Frame it as a checkpoint, not an error: nothing was attempted, signed, or lost — no ❌ or "failed" headlines.`,
      }
    }
    return {
      claimed: f.name,
      offer: {
        ...offer,
        reply: `${offer.reply.replace(/ and finish [^—]+— one job[^.]*\./, '.')} Once the move settles (seconds), ask again and I'll build the action with the funds in place.`,
      },
      contextBlock:
        `### Funding path ready (after the ${f.name} balance check)\n` +
        `The call stopped at a pre-flight balance check, and the wallet holds movable funds on other chains. The system RENDERS funding chips directly under your reply (this is guaranteed — never hedge about whether they appear, never add placeholder lines about them). ` +
        `Tell the user the chips below move the money over (they sign, delivered to their own address), and that once it settles they should re-ask so the action rebuilds with funds in place. ` +
        `Do NOT invent your own bridge instructions, amounts, or addresses.\n${TONE_DIRECTIVE}`,
    }
  }
  return null
}
