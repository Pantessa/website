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

export interface FundingNeed {
  /** Destination chain + token the blocked action needs. */
  chainId: number
  token: string
  /** How much MORE of the token must land there (shortfall, not the ask). */
  amountHuman: number
  /** The segment appended after the funding legs — MUST parse under an
   *  existing native layer (e.g. "stake all my ETH on Lido"). */
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

const legResume = (s: FundingSource, amount: string, need: FundingNeed): string =>
  `Swap ${amount} ${s.token} from ${s.chainWord} to ${need.token.toUpperCase()} on ${FUNDING_CHAIN_WORD[need.chainId]}`

/** Rank: same token first (no swap spread), stables next, ETH last; richest
 *  chain first within each group. */
export function rankFundingSources(need: FundingNeed, sources: FundingSource[]): FundingSource[] {
  const group = (s: FundingSource) => (s.token.toUpperCase() === need.token.toUpperCase() ? 0 : s.token === 'USDC' ? 1 : 2)
  return [...sources].sort((a, b) => group(a) - group(b) || b.usd - a.usd)
}

/**
 * The pure planner: rank the sources and turn a shortfall into chips (or an
 * honest "the whole wallet can't cover it"). Every chip's resume string is
 * harness-checked to compile under lib/jobs.ts — the chip is the contract.
 */
export function planFundingChips(need: FundingNeed, needUsd: number, sources: FundingSource[]): FundingPlan {
  // Destination-chain balances are never sources — these legs are NEAR
  // Intents bridges, and a same-chain conversion belongs to the swap venues.
  const ranked = rankFundingSources(
    need,
    sources.filter((s) => s.usd >= DUST_USD && s.chainId !== need.chainId),
  )
  const sourceSummary = ranked
    .slice(0, 4)
    .map((s) => `~$${usd2(Number(s.usd.toFixed(2)))} of ${s.token} on ${s.chainWord}`)
    .join(', ')
  const totalUsd = Number(ranked.reduce((a, s) => a + s.usd, 0).toFixed(2))

  const best = ranked.find((s) => s.usd >= needUsd)
  const chips: FundingChip[] = []
  if (best) {
    const amount = sourceAmountFor(best, needUsd)
    chips.push({
      label: `Just enough (~$${usd2(needUsd)} of ${best.token} on ${best.chainWord})`,
      resume: `${legResume(best, amount, need)}, then ${need.followupResume}`,
    })
    // "All of it" only when it's a sensible whole-balance move — a $15k
    // balance covering a $25 need doesn't get an all-in chip.
    if (best.usd >= needUsd * 1.6 && best.usd <= needUsd * 10) {
      const all = fmtAmount(best.balance, best.token === 'USDC' ? 2 : 6, 'down')
      chips.push({
        label: `All my ${best.token} on ${best.chainWord} (~$${usd2(Number(best.usd.toFixed(2)))})`,
        resume: `${legResume(best, all, need)}, then ${need.followupResume}`,
      })
    }
  } else if (totalUsd >= needUsd && ranked.length >= 2) {
    // No single source covers it — combine legs (richest-first) until it does.
    const legs: string[] = []
    let covered = 0
    for (const s of [...ranked].sort((a, b) => b.usd - a.usd)) {
      const legUsd = Math.min(s.usd, needUsd - covered)
      legs.push(legResume(s, sourceAmountFor(s, legUsd), need))
      covered += s.usd
      if (covered >= needUsd) break
    }
    chips.push({
      label: `Combine ${legs.length} chains (~$${usd2(needUsd)} total)`,
      resume: `${legs.join(', then ')}, then ${need.followupResume}`,
    })
  }

  if (chips.length === 0) return { kind: 'short', needUsd, totalUsd, sourceSummary }
  chips.push({ label: 'Not now', resume: 'Never mind — leave my funds where they are.' })
  return { kind: 'offer', needUsd, chips: chips.slice(0, 4), sourceSummary }
}

// ── I/O: the wallet scan + the offer turn ───────────────────────────────────

/** Read movable ETH + USDC across the scan chains. Per-chain read failures
 *  drop that chain (fail-soft); throws only when NOTHING was readable. */
export async function scanFundingSources(user: string): Promise<FundingSource[]> {
  const ethProbe = await usdPerToken(8453, 'ETH').catch(() => null)
  let readable = 0
  const sources: FundingSource[] = []
  await Promise.all(
    FUNDING_SCAN_CHAINS.map(async (chainId) => {
      const chain = chainById(chainId)
      const client = publicClientFor(chainId)
      const usdc = chain?.tokens.USDC
      if (!chain || !client || !usdc) return
      try {
        const [nativeWei, usdcAtoms] = await Promise.all([
          client.getBalance({ address: user as `0x${string}` }),
          client.readContract({ address: usdc.address, abi: erc20Abi, functionName: 'balanceOf', args: [user as `0x${string}`] }),
        ])
        readable++
        const nativeEth = Number(formatEther(nativeWei))
        const usdcBal = Number(formatUnits(usdcAtoms, usdc.decimals))
        const word = FUNDING_CHAIN_WORD[chainId]
        if (usdcBal > 0 && nativeEth >= (MIN_GAS_TO_SEND_ETH[chainId] ?? 0.001)) {
          sources.push({ chainId, chainWord: word, token: 'USDC', balance: usdcBal, usd: usdcBal })
        }
        const movableEth = nativeEth - (GAS_RESERVE_ETH[chainId] ?? 0.002)
        if (ethProbe && movableEth > 0) {
          sources.push({ chainId, chainWord: word, token: 'ETH', balance: movableEth, usd: movableEth * ethProbe.usd })
        }
      } catch {
        /* this chain's RPC is down — the others still count */
      }
    }),
  )
  if (readable === 0) throw new Error('no funding-scan chain was readable')
  return sources
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
  if (!destChain || !FUNDING_CHAIN_WORD[need.chainId] || !(need.amountHuman > 0)) return null

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

  let sources: FundingSource[]
  try {
    sources = await scanFundingSources(user)
  } catch {
    trace({ type: 'note', level: 'warn', label: 'funding layer: wallet scan unavailable — falling through' })
    return null
  }

  const needUsd = fundingPlanUsd(need.amountHuman, tokenUsd)
  const plan = planFundingChips(need, needUsd, sources)

  if (plan.kind === 'short') {
    trace({
      type: 'note',
      level: 'warn',
      label: `funding layer: ${need.actionLabel} needs ~$${plan.needUsd} moved but the wallet holds ~$${plan.totalUsd} movable across the scan chains — honest refusal`,
    })
    return {
      insufficient:
        (plan.sourceSummary
          ? `Across Base, Arbitrum and Ethereum I can see ${plan.sourceSummary} — `
          : 'Across Base, Arbitrum and Ethereum I found no movable ETH or USDC — ') +
        `the smallest plan for ${need.actionLabel} moves ~$${usd2(plan.needUsd)} (solver fees included). Top up any of those chains and ask again.`,
    }
  }

  trace({
    type: 'status',
    label: `funding layer claimed the turn: ${need.token} short on ${destChain.name} for ${need.actionLabel} — offering ${plan.chips.length - 1} funding path(s) (~$${plan.needUsd} needed, NEAR Intents legs)`,
  })
  return {
    reply:
      `You don't have enough ${need.token.toUpperCase()} on ${destChain.name} for ${need.actionLabel} yet — but you're holding ${plan.sourceSummary}. ` +
      `I can move it over (NEAR Intents, delivered to your own address) and finish ${need.actionLabel} — one job, every step built and guard-checked when it's your turn to sign.`,
    clarify: { question: 'Fund it from another chain?', options: plan.chips },
    buildPath: 'native-funding-offer',
  }
}
