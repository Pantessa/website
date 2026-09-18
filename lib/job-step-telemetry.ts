// lib/job-step-telemetry.ts — the ONE contract for "a job step just got
// signed", shared by every surface that mounts a JobCard.
//
// A job step is signed inside JobCard, but JobCard is mounted in two places:
// the chat thread (components/ChatInterface.tsx — which may be an EMBED, so
// its beacon rides the keyed embed lane and also emits the host-page `turn`
// event) and the Jobs rail's detail overlay (components/JobDetailOverlay.tsx
// — first-party only, `!embedded && !simple`). Until this module existed the
// overlay's onStepSigned threw the signal away, so every step signed from the
// rail recorded NOTHING: no embed_turns row, no money moved, no creator
// earnings, nothing on /activity. Only chat-signed steps reported.
//
// Two things live here so the lanes can never drift:
//   1. jobStepSignedInfo() — the field mapping from JobCard's signal to the
//      `signed` beacon. Both lanes call it; neither spells the fields itself.
//   2. claimJobStepReport() — the double-count fence. Both JobCards can be
//      mounted over the SAME job at once (the overlay renders over the chat
//      that also holds the job's message), and the beacon is keyed only by
//      sessionId server-side, so a second report would be counted twice as
//      money moved. A step reports once per page load, whichever card wins.

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
  /** Which layer built it. Job steps carry their builder here, exactly as the
   *  chat lane has always sent it — see the note on the beacon below. */
  buildPath?: string
  /** Chain the final tx landed on, when the step signed an EVM tx. */
  chainId?: number
  /** Explorer link for the final tx / placed order. */
  txUrl?: string
}

/** The `signed` beacon for a job step — the shape both lanes hand their own
 *  poster (ChatInterface's postEmbedTelemetry, or postJobStepSigned below).
 *
 *  `buildPath` carries the step's raw builder, which is what the chat lane has
 *  sent since the job card shipped. Job builders (`native-swap`,
 *  `native-lifi-fund`, …) are NOT in lib/build-path BUILD_PATHS, so the
 *  telemetry route drops the field and job-step rows land with build_path
 *  NULL — i.e. fee-free, earning no creator kickback. That is a real gap, but
 *  it is a MONEY gap (it changes what creators can claim) and gets its own PR;
 *  this module deliberately keeps the wire byte-identical to today's chat
 *  lane so turning the rail's reporter on cannot quietly re-price anything. */
export function jobStepSignedInfo(signal: JobStepSignal): {
  artifact: 'job-step'
  chain: 'multi'
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
    // A job spans venues and chains by construction — the steps carry the
    // real chain ids, the row carries 'multi' (same as the compiling turn).
    chain: 'multi',
    detail: signal.detail?.slice(0, 60),
    valueUsd: signal.valueUsd ?? undefined,
    buildPath: signal.builder,
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
