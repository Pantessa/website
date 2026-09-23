// lib/desk-wire.ts — THE leg wire between the agent desk and an agent's signer.
//
// Squad contract C1/C2 (~/yeetful/squad-agentdesk-2026-09-23/README.md). Owned by the
// MCP lane; DRIVE writes the batch shape (C2); the `pantessa` SDK mirrors these types in
// `src/desk.ts`; the harness pins the two in sync. Pure — no I/O, no React, no Prisma, and
// deliberately NO imports, so the SDK can mirror it line for line and the harness can load
// it in a bare node process.
//
// A job step the runner has OFFERED carries exactly one signable artifact shape. `legViewOf`
// turns a raw Jobs-API step into the one view every consumer (SDK, broker_next, the admin
// log) reads, so nobody re-derives "what kind of thing is this" from the artifact by hand.
//
// THE ARTIFACT KEYS, as lib/jobs-runner.ts `buildSignArtifact` actually writes them (the
// squad brief's C1 sketch says `artifact.tx`; the runner has always written `txRequest`, so
// both spellings classify here and the brief's name is the alias):
//   { txRequest }                     one EVM tx            — cross-chain deposit, Lido
//                                                             stake, transfer, NFT buy/xfer
//   { txRequest, depositAddress,      a cross-chain deposit — the address is the venue's,
//     addressExpires }                                        and it EXPIRES
//   { txChain: { summary, steps[],    N EVM txs in order    — swaps (approve → swap → fee),
//     refresh? } }                                            Aave/Morpho, LiFi funding legs
//   { orderRequest: {                 an EIP-712 order      — protocol 'hyperliquid' (L1
//     protocol, typedData, … } }                              action, domain chainId 1337),
//                                                             'cow', 'opensea' (Seaport)
//   (no artifact)                     a wait leg            — the runner settles it itself
//
// SIGNING A HYPERLIQUID LEG — the #850 rule, stated where a signer will read it:
// the venue hashes the MSGPACK of `hl.action`, and msgpack is key-order sensitive while
// Postgres `jsonb` sorts object keys. So the action you read out of a job step is NOT in
// the venue's schema order. You do not need it to be: the leg's `orderRequest.typedData`
// was built server-side over the CANONICAL hash, so SIGN `typedData` VERBATIM, post the
// action back as you received it, and `/api/hl/submit` re-canonicalizes before it hashes,
// guards, or relays. Never recompute the connectionId yourself from a stored action, and
// never re-serialize an artifact on its way to a signer — `legViewOf` hands the runner's
// object through by REFERENCE for exactly that reason.

/** What kind of signature a leg wants. */
export type DeskLegKind =
  | 'tx'        // one EVM transaction
  | 'txChain'   // N EVM transactions, in order
  | 'hlAction'  // one Hyperliquid L1 action (EIP-712, domain chainId 1337)
  | 'hlBatch'   // N Hyperliquid L1 actions signed in one motion (C2)
  | 'order'     // a non-HL EIP-712 order: CoW swap / limit, Seaport listing
  | 'wait'      // nothing to sign — the runner verifies settlement on-chain
  | 'unknown'   // a shape this wire does not name yet: do not sign it blind

/** The Hyperliquid L1 domain chain id — a venue constant, never a network. */
export const HL_DOMAIN_CHAIN_ID = 1337
/** How long a Hyperliquid nonce stays signable (mirrors HL_NONCE_SIGNABLE_MS). */
export const HL_NONCE_LIFE_MS = 90_000
/** How long the runner leaves a built artifact offered before rebuilding it
 *  (mirrors jobs-runner OFFER_TTL_MS). The floor under every leg's freshness. */
export const LEG_OFFER_TTL_MS = 30 * 60_000

export interface DeskLegView {
  seq: number
  kind: DeskLegKind
  /** One plain sentence: what signing this does ("Bridge 12 USDC from Base to Arbitrum"). */
  summary: string
  /** The signable material, verbatim from the runner — never re-serialized (jsonb/msgpack, #850). */
  artifact: Record<string, unknown> | null
  /** The chain the signature belongs to (EVM id; 1337 for a Hyperliquid L1 action). */
  chainId: number | null
  valueUsd: number | null
  /** ms after which the material must be re-fetched (deadline calldata, HL nonce ~2 min).
   *  0 = already stale, poll again for a rebuild. null = nothing to sign (a wait leg). */
  staleAfterMs: number | null
}

