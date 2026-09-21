// ─────────────────────────────────────────────────────────────────────────
//  What a signed JOB STEP tells telemetry about itself.
//
//  A job step is a real transaction on a real venue — the funded
//  "Fund Robinhood Chain with $12.50 from Base, then buy $12 of AAPL" flow
//  IS a Uniswap swap with our fee on it — but until this module the
//  `job-step` beacon reported `buildPath: <the raw job builder id>` and
//  `chain: 'multi'`. Most builder ids aren't BuildPaths, so the telemetry
//  route's allowlist dropped them: the row landed with build_path NULL.
//
//  Everything downstream that prices a turn needs a fee-bearing path —
//  lib/fees (FEE_BEARING_BUILD_PATHS / netFeeBpsForTurn), the creator
//  studio + claims, the public fee strip, the admin Growth books — so a
//  swap that DID pay 20/50 bps on-chain counted as volume and earned $0,
//  and a link creator earned nothing on link-driven funded buys even though
//  the visitor paid the link tier. Prod, 2026-09-18: $308.50 of $347.50 of
//  real signed 30-day volume was job steps with a NULL path.
//
//  The rule this module encodes: a step reports the path of what it ACTUALLY
//  built. Swap steps run the shared venue cascade (lib/swap-exec), so only
//  the build knows whether it settled on v3, v4 or LiFi — the runner stamps
//  that winner onto the artifact. Every other builder has one answer, and it
//  lives in the table below. Funding/bridge legs get their own fee-free
//  paths: they charge nothing (lib/lifi-bridge, and the runner's
//  no-appFees cross-chain build), so they must never resolve to a
//  fee-bearing path.
//
//  ── and WHETHER it tells telemetry anything at all. ─────────────────────
//
//  A job step is signed inside JobCard, but JobCard is mounted in two places:
//  the chat thread (components/ChatInterface.tsx — which may be an EMBED, so
//  its beacon rides the keyed embed lane and also emits the host-page `turn`
//  event) and the Jobs rail's detail overlay (components/JobDetailOverlay.tsx
//  — first-party only). Until #821 the overlay's onStepSigned threw the
//  signal away, so a step signed from the rail recorded NOTHING: no
//  embed_turns row, no money moved, no creator earnings, nothing on
//  /activity. Two sign surfaces for one artifact, one of them silent.
//
//  So the second half of this module is the reporting contract both mounts
//  share — jobStepSignedInfo() (the field mapping; neither lane spells the
//  beacon itself any more, so they cannot drift) and claimJobStepReport()
//  (the fence: both JobCards can be mounted over the SAME job at once, the
//  overlay rendering over the chat that also holds the job's message, and the
//  beacon is keyed only by sessionId server-side — a second report would
//  count the money twice).
// ─────────────────────────────────────────────────────────────────────────

import { isBuildPath, type BuildPath } from '@/lib/build-path'
import { chainById } from '@/lib/chains'

/** The artifact key the runner stamps the winning path onto. */
export const STEP_BUILD_PATH_KEY = 'buildPath'

/**
 * job_steps.builder → the BuildPath a step of that builder settles as.
 *
 * The SWAP builders (`native-swap`, `native-lifi-swap`) are deliberately
 * absent: both run the v3 → v4 → LiFi cascade and only the build knows which
 * venue answered. They resolve from the artifact instead (see below) — a
 * static guess here would print a LiFi stock fill as a Uniswap one.
 *
 * `wait` / `native-hl-guardian` are absent too: a wait predicate is not a
 * build, and the guardian arm is an `auto` step nobody signs — neither ever
 * reaches a beacon.
 */
export const BUILD_PATH_OF_JOB_BUILDER: Record<string, BuildPath> = {
  // Fee-free legs — the money is being MOVED so the next step can happen.
  'native-lifi-fund': 'native-fund-bridge',
  'native-cross-chain': 'native-cross-chain-leg',
  'native-transfer': 'native-transfer',
  // Fee-free actions.
  'native-nft-buy': 'native-nft-buy',
  'native-nft-transfer': 'native-nft-transfer',
  'native-nft-list': 'native-nft-list',
  'native-aave-supply': 'native-aave-supply',
  'native-aave-repay': 'native-aave-op',
  'native-morpho-lend': 'native-morpho-lend',
  'native-morpho-repay': 'native-morpho-op',
  'native-lido': 'native-lido',
  // Fee-BEARING: an HL perp order carries the builder fee. The deposit leg
  // shares the builder id and does not — lib/hyperliquid-exec names its own
  // path per branch and the runner forwards it, so this entry is only the
  // fallback for a legacy artifact that carries neither.
  'native-hl-exec': 'native-hl-exec',
}

