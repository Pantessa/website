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
import { expectedOriginChainId, guardCrossChainBuild, type BuiltSwap, type CrossChainSwapParams } from '@/lib/cross-chain-swap'
import { buildHlExecTurn, type HlIntent } from '@/lib/hyperliquid-exec'
import { armGuardianPolicy } from '@/lib/hl-guardian-store'
import type { GuardianArmAsk } from '@/lib/hl-guardian'
import type { CompiledJob } from '@/lib/jobs'

export function jobsEnv(): string {
  return process.env.VERCEL_ENV ?? 'dev'
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
        await prisma.jobStep.update({ where: { id: step.id }, data: { status: 'failed', result: { error: (e as Error).message } } })
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
async function buildSignArtifact(
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
    const usd = Number((raw.quote?.sell as { usd?: string } | undefined)?.usd)
    return {
      artifact: { txRequest: guard.tx as unknown as Record<string, unknown>, depositAddress: guard.depositAddress, summary: guard.summary, addressExpires: guard.addressExpires },
      guardReport: { ok: true, warnings: guard.warnings },
      valueUsd: Number.isFinite(usd) ? Number(usd.toFixed(2)) : null,
    }
  }
  if (builder === 'native-hl-exec') {
    const turn = await buildHlExecTurn(params as unknown as HlIntent, wallet, () => {})
    if (turn.orderRequest) return { artifact: { orderRequest: turn.orderRequest }, guardReport: turn.guardrails, valueUsd: turn.guardrails?.valueUsd ?? null }
    if (turn.txRequest) return { artifact: { txRequest: turn.txRequest }, guardReport: turn.guardrails, valueUsd: turn.guardrails?.valueUsd ?? null }
    throw new Error(turn.reply.replace(/^[^\w]+/, ''))
  }
  throw new Error(`unknown sign builder ${builder}`)
}

/** Evaluate a wait step's predicate. */
async function evaluateWait(
  job: JobWithSteps,
  seq: number,
): Promise<{ done?: boolean; failed?: string; result?: unknown }> {
  const step = job.steps.find((s) => s.seq === seq)!
  const pred = (step.waitPredicate ?? {}) as { kind?: string; fromStep?: number; minUsd?: number }

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

export async function cancelJob(jobId: string, wallet: string): Promise<boolean> {
  const res = await prisma.job.updateMany({
    where: { id: jobId, wallet: wallet.toLowerCase(), status: { in: ['running', 'waiting_signature', 'waiting_settlement', 'paused'] } },
    data: { status: 'canceled' },
  })
  return res.count === 1
}
