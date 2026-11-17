// lib/job-preflight.ts — a job nobody can afford is refused BEFORE it exists.
//
// Squad lane1 (the jobs audit, 2026-11-17). On prod a new wallet holding
// 0 USDC on Base pressed the Jobs rail's "Try a 4-step job" ("Fund Robinhood
// Chain with $12 from Base including gas, then buy $10 of AAPL"). The job row
// was created and its first step failed in red: "Insufficient USDC on Base:
// this leg needs $2 but the wallet holds 0." Of 115 real failed jobs, the ones
// that were not plain expiry were mostly this: a first step the wallet could
// never have signed.
//
// The rule, applied at both doors that turn a compiled ask into a job (the
// chat route's job site and POST /api/jobs):
//
//   · read what the FIRST sign step spends (the leading funding legs count as
//     one spend: a $2 gas leg and a $10 value leg from Base need $12 there);
//   · ONE balance read for it. Provably short → no job row. The answer names
//     the shortfall and carries chips that work for THIS wallet: the same job
//     from a chain where its money is, a funded plan, or the card door when it
//     holds nothing anywhere. The wallet scan runs only on this refusal path;
//   · an unreadable balance, an unpriceable token or a step this file cannot
//     size passes (`unknown` / `no-check`): the job is created exactly as
//     before and the runner's own gate (lib/affordability + StepShortError in
//     lib/jobs-runner) withholds the step if it turns out short.
//
// Nothing here builds, signs or widens authority. The split is the usual one:
// `jobLeadNeed` / `jobGoalOf` / the copy are PURE (pinned in
// scripts/jobs-preflight-pins.ts); `preflightJob` is the I/O shell with every
// read injectable.

import { formatUnits } from 'viem'
import { buildsNatively } from '@/scripts/ask-ladder'
import { rpcBalanceReader, type BalanceReader } from '@/lib/affordability'
import { chainById } from '@/lib/chains'
import type { ClarifyOption, ClarifyRequest } from '@/lib/clarify'
import { expectedOriginChainId } from '@/lib/cross-chain-swap'
import { FUNDING_CHAIN_WORD, offerFundingPlan } from '@/lib/funding-plan'
import { fundingOriginWords } from '@/lib/funding-origins'
import { arbitrumUsdcBalance, hlOpenCollateralShortfall, type HlOpenShortfall, type HlOrderIntent } from '@/lib/hyperliquid-exec'
import { parseRobinhoodEthMove, parseRobinhoodFunding, parseRobinhoodGasFunding, robinhoodFundingFromCrossChain, splitJobSegments, type CompiledJob } from '@/lib/jobs'
import {
  fundingAltUsdcFor,
  lifiDestination,
  ORIGIN_ETH_KEEPBACK,
  planRobinhoodFundingAdvice,
  readFundingShortfall,
  ROBINHOOD_CHAIN_ID,
  type FundingShortfall,
  type RobinhoodFundingAdvice,
} from '@/lib/lifi-bridge'
import { fundSegment } from '@/lib/lifi-destinations'
import { fundChipFor, ONRAMP_NETWORK_LABEL, planFitsOneCheckout } from '@/lib/onramp'
import { usdPerToken } from '@/lib/usd-probe'

// ── What the first step spends (pure) ───────────────────────────────────────

/** The leading funding legs of a Robinhood Chain / Arc funding job. */
export interface FundingLead {
  destChainId: number
  originChainId: number
  token: string
  /** Dollars every leading leg moves, gas leg included. */
  usd: number
  gasIncluded: boolean
}

export type JobLeadNeed =
  /** A token amount on one chain (USDC on Base, ETH on Arbitrum). */
  | { kind: 'token'; chainId: number; symbol: string; amount: number; stepTitle: string; funding?: FundingLead }
  /** Dollars of native ETH sold by value (a "using eth" funding leg). */
  | { kind: 'eth-usd'; chainId: number; usd: number; stepTitle: string; funding?: FundingLead }
  /** A Hyperliquid open: it spends collateral on the venue, not a token. */
  | { kind: 'hl-open'; intent: HlOrderIntent; stepTitle: string }

