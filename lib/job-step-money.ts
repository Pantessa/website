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

import { createHash } from 'node:crypto'
import prisma from '@/lib/db'
import { Prisma } from '@prisma/client'
import { jobStepBuildPath, jobStepChainId, jobStepSignedInfo, stampJobStepPath } from '@/lib/job-step-telemetry'
import { feeBpsOfArtifact } from '@/lib/fees'
import { isBuildPath } from '@/lib/build-path'
import { COUNTED_VERIFICATIONS, receiptClientFor, verifyTurnNow } from '@/lib/link-receipt-verify'
import { chainById } from '@/lib/chains'
import { recordCreatorPaidOnchain } from '@/lib/creator-paid'
import { deskIdOfKey, legFeeBps, legFeeUsd, recordBlotterOnce, tenantVenueOfBuildPath } from '@/lib/tenant/blotter'
import type { BlotterVerification } from '@/lib/tenant/spec'

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
/** A chain of more transactions than this is not a leg any builder emits. */
export const LEG_TXS_MAX = 16
/** The per-transaction label's cap ("Approve USDC", "Swap"). */
export const LEG_TX_TITLE_MAX = 80

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
  // MCP lane: `txs` was the one allowed key nothing looked INSIDE, so an agent
  // could put anything in it, bounded only by the body cap. The entry shape is
  // the published DeskLegResult one (lib/desk-wire): hash, chainId, and the
  // optional per-transaction `title` the browser's JobCard has always sent.
  if (r.txs !== undefined) {
    if (!Array.isArray(r.txs)) return { ok: false, reason: 'txs must be an array' }
    if (r.txs.length > LEG_TXS_MAX) return { ok: false, reason: `txs carries ${r.txs.length} entries; the cap is ${LEG_TXS_MAX}` }
    for (const [i, e] of r.txs.entries()) {
      const t = e as { hash?: unknown; chainId?: unknown; title?: unknown } | null
      if (!t || typeof t !== 'object' || Array.isArray(t)) return { ok: false, reason: `txs[${i}] must be an object` }
      const extra = Object.keys(t).filter((k) => k !== 'hash' && k !== 'chainId' && k !== 'title')
      if (extra.length) return { ok: false, reason: `txs[${i}] carries keys the wire does not name: ${extra.slice(0, 3).join(', ')} (allowed: hash, chainId, title)` }
      if (typeof t.hash !== 'string' || !LEG_TX_HASH_RE.test(t.hash)) return { ok: false, reason: `txs[${i}].hash must be a 0x-prefixed 64-hex lowercase hash` }
      if (typeof t.chainId !== 'number' || !Number.isInteger(t.chainId) || t.chainId <= 0) return { ok: false, reason: `txs[${i}].chainId must be a positive integer` }
      if (t.title !== undefined && (typeof t.title !== 'string' || t.title.length > LEG_TX_TITLE_MAX)) return { ok: false, reason: `txs[${i}].title must be a string of at most ${LEG_TX_TITLE_MAX} characters` }
    }
  }
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
  /** FIVE-MILLION: what the chain said about the claimed hash (absent on the
   *  idempotent second call) — the tenant blotter's `settled` row reuses it. */
  claim?: LegClaim
  claimTxHash?: string
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
  /** The JOB row's source: a `dca:<id>` job's step is a schedule's run. */
  source?: string | null
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
        // The telemetry route's rule, kept now that this is the writer: a DCA
        // schedule's step is a run the schedule fired (lib/value-origin).
        originKind: leg.source?.startsWith('dca:') ? 'dca-run' : 'job-step',
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
      return { recorded: false, valueUsd: leg.valueUsd ?? null, verification: 'mismatch', rowId: row.id, claim, claimTxHash: txHash }
    }
    // Unreadable chain: leave it `unverified` (T-R4 — delay, never mint). The
    // lazy re-check promotes it once the node answers.
    if (claim === 'unreadable') return { recorded: false, valueUsd: leg.valueUsd ?? null, verification: 'unverified', rowId: row.id, claim, claimTxHash: txHash }

    const verification = await Promise.race([
      verifyTurnNow(row.id, chainId),
      new Promise<'unverified'>((r) => setTimeout(() => r('unverified'), 4000)),
    ]).catch(() => 'unverified')
    // A swap step that paid a creator inside the transaction is booked as an
    // already-paid claim (lib/creator-paid) — same rule as the browser beacon.
    // `claim` above already proved the hash is this wallet's successful tx.
    if ((COUNTED_VERIFICATIONS as readonly string[]).includes(verification) && !leg.internal && chainId && txHash) {
      await Promise.race([
        recordCreatorPaidOnchain({ intentLinkSlug: null, wallet: leg.wallet, chainId, txHash }),
        new Promise<number>((r) => setTimeout(() => r(0), 4000)),
      ]).catch(() => 0)
    }
    return { recorded: (COUNTED_VERIFICATIONS as readonly string[]).includes(verification), valueUsd: leg.valueUsd ?? null, verification, rowId: row.id, claim, claimTxHash: txHash }
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
export type LegClaim = 'ok' | 'refuted' | 'unreadable' | 'off-chain'

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

