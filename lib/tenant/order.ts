// lib/tenant/order.ts — what the desk already knows, as the order the tenant
// gate judges (TENANT lane, five-million).
//
// The gate (lib/tenant/policy) speaks venues × ops × chains × tokens × side ×
// size × leverage. The desk speaks sentences, compiled job steps, and built
// artifacts. This file is the one translation, at three moments:
//
//   PLAN  (broker_open / choose / handoff): the working ask compiles through
//         the SAME jobs registry the agent lane drives (lib/jobs), and each
//         sign step becomes an order. A same-chain swap has no venue yet —
//         the job cascade picks one at build time (v3 → v4 → LiFi,
//         lib/swap-exec) — so its order carries the cascade's CANDIDATES and
//         the gate admits it when any candidate the policy names would build
//         it. The leg is judged again on the venue that actually built it.
//   JOB   (broker_execute): the compiled job's own steps (the funded form,
//         deposit and bridge legs included), before any job row exists.
//   LEG   (broker_next, the three relays): one built job step — its venue
//         from the build path the runner stamped (lib/job-step-telemetry),
//         its chain from the artifact, its dollars from the guard's price.
//
// Pure except for the jobs compiler it reads (sync, cached universes only).

import { compileJobAsk, JOB_SEGMENT_PARSERS, type CompiledJob, type CompiledStep, type JobSegmentCtx } from '@/lib/jobs'
import { askUsd, type BrokerPlan } from '@/lib/broker'
import { jobStepBuildPath } from '@/lib/job-step-telemetry'
import { POLICY_POOL_BUILD_PATH, POLICY_POOL_VENUE } from '@/lib/policy-pool/config'
import { TESTNET_CHAIN_IDS } from '@/lib/tenant/policy'
import { VENUE_CHAINS, type TenantOp, type TenantOrder, type TenantSide, type TenantVenue } from '@/lib/tenant/spec'

/** A gate order plus the two facts only the desk knows: which venues a
 *  not-yet-built swap could land on, and whether an off-chain venue leg
 *  (Hyperliquid) targets mainnet or testnet (the sandbox rule's input). */
export type GateOrder = TenantOrder & {
  /** Venues the builder may choose between, in its own cascade order. The
   *  gate admits the order when one of them is admitted. Absent = `venue`. */
  candidates?: TenantVenue[]
  /** For an off-chain venue: the network the built leg targets. */
  network?: 'mainnet' | 'testnet'
  /** One line for the blotter + the refusal: which step this is. */
  label?: string
}

/** Stable symbols: a swap that SELLS one is a buy, priced at its own units. */
const STABLES = new Set(['USDC', 'USDT', 'DAI', 'USDG', 'USDC.E', 'USDBC', 'PYUSD', 'USDS', 'FRAX'])
export const isStable = (sym: unknown) => typeof sym === 'string' && STABLES.has(sym.toUpperCase())

/** Build path → tenant venue (lib/build-path BUILD_PATHS). null = not a venue
 *  a tenant policy can name (planner, manual, the job wrapper itself). */
export function venueOfBuildPath(path: string | null | undefined): TenantVenue | null {
  switch (path) {
    case 'native-swap-uniswap':
      return 'uniswap-v3'
    case 'native-swap-uniswap-v4':
      return 'uniswap-v4'
    case 'native-swap-lifi':
    case 'native-fund-bridge':
      return 'lifi'
    case 'native-swap-cow':
      return 'cow'
    case 'native-cross-chain':
    case 'native-cross-chain-leg':
      return 'near-intents'
    case 'native-transfer':
      return 'transfer'
    case 'native-nft-transfer':
    case 'native-nft-list':
    case 'native-nft-buy':
      return 'opensea'
    case 'native-lido':
      return 'lido'
    case 'native-hl-guardian':
    case 'native-hl-exec':
    case 'native-hl-deposit':
      return 'hyperliquid'
    case 'native-aave-supply':
    case 'native-aave-op':
      return 'aave-v4'
    case 'native-morpho-lend':
    case 'native-morpho-op':
      return 'morpho'
    case POLICY_POOL_BUILD_PATH:
      return 'policy-pool'
    default:
      return null
  }
}

/** The swap cascade a job's `native-swap` / `native-lifi-swap` step runs on a
 *  chain, in its own order (lib/swap-exec): v3 first, v4 where the chain pins
 *  it, LiFi's settlement venue where the chain has one. */
