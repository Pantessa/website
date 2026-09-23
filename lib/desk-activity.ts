// lib/desk-activity.ts — the desk log read model (UI lane owns; squad contract C5).
//
// One row per broker intent, with its timeline: opened → chosen → consent → job compiled →
// leg N built → CLAIMED (the agent posted a result) → VERIFIED (the runner's wait leg read the
// chain) → settled → done | failed. `is_internal` rows are returned but flagged, never counted.
//
// Two paths share the log. The AGENT path (broker_execute): the intent binds a job the agent's
// own key drives leg by leg; its evidence is `jobs` + `job_steps`. The HUMAN path
// (broker_handoff): the intent binds an /i link a person signs; its evidence is
// `intent_link_events` (+ the receipt verdict stamped on each). A row with neither is an open
// or abandoned negotiation.
//
// Money on this screen is said in two voices, on purpose (README gotcha: a client's claim is
// evidence about the client):
//   · `valueUsd`  — what the agent CLAIMED to have signed: the guard-priced notional of every
//                   sign step it completed. The runner's next wait leg checks the chain, so a
//                   lie fails the job one leg later — but until then it is the agent's word.
//   · `countedUsd` — what the RECEIPT-COUNTED books saw: `embed_turns` rows for the same wallet
//                   under the REAL_TRAFFIC fence. Today an agent-driven completion writes no
//                   such row (UI.md Finding 1), so this reads $0 by construction — the gap is
//                   printed, never hidden.
//
// Pure folds only. The I/O lives in app/api/admin/desk/read.ts; the harness imports this
// module in-process and pins the folds on fixtures.

import { chainById } from '@/lib/chains'
import { feeBpsOfArtifact } from '@/lib/fees'
import { jobStepBuildPath, jobStepChainId } from '@/lib/job-step-telemetry'
import { venueOfBuildPath } from '@/lib/build-path'
import { dailySeries, dayKey, deltaPct, splitOfRow, sumSplit, windowRows, type GrowthDayPoint, type GrowthTurnRow } from '@/lib/admin-growth'

/* ── raw rows (what the loader hands the fold; Dates or ISO strings both fine) ───────── */

export interface DeskIntentRaw {
  id: string
  ask: string
  wallet: string | null
  agent: string | null
  agentKeyHash: string | null
  isInternal: boolean
  state: string
  plan: unknown
  linkSlug: string | null
  jobId: string | null
  createdAt: Date | string
  updatedAt: Date | string
}

export interface DeskStepRaw {
  seq: number
  kind: string
  status: string
  builder: string
  title: string
  artifact: unknown
  result: unknown
  valueUsd: number | null
  expiresAt: Date | string | null
  createdAt: Date | string
  updatedAt: Date | string
}

export interface DeskJobRaw {
  id: string
  status: string
  valueUsd: number | null
  failReason: string | null
  isInternal: boolean
  createdAt: Date | string
  updatedAt: Date | string
  steps: DeskStepRaw[]
}

export interface DeskLinkEventRaw {
  kind: string
  wallet: string | null
  valueUsd: number | null
  txHash: string | null
  chainId: number | null
  verification: string | null
  createdAt: Date | string
}

/** A receipt-counted `embed_turns` row for one of the log's wallets (already fenced). */
export interface DeskTurnRaw {
  walletAddress: string | null
  valueUsd: number | null
  createdAt: Date | string
}

/* ── the read model ──────────────────────────────────────────────────────────────────── */

export type DeskEventKind =
  | 'opened'
  | 'chosen'
  | 'handoff'
  | 'consent'
  | 'compiled'
  | 'built'
  | 'claimed'
  | 'verified'
  | 'settled'
  | 'done'
  | 'failed'
  | 'closed'
  | 'refused'

/** Who is the authority for an event — the pill the timeline wears beside it. */
export type DeskVoice = 'desk' | 'agent' | 'runner' | 'human'