/**
 * What a signer reports back for one leg. THE list — three files used to
 * carry three ideas of it (QA F9: this type named 4 keys, the SDK 7, the
 * desk's own allowlist 9, and the admin log read an `explorerUrl` no
 * published type mentioned). `DESK_LEG_RESULT_KEYS` below is the same list
 * as data, so the desk's allowlist and the SDK's writer derive from the type
 * instead of re-typing it.
 *
 * Everything here is the signer's CLAIM about its own signature (#824). The
 * runner treats it as advancement; the wait leg after it, and the receipt
 * check on the money row, are what make it true.
 */
export interface DeskLegResult {
  /** EVM: the hash — of the LAST transaction for a txChain. */
  txHash?: `0x${string}`
  chainId?: number
  /** EVM: every hash the leg produced, when the leg was more than one tx. */
  txs?: Array<{ hash: string; chainId: number }>
  /** Hyperliquid / CoW / Seaport: the venue's response to the submitted action. */
  orderResponse?: unknown
  /** Hyperliquid: the fill, when the venue returned one separately. */
  fill?: unknown
  /** hlBatch: one entry per SUBMITTED member, in order; a failed member is the
   *  last entry with `ok: false` and the runner re-offers from it. */
  batch?: Array<{ ok: boolean; orderResponse?: unknown; error?: string }>
  /** A human line for the card and the desk log, when a hash says nothing. */
  detail?: string
  /** The venue's own link for an off-chain order (no EVM explorer exists). */
  explorerUrl?: string
  /** The venue's own word for what happened, when it has one. */
  status?: string
}

/** {@link DeskLegResult}'s keys, as data. The desk allowlists exactly these
 *  on `broker_done`; anything else is dropped and named back to the caller. */
export const DESK_LEG_RESULT_KEYS = [
  'txHash',
  'chainId',
  'txs',
  'orderResponse',
  'fill',
  'batch',
  'detail',
  'explorerUrl',
  'status',
] as const satisfies ReadonlyArray<keyof DeskLegResult>

export interface DeskNext {
  leg: DeskLegView | null
  /** Set when there is nothing to sign right now (a wait leg settling, the runner building). */
  waiting: string | null
  retryAfterMs: number | null
  jobStatus: string
}

/** The raw Jobs-API step shape this wire reads. Structural on purpose: the Prisma row,
 *  the JSON the Jobs API serves, and a harness fixture all satisfy it. */
export interface DeskStepLike {
  seq: number
  kind?: string | null
  status?: string | null
  builder?: string | null
  title?: string | null
  artifact?: unknown
  valueUsd?: number | null
  /** When the runner last touched the step — the offer clock for a leg with no
   *  deadline of its own. Date or ISO string (the Jobs API serializes it). */
  updatedAt?: Date | string | number | null
}

/* ── reading the artifact ─────────────────────────────────────────────── */

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

const str = (v: unknown): string | null => {
  if (typeof v !== 'string') return null
  const s = v.replace(/\s+/g, ' ').trim()
  return s ? s : null
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}

const ms = (v: unknown): number | null => {
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'number' && Number.isFinite(v)) return v
  if (typeof v === 'string') {
    const t = Date.parse(v)
    return Number.isFinite(t) ? t : null
  }
  return null
}

/** The one EVM tx a `txRequest` leg carries. `tx` is accepted as an alias for
 *  the same field (the brief's C1 spelling). */
function txOf(artifact: Record<string, unknown>): Record<string, unknown> | null {
  return obj(artifact.txRequest) ?? obj(artifact.tx)
}

/** One member of a batched Hyperliquid leg (C2, DRIVE #853). Every member is
 *  signed on its own `typedData` and submitted on its own, in order. */
export interface HlBatchMemberLike {
  kind?: string
  action?: unknown
  nonce?: number
  typedData?: unknown
  expected?: unknown
}

/** The members of a batched HL leg, in order. `orderRequest.batch` is the
 *  contract; `orderRequest.hl.batch` is tolerated. Empty = not a batch. */
function hlBatchOf(order: Record<string, unknown> | null): HlBatchMemberLike[] {
  if (!order) return []
  const top = order.batch
  const nested = obj(order.hl)?.batch
  const raw = Array.isArray(top) ? top : Array.isArray(nested) ? nested : []
  return raw.filter((m): m is HlBatchMemberLike => !!obj(m))
}

function chainOf(artifact: Record<string, unknown> | null, kind: DeskLegKind): number | null {
  if (kind === 'hlAction' || kind === 'hlBatch') return HL_DOMAIN_CHAIN_ID
  if (!artifact) return null
  if (kind === 'tx') return num(txOf(artifact)?.chainId)
  if (kind === 'txChain') {
    const steps = obj(artifact.txChain)?.steps
    if (!Array.isArray(steps)) return null
    for (const s of steps) {
      const c = num(obj(obj(s)?.tx)?.chainId)
      if (c != null) return c
    }
    return null
  }
  if (kind === 'order') return num(obj(artifact.orderRequest)?.chainId)
  return null
}