/* ── the tenant desk's rows (FIVE-MILLION, 2026-11-03) ─────────────────────
 *
 * A job whose `tenant_id` is set belongs to a governed desk (lib/tenant/spec):
 * every leg the runner BUILDS, every leg a signer reports SIGNED, and every leg
 * the chain (or the venue) proves SETTLED is a row on that tenant's hash-chained
 * blotter (lib/tenant/blotter). Each write is keyed (`recordBlotterOnce`), so a
 * re-run never doubles a row. Fail-soft like the money row: the leg the signer
 * just signed is never broken by the ledger. A retail job (no tenant) writes
 * nothing here.
 *
 *   signed   — the signer's claim (the job's own wallet or its desk agent,
 *              authenticated at the door): value, net fee in bps + USD (the fee
 *              that rides the calldata), tx hash, venue, chain, desk.
 *   settled  — `verified`: an EVM leg whose hash the CHAIN says was sent by the
 *              job's wallet and succeeded (the same sender + status read the
 *              money row uses); `mismatch`: the chain refutes it; `attested`: an
 *              off-chain leg (a Hyperliquid or CoW / Seaport order) — there is
 *              no receipt to read, the signer's report is the evidence. An
 *              unreadable chain writes nothing yet: `settleTenantJobLegs` (the
 *              statement + blotter reads run it) re-checks later.
 *   build    — the route the runner built (build path, venue, value, the guard's
 *              checks) or the refusal. The venue cascade reports only the venue
 *              it settled on, so `quotesConsidered` is null — never invented.
 */

export interface TenantJobRef {
  id: string
  wallet: string
  tenantId: string | null
  deskKeyId: string | null
}

/** The broker intent a job was opened from (broker_execute binds `job_id`). */
async function intentIdOfJob(jobId: string): Promise<string | null> {
  try {
    const intent = await prisma.brokerIntent.findFirst({ where: { jobId }, select: { id: true } })
    return intent?.id ?? null
  } catch {
    return null
  }
}

/** An order artifact (CoW / Seaport / Hyperliquid) settles off-chain. */
function isOrderArtifact(artifact: unknown): boolean {
  return !!(artifact && typeof artifact === 'object' && (artifact as { orderRequest?: unknown }).orderRequest)
}

/** The hash a leg's completion names: `txHash`, else the LAST of `txs` (a chain's
 *  final transaction is the one that moves the money). */
function legTxHash(result: Record<string, unknown>): string | undefined {
  if (typeof result.txHash === 'string' && LEG_TX_HASH_RE.test(result.txHash)) return result.txHash
  const txs = Array.isArray(result.txs) ? (result.txs as { hash?: unknown }[]) : []
  const last = [...txs].reverse().find((t) => typeof t?.hash === 'string' && LEG_TX_HASH_RE.test(t.hash))
  return last?.hash as string | undefined
}