export interface DeskLogEvent {
  at: string
  kind: DeskEventKind
  who: DeskVoice
  seq?: number
  detail?: string
  txHash?: string
  txUrl?: string
  chainId?: number
  valueUsd?: number | null
  feeUsd?: number
  venue?: string | null
  /** A claimed leg's fee facts, verbatim, so the Growth series re-runs `splitOfRow` on them. */
  buildPath?: string | null
  feeBps?: number | null
}

/** Where an intent got to. Each stage implies the ones before it on its path. */
export type DeskStage = 'opened' | 'handed_off' | 'executing' | 'signed' | 'settled' | 'failed' | 'closed' | 'declined'

export const DESK_STAGES: readonly DeskStage[] = ['opened', 'handed_off', 'executing', 'signed', 'settled', 'failed', 'closed', 'declined']

export const DESK_STAGE_LABEL: Record<DeskStage, string> = {
  opened: 'Opened',
  handed_off: 'Handed to a human',
  executing: 'Executing',
  signed: 'Signed',
  settled: 'Settled',
  failed: 'Failed',
  closed: 'Closed',
  declined: 'Declined',
}

export type DeskTone = 'info' | 'act' | 'good' | 'warn' | 'bad'

export const DESK_STAGE_TONE: Record<DeskStage, DeskTone> = {
  opened: 'info',
  handed_off: 'info',
  executing: 'act',
  signed: 'good',
  settled: 'good',
  failed: 'bad',
  closed: 'info',
  declined: 'warn',
}

export const DESK_EVENT_TONE: Record<DeskEventKind, DeskTone> = {
  opened: 'info',
  chosen: 'info',
  handoff: 'info',
  consent: 'act',
  compiled: 'act',
  built: 'act',
  claimed: 'act',
  verified: 'good',
  settled: 'good',
  done: 'good',
  failed: 'bad',
  closed: 'info',
  refused: 'warn',
}

export const DESK_WINDOWS = [7, 30, 90] as const
export type DeskWindow = (typeof DESK_WINDOWS)[number]

export interface DeskLogRow {
  intentId: string
  /** The public track-record handle (sha256(agent_key)[:16]); null = an unidentified caller. */
  agentHandle: string | null
  /** The agent's sanitized self-reported name, or null. */
  agentName: string | null
  ask: string
  wallet: string | null
  /** The raw broker_intents.state. */
  status: string
  stage: DeskStage
  path: 'agent' | 'human' | 'none'
  isInternal: boolean
  /** The wallet is one of ours (lib/admin TEST_WALLETS). Shown; dropped under `external`. */
  team: boolean
  openedAt: string
  /** The newest event's time — the log sorts by it. */
  lastAt: string
  jobId: string | null
  jobStatus: string | null
  linkSlug: string | null
  legs: { total: number; signed: number; verified: number; failed: number }
  /** Agent path: guard-priced notional of every sign step the agent completed (its CLAIM).
   *  Human path: receipt-counted signed link events. */
  valueUsd: number | null
  /** Receipt-counted `embed_turns` money for this wallet inside the intent's lifetime. */
  countedUsd: number
  /** Pantessa's net fee the claimed legs' artifacts carried (lib/fees rules). */
  feeUsd: number
  events: DeskLogEvent[]
}

/* ── helpers ─────────────────────────────────────────────────────────────────────────── */

const iso = (d: Date | string): string => (typeof d === 'string' ? new Date(d) : d).toISOString()
const ms = (d: Date | string): number => (typeof d === 'string' ? new Date(d) : d).getTime()
const obj = (v: unknown): Record<string, unknown> | null => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
const r2 = (n: number) => Math.round(n * 100) / 100

/** The runner offers a sign step for 30 minutes (lib/jobs-runner OFFER_TTL_MS). A step's
 *  offer time is not stored, so while it is OFFERED the fold reads it back off `expires_at`;
 *  once it is done, the offer moment is gone and the fold shows only the claim. */
export const DESK_OFFER_TTL_MS = 30 * 60_000

const HASH_RE = /^0x[0-9a-fA-F]{64}$/

/** The tx hash an agent's completion result carries, if any. JobCard posts `{ txHash }`; a
 *  txChain posts the LAST hash; anything hash-shaped under the usual keys counts. Anything
 *  else (an HL fill, a Seaport order) is a venue receipt with no chain hash. */