/** Classify the artifact. Fails to `unknown` rather than guessing — an agent
 *  must never blind-sign a shape this wire cannot name. */
function kindOf(step: DeskStepLike, artifact: Record<string, unknown> | null): DeskLegKind {
  if (step.kind === 'wait') return 'wait'
  if (!artifact) return step.kind === 'sign' ? 'unknown' : 'wait'
  const order = obj(artifact.orderRequest)
  if (order) {
    const protocol = str(order.protocol)?.toLowerCase()
    if (protocol === 'hyperliquid') {
      // C2 (DRIVE, #853): a batched HL leg carries its members at the TOP
      // level of orderRequest as `batch: HlBatchMember[]` — each
      // { kind: 'leverage' | 'order', action, nonce, typedData, expected },
      // ≤3, nonces ascending, the `order` member last. `hl.batch` is
      // tolerated as a nesting some earlier draft used. One action stays
      // exactly the shape SignHlActionButton has always signed — and a leg
      // carrying a one-time builder-fee approval is always that single shape.
      return hlBatchOf(order).length > 0 ? 'hlBatch' : 'hlAction'
    }
    return 'order'
  }
  const chain = obj(artifact.txChain)
  if (chain && Array.isArray(chain.steps) && chain.steps.length > 0) return 'txChain'
  if (txOf(artifact)) return 'tx'
  return 'unknown'
}

/** How long the material stays signable, in ms from `now`. Deadline first
 *  (the $32M-fee lesson: never offer dead calldata), then the offer clock. */
function staleOf(kind: DeskLegKind, artifact: Record<string, unknown> | null, step: DeskStepLike, now: number): number | null {
  if (kind === 'wait') return null
  const clamp = (at: number | null) => (at == null ? null : Math.max(0, at - now))
  if (artifact) {
    if (kind === 'hlAction' || kind === 'hlBatch') {
      const order = obj(artifact.orderRequest)
      // A batch is minted on ascending nonces in one motion, so the EARLIEST
      // member is the clock the whole leg shares — the moment it lapses, the
      // leg is rebuilt (retry), never re-signed.
      const members = hlBatchOf(order)
      const first = members.length > 0 ? num(members[0]?.nonce) : num(obj(order?.hl)?.nonce)
      if (first != null) return clamp(first + HL_NONCE_LIFE_MS)
    }
    if (kind === 'txChain') {
      const steps = obj(artifact.txChain)?.steps
      let soonest: number | null = null
      if (Array.isArray(steps)) {
        for (const s of steps) {
          const v = num(obj(s)?.validUntil)
          // validUntil is unix SECONDS (lib/transaction-layer TxChainStep).
          if (v != null && (soonest == null || v < soonest)) soonest = v
        }
      }
      if (soonest != null) return clamp(soonest * 1000)
    }
    if (kind === 'tx') {
      // A cross-chain deposit address is the venue's and it expires.
      const expires = ms(artifact.addressExpires)
      if (expires != null) return clamp(expires)
    }
  }
  const touched = ms(step.updatedAt)
  return touched == null ? null : clamp(touched + LEG_OFFER_TTL_MS)
}

/** One plain sentence: what signing this leg does. Composed from what the
 *  runner already stamps — the builder's own `artifact.summary` first, then
 *  the compiled step title — never invented. */
function summaryOf(kind: DeskLegKind, artifact: Record<string, unknown> | null, step: DeskStepLike): string {
  // A shape this wire cannot name gets the refusal and NOTHING else: the
  // step's own title would read like a description of something signable.
  if (kind === 'unknown') return fallbackSummary(kind)
  const base = (artifact && str(artifact.summary)) ?? str(step.title) ?? fallbackSummary(kind)
  const extras: string[] = []
  if (kind === 'txChain') {
    const raw = obj(artifact?.txChain)?.steps
    const steps: unknown[] = Array.isArray(raw) ? raw : []
    if (steps.length > 1) {
      const labels = steps.map((s) => str(obj(s)?.label) ?? str(obj(s)?.title) ?? 'transaction')
      extras.push(`${steps.length} transactions in order: ${labels.join(' → ')}`)
    }
    if (obj(artifact?.txChain)?.refresh) extras.push('one step re-quotes before it is signed (POST /api/tx/refresh)')
  }
  if (kind === 'tx' && artifact && str(artifact.depositAddress)) {
    extras.push('pays a one-time deposit address the guard pinned — the address expires')
  }
  if (kind === 'hlAction' || kind === 'hlBatch') {
    const hl = obj(obj(artifact?.orderRequest)?.hl)
    if (hl?.pre) extras.push('a guarded leverage update signs first, then the order')
    if (hl?.feeApproval) extras.push('a one-time builder-fee approval signs first')
    if (kind === 'hlBatch') {
      const members = hlBatchOf(obj(artifact?.orderRequest))
      const named = members.map((m) => str(m.kind) ?? 'action').join(' → ')
      extras.push(`${members.length} Hyperliquid actions signed in one motion and submitted in order: ${named}; the first failure stops the batch`)
    }
  }
  if (kind === 'order') {
    const protocol = str(obj(artifact?.orderRequest)?.protocol)
    if (protocol) extras.push(`${protocol} order — signing it is off-chain; the venue settles it`)
    if (obj(artifact?.orderRequest)?.prereqTx) extras.push('a one-time on-chain approval signs first')
  }
  return extras.length ? `${base} (${extras.join('; ')})` : base
}