export function swapCandidates(chainId: number | null): TenantVenue[] {
  if (chainId == null) return ['uniswap-v3']
  const all: TenantVenue[] = ['uniswap-v3', 'uniswap-v4', 'lifi']
  const on = all.filter((v) => (VENUE_CHAINS[v] ?? []).includes(chainId))
  return on.length ? on : ['uniswap-v3']
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}
const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const up = (v: unknown): string[] => (str(v) ? [String(v).trim().toUpperCase()] : [])

const CHAIN_WORD_IDS: Record<string, number> = { base: 8453, ethereum: 1, mainnet: 1, arbitrum: 42161, arb: 42161, optimism: 10, op: 10, robinhood: 4663, 'robinhood chain': 4663 }

/** One compiled (or built) job step → the order the gate judges. `stage`
 *  says what is known: at `plan` a swap's venue is a candidate set and the
 *  dollars are the ask's own; at `leg` the build path names the venue and the
 *  guard priced it. null = not a step the gate judges (a wait). */
export function orderOfStep(
  step: Pick<CompiledStep, 'builder' | 'params'> & { kind?: string; artifact?: unknown; valueUsd?: number | null },
  deskId: string,
  stage: 'plan' | 'leg',
): GateOrder | null {
  if (step.kind === 'wait' || step.builder === 'wait') return null
  const p = (step.params ?? {}) as Record<string, unknown>
  const built = stage === 'leg' ? venueOfBuildPath(jobStepBuildPath(step.builder, step.artifact) ?? null) : null
  const legUsd = stage === 'leg' && typeof step.valueUsd === 'number' && Number.isFinite(step.valueUsd) ? step.valueUsd : null
  const base = { deskId, at: Date.now() }

  switch (step.builder) {
    case 'native-swap': {
      // { amountHuman, sellToken, buyToken, chainId } (lib/jobs SameChainSwapSegment)
      const chainId = num(p.chainId)
      const sell = str(p.sellToken)?.toUpperCase() ?? null
      const buy = str(p.buyToken)?.toUpperCase() ?? null
      const side: TenantSide = isStable(buy) && !isStable(sell) ? 'sell' : 'buy'
      const usd = legUsd ?? (isStable(sell) ? num(p.amountHuman) : null)
      const candidates = built ? [built] : swapCandidates(chainId)
      return { ...base, venue: candidates[0], candidates, op: 'swap', chainId, tokens: [sell, buy].filter((t): t is string => !!t), side, usd, label: `swap ${sell ?? '?'} → ${buy ?? '?'}` }
    }
    case 'native-lifi-swap': {
      // { buyUsd, buyToken, sellToken, chainId } — the funded buy, same cascade.
      const chainId = num(p.chainId)
      const candidates = built ? [built] : swapCandidates(chainId)
      return { ...base, venue: candidates[0], candidates, op: 'swap', chainId, tokens: [...up(p.sellToken), ...up(p.buyToken)], side: 'buy', usd: legUsd ?? num(p.buyUsd), label: `buy ${String(p.buyToken ?? '?')}` }
    }
    case 'native-lifi-fund': {
      // { leg, usd, origin, token, dest? } — a LiFi (or NEAR fallback) funding bridge.
      const chainId = num(p.origin) ?? 8453
      const venue: TenantVenue = built ?? 'lifi'
      return { ...base, venue, op: 'bridge', chainId, tokens: up(p.token).length ? up(p.token) : ['USDC'], side: null, usd: legUsd ?? num(p.usd), label: `bridge ${String(p.leg ?? '')} leg` }
    }
    case 'native-cross-chain': {
      // CrossChainSwapParams { amount, originToken, originChain, destinationToken, destinationChain }
      const origin = str(p.originChain)?.toLowerCase() ?? ''
      const chainId = ORIGIN_IDS[origin] ?? null
      const ot = str(p.originToken)?.toUpperCase() ?? null
      const dt = str(p.destinationToken)?.toUpperCase() ?? null
      const usd = legUsd ?? (isStable(ot) ? num(p.amount) : null)
      return { ...base, venue: built ?? 'near-intents', op: 'bridge', chainId, tokens: [ot, dt].filter((t): t is string => !!t), side: null, usd, label: `bridge ${ot ?? '?'} (${origin}) → ${dt ?? '?'}` }
    }
    case 'native-hl-exec': {
      const kind = str(p.kind)
      const orderReq = obj(obj(step.artifact)?.orderRequest)
      const hl = obj(orderReq?.hl)
      const network: 'mainnet' | 'testnet' | undefined = hl ? (hl.isTestnet === true ? 'testnet' : 'mainnet') : undefined
      if (kind === 'deposit') {
        // The Bridge2 deposit: an Arbitrum USDC transfer INTO the venue — the
        // venue's own door, judged as a Hyperliquid transfer (chain null: the
        // venue is off-chain; the network rides separately for the sandbox).
        return { ...base, venue: 'hyperliquid', op: 'transfer', chainId: null, tokens: ['USDC'], side: null, usd: legUsd ?? num(p.amountUsdc), network: stage === 'leg' ? 'mainnet' : undefined, label: 'deposit to Hyperliquid' }
      }
      const coin = str(p.coin)?.toUpperCase() ?? null
      if (kind === 'close') {
        return { ...base, venue: 'hyperliquid', op: 'perp-close', chainId: null, tokens: coin ? [coin] : [], side: null, usd: legUsd, network, label: `close ${coin ?? '?'}` }
      }
      const isBuy = p.isBuy === true
      const lev = num(p.leverage)
      return {
        ...base,
        venue: 'hyperliquid',
        op: 'perp-open',
        chainId: null,
        tokens: coin ? [coin] : [],
        side: isBuy ? 'long' : 'short',
        usd: legUsd ?? num(p.notionalUsd),
        leverage: lev ?? 1,
        network,
        label: `${lev ? `${lev}x ` : ''}${isBuy ? 'long' : 'short'} ${coin ?? '?'}`,
      }
    }
    case 'native-hl-guardian': {
      // Arming a stop / take-profit only ever REDUCES exposure.
      const coin = str(p.coin)?.toUpperCase() ?? null
      return { ...base, venue: 'hyperliquid', op: 'perp-close', chainId: null, tokens: coin ? [coin] : [], side: null, usd: null, label: `protect ${coin ?? '?'}` }
    }
    case 'native-lido': {
      const usd = legUsd ?? num(p.amountUsd)
      return { ...base, venue: 'lido', op: 'stake', chainId: 1, tokens: ['ETH', p.receive === 'wstETH' ? 'WSTETH' : 'STETH'], side: null, usd, label: 'stake ETH on Lido' }
    }
    case 'native-weth-wrap':
    case 'native-aave-supply':
    case 'native-aave-repay': {
      const op: TenantOp = step.builder === 'native-aave-repay' ? 'repay' : 'supply'
      const token = step.builder === 'native-weth-wrap' ? 'ETH' : str(p.token)?.toUpperCase() ?? null
      const usd = legUsd ?? (p.amountIsUsd === true || isStable(token) ? num(p.amount) : null)
      return { ...base, venue: 'aave-v4', op, chainId: 1, tokens: token ? [token] : [], side: null, usd, label: `${op} ${token ?? '?'} on Aave` }
    }
    case 'native-morpho-lend':
    case 'native-morpho-repay': {
      const op: TenantOp = step.builder === 'native-morpho-repay' ? 'repay' : 'supply'
      const token = str(p.token)?.toUpperCase() ?? null
      const usd = legUsd ?? (p.amountIsUsd === true || isStable(token) ? num(p.amount) : null)
      return { ...base, venue: 'morpho', op, chainId: num(p.chainId) ?? 8453, tokens: token ? [token] : [], side: null, usd, label: `${op} ${token ?? '?'} on Morpho` }
    }
    case 'native-transfer': {
      const token = str(p.token)?.toUpperCase() ?? null
      const usd = legUsd ?? (isStable(token) ? num(p.amountHuman) : null)
      return { ...base, venue: 'transfer', op: 'transfer', chainId: num(p.chainId), tokens: token ? [token] : [], side: null, usd, label: `send ${token ?? '?'}` }
    }
    case 'native-nft-buy':
    case 'native-nft-list':
    case 'native-nft-transfer': {
      const op: TenantOp = step.builder === 'native-nft-buy' ? 'nft-buy' : step.builder === 'native-nft-list' ? 'nft-sell' : 'transfer'
      const chainId = num(p.chainId) ?? CHAIN_WORD_IDS[str(p.chain)?.toLowerCase() ?? ''] ?? null
      return { ...base, venue: 'opensea', op, chainId, tokens: [], side: null, usd: legUsd ?? num(p.priceUsd), label: `${op} on OpenSea` }
    }
    default:
      return null
  }
}

