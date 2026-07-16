// ─────────────────────────────────────────────────────────────────────────
//  Aave job-step builders — the runner-callable half of the native Aave
//  layer, so compound asks ("swap …, then supply 20 USDC to aave") and the
//  universal funding plan's chips can carry Aave steps.
//
//  Same recipe as the chat turns in app/api/chat/route.ts, distilled to the
//  jobs contract (build fresh at offer time, throw the honest reason on any
//  refusal): resolve the reserve from the agent's OWN `reserves` list
//  (addresses never come from a model), anchor repay to the user's real
//  debt via `portfolio`, call the matching build_* tool with the RESOLVED
//  addresses, and re-verify every returned step with the same fail-closed
//  guards chat uses (lib/aave-supply.ts). Supply + repay only — the two ops
//  a funding plan exists for; withdraw/borrow PRODUCE funds and stay
//  chat-only for now.
// ─────────────────────────────────────────────────────────────────────────

import {
  guardAaveSupplyBuild,
  guardAaveOpBuild,
  pickRepayPosition,
  pickSupplyReserve,
  parseUsd,
  reserveForOp,
  reserveLegIds,
  type AaveAmountRule,
  type AaveBuiltPlan,
  type AavePortfolioBorrowRow,
  type AaveReserveRow,
  type AaveSupplyParams,
} from '@/lib/aave-supply'
import { humanToAtoms } from '@/lib/cow'
import { callMcpTool } from '@/lib/mcp-call'

export const AAVE_MCP = 'https://aave-mcp.yeetful.com/mcp'

export interface AaveJobParams {
  op: 'supply' | 'repay'
  token: string
  /** Exact human amount; repay may instead set max. */
  amount: string | null
  max?: boolean
}

export interface AaveArtifactBuilt {
  txChain: { summary: string; steps: NonNullable<ReturnType<typeof guardAaveSupplyBuild>['steps']> }
  summary: string
  guardReport: { ok: true; warnings: string[]; valueUsd: number | null }
  valueUsd: number | null
}

async function readReserves(token: string): Promise<AaveReserveRow[]> {
  const res = (await callMcpTool(AAVE_MCP, 'reserves', { symbols: [token], chainId: 1 }, { timeoutMs: 20_000 })) as {
    reserves?: AaveReserveRow[]
  }
  return res?.reserves ?? []
}

/** Supply as a job step: reserves → build_supply → guard. Throws honestly. */
export async function buildAaveSupplyArtifact(wallet: string, params: { token: string; amount: string }): Promise<AaveArtifactBuilt> {
  const token = params.token.toUpperCase()
  const picked = pickSupplyReserve(await readReserves(token), token)
  if (!picked) throw new Error(`${token} isn't an active, supplyable Aave v4 reserve on Ethereum right now.`)
  const atoms = humanToAtoms(params.amount, picked.decimals)
  if (!atoms) throw new Error(`“${params.amount}” has more decimal places than ${token} supports (${picked.decimals}).`)

  const built = (await callMcpTool(AAVE_MCP, 'build_supply', {
    spokeAddress: picked.spokeAddress,
    currency: picked.currency,
    amount: params.amount,
    user: wallet,
    chainId: 1,
  }, { timeoutMs: 20_000 })) as AaveBuiltPlan

  const guard = guardAaveSupplyBuild(built, {
    chainId: 1,
    atoms: BigInt(atoms),
    currency: picked.currency,
    spoke: picked.spokeAddress,
    user: wallet,
    onChainId: picked.onChainId,
  })
  if (!guard.ok || !guard.steps) throw new Error(guard.reasons.join(' '))

  const valueUsd = picked.priceUsd !== null ? Number((Number(params.amount) * picked.priceUsd).toFixed(2)) : null
  const apy = picked.supplyApyPct !== null ? `${picked.supplyApyPct.toFixed(2)}% APY` : "the pool's live APY"
  const summary = `Supply ${params.amount} ${token}${valueUsd !== null ? ` (≈$${valueUsd.toFixed(2)})` : ''} to Aave v4 ${picked.spokeName} on Ethereum — earning ${apy}`
  return { txChain: { summary, steps: guard.steps }, summary, guardReport: { ok: true, warnings: guard.warnings, valueUsd }, valueUsd }
}