const numOf = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v.replace(/,/g, '')) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * What a compiled job's FIRST step needs the wallet to hold. Null when the
 * job does not open on a sign step, or on a step this file cannot size
 * (Aave, Morpho, Lido, NFTs, sends): those pass, and the runner's gate stands.
 */
export function jobLeadNeed(compiled: CompiledJob): JobLeadNeed | null {
  const lead = compiled.steps[0]
  if (!lead || lead.kind !== 'sign') return null
  const p = (lead.params ?? {}) as Record<string, unknown>

  if (lead.builder === 'native-lifi-fund') {
    const origin = Number(p.origin ?? 8453)
    const token = String(p.token ?? 'USDC')
    const dest = p.dest !== undefined ? Number(p.dest) : ROBINHOOD_CHAIN_ID
    let usd = 0
    let gasIncluded = false
    // One spend for the whole leading run: a gas leg and the value leg after
    // it leave the same balance, and a wallet that covers only the first is
    // the "$52 needed, holds 31.25" job that failed at step 2 on prod.
    for (const s of compiled.steps) {
      const q = (s.params ?? {}) as Record<string, unknown>
      if (s.kind !== 'sign' || s.builder !== 'native-lifi-fund') break
      if (Number(q.origin ?? 8453) !== origin || String(q.token ?? 'USDC') !== token) break
      const legUsd = numOf(q.usd)
      if (legUsd === null) return null
      usd += legUsd
      if (q.leg === 'gas') gasIncluded = true
    }
    usd = Number(usd.toFixed(2))
    if (!(usd > 0) || !Number.isInteger(origin)) return null
    const funding: FundingLead = { destChainId: dest, originChainId: origin, token, usd, gasIncluded }
    return token.toUpperCase() === 'ETH'
      ? { kind: 'eth-usd', chainId: origin, usd, stepTitle: lead.title, funding }
      : { kind: 'token', chainId: origin, symbol: token, amount: usd, stepTitle: lead.title, funding }
  }

  if (lead.builder === 'native-hl-exec') {
    if (p.kind === 'deposit') {
      const amount = numOf(p.amountUsdc)
      return amount === null ? null : { kind: 'token', chainId: 42161, symbol: 'USDC', amount, stepTitle: lead.title }
    }
    if (p.kind === 'open') return { kind: 'hl-open', intent: p as unknown as HlOrderIntent, stepTitle: lead.title }
    return null
  }

  if (lead.builder === 'native-swap') {
    const amount = numOf(p.amountHuman)
    const chainId = Number(p.chainId)
    if (amount === null || !Number.isInteger(chainId) || typeof p.sellToken !== 'string') return null
    return { kind: 'token', chainId, symbol: p.sellToken, amount, stepTitle: lead.title }
  }

  if (lead.builder === 'native-cross-chain') {
    const amount = numOf(p.amount)
    const chainId = typeof p.originChain === 'string' ? expectedOriginChainId(p.originChain) : null
    if (amount === null || chainId === null || typeof p.originToken !== 'string') return null
    return { kind: 'token', chainId, symbol: p.originToken, amount, stepTitle: lead.title }
  }

  return null
}

/**
 * The part of a compound ask that comes AFTER its funding segments: "Fund
 * Robinhood Chain with $12 from Base including gas, then buy $10 of AAPL" →
 * "buy $10 of AAPL". Empty when the ask is funding only, or does not open on
 * a funding segment. Uses the compiler's own segment parsers, so it can never
 * disagree with what was compiled.
 */
export function jobGoalOf(ask: string): string {
  const segs = splitJobSegments(ask)
  let i = 0
  while (i < segs.length) {
    const seg = segs[i]
    const redirect = robinhoodFundingFromCrossChain(seg)
    const isFunding = !!parseRobinhoodFunding(seg) || !!parseRobinhoodGasFunding(seg) || !!parseRobinhoodEthMove(seg) || (!!redirect && 'ask' in redirect)
    if (!isFunding) break
    i += 1
  }
  if (i === 0) return ''
  return segs.slice(i).join(', then ').trim()
}

/** "buy $10 of AAPL" → the house phrasing that round-trips the ladder, when
 *  the goal is exactly one dollar-sized buy. */