const short = (v: unknown, max: number): string | null => (typeof v === 'string' && v ? v.slice(0, max) : null)

/** A `build` row: the leg the runner just offered (built) or refused (refusal). */
export async function recordTenantBuild(
  job: TenantJobRef,
  step: { seq: number; builder: string; title: string },
  built: { artifact: Record<string, unknown>; guardReport?: unknown; valueUsd: number | null; buildPath?: string } | null,
  refusal?: string,
): Promise<void> {
  if (!job.tenantId) return
  try {
    const artifact = built ? stampJobStepPath(step.builder, built.artifact, built.buildPath) : null
    const buildPath = artifact ? (jobStepBuildPath(step.builder, artifact) ?? null) : null
    const checks = (built?.guardReport as { checks?: { id?: unknown; ok?: unknown; level?: unknown }[] } | null | undefined)?.checks
    const [deskId, intentId] = await Promise.all([deskIdOfKey(job.deskKeyId), intentIdOfJob(job.id)])
    await recordBlotterOnce(`job:${job.id}:${step.seq}:build:${built ? `ok:${artifactStamp(artifact)}` : `refused:${Date.now()}`}`, {
      tenantId: job.tenantId,
      kind: 'build',
      intentId,
      jobId: job.id,
      deskId,
      keyId: job.deskKeyId,
      venue: tenantVenueOfBuildPath(buildPath) ?? buildPath,
      chainId: artifact ? (jobStepChainId(artifact) ?? null) : null,
      valueUsd: built?.valueUsd ?? null,
      payload: {
        source: 'runner',
        jobId: job.id,
        seq: step.seq,
        builder: step.builder,
        title: short(step.title, 160),
        ok: !!built,
        buildPath,
        routeChosen: buildPath,
        summary: short((artifact as { summary?: unknown } | null)?.summary, 300),
        feeBps: built ? legFeeBps(buildPath, feeBpsOfArtifact(artifact)) : null,
        checks: Array.isArray(checks) ? checks.slice(0, 24).map((c) => ({ id: short(c?.id, 60), ok: c?.ok === true, level: short(c?.level, 20) })) : null,
        quotesConsidered: null,
        quotesNote: 'the venue cascade reports only the venue it settled on',
        ...(refusal ? { refusal: refusal.slice(0, 300) } : {}),
      },
    })
  } catch (err) {
    console.error('[blotter] tenant build dropped', job.tenantId, job.id, (err as Error)?.message ?? err)
  }
}

/** A stable stamp for one built artifact (re-offers after a TTL rebuild are new builds). */
function artifactStamp(artifact: unknown): string {
  try {
    return createHash('sha256').update(JSON.stringify(artifact ?? null)).digest('hex').slice(0, 16)
  } catch {
    return String(Date.now())
  }
}

