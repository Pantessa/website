// lib/desk-drive.ts — the I/O half of the agent-signed leg loop (squad contract C3).
//
// `broker_execute` compiles an agent's sequenced ask into a job the AGENT'S OWN wallet
// drives. Until now the desk handed back a job id + capability token and told the agent to
// go talk to the Jobs API. That works, but it means an LLM-driven agent has to leave the
// MCP surface mid-intent, learn a second protocol, and re-derive "what kind of thing is
// this" from a raw artifact. `broker_next` / `broker_done` close the loop ON the desk.
//
// ── WHY TRANSACTION MATERIAL NOW CROSSES THIS SURFACE (the M1 revision) ──────────────
// M1 (2026-08-17) wrote: "No transaction material travels through this MCP surface."
// That was the right rule for a surface whose only caller was ANONYMOUS — broker_open is
// unauthenticated by design. It is the wrong rule for the execute path, which by then had
// three gates the open path does not have:
//   1. a bound identity — the intent refuses to execute without an `agent_key` (M1 itself);
//   2. a PROVEN wallet — the agent personal_signs a consent text naming this intent id and
//      this wallet, and the desk recovers the signer before a job row exists;
//   3. a capability token — `signJobToken(jobId, wallet)`, the exact grant the Jobs API
//      accepts, which the desk mints because it knows the job and the wallet.
// Under those three, the desk surface IS the Jobs API's trust boundary, reached by a
// different transport. Withholding the artifact bought nothing: the same bytes were one
// `GET /api/jobs/{id}?t=` away for the same caller. It cost the agent a protocol.
// The rule that actually carries the safety is unchanged and is NOT relaxed anywhere:
// **deterministic builders write every transaction, each build is guard-checked fail-closed
// at offer time, and money moves only through a wallet signature.** The artifact an agent
// reads here is the one the runner just built and guarded for that agent's own wallet.
// Everything NOT the artifact still passes `assertNoTxMaterial` (see `sayShape` below), so
// the negotiation half of the desk keeps its mechanical pin.
//
// Lane note: the MCP lane owns this file. `lib/broker-exec.ts` is the DRIVE lane's — hence
// a sibling module rather than two more exports there.

import { createHmac, timingSafeEqual } from 'node:crypto'
import prisma from '@/lib/db'
import { advanceJob, completeSignStep, getJobWithSteps, jobsEnv } from '@/lib/jobs-runner'
import { signJobToken } from '@/lib/job-token'
import { assertDeskOpen } from '@/lib/broker-policy'
import { assertNoTxMaterial } from '@/lib/broker'
import { deskNextOf, legViewOf, type DeskLegView, type DeskNext } from '@/lib/desk-wire'
import { jobStepBuildPath, jobStepChainId, jobStepSignedInfo } from '@/lib/job-step-telemetry'
import { feeBpsOfArtifact } from '@/lib/fees'
import { isBuildPath } from '@/lib/build-path'
import { COUNTED_VERIFICATIONS, verifyTurnNow } from '@/lib/link-receipt-verify'
import { chainById } from '@/lib/chains'
import type { DeskCallOpts } from '@/lib/broker-exec'

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.pantessa.com').replace(/\/$/, '')

export interface DeskDriveResult {
  intentId: string
  jobId: string
  /** The wallet that owns every leg — the one the intent proved at execute. */
  wallet: string
  next: DeskNext
  /** The same Jobs-API grant `broker_execute` returned, minted fresh. An agent
   *  that would rather drive the REST channel (or hand it to the `pantessa`
   *  SDK's `driveJob`) never has to re-open the intent to get one. */
  drive: { poll: string; complete: string; refresh: string; hlSubmit: string }
  how: string[]
  say: string
}

export interface DeskDoneResult extends DeskDriveResult {
  accepted: { seq: number; keptKeys: string[]; ignoredKeys: string[] }
  /** Whether the leg's money row could be receipt-verified on the spot
   *  (S-2: a claim is evidence about the claimant — the chain is the proof). */
  money: { recorded: boolean; valueUsd: number | null; verification: string | null } | null
}

/* ── the gate ─────────────────────────────────────────────────────────── */

/** Constant-time string equality that never leaks length through timing of
 *  the compare itself (lengths differ → both sides are hashed to 32 bytes). */