export function loneBuyOf(goal: string): { usd: number; sym: string; resume: string } | null {
  const m = goal.trim().match(/^buy \$\s?(\d[\d,]*(?:\.\d+)?) of ([A-Za-z][A-Za-z0-9.]{0,11})(?: on robinhood(?: chain)?)?$/i)
  if (!m) return null
  const usd = Number(m[1].replace(/,/g, ''))
  if (!(usd > 0)) return null
  return { usd, sym: m[2].toUpperCase(), resume: `Buy $${usd} of ${m[2].toUpperCase()}` }
}

// ── Copy (pure) ─────────────────────────────────────────────────────────────

const NOT_NOW: ClarifyOption = { label: 'Not now', resume: 'Never mind — leave my funds where they are.' }

const amountWord = (n: number): string => {
  if (n === 0) return '0'
  if (n >= 1) return Number(n.toFixed(4)).toString()
  return Number(n.toPrecision(4)).toString()
}

export interface PreflightShortFacts {
  /** Null for a Hyperliquid collateral shortfall (the venue, not a chain). */
  chainId: number | null
  chain: string
  symbol: string
  needs: string
  held: string
  /** Dollars-of-ETH needs print as dollars ("$12 of ETH"). */
  needsAreUsd?: boolean
  hlCollateral?: true
  /** The token is there but the chain holds NO native ETH: nothing on it can
   *  be signed (the affordability gate's gas-at-zero rule). */
  gas?: true
}

/** The first sentence of every refusal: what the job needs, what is there. */
export function preflightLead(facts: PreflightShortFacts): string {
  if (facts.hlCollateral) {
    return `🧭 No job was created: it opens a position that needs about $${facts.needs} of collateral on Hyperliquid, and the account has $${facts.held} free.`
  }
  if (facts.gas) return `🧭 No job was created: its first step runs on ${facts.chain}, and this wallet holds no ETH there to pay for gas.`
  const needs = facts.needsAreUsd ? `$${facts.needs} of ${facts.symbol}` : `${facts.needs} ${facts.symbol}`
  return `🧭 No job was created: its first step spends ${needs} on ${facts.chain}, and this wallet holds ${facts.held} ${facts.symbol} there.`
}

/** The last words when there is nothing to press. */
export function preflightHomework(facts: PreflightShortFacts): string {
  if (facts.hlCollateral) return ` Deposit USDC to Hyperliquid first, then ask again. Nothing was built or signed.`
  if (facts.gas) return ` Send a little ETH to this wallet on ${facts.chain}, then ask again. Nothing was built or signed.`
  return ` Send ${facts.symbol} to this wallet on ${facts.chain} (or USDC or ETH on ${fundingOriginWords()}), then ask again. Nothing was built or signed.`
}

/** Keep only chips the ladder really builds (the decline chip always stays). */
export function buildableChips(options: ClarifyOption[], verify: (ask: string) => boolean = buildsNatively): ClarifyOption[] {
  return options.filter((o) => /^never mind\b/i.test(o.resume) || verify(o.resume))
}

/** The last resort when nothing can be pressed toward the money (no holding
 *  to move, the card door closed): the ask itself, to press once the funds
 *  are there. The same turn re-reads the wallet. Null when the ladder would
 *  not build it. */
export function recheckClarify(ask: string, verify: (ask: string) => boolean = buildsNatively): ClarifyRequest | null {
  const resume = ask.trim()
  if (!resume || !verify(resume)) return null
  return { question: 'Sent the funds?', options: [{ label: 'I sent funds, check again', resume }, NOT_NOW] }
}

const withDecline = (options: ClarifyOption[]): ClarifyOption[] => {
  const real = options.filter((o) => !/^never mind\b/i.test(o.resume))
  return real.length ? [...real.slice(0, 3), NOT_NOW] : []
}

/**
 * The answer for a funding job (Robinhood Chain / Arc) short on its named
 * origin, composed from the wallet's own scan. Pure: the scan and the advice
 * are handed in.
 */