/** The `signed` row, then its `settled` row when the evidence decides. */
export async function recordTenantLeg(
  leg: { jobId: string; seq: number; wallet: string; builder: string; artifact: unknown; valueUsd: number | null; result: Record<string, unknown>; tenantId: string | null; deskKeyId: string | null },
  money: JobStepMoneyResult | null,
): Promise<void> {
  if (!leg.tenantId) return
  try {
    const buildPath = jobStepBuildPath(leg.builder, leg.artifact) ?? null
    const chainId = jobStepChainId(leg.artifact) ?? (typeof leg.result.chainId === 'number' ? leg.result.chainId : undefined)
    const txHash = legTxHash(leg.result)
    const offChain = isOrderArtifact(leg.artifact) || !chainId
    const bps = legFeeBps(buildPath, feeBpsOfArtifact(leg.artifact))
    const [deskId, intentId] = await Promise.all([deskIdOfKey(leg.deskKeyId), intentIdOfJob(leg.jobId)])
    const base = { tenantId: leg.tenantId, intentId, jobId: leg.jobId, deskId, keyId: leg.deskKeyId, venue: tenantVenueOfBuildPath(buildPath) ?? buildPath, chainId: offChain ? null : (chainId ?? null), txHash: txHash ?? null }
    const order = leg.result.orderResponse
    const signed = await recordBlotterOnce(`job:${leg.jobId}:${leg.seq}:signed`, {
      ...base,
      kind: 'signed',
      valueUsd: leg.valueUsd,
      feeUsd: legFeeUsd(leg.valueUsd, bps),
      feeBps: bps,
      payload: {
        source: 'job-step',
        jobId: leg.jobId,
        seq: leg.seq,
        builder: leg.builder,
        buildPath,
        wallet: leg.wallet.toLowerCase(),
        offChain,
        txs: Array.isArray(leg.result.txs) ? (leg.result.txs as { hash?: unknown; chainId?: unknown }[]).slice(0, LEG_TXS_MAX).map((t) => ({ hash: t?.hash, chainId: t?.chainId })) : null,
        orderRef: typeof order === 'string' ? order.slice(0, 200) : order && typeof order === 'object' ? short((order as { uid?: unknown; orderUid?: unknown }).uid ?? (order as { orderUid?: unknown }).orderUid, 200) : null,
        moneyRowId: money?.rowId ?? null,
      },
    })
    if (!signed) return
    let verification: BlotterVerification | null
    let how: string
    if (offChain) {
      verification = 'attested'
      how = 'off-chain leg: no EVM receipt exists; the signer reported the venue accepted it'
    } else {
      const claim = money?.claim && money.claimTxHash === txHash ? money.claim : await claimedLegReceipt(chainId, txHash, leg.wallet)
      verification = claimVerification(claim)
      how = claimHow(claim)
    }
    if (verification) await recordTenantSettled(base, leg.jobId, leg.seq, signed.seq, verification, how)
  } catch (err) {
    console.error('[blotter] tenant leg dropped', leg.tenantId, leg.jobId, leg.seq, (err as Error)?.message ?? err)
  }
}

function claimVerification(claim: LegClaim): BlotterVerification | null {
  return claim === 'ok' ? 'verified' : claim === 'refuted' ? 'mismatch' : claim === 'off-chain' ? 'attested' : null
}
function claimHow(claim: LegClaim): string {
  return claim === 'ok'
    ? 'receipt: the chain says the job wallet sent it and it succeeded'
    : claim === 'refuted'
      ? 'receipt: no hash, another sender, or a reverted transaction'
      : claim === 'off-chain'
        ? 'off-chain leg: no EVM receipt exists'
        : 'the chain did not answer yet'
}

async function recordTenantSettled(
  base: { tenantId: string; intentId: string | null; jobId: string; deskId: string | null; keyId: string | null; venue: string | null; chainId: number | null; txHash: string | null },
  jobId: string,
  seq: number,
  signedSeq: number,
  verification: BlotterVerification,
  how: string,
): Promise<void> {
  await recordBlotterOnce(`job:${jobId}:${seq}:settled`, { ...base, kind: 'settled', verification, payload: { source: 'job-step', jobId, seq, signedSeq, how } })
}

/** A `settled` row for a WAIT step the runner saw settle (a bridge's arrival, a
 *  1Click SUCCESS, an NFT owned, an HL credit) — the venue/chain proof of the legs
 *  it waited on. Carries no value (the legs' `signed` rows carry the money). */
