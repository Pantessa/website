// ─────────────────────────────────────────────────────────────────────────
//  Jobs runner — the I/O half of lib/jobs.ts. Advances each job ONE step at
//  a time with the guardian discipline: atomic step claims (overlapping
//  ticks can't double-run), artifacts built FRESH at offer time by the same
//  builders chat uses, per-step guard reports persisted verbatim, and an
//  origin-env fence so the prod cron never advances a dev-created job on
//  the shared Neon DB.
// ─────────────────────────────────────────────────────────────────────────

import { HttpTransport, InfoClient } from '@nktkas/hyperliquid'
import prisma from '@/lib/db'
import { callMcpTool } from '@/lib/mcp-call'
import { crossChainValueUsd, expectedOriginChainId, guardCrossChainBuild, type BuiltSwap, type CrossChainSwapParams } from '@/lib/cross-chain-swap'
import { buildHlExecTurn, type HlIntent } from '@/lib/hyperliquid-exec'
import { armGuardianPolicy } from '@/lib/hl-guardian-store'
import type { GuardianArmAsk } from '@/lib/hl-guardian'
import type { CompiledJob } from '@/lib/jobs'
import {
  guardLidoStakeBuild,
  suggestedStakeEth,
  LIDO_MCP,
  type LidoBuiltStake,
  type LidoPositionPayload,
  type LidoStakeParams,
} from '@/lib/lido-stake'
import { publicClientFor, primaryStable } from '@/lib/chains'
import { erc20Abi, formatEther } from 'viem'
import { buildAaveRepayArtifact, buildAaveSupplyArtifact } from '@/lib/aave-exec'
import { buildGuardedSwap } from '@/lib/swap-exec'
import type { PolicyBlock } from '@/lib/tx-guardrails'
import { buildLifiBridgeLeg, checkChainArrival, ROBINHOOD_CHAIN_ID, type ChainArrival, type FundingLeg } from '@/lib/lifi-bridge'
import { buildLifiSwap } from '@/lib/lifi-venue'
import { ensureTokenList } from '@/lib/token-list'
import { buildTransferArtifact, type TransferSegment } from '@/lib/transfer-exec'
import { buildNftBuy, buildNftTransfer, buildNftListing, ERC721_ABI as NFT_ERC721_ABI, ERC1155_ABI as NFT_ERC1155_ABI, type NftAsk } from '@/lib/nft-layer'

export function jobsEnv(): string {
  return process.env.VERCEL_ENV ?? 'dev'
}

/** A guard refusal whose cause is the wallet's own spend policy — carries the
 *  structured block so the failed step can offer the exact fix (allow the
 *  venue host / raise the right cap) instead of a dead-end string. */
export class PolicyRefusedError extends Error {
  constructor(message: string, public policyBlock: PolicyBlock) {
    super(message)
    this.name = 'PolicyRefusedError'
  }
}

const policyBlockOf = (guardrails: unknown): PolicyBlock | undefined =>
  (guardrails as { policyBlock?: PolicyBlock } | null | undefined)?.policyBlock

/** Throw the refusal, structured when the spend policy caused it. */
function throwRefusal(reasons: string, guardrails: unknown): never {
  const pb = policyBlockOf(guardrails)
  if (pb) throw new PolicyRefusedError(reasons, pb)
  throw new Error(reasons)
}

const NEAR_INTENTS_MCP = 'https://near-intents.yeetful.com/mcp'
/** A sign artifact left unsigned this long is stale — rebuild on next offer. */
const OFFER_TTL_MS = 30 * 60_000
/** A wait that hasn't settled in this long fails the job (refunds surface). */
const WAIT_TIMEOUT_MS = 45 * 60_000

export async function createJob(wallet: string, compiled: CompiledJob, source = 'chat') {
  const job = await prisma.job.create({
    data: {
      wallet: wallet.toLowerCase(),
      title: compiled.title,
      source,
      originEnv: jobsEnv(),
      steps: {
        create: compiled.steps.map((s, i) => ({
          seq: i,
          kind: s.kind,
          builder: s.builder,
          title: s.title,
          params: s.params as object,
          waitPredicate: (s.waitPredicate as object | undefined) ?? undefined,
        })),
      },
    },
    include: { steps: { orderBy: { seq: 'asc' } } },
  })
  return job
}

