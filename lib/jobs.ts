// ─────────────────────────────────────────────────────────────────────────
//  Multi-step jobs — the orchestration primitive (HANDOFF-multistep-jobs.md).
//
//  COMPILER (pure, this file's top half): one compound ask → a FIXED
//  sequence of steps, each backed by an existing native parser. The plan is
//  compiled once, at creation — the runner executes and re-guards; it never
//  re-plans. A segment no native layer can parse fails the WHOLE compile
//  with an honest explanation (jobs are deterministic or they are nothing).
//
//  Step kinds:
//   · sign — a guarded artifact the user's wallet signs. Built FRESH at
//     offer time by the same builders chat uses; the JobCard embeds the
//     existing sign buttons.
//   · wait — a settlement predicate the runner polls. Waits ARE the
//     verification layer: the next step's build re-checks balances anyway,
//     so a lying completion just fails closed one step later.
//   · auto — a server-side action under an EXISTING consent (guardian arm
//     needs an active approveAgent delegation). Jobs never widen authority.
// ─────────────────────────────────────────────────────────────────────────

import { parseCrossChainSwap, type CrossChainSwapParams } from '@/lib/cross-chain-swap'
import { parseHlIntent, type HlIntent, type HlOrderIntent } from '@/lib/hyperliquid-exec'
import { parseGuardianArm, type GuardianArmAsk } from '@/lib/hl-guardian'
import { parseLidoStake } from '@/lib/lido-stake'
import { GAS_LEG_USD } from '@/lib/lifi-bridge'

export interface CompiledStep {
  kind: 'sign' | 'wait' | 'auto'
  /** build_path-style attribution; 'wait' for wait steps. */
  builder: string
  title: string
  params: Record<string, unknown>
  /** wait steps: what the runner polls. {kind:'oneclick', fromStep} |
   *  {kind:'hl-credit', minUsd} — fromStep indexes the step whose artifact
   *  carries the deposit address. */
  waitPredicate?: Record<string, unknown>
}

export interface CompiledJob {
  title: string
  steps: CompiledStep[]
}

// ── Robinhood funding plan ──────────────────────────────────────────────────
// "Fund robinhood chain with $12 from base including gas, then buy $10 of
// AAPL" — the exact resume string the chat route's funding-offer chips emit
// (prepareSwapTurn detects an unfunded Robinhood Chain buy and proposes the
// plan). Deterministic on purpose: the chip IS the contract, so the parse
// stays narrow — "fund robinhood … with $X from base" and nothing looser.

export interface RobinhoodFundingAsk {
  /** Total dollars of Base USDC to convert (gas leg included when flagged). */
  fundUsd: number
  /** True when a gas leg (Base USDC → native ETH on 4663) must come first. */
  gasIncluded: boolean
}

const FUND_RE = /\bfund\s+robinhood(?:\s+chain)?\s+with\s+\$?(\d+(?:\.\d+)?)\s+from\s+base\b/i

export function parseRobinhoodFunding(segment: string): RobinhoodFundingAsk | null {
  const m = segment.match(FUND_RE)
  if (!m) return null
  const fundUsd = Number(m[1])
  if (!Number.isFinite(fundUsd) || fundUsd <= 0) return null
  return { fundUsd, gasIncluded: /\bincluding\s+gas\b/i.test(segment) }
}

// The buy segment that follows a funding segment ("buy $10 of AAPL"). Only
// consulted once a funding step compiled — a bare "buy $X of Y" elsewhere
// belongs to the swap layer, not the jobs compiler.
const FUND_BUY_RE = /\bbuy\s+\$?(\d+(?:\.\d+)?)(?:\s+worth)?\s+of\s+([A-Za-z]{1,10})\b/i

/** Split a compound ask into segments on then/;/→ connectors. */
export function splitJobSegments(message: string): string[] {
  return message
    .split(/\s*(?:→|;|,?\s*(?:and\s+)?\bthen\b)\s*/i)
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Compile a compound ask, or explain exactly which segment can't be. Returns
 * null when the message isn't job-shaped (fewer than 2 parseable segments —
 * single asks belong to the native layers directly).
 */