/**
 * txChain.refresh.kind → the venue path. The recipe rides inside the stored
 * artifact, so this resolves a swap step the runner stamped BEFORE this
 * shipped (an offer already on screen at deploy time, and every legacy row a
 * backfill walks).
 */
export const BUILD_PATH_OF_REFRESH_KIND: Record<string, BuildPath> = {
  'uniswap-swap': 'native-swap-uniswap',
  'uniswap-v4-swap': 'native-swap-uniswap-v4',
  'lifi-swap': 'native-swap-lifi',
  'lifi-bridge': 'native-fund-bridge',
}

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

/**
 * The BuildPath a signed job step should report. Ladder, most-specific first:
 *   1. the path the runner stamped on the artifact (the cascade's own winner);
 *   2. the txChain refresh recipe's kind (legacy + in-flight offers);
 *   3. the builder's one static answer.
 * Undefined when nothing maps — NEVER a guess, and never the raw builder id
 * (the telemetry route would drop it and we'd be back to a NULL path).
 */
export function jobStepBuildPath(builder: string, artifact: unknown): BuildPath | undefined {
  const a = obj(artifact)
  const stamped = a?.[STEP_BUILD_PATH_KEY]
  if (isBuildPath(stamped)) return stamped
  const kind = obj(a?.txChain)?.refresh
  const refreshKind = obj(kind)?.kind
  if (typeof refreshKind === 'string' && BUILD_PATH_OF_REFRESH_KIND[refreshKind]) return BUILD_PATH_OF_REFRESH_KIND[refreshKind]
  return BUILD_PATH_OF_JOB_BUILDER[builder]
}

/**
 * Stamp the built path onto a freshly built step artifact — the offer-time
 * half of {@link jobStepBuildPath}. `built` is the venue cascade's own
 * winner when the builder ran one; otherwise the builder's static answer.
 * A builder with no answer is left unstamped (the beacon then reports no
 * path, which is the honest reading — never a guess).
 */
export function stampJobStepPath(
  builder: string,
  artifact: Record<string, unknown>,
  built?: string,
): Record<string, unknown> {
  const path = isBuildPath(built) ? built : BUILD_PATH_OF_JOB_BUILDER[builder]
  return path ? { ...artifact, [STEP_BUILD_PATH_KEY]: path } : artifact
}

const chainIdOf = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? (v.startsWith('0x') ? parseInt(v, 16) : Number(v)) : typeof v === 'number' ? v : NaN
  return Number.isInteger(n) && n > 0 ? n : undefined
}

/**
 * The chain the step is SIGNED on, read from the artifact it was signed from
 * — a bridge leg's chain is its origin, the chain that saw the transaction.
 * Undefined for an off-chain order (a Hyperliquid L1 action has no EVM
 * chain); the caller keeps its 'multi' fallback for that.
 */
export function jobStepChainId(artifact: unknown): number | undefined {
  const a = obj(artifact)
  const direct = chainIdOf(obj(a?.txRequest)?.chainId)
  if (direct) return direct
  const steps = obj(a?.txChain)?.steps
  if (Array.isArray(steps)) {
    for (const s of steps) {
      const id = chainIdOf(obj(obj(s)?.tx)?.chainId)
      if (id) return id
    }
  }
  return undefined
}

// ─────────────────────────────────────────────────────────────────────────
//  The reporting contract — what a signed step tells telemetry, and the
//  fence that keeps it to once.
// ─────────────────────────────────────────────────────────────────────────

/** What JobCard hands back the moment a step's signature confirms. */
export interface JobStepSignal {
  /** The job the step belongs to — the beacon's origin-kind lookup key. */
  jobId: string
  /** Step index within the job. With jobId it is the dedupe identity. */
  seq: number
  /** The step's builder (job_steps.builder — `native-swap`, `native-lido`, …). */
  builder: string
  /** Guardrail-priced notional of this step. */
  valueUsd?: number | null
  /** Human label for the row (tx hash or the venue's own detail line). */
  detail?: string
  /** The fee tier the step's ARTIFACT carried (lib/fees.feeBpsOfArtifact). */
  feeBps?: number
  /** The path of what the step ACTUALLY built — {@link jobStepBuildPath}, the
   *  venue cascade's own winner, never the raw builder id. A raw id fails the
   *  telemetry route's allowlist and the row lands with build_path NULL: $0 of
   *  fee and $0 of creator earnings on a swap that really paid the fee. */
  buildPath?: string
  /** Chain the step was SIGNED on — the receipt the sign surface handed back,
   *  falling back to {@link jobStepChainId}. Undefined for an off-chain order. */
  chainId?: number
  /** Explorer link for the final tx, or the venue's own order URL. */
  txUrl?: string
}

