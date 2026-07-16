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

const legResume = (s: FundingSource, amount: string, need: FundingNeed): string =>
  `Swap ${amount} ${s.token} from ${s.chainWord} to ${need.token.toUpperCase()} on ${FUNDING_CHAIN_WORD[need.chainId]}`

/** Rank: same token first (no swap spread), stables next, ETH last; richest
 *  chain first within each group. */
export function rankFundingSources(need: FundingNeed, sources: FundingSource[]): FundingSource[] {
  const group = (s: FundingSource) => (s.token.toUpperCase() === need.token.toUpperCase() ? 0 : s.token === 'USDC' ? 1 : 2)
  return [...sources].sort((a, b) => group(a) - group(b) || b.usd - a.usd)
}

/** The gas-leg resume segment: same source, delivered as native ETH on the
 *  destination so the follow-up action can actually be signed. */
const gasLegResume = (s: FundingSource, amount: string, need: FundingNeed): string =>
  `Swap ${amount} ${s.token} from ${s.chainWord} to ETH on ${FUNDING_CHAIN_WORD[need.chainId]}`

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
  const totalNeedUsd = Number((needUsd + gasUsd).toFixed(2))

  /** [gas leg?, token leg] from ONE source, spending `tokenUsd` on the token
   *  leg — the source must hold tokenUsd + gasUsd or this returns null. */
  const legsFrom = (s: FundingSource, tokenUsd: number): string[] | null => {
    if (s.usd < tokenUsd + gasUsd) return null
    const segs: string[] = []
    let spent = 0
    if (gasUsd > 0) {
      segs.push(gasLegResume(s, sourceAmountFor(s, gasUsd), need))
      spent = gasUsd
    }
    // The token leg's amount comes out of what's left of the source.
    const remaining: FundingSource = { ...s, balance: s.balance * (1 - spent / s.usd), usd: s.usd - spent }
    segs.push(legResume(remaining, sourceAmountFor(remaining, tokenUsd), need))
    return segs
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

// ── I/O: the wallet scan + the offer turn ───────────────────────────────────

export interface FundingScan {
  sources: FundingSource[]
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

/** Read movable ETH + USDC across the scan chains, one retry per chain.
 *  Throws only when NOTHING was readable. */
export async function scanFundingSources(user: string): Promise<FundingScan> {
  const ethProbe = await usdPerToken(8453, 'ETH').catch(() => null)
  const sources: FundingSource[] = []
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
        const nativeEth = Number(formatEther(nativeWei))
        const usdcBal = Number(formatUnits(usdcAtoms, usdc.decimals))
        if (usdcBal > 0 && nativeEth >= (MIN_GAS_TO_SEND_ETH[chainId] ?? 0.001)) {
          sources.push({ chainId, chainWord: word, token: 'USDC', balance: usdcBal, usd: usdcBal })
        }
        const movableEth = nativeEth - (GAS_RESERVE_ETH[chainId] ?? 0.002)
        if (ethProbe && movableEth > 0) {
          sources.push({ chainId, chainWord: word, token: 'ETH', balance: movableEth, usd: movableEth * ethProbe.usd })
        }
      } catch {
        failedChains.push(word)
      }
    }),
  )
  if (readChains.length === 0) throw new Error('no funding-scan chain was readable')
  return { sources, readChains, failedChains }
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

  const needUsd = fundingPlanUsd(need.amountHuman, tokenUsd)
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
      return null
    }
    const chainsRead = scan.readChains.join(', ').replace(/, ([^,]*)$/, ' and $1')
    trace({
      type: 'note',
      level: 'warn',
      label: `funding layer: ${need.actionLabel} needs ~$${plan.needUsd} moved but the wallet holds ~$${plan.totalUsd} movable across ${chainsRead} — honest refusal`,
    })
    return {
      insufficient:
        (plan.sourceSummary
          ? `Across ${chainsRead} I can see ${plan.sourceSummary} — `
          : `Across ${chainsRead} I found no movable ETH or USDC — `) +
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
      `I can move it over (NEAR Intents, delivered to your own address)${gasUsd > 0 ? `, drop in a little ETH so ${destChain.name} gas is covered,` : ''} and finish ${need.actionLabel} — one job, every step built and guard-checked when it's your turn to sign.`,
    clarify: { question: 'Fund it from another chain?', options: plan.chips },
    buildPath: 'native-funding-offer',
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
const NEEDED_RE = new RegExp(`\\b(?:needs?|requires?|staking|bridging|sending|supplying|repaying|depositing|short)\\s+~?\\$?(\\d+(?:\\.\\d+)?)\\s*(${TOKEN_SYM})\\b`)
// "holds 3.000000 USDC" / "wallet holds only 0 ETH" / "has 3 USDC" / "you have 3 USDC"
const HELD_RE = new RegExp(`\\b(?:holds?|have|has)\\s+(?:only\\s+)?~?\\$?(\\d+(?:\\.\\d+)?)\\s*(${TOKEN_SYM})?\\b`)
// "insufficient USDC" / "not enough ETH" — the token when NEEDED_RE misses
const TRIGGER_TOKEN_RE = new RegExp(`\\b(?:insufficient|not enough)\\s+(?:balance\\s+of\\s+)?(${TOKEN_SYM})\\b`)
const CHAIN_HINT_RE = /\bon\s+(base|arbitrum(?:\s+one)?|arb|ethereum|eth\s+mainnet|mainnet)\b/i

const CHAIN_HINT_IDS: Record<string, number> = {
  base: 8453,
  arbitrum: 42161,
  'arbitrum one': 42161,
  arb: 42161,
  ethereum: 1,
  'eth mainnet': 1,
  mainnet: 1,
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
 */
export function detectBalanceShortfall(text: string): DetectedShortfall | null {
  if (!text || !SHORTFALL_TRIGGER_RE.test(text)) return null
  const chainHint = text.match(CHAIN_HINT_RE)
  if (!chainHint) return null
  const chainId = CHAIN_HINT_IDS[chainHint[1].toLowerCase().replace(/\s+/g, ' ')]
  if (!chainId || !FUNDING_CHAIN_WORD[chainId]) return null

  const needed = text.match(NEEDED_RE)
  const token = needed?.[2] ?? text.match(TRIGGER_TOKEN_RE)?.[1] ?? null
  if (!token || !needed) return null
  const neededAmt = Number(needed[1])
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
): Promise<GenericFundingFallback | null> {
  for (const f of failures) {
    const detected = detectBalanceShortfall(f.note)
    if (!detected) continue
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
        offer: null,
        contextBlock:
          `### Funding scan (after the ${f.name} failure)\n${offer.insufficient}\n` +
          `Weave this into the failure explanation — the user should know exactly what they hold, per chain, and what the smallest plan needs.`,
      }
    }
    return {
      offer: {
        ...offer,
        reply: `${offer.reply.replace(/ and finish [^—]+— one job[^.]*\./, '.')} Once the move settles (seconds), ask again and I'll build the action with the funds in place.`,
      },
      contextBlock:
        `### Funding options found (after the ${f.name} failure)\n` +
        `The failed call was short of funds, but the wallet holds movable funds on other chains. The system RENDERS funding chips directly under your reply (this is guaranteed — never hedge about whether they appear, never add placeholder lines about them). ` +
        `Tell the user the action couldn't be funded yet, that the chips below move the money over (they sign, delivered to their own address), and that once it settles they should re-ask so the action rebuilds with funds in place. ` +
        `Do NOT invent your own bridge instructions, amounts, or addresses.`,
    }
  }
  return null
}