export function fundingShortAnswer(input: {
  facts: PreflightShortFacts
  funding: FundingLead
  goal: string
  advice: RobinhoodFundingAdvice
  scan: Pick<FundingShortfall, 'origins'>
  /** The card chip, already built (null = the door is closed or does not fit). */
  cardChip: ClarifyOption | null
  /** The ask as typed: the recheck chip when there is nothing else to press. */
  ask?: string
  verify?: (ask: string) => boolean
}): { reply: string; clarify?: ClarifyRequest } {
  const { facts, funding, goal, advice, scan, cardChip } = input
  const verify = input.verify ?? buildsNatively
  const lead = preflightLead(facts)
  const destName = lifiDestination(funding.destChainId)?.name ?? 'the destination'
  const then = goal ? ` and then ${goal.replace(/^then\s+/i, '')}` : ''

  if (advice.kind === 'chips') {
    const options = withDecline(buildableChips(advice.chips, verify))
    if (options.length) {
      const held = scan.origins.filter((o) => o.usd > 0).map((o) => `~$${o.usd} of ${o.token} on ${o.word}`).join(', ')
      return {
        reply: `${lead} It does hold ${held || 'enough elsewhere'}, so the same job can run from there: fund ${destName} with $${funding.usd}${then}. Tap one and I'll line it up as one job you sign step by step. Nothing was built or signed.`,
        clarify: { question: 'Run it from where the money is?', options },
      }
    }
  }
  if (advice.kind === 'gas-stranded') {
    const options = advice.chips ? withDecline(buildableChips(advice.chips, verify)) : []
    return {
      reply: `${lead} But ${advice.copy} Nothing was built or signed.`,
      ...(options.length ? { clarify: { question: `Fix the ${advice.stranded.word} gas and run it?`, options } } : input.ask && recheckClarify(input.ask, verify) ? { clarify: recheckClarify(input.ask, verify)! } : {}),
    }
  }
  if (advice.kind === 'move' && advice.chips.length) {
    const options = withDecline(buildableChips(advice.chips, verify))
    if (options.length) return { reply: `${lead} ${advice.copy}`, clarify: { question: `Move your ETH to ${destName} instead?`, options } }
  }
  const seen = advice.kind === 'none' ? advice.copy : ''
  const across = seen ? ` Across the chains I can bridge from I see: ${seen}. That does not cover the ~$${funding.usd} plan.` : ''
  if (cardChip?.fund) {
    return {
      reply: `${lead}${across} You can add it with a card or bank below: it lands as ETH on ${ONRAMP_NETWORK_LABEL[cardChip.fund.network]}, which also pays the gas, and once it is there I'll line up the move${then}. Nothing was built or signed.`,
      clarify: { question: 'Add the funds and run it?', options: [cardChip, NOT_NOW] },
    }
  }
  const recheck = input.ask ? recheckClarify(input.ask, verify) : null
  return { reply: `${lead}${across}${preflightHomework(facts)}`, ...(recheck ? { clarify: recheck } : {}) }
}

// ── The I/O shell ───────────────────────────────────────────────────────────

export type JobPreflight =
  | { kind: 'ok' }
  /** Nothing this file can size leads the job: created as before. */
  | { kind: 'no-check' }
  /** A read failed: created as before (fail open, said out loud in the log). */
  | { kind: 'unknown'; reason: string }
  | { kind: 'short'; reply: string; clarify?: ClarifyRequest; short: PreflightShortFacts }

export interface JobPreflightDeps {
  reader?: BalanceReader
  ethUsd?: () => Promise<number | null>
  scanFunding?: (wallet: string, destChainId: number) => Promise<FundingShortfall>
  offerPlan?: typeof offerFundingPlan
  hlShortfall?: (intent: HlOrderIntent, wallet: string) => Promise<HlOpenShortfall | null>
  arbUsdc?: (wallet: string) => Promise<number>
  cardChip?: typeof fundChipFor
  verify?: (ask: string) => boolean
  /** Bound on each read, so a slow RPC can never hold the turn. */
  timeoutMs?: number
}

const PREFLIGHT_READ_TIMEOUT_MS = 6_000
const PREFLIGHT_SCAN_TIMEOUT_MS = 12_000

function within<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms)
  })
  return Promise.race([p, guard]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}

const firstLine = (e: unknown): string => (e instanceof Error ? e.message.split('\n')[0].slice(0, 160) : String(e).slice(0, 160))