export async function getJobWithSteps(id: string) {
  return prisma.job.findUnique({ where: { id }, include: { steps: { orderBy: { seq: 'asc' } } } })
}

type JobWithSteps = NonNullable<Awaited<ReturnType<typeof getJobWithSteps>>>

/** One cron tick: advance every live job of THIS env. */
export async function advanceJobs(limit = 20): Promise<{ touched: number; notes: string[] }> {
  const notes: string[] = []
  const jobs = await prisma.job.findMany({
    where: { status: { in: ['running', 'waiting_settlement', 'waiting_signature'] }, originEnv: jobsEnv() },
    include: { steps: { orderBy: { seq: 'asc' } } },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })
  for (const job of jobs) {
    try {
      await advanceJob(job)
    } catch (e) {
      notes.push(`${job.id.slice(0, 8)}: ${(e as Error).message}`)
    }
  }
  return { touched: jobs.length, notes }
}

async function failJob(jobId: string, reason: string): Promise<void> {
  await prisma.job.update({ where: { id: jobId }, data: { status: 'failed', failReason: reason.slice(0, 500) } })
}

/** Advance ONE job as far as it can go without user input this tick. */
export async function advanceJob(job: JobWithSteps): Promise<void> {
  for (let hop = 0; hop <= job.steps.length; hop++) {
    const fresh = await getJobWithSteps(job.id)
    if (!fresh || !['running', 'waiting_settlement', 'waiting_signature'].includes(fresh.status)) return
    const step = fresh.steps.find((s) => s.seq === fresh.currentStep)

    // Past the last step → the job is done; roll up money moved.
    if (!step) {
      const valueUsd = fresh.steps.reduce((a, s) => a + (s.valueUsd ?? 0), 0)
      await prisma.job.update({ where: { id: fresh.id }, data: { status: 'done', valueUsd: valueUsd || null } })
      return
    }
    if (step.status === 'done') {
      await prisma.job.update({ where: { id: fresh.id }, data: { currentStep: step.seq + 1, status: 'running' } })
      continue
    }
    if (step.status === 'failed') {
      await failJob(fresh.id, `step ${step.seq + 1} failed`)
      return
    }

    if (step.kind === 'sign') {
      if (step.status === 'offered') {
        // Stale artifact? Re-arm it for a fresh build; else wait for the user.
        if (step.expiresAt && step.expiresAt < new Date()) {
          await prisma.jobStep.updateMany({ where: { id: step.id, status: 'offered' }, data: { status: 'pending', artifact: undefined } })
          continue
        }
        if (fresh.status !== 'waiting_signature') {
          await prisma.job.update({ where: { id: fresh.id }, data: { status: 'waiting_signature' } })
        }
        return
      }
      // Atomic claim, then build fresh + guard.
      const claim = await prisma.jobStep.updateMany({ where: { id: step.id, status: 'pending' }, data: { status: 'running' } })
      if (claim.count !== 1) return
      try {
        const built = await buildSignArtifact(fresh.wallet, step.builder, step.params as Record<string, unknown>)
        await prisma.jobStep.update({
          where: { id: step.id },
          data: {
            status: 'offered',
            artifact: built.artifact as object,
            guardReport: (built.guardReport as object | undefined) ?? undefined,
            valueUsd: built.valueUsd,
            expiresAt: new Date(Date.now() + OFFER_TTL_MS),
          },
        })
        await prisma.job.update({ where: { id: fresh.id }, data: { status: 'waiting_signature' } })
      } catch (e) {
        // A spend-policy refusal persists its structured block so the JobCard
        // can offer the exact fix + retry instead of a dead-end message.
        const policyBlock = e instanceof PolicyRefusedError ? e.policyBlock : undefined
        await prisma.jobStep.update({
          where: { id: step.id },
          data: { status: 'failed', result: { error: (e as Error).message, ...(policyBlock ? { policyBlock } : {}) } as object },
        })
        await failJob(fresh.id, `"${step.title}" refused: ${(e as Error).message}`)
      }
      return
    }

    if (step.kind === 'wait') {
      if (step.status === 'pending') {
        const claim = await prisma.jobStep.updateMany({
          where: { id: step.id, status: 'pending' },
          data: { status: 'running', expiresAt: new Date(Date.now() + WAIT_TIMEOUT_MS) },
        })
        if (claim.count !== 1) return
      }
      if (step.expiresAt && step.expiresAt < new Date()) {
        await prisma.jobStep.update({ where: { id: step.id }, data: { status: 'failed', result: { error: 'settlement timeout' } } })
        await failJob(fresh.id, `"${step.title}" timed out — unfilled swaps auto-refund to your wallet.`)
        return
      }
      const settled = await evaluateWait(fresh, step.seq)
      if (settled.done) {
        await prisma.jobStep.update({ where: { id: step.id }, data: { status: 'done', result: settled.result as object } })
        await prisma.job.update({ where: { id: fresh.id }, data: { currentStep: step.seq + 1, status: 'running' } })
        continue
      }
      if (settled.failed) {
        await prisma.jobStep.update({ where: { id: step.id }, data: { status: 'failed', result: settled.result as object } })
        await failJob(fresh.id, `"${step.title}": ${settled.failed}`)
        return
      }
      if (fresh.status !== 'waiting_settlement') {
        await prisma.job.update({ where: { id: fresh.id }, data: { status: 'waiting_settlement' } })
      }
      return
    }

    // auto — server-side under an existing consent.
    const claim = await prisma.jobStep.updateMany({ where: { id: step.id, status: 'pending' }, data: { status: 'running' } })
    if (claim.count !== 1) return
    if (step.builder === 'native-hl-guardian') {
      const armed = await armGuardianPolicy(fresh.wallet, step.params as unknown as GuardianArmAsk)
      if (!armed.ok) {
        await prisma.jobStep.update({ where: { id: step.id }, data: { status: 'failed', result: { error: armed.error } } })
        await failJob(fresh.id, `"${step.title}": ${armed.error}`)
        return
      }
      await prisma.jobStep.update({ where: { id: step.id }, data: { status: 'done', result: { policy: armed.policy, positionNote: armed.positionNote } as object } })
      await prisma.job.update({ where: { id: fresh.id }, data: { currentStep: step.seq + 1, status: 'running' } })
      continue
    }
    await prisma.jobStep.update({ where: { id: step.id }, data: { status: 'failed', result: { error: `unknown auto builder ${step.builder}` } } })
    await failJob(fresh.id, `unknown auto builder ${step.builder}`)
    return
  }
}