/** The `signed` beacon for a job step — the shape both lanes hand their own
 *  poster (ChatInterface's postEmbedTelemetry, or postJobStepSigned below).
 *  Shared so the keyed embed lane and the keyless first-party lane can never
 *  report the same step differently. */
export function jobStepSignedInfo(signal: JobStepSignal): {
  artifact: 'job-step'
  chain: string
  detail?: string
  valueUsd?: number
  buildPath?: string
  feeBps?: number
  jobId: string
  chainId?: number
  txUrl?: string
} {
  return {
    artifact: 'job-step',
    // The step's OWN chain when the artifact named one — a job spans venues
    // and chains by construction, so 'multi' is the honest answer only for an
    // off-chain order (a Hyperliquid L1 action has no EVM chain). The registry
    // is the single source: the hand-written map it replaced had no Robinhood
    // Chain, the chain most job steps sign on.
    chain: signal.chainId ? (chainById(signal.chainId)?.key ?? String(signal.chainId)) : 'multi',
    detail: signal.detail?.slice(0, 60),
    valueUsd: signal.valueUsd ?? undefined,
    buildPath: signal.buildPath,
    feeBps: signal.feeBps,
    jobId: signal.jobId,
    chainId: signal.chainId,
    txUrl: signal.txUrl,
  }
}

/** Stable identity of one signed step. */
export function jobStepKey(signal: Pick<JobStepSignal, 'jobId' | 'seq'>): string {
  return `${signal.jobId}#${signal.seq}`
}

// Page-load scoped, deliberately: a done step renders no sign button, so a
// step can never be re-signed after a reload — there is nothing for a durable
// fence to catch, and a durable one would silently swallow a legitimate retry
// of a step that FAILED and got rebuilt at the same seq.
const reported = new Set<string>()

/** Claim the right to report this step. True exactly once per (job, step) per
 *  page load; every later caller — the other mounted JobCard, a sign button
 *  that fired its callback twice — gets false and reports nothing. */
export function claimJobStepReport(signal: Pick<JobStepSignal, 'jobId' | 'seq'>): boolean {
  const key = jobStepKey(signal)
  if (reported.has(key)) return false
  reported.add(key)
  return true
}

/** Test seam — the harness pins the fence by replaying a signal. */
export function resetJobStepReports(): void {
  reported.clear()
}

// One id per page load for the rail lane: the Jobs rail is one continuous
// surface, and embed_turns.session_id groups a visitor's beacons.
let railSessionId: string | null = null
export function jobStepSessionId(): string {
  if (railSessionId) return railSessionId
  railSessionId =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `s-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
  return railSessionId
}

/** The FIRST-PARTY beacon body (the keyless lane the telemetry route accepts
 *  only from our own origin, and only for value-bearing outcomes). Pure so the
 *  harness can assert the wire without a browser. */
export function firstPartyJobStepBody(
  signal: JobStepSignal,
  ctx: { sessionId: string; walletAddress?: string; page?: string },
): Record<string, unknown> {
  return {
    firstParty: true,
    sessionId: ctx.sessionId,
    page: ctx.page,
    walletAddress: ctx.walletAddress,
    outcome: 'signed',
    ...jobStepSignedInfo(signal),
    // The first-party lane never carries free text (chat asks stay private) —
    // the route drops it anyway; sending nothing is the honest wire.
    detail: undefined,
  }
}

/** Report a step signed from a first-party surface with no embed key and no
 *  host page to notify — today, the Jobs rail's detail overlay. Fenced, and
 *  fail-soft: telemetry never breaks the card the user just signed in. */
export function postJobStepSigned(
  signal: JobStepSignal,
  ctx: { walletAddress?: string; sessionId?: string; page?: string } = {},
): void {
  if (!claimJobStepReport(signal)) return
  const body = firstPartyJobStepBody(signal, {
    sessionId: ctx.sessionId ?? jobStepSessionId(),
    walletAddress: ctx.walletAddress,
    page: ctx.page ?? (typeof window !== 'undefined' ? window.location.href : undefined),
  })
  void fetch('/api/embed/telemetry', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {})
}
