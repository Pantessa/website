// lib/job-step-money.ts — the ONE server-side writer of a job step's money row.
//
// Three lanes of the 2026-09-23 agent-desk squad found the same hole independently: a job
// leg signed by an AGENT books $0. `embed_turns` — the row that /activity, Growth, the fee
// split and the creator books all read — is written by a CLIENT beacon (`JobCard` →
// `POST /api/embed/telemetry`, lib/job-step-telemetry). An agent has no browser, so an
// agent that moves real money records nothing: no money moved, no fee, nothing in the desk
// log. Same class as #818's NULL `build_path` on job steps, one surface further out.
//
// So the write happens where the COMPLETION happens — `completeSignStep` — for every
// channel at once: the browser, the Jobs API `/complete` route, and the desk's
// `broker_done`. The browser's own beacon is deduped against this row on `sessionId`
// (`job-<jobId>-<seq>` is the stable identity of one signed leg, whoever reported it).
//
// What it is NOT: this does not claim creator referrals and does not bank earned answers.
// Both key off an intent-link slug and a chat pool a job-driven leg has neither of, and
// both are write-once and lifetime — exactly the things not to grant on a server-side
// inference about who signed.
//
// Trust: the result an agent (or a browser) posts is a CLAIM about itself (#824). The row
// starts `unverified` and only `verifyTurnNow` — the same receipt verifier the beacon runs
// — promotes it. A hash the chain has never seen counts nothing.

import prisma from '@/lib/db'
import { isBuildPath } from '@/lib/build-path'
import { chainById } from '@/lib/chains'
import { feeBpsOfArtifact } from '@/lib/fees'
import { jobStepBuildPath, jobStepChainId, jobStepSignedInfo } from '@/lib/job-step-telemetry'
import { COUNTED_VERIFICATIONS, receiptClientFor, verifyTurnNow } from '@/lib/link-receipt-verify'

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.pantessa.com').replace(/\/$/, '')
const HASH_RE = /^0x[0-9a-fA-F]{64}$/

/** The stable identity of ONE signed job leg, whoever reported it. Both this
 *  writer and the browser beacon key on it, so a leg can only be counted once
 *  however many surfaces saw it signed. */
export function jobStepMoneyKey(jobId: string, seq: number): string {
  return `job-${jobId}-${seq}`
}

/** Prefix for our own harness/drill rows (lib/internal-run.ts): every belt that
 *  reads a `harness-` session id, not just `is_internal`, sees it as ours. */
export function jobStepMoneySession(jobId: string, seq: number, isInternal: boolean): string {
  return `${isInternal ? 'harness-' : ''}${jobStepMoneyKey(jobId, seq)}`.slice(0, 64)
}

export interface JobStepMoney {
  /** True only when the CHAIN agreed — an agent's claim alone is never counted. */
  counted: boolean
  verification: string
  valueUsd: number | null
  /** False when a row for this (job, seq) already existed — the write is once. */
  wrote: boolean
}

export interface JobStepMoneyInput {
  job: { id: string; wallet: string; isInternal?: boolean | null }
  step: { seq: number; builder: string; artifact?: unknown; valueUsd?: number | null }
  /** What the signer reported — its own claim about its own signature. */
  result?: Record<string, unknown> | null
  /** Force the internal stamp on (a harness/drill run) regardless of the job row. */
  isInternal?: boolean
}

/**
 * Record the money a signed job leg moved. Idempotent on (job, seq), fail-soft:
 * telemetry never breaks the leg somebody just signed.
 */