export function txHashOf(result: unknown): string | null {
  const r = obj(result)
  if (!r) return null
  for (const k of ['txHash', 'hash', 'transactionHash']) {
    const v = r[k]
    if (typeof v === 'string' && HASH_RE.test(v)) return v
  }
  const many = r.txHashes ?? r.hashes
  if (Array.isArray(many)) {
    const last = many[many.length - 1]
    if (typeof last === 'string' && HASH_RE.test(last)) return last
  }
  return null
}

/** Explorer link from the chain registry — never a hand-typed host. Null off-registry. */
export function explorerTxUrl(chainId: number | null | undefined, hash: string | null | undefined): string | null {
  if (!chainId || !hash) return null
  const c = chainById(chainId)
  return c ? `${c.explorerTx}${hash}` : null
}

/** The chain a completed step's result names, else the one its artifact was built for. */
export function stepChainId(step: Pick<DeskStepRaw, 'artifact' | 'result'>): number | null {
  const r = obj(step.result)
  const fromResult = r?.chainId
  const n = typeof fromResult === 'number' ? fromResult : typeof fromResult === 'string' ? Number(fromResult) : NaN
  if (Number.isInteger(n) && n > 0) return n
  return jobStepChainId(step.artifact) ?? null
}

/** One claimed sign step as a Growth turn row — the SAME `splitOfRow` rulebook the books use,
 *  so a desk dollar earns a fee exactly where a chat dollar does (and nowhere else). */
export function legTurnRow(step: Pick<DeskStepRaw, 'builder' | 'artifact' | 'valueUsd' | 'updatedAt'>, tester = false): GrowthTurnRow {
  const buildPath = jobStepBuildPath(step.builder, step.artifact) ?? null
  return {
    day: iso(step.updatedAt).slice(0, 10),
    source: 'standing',
    buildPath,
    feeBps: feeBpsOfArtifact(step.artifact) ?? null,
    creator: null,
    tester,
    usd: step.valueUsd && step.valueUsd > 0 ? step.valueUsd : 0,
    n: 1,
  }
}

function planChosen(plan: unknown): { label: string; at: string | null } | null {
  const p = obj(plan)
  const c = obj(p?.chosen)
  if (!c) return null
  const label = typeof c.label === 'string' ? c.label : typeof c.optionId === 'string' ? c.optionId : null
  if (!label) return null
  const at = typeof c.at === 'string' && !Number.isNaN(Date.parse(c.at)) ? new Date(c.at).toISOString() : null
  return { label, at }
}