/** Build a sign step's artifact with the SAME builders chat uses. Throws on
 *  guard refusal (the message is the honest reason). */
export async function buildSignArtifact(
  wallet: string,
  builder: string,
  params: Record<string, unknown>,
): Promise<{ artifact: Record<string, unknown>; guardReport?: unknown; valueUsd: number | null }> {
  if (builder === 'native-cross-chain') {
    const p = params as unknown as CrossChainSwapParams
    const raw = (await callMcpTool(NEAR_INTENTS_MCP, 'build_swap', {
      originChain: p.originChain,
      originToken: p.originToken,
      destinationChain: p.destinationChain,
      destinationToken: p.destinationToken,
      amount: p.amount,
      from: wallet,
    }, { timeoutMs: 20_000 })) as BuiltSwap
    const guard = guardCrossChainBuild(raw, { chainId: expectedOriginChainId(p.originChain) })
    if (!guard.ok || !guard.tx) throw new Error(guard.reasons.join(' '))
    const valueUsd = crossChainValueUsd(raw)
    return {
      artifact: { txRequest: guard.tx as unknown as Record<string, unknown>, depositAddress: guard.depositAddress, summary: guard.summary, addressExpires: guard.addressExpires },
      guardReport: { ok: true, warnings: guard.warnings, valueUsd },
      valueUsd,
    }
  }
  if (builder === 'native-hl-exec') {
    const turn = await buildHlExecTurn(params as unknown as HlIntent, wallet, () => {})
    if (turn.orderRequest) return { artifact: { orderRequest: turn.orderRequest }, guardReport: turn.guardrails, valueUsd: turn.guardrails?.valueUsd ?? null }
    if (turn.txRequest) return { artifact: { txRequest: turn.txRequest }, guardReport: turn.guardrails, valueUsd: turn.guardrails?.valueUsd ?? null }
    throw new Error(turn.reply.replace(/^[^\w]+/, ''))
  }
  if (builder === 'native-lido') {
    const p = params as unknown as LidoStakeParams
    // 'max' resolves from the LIVE mainnet balance at build time — the
    // compound-job form ("…then stake the ETH on lido") where the amount
    // only exists after the bridge settles.
    let amountEth = p.amount
    if (amountEth === 'max') {
      const client = publicClientFor(1)
      if (!client) throw new Error('No Ethereum mainnet RPC configured — cannot resolve the stake amount.')
      const balance = await client.getBalance({ address: wallet as `0x${string}` })
      const resolved = suggestedStakeEth(formatEther(balance))
      if (!resolved) throw new Error(`Wallet holds only ${formatEther(balance)} ETH on mainnet — nothing left to stake after the gas buffer.`)
      amountEth = resolved
    }
    const raw = (await callMcpTool(LIDO_MCP, 'build_stake', { user: wallet, amount: amountEth, receive: p.receive }, { timeoutMs: 20_000 })) as LidoBuiltStake
    const guard = guardLidoStakeBuild(raw, { amountEth, receive: p.receive })
    if (!guard.ok || !guard.tx) throw new Error(guard.reasons.join(' '))
    // Price the stake off the same read the splash uses (fail-soft null).
    const valueUsd = await callMcpTool(LIDO_MCP, 'position', { user: wallet }, { timeoutMs: 12_000 })
      .then((pos) => {
        const eth = (pos as LidoPositionPayload).eth
        const price = Number(eth?.usd) / Number(eth?.balance)
        return Number.isFinite(price) && price > 0 ? Number((Number(amountEth) * price).toFixed(2)) : null
      })
      .catch(() => null)
    return {
      artifact: { txRequest: guard.tx as unknown as Record<string, unknown>, summary: guard.summary },
      guardReport: { ok: true, warnings: guard.warnings, valueUsd },
      valueUsd,
    }
  }
  if (builder === 'native-swap') {
    // Same-chain swap through the SHARED venue cascade (lib/swap-exec.ts —
    // the exact builders + guardrails chat and the swap panel use). Built
    // fresh at offer time: after a funding leg settles, the balance the
    // venue simulation checks is the real, funded one.
    const p = params as { sellToken: string; buyToken: string; amountHuman: string; chainId: number }
    const built = await buildGuardedSwap({ sellToken: p.sellToken, buyToken: p.buyToken, amountHuman: p.amountHuman, from: wallet, chainId: Number(p.chainId) })
    if (!built.ok) throwRefusal(built.reasons, built.guardrails)
    return {
      artifact: { txChain: built.txChain, summary: built.summary },
      guardReport: built.guardrails,
      valueUsd: built.guardrails.valueUsd ?? null,
    }
  }
  if (builder === 'native-aave-supply' || builder === 'native-aave-repay') {
    // Aave steps ride the same fail-closed recipe chat uses (lib/aave-exec):
    // reserves resolved from the agent's own list, build_* with resolved
    // addresses, every step re-verified. Built fresh at offer time — after a
    // funding leg settles, the wallet really holds what the build checks.
    const p = params as { token: string; amount: string | null; max?: boolean }
    const built =
      builder === 'native-aave-supply'
        ? await buildAaveSupplyArtifact(wallet, { token: p.token, amount: p.amount ?? '' })
        : await buildAaveRepayArtifact(wallet, p)
    return {
      artifact: { txChain: built.txChain, summary: built.summary },
      guardReport: built.guardReport,
      valueUsd: built.valueUsd,
    }
  }
  if (builder === 'native-lifi-fund') {
    // One funding leg of the Robinhood plan: Base USDC → gas ETH or USDG on
    // Robinhood Chain, built fresh (quote + guardrails + destination
    // baseline) at offer time. The artifact carries a txChain so the JobCard
    // embeds the same self-advancing SendTxChain chat uses, refresh recipe
    // included (LiFi quotes go stale in ~90s — the deadline watch re-quotes).
    const p = params as { leg: FundingLeg; usd: number; origin?: number; token?: string }
    const origin = Number(p.origin ?? 8453)
    const built = await buildLifiBridgeLeg({ leg: p.leg, usd: Number(p.usd), from: wallet, origin, token: p.token })
    if (built.blocked) {
      const reasons = built.guardrails.checks.filter((c) => !c.ok && c.level === 'block').map((c) => c.note).join(' ')
      throwRefusal(reasons || 'a safety check refused the funding leg', built.guardrails)
    }
    return {
      artifact: {
        txChain: {
          summary: built.summary,
          steps: built.steps,
          refresh: { kind: 'lifi-bridge', stepIndex: built.bridgeStepIndex, params: { leg: p.leg, usd: String(p.usd), origin: String(origin), ...(p.token ? { token: p.token } : {}) } },
        },
        summary: built.summary,
        arrival: built.arrival as unknown as Record<string, unknown>,
      },
      guardReport: built.guardrails,
      valueUsd: built.valueUsd,
    }
  }
  if (builder === 'native-lifi-swap') {
    // The buy that the funding legs exist for. The USDG amount resolves from
    // the LIVE Robinhood Chain balance at offer time — bridge fees mean the
    // arrived amount is slightly under the asked dollars, and a job step
    // must never offer a swap the wallet can't fund.
    const p = params as { buyUsd: number; buyToken: string; chainId?: number }
    const chainId = Number(p.chainId ?? ROBINHOOD_CHAIN_ID)
    const client = publicClientFor(chainId)
    const stable = primaryStable(chainId)
    if (!client || !stable) throw new Error(`No RPC client / stable token configured for chain ${chainId}.`)
    const balance = await client.readContract({ address: stable.address, abi: erc20Abi, functionName: 'balanceOf', args: [wallet as `0x${string}`] })
    const balanceUsd = Number(balance) / 10 ** stable.decimals
    const buyUsd = Number(p.buyUsd)
    if (balanceUsd < buyUsd * 0.5) {
      throw new Error(`The wallet holds only ${balanceUsd.toFixed(2)} ${stable.symbol} on the chain — not enough to buy $${buyUsd} of ${p.buyToken}.`)
    }
    const amountHuman = Math.min(buyUsd, Math.floor(balanceUsd * 100) / 100).toFixed(2)
    await ensureTokenList(chainId) // AAPL/TSLA/… resolve from the official list
    const built = await buildLifiSwap({ sellToken: stable.symbol, buyToken: p.buyToken, amountHuman, from: wallet, chainId })
    if (built.blocked) {
      const reasons = built.guardrails.checks.filter((c) => !c.ok && c.level === 'block').map((c) => c.note).join(' ')
      throwRefusal(reasons || 'a safety check refused the swap', built.guardrails)
    }
    return {
      artifact: {
        txChain: {
          summary: built.summary,
          steps: built.steps,
          refresh: { kind: 'lifi-swap', stepIndex: built.swapStepIndex, params: { sellToken: stable.symbol, buyToken: p.buyToken, amountHuman, chainId: String(chainId) } },
        },
        summary: built.summary,
      },
      guardReport: built.guardrails,
      valueUsd: built.guardrails.valueUsd ?? Number(amountHuman),
    }
  }
  if (builder === 'native-transfer') {
    // Fungible send through the native transfer layer (lib/transfer-exec):
    // pinned calldata, live-balance check, priced valueUsd, full outflow
    // policy gate. Built fresh at offer time — after a bridge leg settles,
    // the balance the check reads is the real, funded one.
    const built = await buildTransferArtifact(params as unknown as TransferSegment, wallet)
    if ('problem' in built) throw new Error(built.problem)
    if (built.blocked) {
      throwRefusal(built.refusal ?? 'a safety check refused the transfer', built.guardrails)
    }
    return {
      artifact: { txRequest: built.tx as unknown as Record<string, unknown>, summary: built.summary },
      guardReport: built.guardrails,
      valueUsd: built.guardrails.valueUsd ?? null,
    }
  }
  if (builder === 'native-nft-transfer' || builder === 'native-nft-list' || builder === 'native-nft-buy') {
    // NFT steps ride the SAME native NFT layer chat uses (lib/nft-layer):
    // ownership re-anchored on-chain at offer time, transfer calldata
    // re-decoded by the independent guard, listings assembled from the
    // collection's LIVE fee schedule and re-verified at the submit relay,
    // buys resolved against LIVE listings with locally re-encoded fulfillment.
    const ask = params as unknown as NftAsk
    if (builder === 'native-nft-buy') {
      if (ask.kind !== 'buy') throw new Error('step params are not an NFT buy ask')
      const built = await buildNftBuy(ask, wallet)
      if ('problem' in built) throw new Error(built.problem)
      if (built.blocked) throwRefusal(built.refusal ?? 'a safety check refused the buy', built.guardrails)
      // artifact.nft is what the nft-owned wait predicate polls against.
      return {
        artifact: { txRequest: built.tx as unknown as Record<string, unknown>, summary: built.summary, nft: built.nft as unknown as Record<string, unknown> },
        guardReport: built.guardrails,
        valueUsd: built.guardrails.valueUsd ?? null,
      }
    }
    if (builder === 'native-nft-transfer') {
      if (ask.kind !== 'transfer') throw new Error('step params are not an NFT transfer ask')
      const built = await buildNftTransfer(ask, wallet)
      if ('problem' in built) throw new Error(built.problem)
      if (built.blocked) throwRefusal(built.refusal ?? 'a safety check refused the NFT transfer', built.guardrails)
      return {
        artifact: { txRequest: built.tx as unknown as Record<string, unknown>, summary: built.summary },
        guardReport: built.guardrails,
        valueUsd: built.guardrails.valueUsd ?? null,
      }
    }
    if (ask.kind !== 'sell') throw new Error('step params are not an NFT listing ask')
    const built = await buildNftListing(ask, wallet)
    if ('problem' in built) throw new Error(built.problem)
    if (built.blocked) throwRefusal(built.refusal ?? 'a safety check refused the listing', built.guardrails)
    return {
      artifact: { orderRequest: built.order as unknown as Record<string, unknown>, summary: built.summary },
      guardReport: built.guardrails,
      valueUsd: built.guardrails.valueUsd ?? null,
    }
  }
  throw new Error(`unknown sign builder ${builder}`)
}