function sameSecret(a: string, b: string): boolean {
  const h = (s: string) => createHmac('sha256', 'desk-agent-key').update(s).digest()
  return timingSafeEqual(h(a), h(b))
}

/** Every refusal names itself — an LLM-driven agent can only recover from a
 *  reason it can read. */
async function mustDriveable(intentId: unknown, agentKey: unknown) {
  // C3: the drive tools ride the desk kill switch. An agent mid-job is never
  // stranded by a pause — it already holds the Jobs-API recipe from execute,
  // and the refusal says so.
  try {
    assertDeskOpen()
  } catch {
    throw new Error(
      'The Pantessa agent desk is paused, so it is not serving legs right now. A job already executing is ' +
        `unaffected: drive it directly at ${SITE}/api/jobs/<jobId>?t=<the token broker_execute returned>. ` +
        'broker_status and broker_close keep working.',
    )
  }
  const id = typeof intentId === 'string' ? intentId.trim() : ''
  const row = id ? await prisma.brokerIntent.findUnique({ where: { id } }) : null
  if (!row) throw new Error(`No such intent "${String(intentId)}".`)
  if (!row.jobId || !row.wallet)
    throw new Error(
      `Intent ${row.id} is ${row.state} — it has no job to drive. The leg loop starts at broker_execute, ` +
        'which compiles a SEQUENCED ask into a job owned by the wallet the intent was opened for. ' +
        'A human-handoff intent reports through broker_status instead.',
    )
  const bound = typeof row.agentKey === 'string' ? row.agentKey : ''
  const presented = typeof agentKey === 'string' ? agentKey.trim() : ''
  if (!bound)
    throw new Error(
      `Intent ${row.id} carries no bound agent identity, so no caller can claim its legs. ` +
        'Re-open with agent_key and execute again.',
    )
  if (!presented || !sameSecret(bound, presented))
    throw new Error(
      `agent_key does not match the identity intent ${row.id} was opened with. The legs of an agent-signed ` +
        'job are served only to the agent that proved the wallet at broker_execute.',
    )
  return row
}

/* ── the answer ───────────────────────────────────────────────────────── */

const HOW = [
  'kind tells you what to sign: tx = one EVM transaction; txChain = N EVM transactions IN ORDER (a step carrying validUntil is re-quoted first via the refresh URL); hlAction/hlBatch = Hyperliquid L1 action(s), EIP-712 domain chainId 1337, POST to hlSubmit; order = an off-chain EIP-712 order (CoW, Seaport) with its own submitUrl.',
  'Sign the artifact EXACTLY as served. Never re-serialize it: a Hyperliquid action is hashed as msgpack and key order is part of the hash, while storage re-sorted it — sign orderRequest.typedData verbatim and post the action back unchanged; the submit relay re-canonicalizes before it hashes (#850).',
  'staleAfterMs is how long the material stays signable (a Hyperliquid nonce ~90s; deadline calldata to its validUntil; otherwise the runner rebuilds after 30 minutes). At 0, call broker_next again for a fresh build rather than signing what you hold.',
  'Then broker_done(intent_id, seq, result) — it records the leg, rolls the runner forward, and answers with the NEXT leg. One call per leg; no polling loop in between.',
  'waiting means there is nothing to sign: a wait leg is settling on-chain (the runner verifies arrival itself) or the next leg is being built and guard-checked. Sleep retryAfterMs and call broker_next again.',
  'Completion is advancement, not proof. The wait leg after yours reads the chain; a result that claims a hash the chain does not have fails the job closed one leg later.',
]

function driveUrls(jobId: string, wallet: string) {
  const t = signJobToken(jobId, wallet)
  return {
    poll: `${SITE}/api/jobs/${jobId}?t=${t}`,
    complete: `${SITE}/api/jobs/${jobId}/complete?t=${t}`,
    refresh: `${SITE}/api/tx/refresh`,
    hlSubmit: `${SITE}/api/hl/submit`,
  }
}

function sayFor(next: DeskNext, legs: number): string {
  if (next.leg) {
    const n = next.leg
    return `Leg ${n.seq + 1}/${legs} is offered (${n.kind}): ${n.summary} Sign it with the intent's wallet, then broker_done.`
  }
  return `Leg ${'—'} : ${next.waiting ?? 'nothing offered.'}${next.retryAfterMs ? ` Retry in ~${Math.round(next.retryAfterMs / 1000)}s.` : ''}`
}

