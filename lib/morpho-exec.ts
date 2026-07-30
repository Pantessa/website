// ─────────────────────────────────────────────────────────────────────────
//  Morpho job-step builders — the runner-callable half of the native Morpho
//  layer (the lib/aave-exec.ts twin), so compound asks ("swap …, then lend
//  100 USDC on morpho") can carry Morpho steps.
//
//  Same recipe as the chat turns, distilled to the jobs contract (build
//  fresh at offer time, throw the honest reason on any refusal): resolve
//  the market from the agent's OWN `markets`/`position` tools (ids never
//  come from a model), resolve the FULL MarketParams tuple OURSELVES with
//  an on-chain idToMarketParams read against the pinned singleton,
//  cross-check it against the agent's `market_info` answer, call the
//  matching build_* tool, and re-verify every returned step with the same
//  fail-closed guard chat uses (lib/morpho-supply.ts). Lend + repay only —
//  the two ops a compound ask lands on; the rest stay chat-only for now.
// ─────────────────────────────────────────────────────────────────────────

import {
  MORPHO_SINGLETON,
  guardMorphoOpBuild,
  pickDebtPosition,
  pickLendMarket,
  type MorphoAmountRule,
  type MorphoBuiltPlan,
  type MorphoChainId,
  type MorphoMarketParams,
  type MorphoMarketRow,
  type MorphoPositionRow,
} from '@/lib/morpho-supply'
import { humanToAtoms } from '@/lib/cow'
import { publicClientFor } from '@/lib/chains'
import { callMcpTool } from '@/lib/mcp-call'

export const MORPHO_MCP = 'https://morpho-mcp.yeetful.com/mcp'

/** Chain name for replies/summaries. */
export const morphoChainName = (chainId: MorphoChainId): string => (chainId === 1 ? 'Ethereum' : 'Base')

export interface MorphoJobParams {
  op: 'lend' | 'repay'
  token: string
  /** Exact human amount; repay may instead set max. */
  amount: string | null
  max?: boolean
  chainId: MorphoChainId
}

export interface MorphoArtifactBuilt {
  txChain: { summary: string; steps: NonNullable<ReturnType<typeof guardMorphoOpBuild>['steps']> }
  summary: string
  guardReport: { ok: true; warnings: string[]; valueUsd: number | null }
  valueUsd: number | null
}

/** The agent's `markets` answer (curated rows, sorted by size). */
export async function readMorphoMarkets(chainId: MorphoChainId, endpoint = MORPHO_MCP): Promise<MorphoMarketRow[]> {
  const res = (await callMcpTool(endpoint, 'markets', { chainId }, { timeoutMs: 20_000 })) as {
    markets?: MorphoMarketRow[]
  }
  return res?.markets ?? []
}

/** The agent's `market_info` answer — addresses + decimals for one market. */
export interface MorphoMarketInfo {
  marketId?: string
  market?: string
  loanAsset?: { symbol?: string; address?: string; decimals?: number }
  collateralAsset?: { symbol?: string; address?: string; decimals?: number }
  lltv?: string
  supplyApy?: string | null
  borrowApy?: string | null
  availableLiquidity?: string
  oracle?: { address?: string; collateralPriceInLoan?: string | null; warning?: string }
}

export async function readMorphoMarketInfo(
  chainId: MorphoChainId,
  marketId: string,
  endpoint = MORPHO_MCP,
): Promise<MorphoMarketInfo> {
  return (await callMcpTool(endpoint, 'market_info', { chainId, marketId }, { timeoutMs: 20_000 })) as MorphoMarketInfo
}

/** The agent's `position` answer, narrowed to the rows. */
export async function readMorphoPosition(
  chainId: MorphoChainId,
  user: string,
  endpoint = MORPHO_MCP,
): Promise<MorphoPositionRow[]> {
  const res = (await callMcpTool(endpoint, 'position', { chainId, user }, { timeoutMs: 30_000 })) as {
    positions?: MorphoPositionRow[]
  }
  return res?.positions ?? []
}

const MARKET_PARAMS_COMPONENTS = [
  { name: 'loanToken', type: 'address' },
  { name: 'collateralToken', type: 'address' },
  { name: 'oracle', type: 'address' },
  { name: 'irm', type: 'address' },
  { name: 'lltv', type: 'uint256' },
] as const