/** Evaluate a wait step's predicate. */
async function evaluateWait(
  job: JobWithSteps,
  seq: number,
): Promise<{ done?: boolean; failed?: string; result?: unknown }> {
  const step = job.steps.find((s) => s.seq === seq)!
  const pred = (step.waitPredicate ?? {}) as { kind?: string; fromStep?: number; fromSteps?: number[]; minUsd?: number }

  if (pred.kind === 'chain-arrival') {
    // Every funding leg recorded a destination baseline + expected delta at
    // build time (artifact.arrival) — settled when ALL of them are visible.
    const arrivals = (pred.fromSteps ?? [])
      .map((s) => (job.steps.find((x) => x.seq === s)?.artifact as { arrival?: ChainArrival } | null)?.arrival)
      .filter((a): a is ChainArrival => !!a?.baselineAtoms)
    if (arrivals.length === 0) return { failed: 'no arrival expectations on the prior funding steps' }
    try {
      const check = await checkChainArrival(job.wallet, arrivals)
      if (check.done) return { done: true, result: { status: check.note } }
      return {}
    } catch {
      return {} // RPC trouble is "not yet", never arrival — the timeout still bounds the wait
    }
  }

  if (pred.kind === 'oneclick') {
    const from = job.steps.find((s) => s.seq === pred.fromStep)
    const depositAddress = (from?.artifact as { depositAddress?: string } | null)?.depositAddress
    if (!depositAddress) return { failed: 'no deposit address on the prior step' }
    const status = await callMcpTool(NEAR_INTENTS_MCP, 'check_status', { depositAddress }, { timeoutMs: 15_000 }).catch((e) => `error: ${(e as Error).message}`)
    const text = typeof status === 'string' ? status : JSON.stringify(status)
    if (/SUCCESS/.test(text)) return { done: true, result: { status: 'SUCCESS' } }
    if (/REFUNDED|FAILED/.test(text)) return { failed: 'the swap was refunded/failed — funds return to your wallet', result: { status: text.slice(0, 200) } }
    return {}
  }

  if (pred.kind === 'nft-owned') {
    // The prior buy step recorded exactly which NFT the fill targets
    // (artifact.nft) — settled once the chain shows the job's wallet owning
    // it. Probes ERC-721 ownerOf first, ERC-1155 balanceOf as the fallback.
    const from = job.steps.find((s) => s.seq === pred.fromStep)
    const nft = (from?.artifact as { nft?: { chainId: number; contract: string; tokenId: string } } | null)?.nft
    if (!nft?.contract || !nft.tokenId) return { failed: 'no NFT target on the prior buy step' }
    const client = publicClientFor(nft.chainId)
    if (!client) return { failed: `no RPC client configured for chain ${nft.chainId}` }
    try {
      const owner = (await client.readContract({ address: nft.contract as `0x${string}`, abi: NFT_ERC721_ABI, functionName: 'ownerOf', args: [BigInt(nft.tokenId)] })) as string
      if (owner.toLowerCase() === job.wallet) return { done: true, result: { owner } }
      return {}
    } catch {
      /* not a 721 (or RPC trouble) — try 1155 before calling it "not yet" */
    }
    try {
      const bal = (await client.readContract({ address: nft.contract as `0x${string}`, abi: NFT_ERC1155_ABI, functionName: 'balanceOf', args: [job.wallet as `0x${string}`, BigInt(nft.tokenId)] })) as bigint
      if (bal >= BigInt(1)) return { done: true, result: { balance: bal.toString() } }
    } catch {
      /* RPC trouble is "not yet", never arrival — the timeout bounds the wait */
    }
    return {}
  }

  if (pred.kind === 'hl-credit') {
    const info = new InfoClient({ transport: new HttpTransport() })
    const st = await info.clearinghouseState({ user: job.wallet as `0x${string}` })
    const withdrawable = Number(st.withdrawable)
    if (withdrawable >= (pred.minUsd ?? 1)) return { done: true, result: { withdrawableUsd: withdrawable } }
    return {}
  }

  return { failed: `unknown wait predicate ${pred.kind}` }
}