const ORIGIN_IDS: Record<string, number> = { ...CHAIN_WORD_IDS, polygon: 137, matic: 137, bnb: 56, bsc: 56, binance: 56, avalanche: 43114, avax: 43114, gnosis: 100, xdai: 100 }

/** The jobs compiler, lone segments included — the same claim order the
 *  desk's agent-signed compile walks (lib/broker-exec compileDeskAsk). */
export function compileForGate(ask: string): CompiledJob | null {
  const whole = compileJobAsk(ask)
  if (whole && !('problem' in whole) && !('clarify' in whole)) return whole
  if (whole) return null
  const ctx: JobSegmentCtx = { index: 0, fundingSeen: false, nft: null, message: ask }
  for (const parser of JOB_SEGMENT_PARSERS) {
    const out = parser.parse(ask, ctx)
    if (!out) continue
    if ('problem' in out || 'clarify' in out) return null
    return { title: out.title, steps: out.steps }
  }
  return null
}

/** Every judged step of a compiled job, as orders. */
export function ordersOfCompiled(compiled: CompiledJob, deskId: string): GateOrder[] {
  const out: GateOrder[] = []
  for (const s of compiled.steps) {
    const o = orderOfStep({ builder: s.builder, params: s.params, kind: s.kind }, deskId, 'plan')
    if (o) out.push(o)
  }
  return out
}