const ID_TO_MARKET_PARAMS_ABI = [
  {
    name: 'idToMarketParams',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [{ name: '', type: 'tuple', components: MARKET_PARAMS_COMPONENTS }],
  },
] as const

const ZERO_ADDR = '0x0000000000000000000000000000000000000000'

/**
 * Resolve the FULL MarketParams tuple for a market id with OUR OWN on-chain
 * read against the pinned singleton — the guard's binding anchor (the id
 * never appears in calldata; the tuple does, every field). Throws when the
 * id resolves to no market on this chain.
 */
export async function resolveMorphoMarketParams(chainId: MorphoChainId, marketId: string): Promise<MorphoMarketParams> {
  if (!/^0x[0-9a-fA-F]{64}$/.test(marketId)) {
    throw new Error(`"${marketId}" is not a 32-byte Morpho market id — refusing to resolve it.`)
  }
  const client = publicClientFor(chainId)
  if (!client) throw new Error(`No RPC client configured for chain ${chainId}.`)
  const p = (await client.readContract({
    address: MORPHO_SINGLETON as `0x${string}`,
    abi: ID_TO_MARKET_PARAMS_ABI,
    functionName: 'idToMarketParams',
    args: [marketId as `0x${string}`],
  })) as { loanToken: string; collateralToken: string; oracle: string; irm: string; lltv: bigint }
  if (p.loanToken.toLowerCase() === ZERO_ADDR) {
    throw new Error(`Market ${marketId} doesn't exist on ${morphoChainName(chainId)} — refusing to build against it.`)
  }
  return { loanToken: p.loanToken, collateralToken: p.collateralToken, oracle: p.oracle, irm: p.irm, lltv: p.lltv }
}

const eqAddr = (a?: string | null, b?: string | null): boolean => !!a && !!b && a.toLowerCase() === b.toLowerCase()