/** The signed-step callback from the JobCard: record evidence and advance
 *  inline so the next step offers without waiting a full cron tick. */
export async function completeSignStep(
  jobId: string,
  wallet: string,
  seq: number,
  result: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const job = await getJobWithSteps(jobId)
  if (!job || job.wallet !== wallet.toLowerCase()) return { ok: false, error: 'job not found' }
  const step = job.steps.find((s) => s.seq === seq)
  if (!step || step.kind !== 'sign') return { ok: false, error: 'not a sign step' }
  const claim = await prisma.jobStep.updateMany({ where: { id: step.id, status: 'offered' }, data: { status: 'done', result: result as object } })
  if (claim.count !== 1) return { ok: false, error: 'step is not awaiting a signature' }
  await prisma.job.update({ where: { id: jobId }, data: { currentStep: seq + 1, status: 'running' } })
  const fresh = await getJobWithSteps(jobId)
  if (fresh) await advanceJob(fresh).catch(() => {})
  return { ok: true }
}

/** Re-arm a failed job for a fresh build of its failed step — the fix (a
 *  policy change, a topped-up balance) happened OUTSIDE the job, so the step
 *  goes back to pending and rebuilds through the same guarded path. Completed
 *  steps keep their receipts; nothing is signed here. */
export async function retryFailedJob(jobId: string, wallet: string): Promise<{ ok: boolean; error?: string }> {
  const job = await getJobWithSteps(jobId)
  if (!job || job.wallet !== wallet.toLowerCase()) return { ok: false, error: 'job not found' }
  if (job.status !== 'failed') return { ok: false, error: 'only a failed job can be retried' }
  const failed = job.steps.find((s) => s.status === 'failed')
  if (!failed) return { ok: false, error: 'no failed step to retry' }
  // Atomic re-arm: overlapping retries converge on one pending step.
  const claim = await prisma.jobStep.updateMany({ where: { id: failed.id, status: 'failed' }, data: { status: 'pending' } })
  if (claim.count !== 1) return { ok: false, error: 'already retried' }
  await prisma.job.update({ where: { id: jobId }, data: { status: 'running', failReason: null, currentStep: failed.seq } })
  const fresh = await getJobWithSteps(jobId)
  if (fresh) await advanceJob(fresh).catch(() => {})
  return { ok: true }
}

export async function cancelJob(jobId: string, wallet: string): Promise<boolean> {
  const res = await prisma.job.updateMany({
    where: { id: jobId, wallet: wallet.toLowerCase(), status: { in: ['running', 'waiting_signature', 'waiting_settlement', 'paused'] } },
    data: { status: 'canceled' },
  })
  return res.count === 1
}