function planGate(plan: unknown): string | null {
  const q = obj(obj(plan)?.quote)
  const gate = typeof q?.gate === 'string' ? q.gate : null
  const kind = typeof q?.kind === 'string' ? q.kind : null
  return gate ? `${gate}${kind && kind !== 'action' ? ` · ${kind}` : ''}` : kind
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

/* ── the fold ────────────────────────────────────────────────────────────────────────── */

export interface DeskFoldInput {
  intent: DeskIntentRaw
  job?: DeskJobRaw | null
  linkEvents?: DeskLinkEventRaw[]
  /** Receipt-counted signed turns for `intent.wallet` (any time; the fold windows them). */
  turns?: DeskTurnRaw[]
  testers?: ReadonlySet<string>
}

/** Fold one intent (+ its job / link evidence) into a log row. */
export function foldDeskIntent(input: DeskFoldInput): DeskLogRow {
  const { intent } = input
  const job = input.job ?? null
  const linkEvents = input.linkEvents ?? []
  const wallet = intent.wallet?.toLowerCase() ?? null
  const team = !!wallet && !!input.testers?.has(wallet)
  const isInternal = intent.isInternal || !!job?.isInternal
  const events: DeskLogEvent[] = []

  events.push({ at: iso(intent.createdAt), kind: 'opened', who: 'desk', detail: planGate(intent.plan) ?? undefined })
  const chosen = planChosen(intent.plan)
  if (chosen) events.push({ at: chosen.at ?? iso(intent.updatedAt), kind: 'chosen', who: 'agent', detail: chosen.label })

  let stage: DeskStage = 'opened'
  let path: DeskLogRow['path'] = 'none'
  const legs = { total: 0, signed: 0, verified: 0, failed: 0 }
  let valueUsd: number | null = null
  let feeUsd = 0
  const legRows: GrowthTurnRow[] = []
  let lifeStart = ms(intent.createdAt)
  let lifeEnd = Number.POSITIVE_INFINITY

  if (job) {
    path = 'agent'
    stage = 'executing'
    const jobAt = iso(job.createdAt)
    lifeStart = Math.min(lifeStart, ms(job.createdAt))
    // The consent signature is recovered inside broker_execute and never stored; the job
    // cannot exist without it, so its creation IS the consent moment (Finding 3).
    events.push({ at: jobAt, kind: 'consent', who: 'agent', detail: wallet ? `signature recovered from ${wallet.slice(0, 6)}…${wallet.slice(-4)} at execute` : 'signature recovered at execute' })
    events.push({ at: jobAt, kind: 'compiled', who: 'desk', detail: `${job.steps.length}-leg job ${job.id}` })
    for (const step of [...job.steps].sort((a, b) => a.seq - b.seq)) {
      const result = obj(step.result)
      const venue = venueOfBuildPath(jobStepBuildPath(step.builder, step.artifact) ?? step.builder)
      if (step.kind === 'sign') {
        legs.total += 1
        if (step.status === 'offered') {
          const at = step.expiresAt ? new Date(ms(step.expiresAt) - DESK_OFFER_TTL_MS).toISOString() : iso(step.createdAt)
          events.push({ at, kind: 'built', who: 'runner', seq: step.seq, detail: `${step.title} — offered, awaiting the agent's signature`, valueUsd: step.valueUsd, venue })
        } else if (step.status === 'done') {
          legs.signed += 1
          const hash = txHashOf(step.result)
          const chainId = stepChainId(step)
          const row = legTurnRow(step, team)
          const split = splitOfRow(row)
          legRows.push(row)
          valueUsd = (valueUsd ?? 0) + row.usd
          feeUsd += split.feeUsd
          events.push({
            at: iso(step.updatedAt),
            kind: 'claimed',
            who: 'agent',
            seq: step.seq,
            detail: hash ? step.title : `${step.title} — ${result ? clip(JSON.stringify(result), 80) : 'no receipt in the result'}`,
            txHash: hash ?? undefined,
            txUrl: explorerTxUrl(chainId, hash) ?? undefined,
            chainId: chainId ?? undefined,
            valueUsd: step.valueUsd,
            feeUsd: split.feeUsd > 0 ? split.feeUsd : undefined,
            venue,
            buildPath: row.buildPath,
            feeBps: row.feeBps,
          })
        } else if (step.status === 'failed') {
          legs.failed += 1
          const why = typeof result?.error === 'string' ? result.error : 'the build refused'
          events.push({ at: iso(step.updatedAt), kind: 'failed', who: 'runner', seq: step.seq, detail: `${step.title} — ${clip(why, 160)}`, valueUsd: step.valueUsd, venue })
        } else if (result && result.withheld === true && typeof result.error === 'string') {
          // Withheld = the runner built, then would not offer (affordability, an RPC wall).
          events.push({ at: iso(step.updatedAt), kind: 'refused', who: 'runner', seq: step.seq, detail: `${step.title} — ${clip(result.error, 160)}` })
        }
      } else if (step.kind === 'wait') {
        if (step.status === 'done') {
          legs.verified += 1
          const status = typeof result?.status === 'string' ? result.status : result ? clip(JSON.stringify(result), 60) : undefined
          events.push({ at: iso(step.updatedAt), kind: 'verified', who: 'runner', seq: step.seq, detail: `${step.title}${status ? ` — ${status}` : ''}` })
        } else if (step.status === 'failed') {
          legs.failed += 1
          const why = typeof result?.error === 'string' ? result.error : typeof result?.status === 'string' ? result.status : 'the wait timed out'
          events.push({ at: iso(step.updatedAt), kind: 'failed', who: 'runner', seq: step.seq, detail: `${step.title} — ${clip(why, 160)}` })
        }
      } else if (step.status === 'done') {
        // An `auto` step the runner ran itself (a guardian arm): server truth, not a claim.
        events.push({ at: iso(step.updatedAt), kind: 'verified', who: 'runner', seq: step.seq, detail: `${step.title} — done by the runner` })
      } else if (step.status === 'failed') {
        legs.failed += 1
        const why = typeof result?.error === 'string' ? result.error : 'failed'
        events.push({ at: iso(step.updatedAt), kind: 'failed', who: 'runner', seq: step.seq, detail: `${step.title} — ${clip(why, 160)}` })
      }
    }
    if (legs.signed > 0) stage = 'signed'
    if (job.status === 'done') {
      stage = 'settled'
      lifeEnd = ms(job.updatedAt) + 60 * 60_000
      events.push({ at: iso(job.updatedAt), kind: 'done', who: 'runner', detail: `job done${job.valueUsd ? ` · $${r2(job.valueUsd).toFixed(2)} moved` : ''}` })
    } else if (job.status === 'failed') {
      stage = 'failed'
      lifeEnd = ms(job.updatedAt) + 60 * 60_000
      events.push({ at: iso(job.updatedAt), kind: 'failed', who: 'runner', detail: job.failReason ? clip(job.failReason, 200) : 'job failed' })
    } else if (job.status === 'canceled') {
      stage = 'closed'
      lifeEnd = ms(job.updatedAt)
      events.push({ at: iso(job.updatedAt), kind: 'closed', who: 'desk', detail: 'job canceled' })
    }
  } else if (intent.linkSlug) {
    path = 'human'
    stage = 'handed_off'
    events.push({ at: iso(intent.updatedAt), kind: 'handoff', who: 'desk', detail: `sign link /i/${intent.linkSlug} minted for the agent's human` })
    let linkUsd = 0
    for (const ev of [...linkEvents].sort((a, b) => ms(a.createdAt) - ms(b.createdAt))) {
      const counted = ev.verification == null || ev.verification === 'verified' || ev.verification === 'attested'
      const url = explorerTxUrl(ev.chainId, ev.txHash) ?? undefined
      if (ev.kind === 'connect') events.push({ at: iso(ev.createdAt), kind: 'consent', who: 'human', detail: ev.wallet ? `wallet ${ev.wallet.slice(0, 6)}…${ev.wallet.slice(-4)} connected` : 'wallet connected' })
      else if (ev.kind === 'built') events.push({ at: iso(ev.createdAt), kind: 'built', who: 'runner', detail: 'artifact built for the human', valueUsd: ev.valueUsd })
      else if (ev.kind === 'signed') {
        legs.total += 1
        legs.signed += 1
        events.push({ at: iso(ev.createdAt), kind: 'claimed', who: 'human', detail: counted ? 'signed' : `signed · receipt ${ev.verification}`, txHash: ev.txHash ?? undefined, txUrl: url, chainId: ev.chainId ?? undefined, valueUsd: ev.valueUsd })
        if (counted) {
          linkUsd += ev.valueUsd ?? 0
          if (ev.verification) {
            legs.verified += 1
            events.push({ at: iso(ev.createdAt), kind: 'verified', who: 'runner', detail: `receipt ${ev.verification}`, txHash: ev.txHash ?? undefined, txUrl: url, chainId: ev.chainId ?? undefined })
          }
        }
      } else if (ev.kind === 'settled') {
        events.push({ at: iso(ev.createdAt), kind: 'settled', who: 'runner', detail: 'settlement recorded', txHash: ev.txHash ?? undefined, txUrl: url, chainId: ev.chainId ?? undefined })
      }
    }
    if (legs.signed > 0) {
      stage = 'signed'
      valueUsd = linkUsd
    }
    if (linkEvents.some((e) => e.kind === 'settled')) stage = 'settled'
  }

  // The desk's own terminal states win over anything derived.
  if (intent.state === 'declined') {
    stage = 'declined'
    events.push({ at: iso(intent.updatedAt), kind: 'refused', who: 'human', detail: 'the recipient declined' })
  } else if (intent.state === 'closed' && stage !== 'closed') {
    stage = 'closed'
    events.push({ at: iso(intent.updatedAt), kind: 'closed', who: 'desk', detail: job ? 'closed' : 'the agent walked away' })
  }

  // Receipt-counted money for this wallet, inside the intent's lifetime.
  const countedUsd = wallet
    ? (input.turns ?? []).reduce((s, t) => {
        if ((t.walletAddress ?? '').toLowerCase() !== wallet) return s
        const at = ms(t.createdAt)
        return at >= lifeStart && at <= lifeEnd ? s + (t.valueUsd ?? 0) : s
      }, 0)
    : 0

  const KIND_ORDER: Record<DeskEventKind, number> = { opened: 0, chosen: 1, handoff: 2, consent: 3, compiled: 4, built: 5, claimed: 6, verified: 7, settled: 8, done: 9, failed: 9, closed: 10, refused: 6 }
  events.sort((a, b) => ms(a.at) - ms(b.at) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.seq ?? 0) - (b.seq ?? 0))

  return {
    intentId: intent.id,
    agentHandle: intent.agentKeyHash,
    agentName: intent.agent,
    ask: intent.ask,
    wallet,
    status: intent.state,
    stage,
    path,
    isInternal,
    team,
    openedAt: iso(intent.createdAt),
    lastAt: events[events.length - 1]?.at ?? iso(intent.updatedAt),
    jobId: job?.id ?? intent.jobId,
    jobStatus: job?.status ?? null,
    linkSlug: intent.linkSlug,
    legs,
    valueUsd: valueUsd == null ? null : r2(valueUsd),
    countedUsd: r2(countedUsd),
    feeUsd,
    events,
  }
}