/** Repay as a job step: portfolio-anchored → build_repay → guard. Throws honestly. */
export async function buildAaveRepayArtifact(
  wallet: string,
  params: { token: string; amount: string | null; max?: boolean },
): Promise<AaveArtifactBuilt> {
  const token = params.token.toUpperCase()
  const pf = (await callMcpTool(AAVE_MCP, 'portfolio', { user: wallet, chainId: 1 }, { timeoutMs: 20_000 })) as {
    borrows?: AavePortfolioBorrowRow[]
  }
  const debtPos = pickRepayPosition(pf.borrows ?? [], token)
  if (!debtPos) throw new Error(`No ${token} debt on Aave v4 — nothing to repay.`)

  const rows = await readReserves(token)
  const picked = reserveForOp(rows, token, debtPos.spokeAddress!, 'borrow')
  if (!picked) throw new Error(`Couldn't cross-check the ${token} reserve on Aave's official list — refusing to build the repay.`)
  const eqAddr = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase()
  if (debtPos.token?.address && !eqAddr(debtPos.token.address, picked.currency)) {
    throw new Error(`Your position's ${token} address doesn't match Aave's official reserve list — refusing to build the repay.`)
  }

  const max = params.max === true || params.amount === null
  let atoms: string | null = null
  if (!max) {
    atoms = humanToAtoms(params.amount!, picked.decimals)
    if (!atoms) throw new Error(`“${params.amount}” has more decimal places than ${token} supports (${picked.decimals}).`)
    if (Number(params.amount) > Number(debtPos.debt ?? 0)) {
      throw new Error(`Your ${token} debt is ${debtPos.debt} (asked: ${params.amount}) — repay at most the debt, or repay it all.`)
    }
  }

  const built = (await callMcpTool(AAVE_MCP, 'build_repay', {
    spokeAddress: picked.spokeAddress,
    currency: picked.currency,
    user: wallet,
    chainId: 1,
    ...(max ? { max: true } : { amount: params.amount }),
  }, { timeoutMs: 20_000 })) as AaveBuiltPlan

  const amountRule: AaveAmountRule = max
    ? { kind: 'repay-max', debtAtoms: BigInt(humanToAtoms(debtPos.debt ?? '0', picked.decimals) ?? '0') }
    : { kind: 'exact', atoms: BigInt(atoms!) }
  const legIds = reserveLegIds(rows, token, picked.spokeAddress, 'borrow')
  const guard = guardAaveOpBuild(built, {
    op: 'repay',
    chainId: 1,
    amount: amountRule,
    currency: picked.currency,
    spoke: picked.spokeAddress,
    user: wallet,
    onChainIds: legIds.length > 0 ? legIds : picked.onChainId !== null ? [picked.onChainId] : null,
  })
  if (!guard.ok || !guard.steps) throw new Error(guard.reasons.join(' '))

  const valueUsd = max
    ? parseUsd(debtPos.debtUsd)
    : picked.priceUsd !== null
      ? Number((Number(params.amount) * picked.priceUsd).toFixed(2))
      : null
  const amountText = max ? `your full ${token} debt (~${debtPos.debt}, accrued interest included)` : `${params.amount} ${token}`
  const summary = `Repay ${amountText}${valueUsd !== null ? ` (≈$${valueUsd.toFixed(2)})` : ''} on Aave v4 ${picked.spokeName}`
  return { txChain: { summary, steps: guard.steps }, summary, guardReport: { ok: true, warnings: guard.warnings, valueUsd }, valueUsd }
}

export type { AaveSupplyParams }