/** Where a symbol lives on a chain, per the registry. Null = unknown token
 *  (the check is skipped, never guessed). */
function tokenOn(chainId: number, symbol: string): { native: true } | { native: false; address: string; decimals: number } | null {
  const sym = symbol.trim().toUpperCase()
  if (sym === 'ETH') return { native: true }
  const chain = chainById(chainId)
  const hit = Object.entries(chain?.tokens ?? {}).find(([s]) => s.toUpperCase() === sym)
  if (hit) return { native: false, address: hit[1].address.toLowerCase(), decimals: hit[1].decimals }
  const alt = fundingAltUsdcFor(chainId)
  if (alt && alt.symbol.toUpperCase() === sym) return { native: false, address: alt.address.toLowerCase(), decimals: alt.decimals }
  return null
}

/**
 * Pre-flight a compiled job for one wallet. `ask` is the sentence as typed
 * (chips restate it). Never throws.
 */
export async function preflightJob(input: {
  wallet: string
  compiled: CompiledJob
  ask: string
  /** The caller already ran the Hyperliquid open's own collateral check (the
   *  chat route compiles the funded job itself): skip it here. */
  hlOpenChecked?: boolean
  trace?: (event: unknown) => void
  deps?: JobPreflightDeps
}): Promise<JobPreflight> {
  const { wallet, compiled, ask } = input
  const deps = input.deps ?? {}
  const trace = input.trace ?? (() => {})
  const verify = deps.verify ?? buildsNatively
  const readMs = deps.timeoutMs ?? PREFLIGHT_READ_TIMEOUT_MS
  const need = jobLeadNeed(compiled)
  if (!need) return { kind: 'no-check' }

  try {
    // ── Hyperliquid open: collateral on the venue ──
    if (need.kind === 'hl-open') {
      if (input.hlOpenChecked) return { kind: 'no-check' }
      const short = await within((deps.hlShortfall ?? hlOpenCollateralShortfall)(need.intent, wallet), readMs, 'the Hyperliquid read')
      if (!short) return { kind: 'ok' }
      const facts: PreflightShortFacts = { chainId: null, chain: 'Hyperliquid', symbol: 'USDC', needs: amountWord(Number((short.withdrawableUsd + short.depositUsdc).toFixed(2))), held: short.withdrawableUsd.toFixed(2), hlCollateral: true }
      const fundedAsk = `deposit ${short.depositUsdc} USDC to Hyperliquid, then ${ask.trim()}`
      const arb = await within((deps.arbUsdc ?? arbitrumUsdcBalance)(wallet), readMs, 'the Arbitrum read').catch(() => null)
      const usdcShort = arb === null ? null : Number(Math.max(0, short.depositUsdc - arb).toFixed(2))
      const lead = preflightLead(facts)
      if (usdcShort === 0 && verify(fundedAsk)) {
        // Arbitrum covers the deposit: the funded version of the same ask.
        return {
          kind: 'short',
          short: facts,
          reply: `${lead} This wallet holds ${amountWord(arb ?? 0)} USDC on Arbitrum, which covers the $${short.depositUsdc} deposit, so the same job can lead with it. Nothing was built or signed.`,
          clarify: { question: 'Deposit first, then run it?', options: [{ label: `Deposit $${short.depositUsdc}, then run it`, resume: fundedAsk }, NOT_NOW] },
        }
      }
      const offer = usdcShort === null ? null : await within((deps.offerPlan ?? offerFundingPlan)({ user: wallet, need: { chainId: 42161, token: 'USDC', amountHuman: usdcShort, followupResume: fundedAsk, actionLabel: 'the Hyperliquid position' }, trace }), PREFLIGHT_SCAN_TIMEOUT_MS, 'the funding scan').catch(() => null)
      return shortFromOffer({ facts, offer, lead, resume: ask.trim(), actionLabel: 'run the job', verify, cardChip: deps.cardChip ?? fundChipFor })
    }

    // ── A token (or dollars of ETH) on one chain: ONE balance read ──
    const reader = deps.reader ?? rpcBalanceReader
    const chain = chainById(need.chainId)
    if (!chain) return { kind: 'unknown', reason: `chain ${need.chainId} is not in the registry` }
    const symbol = need.kind === 'eth-usd' ? 'ETH' : need.symbol
    const where = tokenOn(need.chainId, symbol)
    if (!where) return { kind: 'unknown', reason: `${symbol} is not a registry token on ${chain.name}` }
    let held: number
    let needs: number
    let facts: PreflightShortFacts
    let gasShort = false
    if (where.native) {
      const wei = await within(reader.native(need.chainId, wallet), readMs, `the ${chain.name} balance read`)
      held = Number(formatUnits(wei, 18))
      if (need.kind === 'eth-usd') {
        const price = await within((deps.ethUsd ?? (() => usdPerToken(8453, 'ETH').then((p) => p?.usd ?? null)))(), readMs, 'the ETH price read')
        if (!price || !(price > 0)) return { kind: 'unknown', reason: 'ETH could not be priced' }
        needs = need.usd / price + (ORIGIN_ETH_KEEPBACK[need.chainId] ?? 0)
        facts = { chainId: need.chainId, chain: chain.name, symbol: 'ETH', needs: amountWord(need.usd), held: amountWord(held), needsAreUsd: true }
      } else {
        needs = need.amount
        facts = { chainId: need.chainId, chain: chain.name, symbol: 'ETH', needs: amountWord(needs), held: amountWord(held) }
      }
    } else {
      // The token and the chain's gas, read together (no extra wall-clock). A
      // gas read that fails is ignored: only a READ zero is a verdict.
      const [read, gasWei] = await Promise.all([
        within(reader.erc20(need.chainId, where.address, wallet), readMs, `the ${chain.name} balance read`),
        within(reader.native(need.chainId, wallet), readMs, `the ${chain.name} gas read`).catch(() => null),
      ])
      held = Number(formatUnits(read.balance, read.decimals))
      needs = need.kind === 'token' ? need.amount : 0
      facts = { chainId: need.chainId, chain: chain.name, symbol: read.symbol || symbol.toUpperCase(), needs: amountWord(needs), held: amountWord(held) }
      if (held + 1e-9 >= needs && gasWei === BigInt(0)) {
        facts = { ...facts, gas: true }
        gasShort = true
      }
    }
    if (held + 1e-9 >= needs && !gasShort) return { kind: 'ok' }
    trace({ type: 'note', level: 'warn', label: gasShort ? `jobs pre-flight: the first step runs on ${facts.chain} and the wallet holds no ETH there for gas — no job created` : `jobs pre-flight: the first step needs ${facts.needsAreUsd ? '$' : ''}${facts.needs} ${facts.symbol} on ${facts.chain} and the wallet holds ${facts.held} — no job created` })

    // The wallet scan and the chips: only on this path.
    const lead = preflightLead(facts)
    if (need.funding) {
      const funding = need.funding
      const dest = lifiDestination(funding.destChainId)
      const goal = jobGoalOf(ask)
      const buy = loneBuyOf(goal)
      const scan = dest ? await within((deps.scanFunding ?? readFundingShortfall)(wallet, funding.destChainId), PREFLIGHT_SCAN_TIMEOUT_MS, 'the funding scan').catch(() => null) : null
      if (!scan || !dest) {
        // No scan: the buy asked alone re-reads the wallet on its own turn.
        const options = buy && verify(buy.resume) ? [{ label: `Buy $${buy.usd} of ${buy.sym} from what this wallet holds`, resume: buy.resume }, NOT_NOW] : []
        return { kind: 'short', short: facts, reply: `${lead}${preflightHomework(facts)}`, ...(options.length ? { clarify: { question: 'Plan it from what you hold?', options } } : {}) }
      }
      const advice = planRobinhoodFundingAdvice({ scan, needUsd: funding.usd, gasIncluded: funding.gasIncluded, followup: goal, dest, buyToken: buy?.sym })
      // The card lands ETH on its own lane; the resume is the buy asked alone
      // (the chat plans it from what landed) or, for a funding-only ask, the
      // same funding sentence from that lane.
      let cardChip: ClarifyOption | null = null
      if (advice.kind === 'none' || (advice.kind === 'chips' && buildableChips(advice.chips, verify).length === 0)) {
        const laneResume = `${fundSegment(funding.usd, 'ethereum', funding.gasIncluded, 'ETH', dest)}${goal ? `, then ${goal}` : ''}`
        const resume = buy ? buy.resume : laneResume
        if (verify(resume) && planFitsOneCheckout(funding.usd)) {
          cardChip = (deps.cardChip ?? fundChipFor)({ needUsd: funding.usd, actionLabel: buy ? `buy $${buy.usd} of ${buy.sym}` : `fund ${dest.name} with $${funding.usd}`, resume })
        }
      }
      return { kind: 'short', short: facts, ...fundingShortAnswer({ facts, funding, goal, advice, scan, cardChip, verify, ask }) }
    }

    // Any other lead: the generic funding plan toward the chain it spends on.
    const shortBy = Number(Math.max(0, needs - held).toFixed(6))
    const plannable = need.kind === 'token' && !!FUNDING_CHAIN_WORD[need.chainId]
    const offer = plannable
      ? await within((deps.offerPlan ?? offerFundingPlan)({ user: wallet, need: { chainId: need.chainId, token: facts.symbol, amountHuman: shortBy, followupResume: ask.trim(), actionLabel: 'the job' }, trace }), PREFLIGHT_SCAN_TIMEOUT_MS, 'the funding scan').catch(() => null)
      : null
    return shortFromOffer({ facts, offer, lead, resume: ask.trim(), actionLabel: 'run the job', verify, cardChip: deps.cardChip ?? fundChipFor })
  } catch (e) {
    // FAIL OPEN, OUT LOUD (the affordability gate's posture): a read that did
    // not answer is not chain state.
    const reason = firstLine(e)
    console.warn(`[jobs] pre-flight unverified (${reason}) — creating the job as before`)
    return { kind: 'unknown', reason }
  }
}