/** Newest activity first. */
export function sortDeskRows(rows: DeskLogRow[]): DeskLogRow[] {
  return [...rows].sort((a, b) => ms(b.lastAt) - ms(a.lastAt) || ms(b.openedAt) - ms(a.openedAt))
}

export interface DeskFilter {
  stage?: DeskStage | null
  /** Substring of the handle or the agent's name (case-insensitive). */
  agent?: string | null
  /** Strangers only: drop internal AND team rows. */
  external?: boolean
}

export function filterDeskRows(rows: DeskLogRow[], f: DeskFilter): DeskLogRow[] {
  const q = f.agent?.trim().toLowerCase() || null
  return rows.filter((r) => {
    if (f.external && (r.isInternal || r.team)) return false
    if (f.stage && r.stage !== f.stage) return false
    if (q && !((r.agentHandle ?? '').toLowerCase().includes(q) || (r.agentName ?? '').toLowerCase().includes(q))) return false
    return true
  })
}

/* ── the Growth section ─────────────────────────────────────────────────────────────── */

/** Rows that COUNT: never internal; team rows only when not `external`. */
export function countedDeskRows(rows: DeskLogRow[], external = false): DeskLogRow[] {
  return rows.filter((r) => !r.isInternal && !(external && r.team))
}

/** Every claimed leg of the counted rows as a Growth turn row (day = the claim's day), so the
 *  section's series and fee come from the SAME `windowRows`/`dailySeries`/`sumSplit` idiom
 *  the rest of the page uses. */