export function compileJobAsk(message: string): CompiledJob | { problem: string } | null {
  const segments = splitJobSegments(message)
  if (segments.length < 2) return null

  const steps: CompiledStep[] = []
  const titles: string[] = []
  // Set once a Robinhood funding segment compiles — gates the buy segment,
  // so a bare "buy $X of Y" in any other compound ask never lands here.
  let fundingSeen = false
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]

    const fund = parseRobinhoodFunding(seg)
    if (fund) {
      const usdgUsd = Math.max(0, Number((fund.fundUsd - (fund.gasIncluded ? GAS_LEG_USD : 0)).toFixed(2)))
      if (usdgUsd <= 0) {
        return { problem: `Step ${i + 1}: $${fund.fundUsd} isn't enough to fund Robinhood Chain${fund.gasIncluded ? ` — the gas leg alone is ~$${GAS_LEG_USD}` : ''}.` }
      }
      const arrivalFrom: number[] = []
      if (fund.gasIncluded) {
        steps.push({ kind: 'sign', builder: 'native-lifi-fund', title: `Bridge ~$${GAS_LEG_USD} of gas ETH → Robinhood Chain`, params: { leg: 'gas', usd: GAS_LEG_USD } })
        arrivalFrom.push(steps.length - 1)
      }
      steps.push({ kind: 'sign', builder: 'native-lifi-fund', title: `Move $${usdgUsd} of Base USDC → USDG on Robinhood Chain`, params: { leg: 'usdg', usd: usdgUsd } })
      arrivalFrom.push(steps.length - 1)
      steps.push({
        kind: 'wait',
        builder: 'wait',
        title: 'Funds arrive on Robinhood Chain',
        params: {},
        waitPredicate: { kind: 'chain-arrival', fromSteps: arrivalFrom },
      })
      titles.push(`Fund Robinhood Chain with $${fund.fundUsd} from Base`)
      fundingSeen = true
      continue
    }

    if (fundingSeen) {
      const buy = seg.match(FUND_BUY_RE)
      if (buy) {
        const buyUsd = Number(buy[1])
        const buyToken = buy[2].toUpperCase()
        const title = `Buy ~$${buyUsd} of ${buyToken} with the arrived USDG`
        steps.push({ kind: 'sign', builder: 'native-lifi-swap', title, params: { buyUsd, buyToken, sellToken: 'USDG', chainId: 4663 } })
        titles.push(`Buy $${buyUsd} of ${buyToken}`)
        continue
      }
    }

    const cc = parseCrossChainSwap(seg)
    if (cc && 'problem' in cc) return { problem: `Step ${i + 1}: ${cc.problem}` }
    if (cc) {
      const ccp = cc as CrossChainSwapParams
      const title = `Bridge ${ccp.amount} ${ccp.originToken.toUpperCase()} (${ccp.originChain}) → ${ccp.destinationToken.toUpperCase()} (${ccp.destinationChain})`
      steps.push({ kind: 'sign', builder: 'native-cross-chain', title, params: ccp as unknown as Record<string, unknown> })
      steps.push({
        kind: 'wait',
        builder: 'wait',
        title: 'Solver settles the swap',
        params: {},
        waitPredicate: { kind: 'oneclick', fromStep: steps.length - 1 },
      })
      titles.push(title)
      continue
    }

    const hl = parseHlIntent(seg)
    if (hl) {
      if (hl.kind === 'deposit') {
        const title = `Deposit ${hl.amountUsdc} USDC to Hyperliquid`
        steps.push({ kind: 'sign', builder: 'native-hl-exec', title, params: hl as unknown as Record<string, unknown> })
        steps.push({
          kind: 'wait',
          builder: 'wait',
          title: 'Hyperliquid credits the deposit',
          params: {},
          waitPredicate: { kind: 'hl-credit', minUsd: Math.min(hl.amountUsdc * 0.9, hl.amountUsdc - 0.5) },
        })
        titles.push(title)
      } else {
        const o = hl as HlOrderIntent
        const title =
          o.kind === 'close'
            ? `Close ${o.coin} on Hyperliquid`
            : `${o.isBuy ? 'Long' : 'Short'} ${o.notionalUsd ? `$${o.notionalUsd} of ` : `${o.sizeUnits} `}${o.coin} on Hyperliquid`
        steps.push({ kind: 'sign', builder: 'native-hl-exec', title, params: hl as unknown as Record<string, unknown> })
        titles.push(title)
      }
      continue
    }

    const lido = parseLidoStake(seg)
    if (lido && 'problem' in lido) return { problem: `Step ${i + 1}: ${lido.problem}` }
    if (lido) {
      const title =
        lido.amount === 'max'
          ? `Stake the ETH on Lido${lido.receive === 'wstETH' ? ' (wstETH)' : ''}`
          : `Stake ${lido.amount} ETH on Lido${lido.receive === 'wstETH' ? ' (wstETH)' : ''}`
      steps.push({ kind: 'sign', builder: 'native-lido', title, params: lido as unknown as Record<string, unknown> })
      titles.push(title)
      continue
    }

    const arm = parseGuardianArm(seg)
    if (arm) {
      const title = `Arm ${arm.kind === 'stop_loss' ? 'stop-loss' : 'take-profit'} on ${arm.coin} (${arm.triggerMode === 'price' ? `px ${arm.triggerValue}` : `${arm.triggerValue}%`})`
      steps.push({ kind: 'auto', builder: 'native-hl-guardian', title, params: arm as unknown as Record<string, unknown> })
      titles.push(title)
      continue
    }

    // First segment already not ours → this isn't a job ask at all; let the
    // native layers / router handle the message. But once ANY segment
    // compiled, an unparseable later segment is an honest hard stop — a job
    // with a guessed step is worse than no job.
    if (steps.length === 0) return null
    return {
      problem:
        `I can compile steps that are cross-chain swaps, Robinhood Chain funding plans, Hyperliquid deposits/orders, Lido stakes, or guardian protection — ` +
        `step ${i + 1} ("${seg.slice(0, 80)}") isn't one of those yet, so I won't guess. ` +
        `Amounts must be explicit (e.g. "deposit 20 usdc to hyperliquid").`,
    }
  }

  // A "job" of one real action + its waits is just that action — let the
  // native layer own it directly.
  if (titles.length < 2) return null
  return { title: titles.join(' → '), steps }
}

export type { HlIntent, GuardianArmAsk, CrossChainSwapParams }
