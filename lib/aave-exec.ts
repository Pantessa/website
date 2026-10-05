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
  resolveSupplyAmount,
  reserveLegIds,
  type AaveAmountRule,
  type AaveBuiltPlan,
  type AavePortfolioBorrowRow,
  type AaveReserveRow,
  type AaveSupplyParams,
  type PickedReserve,
} from '@/lib/aave-supply'
import { erc20Abi, formatEther, getAddress } from 'viem'
import { chainById, publicClientFor } from '@/lib/chains'
import { humanToAtoms } from '@/lib/cow'
import { callMcpTool } from '@/lib/mcp-call'
import { aaveReserveSymbolFor, buildWethWrapTx, guardWethWrap, planWethWrap, wrapGasReserveWei, type WrapPlan } from '@/lib/weth-wrap'

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

// ── ETH supplies ride a wrap ───────────────────────────────────────────────
// Aave v4 on Ethereum lists WETH, not native ETH, and the agent's build_supply
// checks the WETH balance at build time. So "supply $50 of ETH to Aave" is two
// signatures: a guarded WETH.deposit{value} first, then the ordinary WETH
// approve + supply, built only once the wrap has confirmed (a job step is
// completed on its receipt, so the next build sees the wrapped balance).
// The reserve is read as WETH and must BE the registry's wrappedNative: we
// wrap into that contract, so a reserve listing any other "WETH" refuses.
// BTC is deliberately NOT aliased: Aave lists WBTC and cbBTC, two different
// tokens with different custodians, and "BTC" names neither.

export interface EthSupplyPlan {
  picked: PickedReserve
  /** Resolved human WETH amount the supply moves. */
  amount: string
  needWei: bigint
  ethWei: bigint
  wethWei: bigint
  plan: WrapPlan
}

async function readEthAndWeth(wallet: string): Promise<{ ethWei: bigint; wethWei: bigint }> {
  const client = publicClientFor(1)
  const weth = chainById(1)?.wrappedNative
  if (!client || !weth) throw new Error('No Ethereum RPC configured — cannot read the ETH and WETH balances.')
  const [ethWei, wethWei] = await Promise.all([
    client.getBalance({ address: wallet as `0x${string}` }),
    client.readContract({ address: weth, abi: erc20Abi, functionName: 'balanceOf', args: [wallet as `0x${string}`] }),
  ])
  return { ethWei, wethWei }
}

/**
 * Resolve an ETH supply against the WETH reserve and the wallet's live
 * balances: which pool, how much WETH, and how much ETH to wrap first (none
 * when the wallet already holds the WETH). Returns `{problem}` with the
 * honest reason; throws only on transport failures.
 */
export async function planEthSupply(
  wallet: string,
  params: { amount: string; amountIsUsd?: boolean; bestRate?: boolean },
  rows?: AaveReserveRow[],
): Promise<EthSupplyPlan | { problem: string }> {
  const picked = pickSupplyReserve(rows ?? (await readReserves('WETH')), 'WETH', { bestRate: params.bestRate === true })
  if (!picked) return { problem: "WETH isn't an active, supplyable Aave v4 reserve on Ethereum right now, so there's nowhere to put the ETH." }
  const weth = chainById(1)?.wrappedNative
  if (!weth || getAddress(picked.currency) !== getAddress(weth)) {
    return { problem: `Aave's WETH reserve (${picked.currency}) isn't the WETH contract we wrap into (${weth ?? 'unknown'}) — refusing to wrap.` }
  }
  const resolved = resolveSupplyAmount({ amount: params.amount, token: 'WETH', ...(params.amountIsUsd ? { amountIsUsd: true } : {}) }, picked)
  if ('problem' in resolved) return { problem: resolved.problem.replace(/\bWETH\b/g, 'ETH') }
  const atoms = humanToAtoms(resolved.amount, picked.decimals)
  if (!atoms) return { problem: `“${resolved.amount}” has more decimal places than ETH supports.` }
  const needWei = BigInt(atoms)
  const { ethWei, wethWei } = await readEthAndWeth(wallet)
  return { picked, amount: resolved.amount, needWei, ethWei, wethWei, plan: planWethWrap({ chainId: 1, needWei, ethWei, wethWei }) }
}

/**
 * The wrap as a job step. `wrapWei` (set by the chat turn, which planned
 * against live balances) is wrapped as-is; a compound job compiled without a
 * wallet carries the ask instead and plans here. Either way the ETH balance
 * is re-read at offer time and the call is re-verified by the guard.
 */