export function deskLegRows(rows: DeskLogRow[]): GrowthTurnRow[] {
  const out: GrowthTurnRow[] = []
  for (const r of rows) {
    if (r.path !== 'agent') continue
    for (const e of r.events) {
      if (e.kind !== 'claimed') continue
      const usd = e.valueUsd && e.valueUsd > 0 ? e.valueUsd : 0
      out.push({ day: e.at.slice(0, 10), source: 'standing', buildPath: e.buildPath ?? null, feeBps: e.feeBps ?? null, creator: null, tester: r.team, usd, n: 1 })
    }
  }
  return out
}

export interface DeskFunnel {
  opened: number
  executed: number
  signed: number
  settled: number
}

export function deskFunnel(rows: DeskLogRow[]): DeskFunnel {
  const f: DeskFunnel = { opened: 0, executed: 0, signed: 0, settled: 0 }
  for (const r of rows) {
    f.opened += 1
    if (r.jobId) f.executed += 1
    if (r.legs.signed > 0) f.signed += 1
    if (r.stage === 'settled') f.settled += 1
  }
  return f
}

export interface DeskAgentRow {
  handle: string | null
  name: string | null
  intents: number
  legs: number
  usd: number
  feeUsd: number
  lastAt: string
}

/** Money moved per agent (claimed), biggest first; unidentified callers fold into one row. */
export function deskByAgent(rows: DeskLogRow[], limit = 10): DeskAgentRow[] {
  const by = new Map<string, DeskAgentRow>()
  for (const r of rows) {
    const key = r.agentHandle ?? ''
    const cur = by.get(key) ?? { handle: r.agentHandle, name: null, intents: 0, legs: 0, usd: 0, feeUsd: 0, lastAt: r.lastAt }
    cur.intents += 1
    cur.legs += r.legs.signed
    cur.usd += r.valueUsd ?? 0
    cur.feeUsd += r.feeUsd
    if (ms(r.lastAt) >= ms(cur.lastAt)) {
      cur.lastAt = r.lastAt
      cur.name = r.agentName ?? cur.name
    } else cur.name = cur.name ?? r.agentName
    by.set(key, cur)
  }
  return [...by.values()]
    .map((a) => ({ ...a, usd: r2(a.usd) }))
    .sort((a, b) => b.usd - a.usd || b.intents - a.intents)
    .slice(0, limit)
}

