// ─────────────────────────────────────────────────────────────────────────
//  Rebalance I/O shell — the thin network layer under lib/rebalance.ts
//  (the funding-plan / briefing seam pattern: THE rules live in the pure
//  module; this file only reads).
//
//  Reads, all fail-soft on the job-context conventions (per-provider
//  timeout + allSettled — a dead venue skips ITSELF by name, never the
//  turn):
//  · scanFundingSources — the same movable/stranded read every funding
//    offer uses (Base / Arbitrum / Ethereum, ETH + USDC). The one REQUIRED
//    read: no scan, no plan (the turn says so instead of guessing).
//  · Aave v4 reserves (USDC supply APY on Ethereum) + portfolio (what's
//    already supplied) via the free aave MCP.
//  · Lido position (stETH staked + the 7d SMA APR) via the free lido MCP.
// ─────────────────────────────────────────────────────────────────────────

import { callMcpTool } from './mcp-call'
import { LIDO_MCP } from './lido-stake'
import { pickSupplyReserve, type AaveReserveRow } from './aave-supply'
import { scanFundingSources, type FundingScan } from './funding-plan'
import {
  moveAsk,
  planRebalance,
  type RebalanceInputs,
  type RebalancePlan,
} from './rebalance'

/** Mirrors lib/aave-exec's endpoint — the free first-party Aave MCP. */
const AAVE_MCP = 'https://aave-mcp.yeetful.com/mcp'
const PROVIDER_TIMEOUT_MS = 8_000

const withTimeout = <T,>(p: Promise<T>): Promise<T> =>
  Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('provider timeout')), PROVIDER_TIMEOUT_MS)),
  ])

export interface RebalanceRead {
  plan: RebalancePlan
  scan: RebalanceInputs['scan']
}

/**
 * The whole read: scan + rates + already-earning positions → the pure plan.
 * Null only when the funding scan itself was unreadable (every chain RPC
 * down) — the caller answers honestly rather than planning on nothing.
 */
export async function readRebalance(address: string): Promise<RebalanceRead | null> {
  const [scanRes, apyRes, suppliedRes, lidoRes] = await Promise.allSettled([
    withTimeout(scanFundingSources(address)),
    withTimeout(callMcpTool(AAVE_MCP, 'reserves', { symbols: ['USDC'], chainId: 1 }, { timeoutMs: PROVIDER_TIMEOUT_MS })),
    withTimeout(callMcpTool(AAVE_MCP, 'portfolio', { user: address }, { timeoutMs: PROVIDER_TIMEOUT_MS })),
    withTimeout(callMcpTool(LIDO_MCP, 'position', { user: address }, { timeoutMs: PROVIDER_TIMEOUT_MS })),
  ])
  if (scanRes.status !== 'fulfilled') return null
  const scan: FundingScan = scanRes.value

  let aaveUsdcSupplyApyPct: number | null = null
  if (apyRes.status === 'fulfilled') {
    const rows = ((apyRes.value as { reserves?: AaveReserveRow[] } | null)?.reserves ?? []) as AaveReserveRow[]
    aaveUsdcSupplyApyPct = pickSupplyReserve(rows, 'USDC')?.supplyApyPct ?? null
  }

  // A SUCCESSFUL portfolio read with no position is a real zero; a failed
  // read is unknown (null) — absence is never claimed from a dead provider.
  let aaveSuppliedUsd: number | null = null
  if (suppliedRes.status === 'fulfilled') {
    const positions = (suppliedRes.value as { positions?: { supplies?: { balanceUsd?: number }[] }[] } | null)?.positions ?? []
    aaveSuppliedUsd = positions.flatMap((p) => p.supplies ?? []).reduce((a, s) => a + (s.balanceUsd ?? 0), 0)
  }

  let lidoAprPct: number | null = null
  let lidoStakedUsd: number | null = null
  if (lidoRes.status === 'fulfilled') {
    const pos = lidoRes.value as { hasPosition?: boolean; totalStaked?: { usd?: number }; currentAprPct?: number | null } | null
    lidoAprPct = pos?.currentAprPct ?? null
    lidoStakedUsd = pos?.hasPosition ? (pos.totalStaked?.usd ?? null) : 0
  }

  const inputs: RebalanceInputs = {
    scan,
    rates: { aaveUsdcSupplyApyPct, lidoAprPct },
    earning: { aaveSuppliedUsd, lidoStakedUsd },
  }
  return { plan: planRebalance(inputs), scan }
}