export async function recordTenantWaitSettled(job: TenantJobRef, step: { seq: number; waitPredicate: unknown }, result: unknown): Promise<void> {
  if (!job.tenantId) return
  try {
    const pred = (step.waitPredicate ?? {}) as { kind?: unknown; fromStep?: unknown; fromSteps?: unknown }
    const kind = typeof pred.kind === 'string' ? pred.kind : null
    // A chain read (balance, ownerOf) is chain evidence; a venue's status read is the venue's word.
    const chainRead = kind === 'chain-arrival' || kind === 'nft-owned'
    const settles = Array.isArray(pred.fromSteps) ? pred.fromSteps.filter((n): n is number => Number.isInteger(n)) : Number.isInteger(pred.fromStep) ? [pred.fromStep as number] : []
    const [deskId, intentId] = await Promise.all([deskIdOfKey(job.deskKeyId), intentIdOfJob(job.id)])
    let resultText: string | null = null
    try {
      resultText = JSON.stringify(result ?? null).slice(0, 400)
    } catch {
      resultText = null
    }
    await recordBlotterOnce(`job:${job.id}:${step.seq}:wait`, {
      tenantId: job.tenantId,
      kind: 'settled',
      intentId,
      jobId: job.id,
      deskId,
      keyId: job.deskKeyId,
      verification: chainRead ? 'verified' : 'attested',
      payload: { source: 'wait', jobId: job.id, seq: step.seq, predicate: kind, settles, result: resultText },
    })
  } catch (err) {
    console.error('[blotter] tenant wait dropped', job.tenantId, job.id, (err as Error)?.message ?? err)
  }
}

/**
 * The lazy re-check: a tenant's `signed` job legs whose chain did not answer at
 * completion get their `settled` row once it does. Bounded (`limit` legs, the last
 * 35 days); never throws. `tenantId` null = every tenant (the jobs cron runs it
 * each tick, fenced to the jobs of ITS env); the statement runs it per tenant.
 */
export async function settleTenantJobLegs(tenantId: string | null, limit = 10, env?: string): Promise<number> {
  try {
    const byTenant = tenantId ? Prisma.sql`AND s.tenant_id = ${tenantId}` : Prisma.empty
    const byEnv = env ? Prisma.sql`AND EXISTS (SELECT 1 FROM jobs j WHERE j.id = s.job_id AND j.origin_env = ${env})` : Prisma.empty
    const pending = await prisma.$queryRaw<{ tenant_id: string; seq: number; job_id: string | null; chain_id: number | null; tx_hash: string | null; intent_id: string | null; desk_id: string | null; key_id: string | null; venue: string | null; payload: unknown }[]>`
      SELECT s.tenant_id, s.seq, s.job_id, s.chain_id, s.tx_hash, s.intent_id, s.desk_id, s.key_id, s.venue, s.payload
      FROM blotter_rows s
      WHERE s.kind = 'signed' AND s.payload->>'source' = 'job-step' AND s.chain_id IS NOT NULL
        ${byTenant} ${byEnv}
        AND s.created_at > now() - interval '35 days'
        AND NOT EXISTS (
          SELECT 1 FROM blotter_rows t
          WHERE t.tenant_id = s.tenant_id AND t.kind = 'settled'
            AND t.payload->>'once' = 'job:' || s.job_id || ':' || (s.payload->>'seq') || ':settled'
        )
      ORDER BY s.created_at DESC
      LIMIT ${limit}`
    let settled = 0
    for (const p of pending) {
      const payload = (p.payload ?? {}) as { seq?: unknown; wallet?: unknown }
      const seq = Number(payload.seq)
      const wallet = typeof payload.wallet === 'string' ? payload.wallet : null
      if (!p.job_id || !Number.isInteger(seq) || !wallet) continue
      const claim = await claimedLegReceipt(p.chain_id ?? undefined, p.tx_hash ?? undefined, wallet)
      const verification = claimVerification(claim)
      if (!verification) continue
      await recordTenantSettled(
        { tenantId: p.tenant_id, intentId: p.intent_id, jobId: p.job_id, deskId: p.desk_id, keyId: p.key_id, venue: p.venue, chainId: p.chain_id, txHash: p.tx_hash },
        p.job_id,
        seq,
        Number(p.seq),
        verification,
        claimHow(claim),
      )
      settled++
    }
    return settled
  } catch (err) {
    console.error('[blotter] tenant settle sweep failed', tenantId ?? '(all)', (err as Error)?.message ?? err)
    return 0
  }
}