export interface DeskGrowth {
  windowDays: number
  /** Distinct identified agents that opened an intent in the window / ever. */
  agents: number
  agentsAllTime: number
  funnel: DeskFunnel
  funnelPrev: DeskFunnel
  /** Claimed money (sum of completed sign legs) in the window, and its delta. */
  moneyUsd: number
  moneyDelta: number | null
  moneyAllTimeUsd: number
  legs: number
  feeUsd: number
  feeAllTimeUsd: number
  /** Receipt-counted money for the same wallets in the window (Finding 1: $0 until the
   *  completion route writes the beacon). */
  countedUsd: number
  series: GrowthDayPoint[]
  byAgent: DeskAgentRow[]
}

/** The Desk section of Growth, from ALREADY-COUNTED rows (see countedDeskRows). */
export function deskGrowthSummary(rows: DeskLogRow[], days: number, now: number): DeskGrowth {
  const start = dayKey(now, days - 1)
  const prevStart = dayKey(now, 2 * days - 1)
  const inWin = rows.filter((r) => r.openedAt.slice(0, 10) >= start)
  const inPrev = rows.filter((r) => r.openedAt.slice(0, 10) >= prevStart && r.openedAt.slice(0, 10) < start)
  const legRows = deskLegRows(rows)
  const { current, previous } = windowRows(legRows, days, now)
  const cur = sumSplit(current)
  const prev = sumSplit(previous)
  const all = sumSplit(legRows)
  const handles = (rs: DeskLogRow[]) => new Set(rs.map((r) => r.agentHandle).filter((h): h is string => !!h)).size
  return {
    windowDays: days,
    agents: handles(inWin),
    agentsAllTime: handles(rows),
    funnel: deskFunnel(inWin),
    funnelPrev: deskFunnel(inPrev),
    moneyUsd: r2(cur.volumeUsd),
    moneyDelta: deltaPct(cur.volumeUsd, prev.volumeUsd),
    moneyAllTimeUsd: r2(all.volumeUsd),
    legs: cur.trades,
    feeUsd: cur.feeUsd,
    feeAllTimeUsd: all.feeUsd,
    countedUsd: r2(inWin.reduce((s, r) => s + r.countedUsd, 0)),
    series: dailySeries(legRows, days, now),
    byAgent: deskByAgent(inWin),
  }
}