const usd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export interface RebalanceTurn {
  reply: string
  clarify?: { question: string; options: { label: string; resume: string }[] }
  buildPath: string
}

/**
 * The chat turn: live read → an offer with chips (every resume compiles
 * under the native ladder) or an honest quiet that names the math. Never a
 * dead end, never a guessed rate, nothing built until a chip is picked.
 */
export async function rebalanceTurnFor(
  address: string,
  trace?: (e: unknown) => void,
): Promise<RebalanceTurn> {
  const read = await readRebalance(address).catch(() => null)
  if (!read) {
    trace?.({ type: 'note', level: 'warn', label: 'rebalance layer: no funding-scan chain was readable — answering honestly, no plan' })
    return {
      reply:
        "💸 I couldn't read your balances just now (every chain RPC timed out) — nothing to plan on. Try again in a minute.",
      buildPath: 'native-rebalance',
    }
  }
  const { plan, scan } = read
  const chainsLine = scan.readChains.join(', ')

  if (plan.kind === 'quiet') {
    trace?.({ type: 'status', label: `rebalance layer claimed the turn: quiet (${plan.notes.length} note(s)) — planner bypassed` })
    const noteLines = plan.notes.map((n) => `- ${n}`).join('\n')
    return {
      reply:
        `💸 **Nothing worth moving right now.** Live read across ${chainsLine}:\n` +
        (noteLines ? `${noteLines}\n` : '- no idle balances above the floors — small money is cheaper left where it sits\n') +
        `Gas and solver fees are real; a rebalance only gets offered when the yearly math clearly beats them. Rates float — this is live math, not financial advice.`,
      buildPath: 'native-rebalance',
    }
  }

  trace?.({
    type: 'status',
    label: `rebalance layer claimed the turn: ${plan.moves.length} move(s), ~${usd(plan.totalEstYearUsd)}/yr on ~${usd(plan.totalMoveUsd)} — planner bypassed`,
  })
  const moveLines = plan.moves.map((m) => `- ${m.summary}`).join('\n')
  const noteLines = plan.notes.map((n) => `- ${n}`).join('\n')
  const options: { label: string; resume: string }[] = [
    { label: `Rebalance now (≈ ${usd(plan.totalEstYearUsd)}/yr)`, resume: plan.ask },
  ]
  if (plan.moves.length > 1) {
    for (const m of plan.moves) {
      if (m.combinedOnly) continue // alone it can't pay its own mainnet gas
      options.push(
        m.venue === 'aave'
          ? { label: 'Just the USDC → Aave', resume: moveAsk(m) }
          : { label: 'Just stake the ETH', resume: moveAsk(m) },
      )
    }
  }
  options.push({ label: 'Not now', resume: 'Never mind — leave my funds where they are.' })

  return {
    reply:
      `💸 **Your money could work harder.** Live read across ${chainsLine}:\n` +
      `${moveLines}\n` +
      (noteLines ? `${noteLines}\n` : '') +
      `One batch, signed step by step: bridge legs settle first (the runner waits them out), then the venue actions — nothing moves without your signature. ` +
      `≈ **${usd(plan.totalEstYearUsd)}/yr** more at today's live rates, against ~${usd(plan.totalCostUsd)} of estimated move costs. Rates float — this is live math, not financial advice.`,
    clarify: { question: 'Put it to work?', options: options.slice(0, 4) },
    buildPath: 'native-rebalance',
  }
}