/** Turn the generic funding layer's answer into the refusal: its chips when it
 *  can plan, the card door when the wallet cannot cover it, homework else. */
function shortFromOffer(input: {
  facts: PreflightShortFacts
  offer: Awaited<ReturnType<typeof offerFundingPlan>>
  lead: string
  resume: string
  actionLabel: string
  verify: (ask: string) => boolean
  cardChip: typeof fundChipFor
}): JobPreflight {
  const { facts, offer, lead, resume, actionLabel, verify } = input
  if (offer && 'clarify' in offer) {
    const options = withDecline(buildableChips(offer.clarify.options, verify))
    if (options.length) {
      return {
        kind: 'short',
        short: facts,
        reply: `${lead} It holds money on another chain, so the same job can lead with the move. ${offer.reply.replace(/^[^\w*]+/, '')}`,
        clarify: { question: 'Fund it and run the job?', options },
      }
    }
  }
  if (offer && 'insufficient' in offer) {
    const chip = !offer.strandedCovers && planFitsOneCheckout(offer.needUsd) && verify(resume) ? input.cardChip({ needUsd: offer.needUsd, actionLabel, resume }) : null
    if (chip?.fund) {
      return {
        kind: 'short',
        short: facts,
        reply: `${lead} ${offer.insufficient} You can add it with a card or bank below: it lands as ETH on ${ONRAMP_NETWORK_LABEL[chip.fund.network]}, and once it is there I'll plan the job from it. Nothing was built or signed.`,
        clarify: { question: 'Add the funds and run it?', options: [chip, NOT_NOW] },
      }
    }
    const recheck = recheckClarify(resume, verify)
    return { kind: 'short', short: facts, reply: `${lead} ${offer.insufficient} Nothing was built or signed.`, ...(recheck ? { clarify: recheck } : {}) }
  }
  const recheck = recheckClarify(resume, verify)
  return { kind: 'short', short: facts, reply: `${lead}${preflightHomework(facts)}`, ...(recheck ? { clarify: recheck } : {}) }
}

/** The wire shape both doors attach to a short answer (the chat exit's own
 *  `affordability` note, so traces and the failure log file it the same way). */
export function preflightAffordabilityNote(short: PreflightShortFacts): { short: PreflightShortFacts; withheldBuildPath: 'native-job' } {
  return { short, withheldBuildPath: 'native-job' }
}
