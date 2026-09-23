// lib/job-step-money.ts — ONE server-side money writer for job steps (agent-desk squad,
// round-2 decision 1), and the fence on what a leg's completion may say.
//
// The money row for a job step used to be a CLIENT beacon (JobCard → POST /api/embed/telemetry,
// lib/job-step-telemetry). An agent driving a job through the REST `/complete` path (or the desk's
// `broker_done`) has no browser, so every agent-signed leg moved real money and recorded nothing:
// $0 on /activity, $0 on Growth, nothing in the desk log — the NULL-build_path class of #818, one
// surface further out. Three lanes found it independently. The ruling: the runner's
// `completeSignStep` writes the row for EVERY sign-step completion, from the SAME field mapping the
// browser lane uses (`jobStepSignedInfo`) and through the SAME receipt verifier (`verifyTurnNow`):
// the caller's claimed hash is evidence about the caller, and only the chain promotes the row to
// counted. The browser beacon is deduped server-side against this row (app/api/embed/telemetry).
//
// Deliberately NOT done here: creator referral claiming and earned-answer grants. Both key off a
// link slug and a chat pool a job step has neither of.

import prisma from '@/lib/db'
import { jobStepBuildPath, jobStepChainId, jobStepSignedInfo } from '@/lib/job-step-telemetry'
import { feeBpsOfArtifact } from '@/lib/fees'
import { isBuildPath } from '@/lib/build-path'
import { COUNTED_VERIFICATIONS, receiptClientFor, verifyTurnNow } from '@/lib/link-receipt-verify'
import { chainById } from '@/lib/chains'

const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.pantessa.com').replace(/\/$/, '')

/* ── the completion fence (QA A2 / F6) ────────────────────────────────── */

/** The keys a leg's completion may carry: `DeskLegResult` (lib/desk-wire) plus the shapes the
 *  browser JobCard and the share receipt already post (`txs`, `fill`, `detail`, `explorerUrl`,
 *  `status`). Anything else is refused — never reshaped, never silently dropped. */
export const LEG_RESULT_KEYS = new Set(['txHash', 'txs', 'chainId', 'orderResponse', 'batch', 'fill', 'detail', 'explorerUrl', 'status'])
/** A claimed EVM hash is exactly 32 lowercase hex bytes (viem, wagmi and the venues print them so). */
export const LEG_TX_HASH_RE = /^0x[0-9a-f]{64}$/
/** Serialized cap. QA proved a 200,089-byte result stored whole on main. */
export const LEG_RESULT_MAX_BYTES = 8 * 1024

export type LegResultVerdict = { ok: true; result: Record<string, unknown> } | { ok: false; reason: string }

/** Pure. Refuses rather than reshapes: an unknown key, a malformed hash, or an oversized body is
 *  the caller's problem to fix, and the step stays offered. */
export function fenceLegResult(raw: unknown): LegResultVerdict {
  if (raw == null) return { ok: true, result: {} }
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, reason: 'result must be an object' }
  const r = raw as Record<string, unknown>
  const unknown = Object.keys(r).filter((k) => !LEG_RESULT_KEYS.has(k))
  if (unknown.length) return { ok: false, reason: `result carries keys the wire does not name: ${unknown.slice(0, 5).join(', ')} (allowed: ${[...LEG_RESULT_KEYS].join(', ')})` }
  if (r.txHash !== undefined && (typeof r.txHash !== 'string' || !LEG_TX_HASH_RE.test(r.txHash))) return { ok: false, reason: 'txHash must be a 0x-prefixed 64-hex lowercase hash' }
  if (r.chainId !== undefined && (typeof r.chainId !== 'number' || !Number.isInteger(r.chainId) || r.chainId <= 0)) return { ok: false, reason: 'chainId must be a positive integer' }
  if (r.batch !== undefined && !Array.isArray(r.batch)) return { ok: false, reason: 'batch must be an array' }
  let bytes = 0
  try {
    bytes = Buffer.byteLength(JSON.stringify(r), 'utf8')
  } catch {
    return { ok: false, reason: 'result is not serializable' }
  }
  if (bytes > LEG_RESULT_MAX_BYTES) return { ok: false, reason: `result is ${bytes} bytes; the cap is ${LEG_RESULT_MAX_BYTES}` }
  return { ok: true, result: r }
}

/* ── the money row ─────────────────────────────────────────────────────── */

/** The server-written money row's session id — the dedupe identity the browser beacon is checked
 *  against. `[A-Za-z0-9-]{8,64}` like every other session id. */
export function jobStepMoneySessionId(jobId: string, seq: number): string {
  return `job-${jobId}-${seq}`.slice(0, 64)
}

export interface JobStepMoneyResult {
  recorded: boolean
  valueUsd: number | null
  verification: string
  rowId: string
}

/**
 * Write the `embed_turns` money row for a signed job step and run the receipt verifier on it.
 * Idempotent per (job, seq): a second call finds the row and returns its verdict. Fail-soft — the
 * step the caller just signed is never broken by telemetry; a `null` return means the row could
 * not be written (the log shows the step, not the money).
 */