export async function recordJobStepMoney(input: JobStepMoneyInput): Promise<JobStepMoney | null> {
  const { job, step } = input
  const result = input.result ?? {}
  const internal = input.isInternal === true || job.isInternal === true
  const sessionId = jobStepMoneySession(job.id, step.seq, internal)
  try {
    // Write once per leg. Two surfaces can watch one job (the chat's JobCard
    // and the rail overlay have always been able to), and now an agent can be
    // driving the same job over two transports.
    const existing = await prisma.embedTurn.findFirst({ where: { sessionId }, select: { id: true, valueUsd: true, verification: true } })
    if (existing) {
      return { counted: (COUNTED_VERIFICATIONS as readonly string[]).includes(existing.verification ?? ''), verification: existing.verification ?? 'unverified', valueUsd: existing.valueUsd ?? null, wrote: false }
    }

    const buildPath = jobStepBuildPath(step.builder, step.artifact)
    const chainId = jobStepChainId(step.artifact)
    const txHash = typeof result.txHash === 'string' && HASH_RE.test(result.txHash) ? result.txHash : undefined
    const explorer = chainId ? chainById(chainId)?.explorerTx : undefined
    const info = jobStepSignedInfo({
      jobId: job.id,
      seq: step.seq,
      builder: step.builder,
      valueUsd: step.valueUsd,
      feeBps: feeBpsOfArtifact(step.artifact),
      buildPath,
      chainId,
      txUrl:
        (typeof result.explorerUrl === 'string' ? result.explorerUrl.slice(0, 300) : undefined) ??
        (explorer && txHash ? `${explorer}${txHash}` : undefined),
    })

    const row = await prisma.embedTurn.create({
      select: { id: true },
      data: {
        embedKeyId: '',
        ownerAddress: null,
        origin: SITE,
        sessionId,
        // A job leg carries no free text — the ask is the job's title, and a
        // first-party row never stores a prompt.
        prompt: '',
        outcome: 'signed',
        artifact: 'job-step',
        chain: info.chain,
        txUrl: info.txUrl,
        valueUsd: info.valueUsd,
        buildPath: isBuildPath(buildPath) ? buildPath : undefined,
        originKind: 'job-step',
        walletAddress: job.wallet.toLowerCase(),
        feeBps: info.feeBps,
        isInternal: internal,
        symbols: [],
        // Money follows the receipt (S-2): fail closed, then let the chain
        // promote it.
        verification: 'unverified',
      },
    })
    // A job step's receipt class is `job`, which settles `attested` — counted
    // on the reporter's word, with no chain read. That is arguable for a
    // browser (a human watched a wallet pop) and indefensible for an agent
    // posting JSON: a fabricated hash on a leg the runner really built would
    // book that leg's whole notional as money moved. So an EVM leg is checked
    // here first, against the one fact a claim cannot forge — the chain's own
    // answer about who sent that transaction and whether it succeeded.
    // Unreadable chain → left `unverified` (T-R4: delay, never mint; the lazy
    // re-check promotes it later). An OFF-CHAIN leg (a Hyperliquid L1 action,
    // a CoW or Seaport order) has no receipt to read, so `attested` stands
    // exactly as it does for the browser.
    const claim = await claimedLegReceipt(chainId, txHash, job.wallet)
    if (claim === 'refuted') return { counted: false, verification: await settleVerification(row.id, 'mismatch'), valueUsd: info.valueUsd ?? null, wrote: true }
    if (claim === 'unreadable') return { counted: false, verification: 'unverified', valueUsd: info.valueUsd ?? null, wrote: true }

    const verification = await Promise.race([
      verifyTurnNow(row.id, chainId),
      new Promise<'unverified'>((r) => setTimeout(() => r('unverified'), 4_000)),
    ]).catch(() => 'unverified')
    return {
      counted: (COUNTED_VERIFICATIONS as readonly string[]).includes(verification),
      verification,
      valueUsd: info.valueUsd ?? null,
      wrote: true,
    }
  } catch {
    return null
  }
}

/** Stamp a verdict this module decided itself (the row is ours and brand new,
 *  so there is no terminal verdict to respect). Fail-soft. */
async function settleVerification(id: string, verdict: string): Promise<string> {
  await prisma.embedTurn.update({ where: { id }, data: { verification: verdict } }).catch(() => {})
  return verdict
}

type LegClaim = 'ok' | 'refuted' | 'unreadable' | 'off-chain'

/**
 * What the CHAIN says about the hash a signer claimed for an EVM leg.
 *
 *   off-chain  the leg has no EVM chain (an HL L1 action, a CoW/Seaport
 *              order) — there is no receipt, and none is expected
 *   refuted    no hash at all, or a tx sent by someone else, or one that
 *              reverted — the claim is false about itself
 *   unreadable the chain did not answer — delay, never mint (T-R4)
 *   ok         a successful transaction from this job's own wallet
 *
 * Deliberately NOT a full receipt verdict: a job step writes no
 * `intent_link_expectations` row, so the to/selector half of
 * `decideReceiptVerdict` has nothing to match and would fail every leg
 * closed. Sender + status is the part that is both available and the part a
 * fabricated hash cannot satisfy.
 */
async function claimedLegReceipt(chainId: number | undefined, txHash: string | undefined, wallet: string): Promise<LegClaim> {
  if (!chainId) return 'off-chain'
  if (!txHash) return 'refuted'
  const client = receiptClientFor(chainId)
  if (!client) return 'unreadable'
  try {
    const [tx, receipt] = await Promise.all([
      client.getTransaction({ hash: txHash as `0x${string}` }).catch(() => null),
      client.getTransactionReceipt({ hash: txHash as `0x${string}` }).catch(() => null),
    ])
    // A hash the chain has never heard of is a claim about nothing. It could
    // also be a tx still in the mempool, which is why this is only ever the
    // difference between counting NOW and counting on the lazy re-check.
    if (!tx) return 'unreadable'
    if (tx.from.toLowerCase() !== wallet.toLowerCase()) return 'refuted'
    if (!receipt) return 'unreadable'
    return receipt.status === 'success' ? 'ok' : 'refuted'
  } catch {
    return 'unreadable'
  }
}