/** The desk's plan → every order it would place. null = the desk cannot
 *  compile this ask into a venue and chain it can judge (the gate refuses).
 *  A plan opened through the policy pool (`plan.venue`) lands on that venue. */
export function ordersOfPlan(plan: Pick<BrokerPlan, 'ask'> & { venue?: unknown }, deskId: string): GateOrder[] | null {
  const compiled = compileForGate(plan.ask)
  if (!compiled) return null
  const orders = ordersOfCompiled(compiled, deskId)
  if (orders.length === 0) return null
  if (plan.venue === POLICY_POOL_VENUE) {
    for (const o of orders) if (o.op === 'swap') {
      o.venue = 'policy-pool'
      o.candidates = ['policy-pool']
    }
  }
  // A dollar ask the compiler could not price per step still has its own figure.
  const fallback = askUsd(plan.ask)
  if (orders.length === 1 && orders[0].usd == null && fallback != null && orders[0].op !== 'perp-close') orders[0].usd = fallback
  return orders
}

/** The contract name (spec): the plan's LEAD order — the largest priced step,
 *  else the first. Callers that gate should use ordersOfPlan (every step). */
export function orderOfPlan(plan: Pick<BrokerPlan, 'ask'> & { venue?: unknown }, deskId: string): GateOrder | null {
  const all = ordersOfPlan(plan, deskId)
  if (!all) return null
  return [...all].sort((a, b) => (b.usd ?? -1) - (a.usd ?? -1))[0] ?? null
}

/** One built job step (a Jobs-API / Prisma step row) → its order. */
export function orderOfLeg(
  step: { builder: string; params: unknown; kind?: string | null; artifact?: unknown; valueUsd?: number | null },
  deskId: string,
): GateOrder | null {
  const o = orderOfStep({ builder: step.builder, params: (step.params ?? {}) as Record<string, unknown>, kind: step.kind ?? undefined, artifact: step.artifact, valueUsd: step.valueUsd ?? null }, deskId, 'leg')
  if (!o) return null
  // An EVM leg names its chain in the artifact; trust the built bytes over the params.
  const a = obj(step.artifact)
  const txChain = num(obj(a?.txRequest)?.chainId) ?? firstChainStep(a)
  if (o.venue !== 'hyperliquid' && txChain != null) o.chainId = txChain
  if (o.venue === 'hyperliquid' && o.op === 'transfer' && txChain != null) o.network = TESTNET_CHAIN_IDS.has(txChain) ? 'testnet' : 'mainnet'
  const orderReq = obj(a?.orderRequest)
  if (orderReq && str(orderReq.protocol) === 'cow') {
    o.venue = 'cow'
    o.candidates = ['cow']
    o.chainId = num(orderReq.chainId) ?? o.chainId
  }
  return o
}

function firstChainStep(a: Record<string, unknown> | null): number | null {
  const steps = obj(a?.txChain)?.steps
  if (!Array.isArray(steps)) return null
  for (const s of steps) {
    const c = num(obj(obj(s)?.tx)?.chainId)
    if (c != null) return c
  }
  return null
}