export async function recordJobStepMoney(leg: {
  jobId: string
  seq: number
  wallet: string
  builder: string
  artifact: unknown
  valueUsd: number | null
  result: Record<string, unknown>
  /** From the JOB row (jobs.is_internal), never the caller's word. */
  internal: boolean
}): Promise<JobStepMoneyResult | null> {
  try {
    const sessionId = jobStepMoneySessionId(leg.jobId, leg.seq)
    const prior = await prisma.embedTurn.findFirst({ where: { sessionId, artifact: 'job-step', outcome: 'signed' }, select: { id: true, verification: true, valueUsd: true } })
    if (prior) {
      return { recorded: (COUNTED_VERIFICATIONS as readonly string[]).includes(prior.verification ?? ''), valueUsd: prior.valueUsd ?? null, verification: prior.verification ?? 'unverified', rowId: prior.id }
    }
    const buildPath = jobStepBuildPath(leg.builder, leg.artifact)
    const chainId = jobStepChainId(leg.artifact) ?? (typeof leg.result.chainId === 'number' ? leg.result.chainId : undefined)
    const txHash = typeof leg.result.txHash === 'string' && LEG_TX_HASH_RE.test(leg.result.txHash) ? leg.result.txHash : undefined
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
        sessionId,
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
        // Money follows the receipt (S-2): fail closed, then let the chain promote it.
        verification: 'unverified',
      },
    })
    // MCP lane (agent-desk round 2, found by a live pin): a job step's receipt
    // class is `job`, and `verifyTurnNow` settles that class **attested** — a
    // COUNTED verdict — with no chain read at all. Arguable for a browser, where
    // a human watched a wallet pop. Indefensible for an agent posting JSON: a
    // fabricated hash books the leg's whole notional as money moved, on
    // /activity, on Growth and in the fee split. So an EVM leg is checked here
    // against the one fact a claim cannot forge — the chain's own answer about
    // who sent that transaction and whether it succeeded.
    const claim = await claimedLegReceipt(chainId, txHash, leg.wallet)
    if (claim === 'refuted') {
      await prisma.embedTurn.update({ where: { id: row.id }, data: { verification: 'mismatch' } }).catch(() => {})
      return { recorded: false, valueUsd: leg.valueUsd ?? null, verification: 'mismatch', rowId: row.id }
    }
    // Unreadable chain: leave it `unverified` (T-R4 — delay, never mint). The
    // lazy re-check promotes it once the node answers.
    if (claim === 'unreadable') return { recorded: false, valueUsd: leg.valueUsd ?? null, verification: 'unverified', rowId: row.id }

    const verification = await Promise.race([
      verifyTurnNow(row.id, chainId),
      new Promise<'unverified'>((r) => setTimeout(() => r('unverified'), 4000)),
    ]).catch(() => 'unverified')
    return { recorded: (COUNTED_VERIFICATIONS as readonly string[]).includes(verification), valueUsd: leg.valueUsd ?? null, verification, rowId: row.id }
  } catch {
    return null
  }
}

/**
 * The browser beacon's dedupe (app/api/embed/telemetry): a `signed` + `artifact: 'job-step'`
 * beacon whose step the runner already booked is a no-op. Keyed on (jobId, seq) when the beacon
 * carries `seq`; else on the beacon's `txUrl` against the job's server rows (an EVM step's
 * explorer link is unique per step); else the newest server row of that job within 15 minutes.
 */
export async function jobStepMoneyAlreadyBooked(beacon: { jobId: string; seq?: unknown; txUrl?: string | null }): Promise<boolean> {
  try {
    if (typeof beacon.seq === 'number' && Number.isInteger(beacon.seq) && beacon.seq >= 0) {
      const hit = await prisma.embedTurn.findFirst({ where: { sessionId: jobStepMoneySessionId(beacon.jobId, beacon.seq), artifact: 'job-step' }, select: { id: true } })
      return !!hit
    }
    const prefix = `job-${beacon.jobId}-`
    if (beacon.txUrl) {
      const hit = await prisma.embedTurn.findFirst({ where: { sessionId: { startsWith: prefix }, artifact: 'job-step', txUrl: beacon.txUrl }, select: { id: true } })
      return !!hit
    }
    const recent = await prisma.embedTurn.findFirst({ where: { sessionId: { startsWith: prefix }, artifact: 'job-step', createdAt: { gte: new Date(Date.now() - 15 * 60_000) } }, select: { id: true } })
    return !!recent
  } catch {
    return false
  }
}

/**
 * What the CHAIN says about the hash a signer claimed for an EVM leg.
 *
 *   off-chain  the leg has no EVM chain (a Hyperliquid L1 action, a CoW or
 *              Seaport order) — there is no receipt, and none is expected
 *   refuted    no hash at all, or a tx sent by someone else, or one that
 *              reverted — the claim is false about itself
 *   unreadable the chain did not answer, or the hash is not mined yet — delay,
 *              never mint (T-R4)
 *   ok         a successful transaction from this job's own wallet
 *
 * Deliberately NOT a full `decideReceiptVerdict`: a job step writes no
 * `intent_link_expectations` row, so the to/selector half would have nothing to
 * match and would fail every leg closed. Sender + status is the part that is
 * both available and the part a fabricated hash cannot satisfy.
 */
async function claimedLegReceipt(chainId: number | undefined, txHash: string | undefined, wallet: string): Promise<'ok' | 'refuted' | 'unreadable' | 'off-chain'> {
  if (!chainId) return 'off-chain'
  if (!txHash) return 'refuted'
  const client = receiptClientFor(chainId)
  if (!client) return 'unreadable'
  try {
    const [tx, receipt] = await Promise.all([
      client.getTransaction({ hash: txHash as `0x${string}` }).catch(() => null),
      client.getTransactionReceipt({ hash: txHash as `0x${string}` }).catch(() => null),
    ])
    // A hash the chain has never heard of is a claim about nothing — but it
    // could also be a tx still in the mempool, which is why this only ever
    // decides between counting NOW and counting on the lazy re-check.
    if (!tx) return 'unreadable'
    if (tx.from.toLowerCase() !== wallet.toLowerCase()) return 'refuted'
    if (!receipt) return 'unreadable'
    return receipt.status === 'success' ? 'ok' : 'refuted'
  } catch {
    return 'unreadable'
  }
}