function fallbackSummary(kind: DeskLegKind): string {
  switch (kind) {
    case 'wait': return 'Wait for settlement — the runner verifies it on-chain.'
    case 'tx': return 'Sign one transaction.'
    case 'txChain': return 'Sign a chain of transactions in order.'
    case 'hlAction': return 'Sign a Hyperliquid action.'
    case 'hlBatch': return 'Sign a batch of Hyperliquid actions.'
    case 'order': return 'Sign an off-chain order.'
    default: return 'This leg carries a shape the desk wire does not name — do not sign it; poll again or ask a human.'
  }
}

/** Classify a raw Jobs-API step into the one view every consumer reads.
 *  Pure. The artifact rides through by REFERENCE — no clone, no JSON round
 *  trip — so a Hyperliquid action reaches the signer exactly as stored. */
export function legViewOf(step: DeskStepLike, now: number = Date.now()): DeskLegView {
  const artifact = obj(step.artifact)
  const kind = kindOf(step, artifact)
  return {
    seq: step.seq,
    kind,
    summary: summaryOf(kind, artifact, step),
    artifact: kind === 'wait' ? null : artifact,
    chainId: chainOf(artifact, kind),
    valueUsd: step.valueUsd ?? null,
    staleAfterMs: staleOf(kind, artifact, step, now),
  }
}

/* ── what to do next ──────────────────────────────────────────────────── */

export interface DeskJobLike {
  status: string
  currentStep: number
  steps: DeskStepLike[]
}

/** How often to poll while the runner is building a leg. */
export const BUILD_RETRY_MS = 3_000
/** How often to poll while a wait leg settles (the GET advances it inline). */
export const SETTLE_RETRY_MS = 10_000

const TERMINAL: Record<string, string> = {
  done: 'done — every leg completed.',
  failed: 'failed — read the job’s failReason; nothing further will be offered.',
  canceled: 'canceled — the job was closed; nothing further will be offered.',
}

/** The whole "what should I do right now" answer, from a job + its steps.
 *  Exactly one of `leg` / `waiting` is set. Pure. */
export function deskNextOf(job: DeskJobLike, now: number = Date.now()): DeskNext {
  const terminal = TERMINAL[job.status]
  if (terminal) return { leg: null, waiting: terminal, retryAfterMs: null, jobStatus: job.status }

  const step = job.steps.find((s) => s.seq === job.currentStep) ?? job.steps.find((s) => s.status === 'offered')
  if (!step) {
    return { leg: null, waiting: 'the runner is rolling the job up — poll again.', retryAfterMs: BUILD_RETRY_MS, jobStatus: job.status }
  }
  if (step.status === 'offered' && step.kind === 'sign') {
    return { leg: legViewOf(step, now), waiting: null, retryAfterMs: null, jobStatus: job.status }
  }
  if (step.status === 'failed') {
    return { leg: null, waiting: `leg ${step.seq + 1} failed — the job will not offer it again without a retry.`, retryAfterMs: null, jobStatus: job.status }
  }
  if (step.kind === 'wait') {
    return {
      leg: null,
      waiting: `${str(step.title) ?? `leg ${step.seq + 1}`} — waiting for on-chain settlement; the runner verifies it, nothing to sign.`,
      retryAfterMs: SETTLE_RETRY_MS,
      jobStatus: job.status,
    }
  }
  return {
    leg: null,
    waiting: `leg ${step.seq + 1} (${str(step.title) ?? step.builder ?? 'building'}) is being built fresh and guard-checked — poll again.`,
    retryAfterMs: BUILD_RETRY_MS,
    jobStatus: job.status,
  }
}