const ERC20_IDENTITY_ABI = [
  { name: 'symbol', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { name: 'decimals', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
] as const

/** The ONLY symbols we accept as naming a different on-chain symbol: a user
 *  saying "eth" in a Morpho market means the wrapped token the market uses.
 *  Deliberately tiny — every entry is a place a lie could hide. */
const SYMBOL_ALIASES: Record<string, string[]> = { ETH: ['ETH', 'WETH'] }

/**
 * Bind the market's token ADDRESS to the symbol the user actually said, and
 * to the decimals we sized the amount with — both read ON-CHAIN from the
 * token itself.
 *
 * Without this the whole symbol→address mapping rests on the MCP's own
 * strings: a hostile or compromised agent in the user's set could answer
 * `{loan: 'USDC', marketId: <a REAL market whose loanToken is WETH>}` and
 * every downstream check would still pass — the tuple resolves honestly from
 * that id, the guard confirms the calldata matches the resolved tuple, and
 * the user signs an approve + supply of WETH for an ask that said USDC. A
 * consistent liar also passes assertInfoMatchesParams. The chain is the only
 * authority on what a token IS, so we ask it.
 */
export async function assertTokenIdentity(
  chainId: MorphoChainId,
  address: string,
  expectedSymbol: string,
  expectedDecimals: number,
): Promise<void> {
  const client = publicClientFor(chainId)
  if (!client) throw new Error(`No RPC client configured for chain ${chainId}.`)
  let onChain: { symbol: string; decimals: number }
  try {
    const [symbol, decimals] = await Promise.all([
      client.readContract({ address: address as `0x${string}`, abi: ERC20_IDENTITY_ABI, functionName: 'symbol' }) as Promise<string>,
      client.readContract({ address: address as `0x${string}`, abi: ERC20_IDENTITY_ABI, functionName: 'decimals' }) as Promise<number>,
    ])
    onChain = { symbol, decimals: Number(decimals) }
  } catch {
    throw new Error(`Couldn't verify on-chain what token ${address.slice(0, 10)}… is — refusing to build against it.`)
  }
  const want = expectedSymbol.toUpperCase()
  const accepted = SYMBOL_ALIASES[want] ?? [want]
  if (!accepted.includes(onChain.symbol.toUpperCase())) {
    throw new Error(
      `That market's asset is ${onChain.symbol} on-chain, not ${want} — the Morpho agent's answer disagrees with the chain, so I won't build it.`,
    )
  }
  if (onChain.decimals !== expectedDecimals) {
    throw new Error(
      `${onChain.symbol} has ${onChain.decimals} decimals on-chain but the Morpho agent reported ${expectedDecimals} — refusing to size an amount against a wrong scale.`,
    )
  }
}

/**
 * The agent's market_info answer must AGREE with the on-chain tuple we
 * resolved — a service answering different addresses than the chain is
 * exactly the drift the guard exists to catch. Throws on any mismatch.
 */
export function assertInfoMatchesParams(info: MorphoMarketInfo, params: MorphoMarketParams): void {
  if (info.loanAsset?.address && !eqAddr(info.loanAsset.address, params.loanToken)) {
    throw new Error("The market's loan-asset address from the Morpho service doesn't match the chain — refusing to build.")
  }
  if (info.collateralAsset?.address && !eqAddr(info.collateralAsset.address, params.collateralToken)) {
    throw new Error("The market's collateral-asset address from the Morpho service doesn't match the chain — refusing to build.")
  }
  if (info.oracle?.address && !eqAddr(info.oracle.address, params.oracle)) {
    throw new Error("The market's oracle address from the Morpho service doesn't match the chain — refusing to build.")
  }
}

/** USD per loan token implied by the market row's totals — the money-moved
 *  heuristic (null when the row can't answer). */
export function impliedLoanPriceUsd(row: MorphoMarketRow | null, info: MorphoMarketInfo): number | null {
  if (!row || row.totalSupplyUsd == null) return null
  const m = (info as { totalSupply?: string }).totalSupply?.match(/^([\d.]+)\s/)
  const totalHuman = m ? Number(m[1]) : NaN
  if (!Number.isFinite(totalHuman) || totalHuman <= 0) return null
  const price = row.totalSupplyUsd / totalHuman
  return Number.isFinite(price) && price > 0 ? price : null
}

/** Lend as a job step: markets → market_info → on-chain tuple → build_lend
 *  → guard. Throws honestly. */
export async function buildMorphoLendArtifact(
  wallet: string,
  params: { token: string; amount: string; chainId: MorphoChainId },
): Promise<MorphoArtifactBuilt> {
  const token = params.token.toUpperCase()
  const chainName = morphoChainName(params.chainId)
  const row = pickLendMarket(await readMorphoMarkets(params.chainId), token)
  if (!row?.marketId) {
    throw new Error(`${token} isn't the loan asset of any curated Morpho market on ${chainName} right now.`)
  }
  const [info, tuple] = await Promise.all([
    readMorphoMarketInfo(params.chainId, row.marketId),
    resolveMorphoMarketParams(params.chainId, row.marketId),
  ])
  assertInfoMatchesParams(info, tuple)
  const decimals = info.loanAsset?.decimals
  if (typeof decimals !== 'number') throw new Error(`Couldn't read ${token}'s decimals from the Morpho service — refusing to build.`)
  // The chain decides what that market's loan asset IS — never the agent.
  await assertTokenIdentity(params.chainId, tuple.loanToken, token, decimals)
  const atoms = humanToAtoms(params.amount, decimals)
  if (!atoms) throw new Error(`“${params.amount}” has more decimal places than ${token} supports (${decimals}).`)

  const built = (await callMcpTool(MORPHO_MCP, 'build_lend', {
    user: wallet,
    chainId: params.chainId,
    marketId: row.marketId,
    amount: params.amount,
  }, { timeoutMs: 30_000 })) as MorphoBuiltPlan

  const guard = guardMorphoOpBuild(built, {
    op: 'lend',
    chainId: params.chainId,
    amount: { kind: 'exact', atoms: BigInt(atoms) },
    params: tuple,
    morpho: MORPHO_SINGLETON,
    user: wallet,
  })
  if (!guard.ok || !guard.steps) throw new Error(guard.reasons.join(' '))

  const price = impliedLoanPriceUsd(row, info)
  const valueUsd = price !== null ? Number((Number(params.amount) * price).toFixed(2)) : null
  const apy = info.supplyApy ?? row.supplyApy
  const marketLabel = info.market ?? `${row.loan}/${row.collateral}`
  const summary = `Lend ${params.amount} ${token}${valueUsd !== null ? ` (≈$${valueUsd.toFixed(2)})` : ''} to the Morpho ${marketLabel} market on ${chainName}${apy ? ` — earning ${apy} APY` : ''}`
  return { txChain: { summary, steps: guard.steps }, summary, guardReport: { ok: true, warnings: guard.warnings, valueUsd }, valueUsd }
}

/** Repay as a job step: position-anchored → market_info → on-chain tuple →
 *  build_repay → guard. Throws honestly. */
export async function buildMorphoRepayArtifact(
  wallet: string,
  params: { token: string; amount: string | null; max?: boolean; chainId: MorphoChainId },
): Promise<MorphoArtifactBuilt> {
  const token = params.token.toUpperCase()
  const chainName = morphoChainName(params.chainId)
  const debtPos = pickDebtPosition(await readMorphoPosition(params.chainId, wallet), token)
  if (!debtPos?.marketId) throw new Error(`No ${token} debt on Morpho (${chainName}) — nothing to repay.`)

  const [info, tuple] = await Promise.all([
    readMorphoMarketInfo(params.chainId, debtPos.marketId),
    resolveMorphoMarketParams(params.chainId, debtPos.marketId),
  ])
  assertInfoMatchesParams(info, tuple)
  const decimals = info.loanAsset?.decimals
  if (typeof decimals !== 'number') throw new Error(`Couldn't read ${token}'s decimals from the Morpho service — refusing to build.`)
  // Same binding on the repay path — the debt position's market comes from
  // the agent too, so the chain must confirm the token before we size atoms.
  await assertTokenIdentity(params.chainId, tuple.loanToken, token, decimals)

  const max = params.max === true || params.amount === null
  const debtHuman = debtPos.borrowed?.amount ?? '0'
  let amountRule: MorphoAmountRule
  if (max) {
    const anchor = humanToAtoms(debtHuman, decimals)
    if (!anchor) throw new Error(`Couldn't anchor your ${token} debt (${debtHuman}) — refusing to build the repay.`)
    amountRule = { kind: 'max-shares', anchorAtoms: BigInt(anchor) }
  } else {
    const atoms = humanToAtoms(params.amount!, decimals)
    if (!atoms) throw new Error(`“${params.amount}” has more decimal places than ${token} supports (${decimals}).`)
    if (Number(params.amount) > Number(debtHuman)) {
      throw new Error(`Your ${token} debt is ${debtHuman} (asked: ${params.amount}) — repay at most the debt, or repay it all.`)
    }
    amountRule = { kind: 'exact', atoms: BigInt(atoms) }
  }

  const built = (await callMcpTool(MORPHO_MCP, 'build_repay', {
    user: wallet,
    chainId: params.chainId,
    marketId: debtPos.marketId,
    amount: max ? 'max' : params.amount,
  }, { timeoutMs: 30_000 })) as MorphoBuiltPlan

  const guard = guardMorphoOpBuild(built, {
    op: 'repay',
    chainId: params.chainId,
    amount: amountRule,
    params: tuple,
    morpho: MORPHO_SINGLETON,
    user: wallet,
  })
  if (!guard.ok || !guard.steps) throw new Error(guard.reasons.join(' '))

  const marketLabel = info.market ?? debtPos.market ?? token
  // Loan assets in curated markets are overwhelmingly stables; still, only
  // price what a market row can answer — here the position gives no USD, so
  // the value rides the debt amount only when the loan asset is a stable-ish
  // 1:1 (fail-soft null otherwise; the ledger prices nothing over a guess).
  const valueUsd = /^(USDC|USDT|DAI|USDG|USDE)$/i.test(token)
    ? Number((max ? Number(debtHuman) : Number(params.amount)).toFixed(2))
    : null
  const amountText = max ? `your full ${token} debt (~${debtHuman}, accrued interest included)` : `${params.amount} ${token}`
  const summary = `Repay ${amountText}${valueUsd !== null ? ` (≈$${valueUsd.toFixed(2)})` : ''} on the Morpho ${marketLabel} market (${chainName})`
  return { txChain: { summary, steps: guard.steps }, summary, guardReport: { ok: true, warnings: guard.warnings, valueUsd }, valueUsd }
}