/** Read the current leg. Advances the job inline first, exactly like the Jobs
 *  API GET: the agent's poll IS the demand, so a settled wait never waits on
 *  the cron window (the 2026-09-02 starvation lesson). */
export async function deskNext(intentId: unknown, agentKey: unknown): Promise<DeskDriveResult> {
  const row = await mustDriveable(intentId, agentKey)
  const out = await readNext(row.id, row.jobId!, row.wallet!)
  return out
}

async function readNext(intentId: string, jobId: string, wallet: string): Promise<DeskDriveResult> {
  let job = await getJobWithSteps(jobId)
  if (!job) throw new Error(`Intent ${intentId} points at job ${jobId}, which no longer exists.`)
  if (['running', 'waiting_settlement', 'waiting_signature'].includes(job.status) && job.originEnv === jobsEnv()) {
    await advanceJob(job).catch(() => {})
    job = (await getJobWithSteps(jobId)) ?? job
  }
  const next = deskNextOf(job)
  const out: DeskDriveResult = {
    intentId,
    jobId,
    wallet,
    next,
    drive: driveUrls(jobId, wallet),
    how: HOW,
    say: sayFor(next, job.steps.length),
  }
  // The negotiation half keeps its mechanical pin: everything except the leg
  // the agent is here to sign must still be free of transaction material.
  assertNoTxMaterial(sayShape(out))
  return out
}

/** The payload minus the deliberate channel — what `assertNoTxMaterial` still
 *  polices. If a future field starts smuggling calldata through the envelope,
 *  this throws exactly as it always did. */
function sayShape(out: DeskDriveResult): unknown {
  const { artifact: _artifact, ...legRest } = out.next.leg ?? ({} as DeskLegView)
  return {
    intentId: out.intentId,
    jobId: out.jobId,
    wallet: out.wallet,
    next: { ...out.next, leg: out.next.leg ? { ...legRest, artifact: '<served>' } : null },
    how: out.how,
    say: out.say,
  }
}

/* ── completing a leg ─────────────────────────────────────────────────── */

/** What a leg result may carry. An agent-supplied blob lands in `job_steps.result`
 *  and is read by the share receipt and the card, so it is allowlisted rather
 *  than stored whole — an unbounded write is a free row-inflation primitive. */
const RESULT_KEYS = new Set(['txHash', 'txs', 'chainId', 'orderResponse', 'batch', 'fill', 'detail', 'explorerUrl', 'status'])
const HASH_RE = /^0x[0-9a-fA-F]{64}$/

function sanitizeResult(raw: unknown): { result: Record<string, unknown>; kept: string[]; ignored: string[] } {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const result: Record<string, unknown> = {}
  const kept: string[] = []
  const ignored: string[] = []
  for (const [k, v] of Object.entries(src)) {
    if (!RESULT_KEYS.has(k)) {
      ignored.push(k)
      continue
    }
    // 8 KB per field: a venue's order response is a few hundred bytes.
    const size = JSON.stringify(v ?? null)?.length ?? 0
    if (size > 8192) {
      ignored.push(`${k} (too large)`)
      continue
    }
    result[k] = v
    kept.push(k)
  }
  return { result, kept, ignored }
}

/** Post a signed leg's evidence and answer with the next one. Rides the SAME
 *  `completeSignStep` the Jobs API `/complete` route calls — one path, so the
 *  desk can never diverge from the channel the browser uses. */
export async function deskDone(
  intentId: unknown,
  agentKey: unknown,
  seq: unknown,
  rawResult: unknown,
  call?: DeskCallOpts,
): Promise<DeskDoneResult> {
  const row = await mustDriveable(intentId, agentKey)
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0)
    throw new Error('seq must be the integer index of the leg you signed (the `seq` broker_next handed you).')
  const { result, kept, ignored } = sanitizeResult(rawResult)

  // Read the step BEFORE completing it: the artifact is what prices the leg
  // and names the venue, and completeSignStep is what advances past it.
  const before = await getJobWithSteps(row.jobId!)
  const step = before?.steps.find((s) => s.seq === seq)
  if (!step)
    throw new Error(`Job ${row.jobId} has no leg ${seq}. Call broker_next for the leg that is actually offered.`)
  if (step.status !== 'offered')
    throw new Error(
      `Leg ${seq} is "${step.status}", not offered — nothing is waiting on a signature there. ` +
        'Call broker_next; a leg that went stale is rebuilt and re-offered under the same seq.',
    )

  const done = await completeSignStep(row.jobId!, row.wallet!, seq, result)
  if (!done.ok) throw new Error(`The runner refused leg ${seq}: ${done.error}.`)

  const money = await recordDeskLegMoney({
    jobId: row.jobId!,
    seq,
    wallet: row.wallet!,
    intentId: row.id,
    builder: step.builder,
    artifact: step.artifact,
    valueUsd: step.valueUsd,
    result,
    internal: call?.internal === true || row.isInternal,
  })

  const next = await readNext(row.id, row.jobId!, row.wallet!)
  return { ...next, accepted: { seq, keptKeys: kept, ignoredKeys: ignored }, money }
}