export async function buildWethWrapArtifact(
  wallet: string,
  params: { wrapWei?: string; amount?: string; amountIsUsd?: boolean; bestRate?: boolean },
): Promise<{ artifact: Record<string, unknown>; guardReport: { ok: true; warnings: string[]; valueUsd: null } }> {
  let wrapWei: bigint
  if (params.wrapWei) {
    wrapWei = BigInt(params.wrapWei)
    const { ethWei } = await readEthAndWeth(wallet)
    const reserve = wrapGasReserveWei(1)
    if (ethWei < wrapWei + reserve) {
      throw new Error(`The wallet holds ${formatEther(ethWei)} ETH on Ethereum; wrapping ${formatEther(wrapWei)} ETH and keeping ~${formatEther(reserve)} ETH for gas needs more. Nothing was built.`)
    }
  } else {
    const planned = await planEthSupply(wallet, { amount: params.amount ?? '', amountIsUsd: params.amountIsUsd, bestRate: params.bestRate })
    if ('problem' in planned) throw new Error(planned.problem)
    if (planned.plan.kind === 'short') throw new Error(planned.plan.problem)
    if (planned.plan.kind === 'covered') {
      throw new Error(`The wallet already holds ${formatEther(planned.wethWei)} WETH, enough for the supply — nothing to wrap. Cancel this job and ask “supply ${planned.amount} WETH to Aave”.`)
    }
    wrapWei = planned.plan.wrapWei
  }
  const tx = buildWethWrapTx(1, wrapWei)
  if (!tx) throw new Error('Could not build the WETH wrap on Ethereum.')
  const guard = guardWethWrap(tx, { chainId: 1, wrapWei })
  if (!guard.ok) throw new Error(guard.reasons.join(' '))
  const summary = `Wrap ${formatEther(wrapWei)} ETH into WETH on Ethereum`
  // A wrap moves no money anywhere (ETH → the same value of WETH in the same
  // wallet), so it books nothing; the supply step carries the value.
  return { artifact: { txRequest: tx as unknown as Record<string, unknown>, summary }, guardReport: { ok: true, warnings: [], valueUsd: null } }
}

/** Supply as a job step: reserves → build_supply → guard. Throws honestly. */
export async function buildAaveSupplyArtifact(
  wallet: string,
  params: { token: string; amount: string; amountIsUsd?: boolean; bestRate?: boolean },
): Promise<AaveArtifactBuilt> {
  const asked = params.token.toUpperCase()
  // An ETH supply supplies the WETH its wrap step just made (see above).
  const token = aaveReserveSymbolFor(asked)
  const picked = pickSupplyReserve(await readReserves(token), token, { bestRate: params.bestRate === true })
  if (!picked) throw new Error(`${token} isn't an active, supplyable Aave v4 reserve on Ethereum right now.`)
  // Dollar asks price from the reserve's own pool totals (stables are 1:1).
  const resolved = resolveSupplyAmount({ amount: params.amount, token, ...(params.amountIsUsd ? { amountIsUsd: true } : {}) }, picked)
  if ('problem' in resolved) throw new Error(resolved.problem)
  params = { ...params, amount: resolved.amount }
  let atoms = humanToAtoms(params.amount, picked.decimals)
  if (!atoms) throw new Error(`“${params.amount}” has more decimal places than ${token} supports (${picked.decimals}).`)
  if (asked === 'ETH') {
    const weth = chainById(1)?.wrappedNative
    if (!weth || getAddress(picked.currency) !== getAddress(weth)) {
      throw new Error(`Aave's WETH reserve (${picked.currency}) isn't the WETH contract the wrap made — refusing to supply.`)
    }
    // A dollar ask re-prices here, a minute after the wrap priced it. A price
    // drift of up to 3% supplies what the wrap made; more than that is not
    // drift, and the build refuses rather than guess.
    const { wethWei } = await readEthAndWeth(wallet)
    const need = BigInt(atoms)
    if (wethWei < need) {
      if (wethWei * BigInt(100) < need * BigInt(97)) {
        throw new Error(`The wallet holds ${formatEther(wethWei)} WETH, short of the ${formatEther(need)} WETH this supply needs — the wrap step may not have confirmed yet.`)
      }
      atoms = wethWei.toString()
      params = { ...params, amount: formatEther(wethWei) }
    }
  }

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