/* ── money moved ──────────────────────────────────────────────────────── */

/**
 * A leg an AGENT signs has to count exactly like a leg a browser signs.
 *
 * The money row for a job step is a CLIENT beacon today (JobCard →
 * POST /api/embed/telemetry, lib/job-step-telemetry). An agent driving the
 * desk has no browser, so without this every agent-signed leg would move real
 * money and record nothing: $0 on /activity, $0 on Growth, nothing in the desk
 * log — the exact NULL-build_path class of bug #818 found on job steps, one
 * surface further out. So the desk writes the row itself, from the SAME field
 * mapping the browser lane uses (`jobStepSignedInfo`), and runs the SAME
 * receipt verifier (`verifyTurnNow`): the agent's claimed hash is evidence
 * about the agent, and only the chain promotes the row to counted.
 *
 * Deliberately NOT done here: creator referral claiming and earned-answer
 * grants. Both key off a link slug and a chat pool an agent-signed desk job
 * has neither of.
 */
async function recordDeskLegMoney(leg: {
  jobId: string
  seq: number
  wallet: string
  intentId: string
  builder: string
  artifact: unknown
  valueUsd: number | null
  result: Record<string, unknown>
  internal: boolean
}): Promise<DeskDoneResult['money']> {
  try {
    const buildPath = jobStepBuildPath(leg.builder, leg.artifact)
    const chainId = jobStepChainId(leg.artifact)
    const txHash = typeof leg.result.txHash === 'string' && HASH_RE.test(leg.result.txHash) ? leg.result.txHash : undefined
    const explorer = chainId ? chainById(chainId)?.explorerTx : undefined
    const info = jobStepSignedInfo({
      jobId: leg.jobId,
      seq: leg.seq,
      builder: leg.builder,
      valueUsd: leg.valueUsd,
      feeBps: feeBpsOfArtifact(leg.artifact),
      buildPath,
      chainId,
      txUrl:
        (typeof leg.result.explorerUrl === 'string' ? leg.result.explorerUrl.slice(0, 300) : undefined) ??
        (explorer && txHash ? `${explorer}${txHash}` : undefined),
    })
    const row = await prisma.embedTurn.create({
      select: { id: true },
      data: {
        embedKeyId: '',
        ownerAddress: null,
        origin: SITE,
        // The desk's own lane marker, and ≥8 chars of [A-Za-z0-9-] like every
        // other session id. `harness-` when internal so every downstream belt
        // (not just is_internal) reads the row as ours.
        sessionId: `${leg.internal ? 'harness-' : ''}desk-${leg.intentId}-${leg.seq}`.slice(0, 64),
        prompt: '',
        outcome: 'signed',
        artifact: 'job-step',
        chain: info.chain,
        txUrl: info.txUrl,
        valueUsd: info.valueUsd,
        buildPath: isBuildPath(buildPath) ? buildPath : undefined,
        originKind: 'job-step',
        walletAddress: leg.wallet.toLowerCase(),
        feeBps: info.feeBps,
        isInternal: leg.internal,
        symbols: [],
        // Money follows the receipt (S-2): fail closed, then let the chain
        // promote it.
        verification: 'unverified',
      },
    })
    const verification = await Promise.race([
      verifyTurnNow(row.id, chainId),
      new Promise<'unverified'>((r) => setTimeout(() => r('unverified'), 4000)),
    ]).catch(() => 'unverified')
    return {
      recorded: (COUNTED_VERIFICATIONS as readonly string[]).includes(verification),
      valueUsd: leg.valueUsd ?? null,
      verification,
    }
  } catch {
    // Telemetry never breaks the leg the agent just signed.
    return null
  }
}
