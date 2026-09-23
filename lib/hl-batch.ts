// lib/hl-batch.ts — THE BATCH RULE for job-borne Hyperliquid steps (agent-desk squad, contract C2).
//
// "Round-trip across every settlement boundary, batched within one." A job crosses a settlement
// boundary with a wait leg (bridge → wait → deposit → wait); INSIDE the venue, the actions that
// follow a credited deposit — set leverage, place the order — are one step whose artifact carries
// `orderRequest.batch`: every member's action + nonce + typed data, in submission order. An agent
// signs them all in one pass (no prompt between them) and submits them in order through the same
// relay the browser uses (`POST /api/hl/submit`, mode `direct`), so each member is re-guarded
// against the live market exactly as a single action is today. A failed member ends the batch:
// the agent posts what it submitted, the runner re-arms the step, and the next offer starts from
// the failed member (a leverage the venue already applied is skipped by the builder).
//
// Pure — no I/O. The builder's `orderRequest` (lib/hyperliquid-exec buildHlExecTurn) is the ONLY
// source of members: `hl.pre` (the leverage pre-step) and `hl.action` (the order). This module
// never composes an action of its own; it re-derives each member's typed data from its action +
// nonce and refuses the offer when anything disagrees (jsonb sorts keys, msgpack doesn't — #850).
// The browser JobCard keeps reading `hl.pre` + `hl.action`; `batch` is additive.

import {
  canonicalizeHlAction,
  hlActionTypedData,
  HL_NONCE_SIGNABLE_MS,
  type HlWireAction,
  type HlWireLeverageAction,
  type HlWireOrderAction,
} from '@/lib/hyperliquid-exec'

/** Leverage + order (+ one spare for a future member); never more. */
export const HL_BATCH_MAX_MEMBERS = 3

export interface HlBatchLeverageMember {
  kind: 'leverage'
  action: HlWireLeverageAction
  nonce: number
  typedData: Record<string, unknown>
  expected: { coin: string; leverage: number }
}
export interface HlBatchOrderMember {
  kind: 'order'
  action: HlWireOrderAction
  nonce: number
  typedData: Record<string, unknown>
  expected: { coin: string; kind: 'open' | 'close'; isBuy?: boolean }
}
export type HlBatchMember = HlBatchLeverageMember | HlBatchOrderMember

/** One entry per SUBMITTED member, in order — the agent's word (the relay already re-guarded and
 *  the venue answered; the entry carries that answer). A failed member is the LAST entry. */
export interface HlBatchMemberResult {
  ok: boolean
  orderResponse?: unknown
  error?: string
}

type OrderRequestLike = {
  protocol?: unknown
  typedData?: unknown
  hl?: {
    action?: unknown
    nonce?: unknown
    isTestnet?: unknown
    expected?: { coin?: unknown; kind?: unknown; isBuy?: unknown }
    pre?: { action?: unknown; nonce?: unknown; typedData?: unknown; expected?: { coin?: unknown; leverage?: unknown } }
    feeApproval?: unknown
  }
  batch?: unknown
}

/**
 * Compose the batch from the builder's own order request. Returns null when the shape can't
 * carry one: not a Hyperliquid order, or a one-time builder-fee approval rides along (that is a
 * wallet-chain `HyperliquidSignTransaction` signature, not an L1 action — the single `hl.action`
 * path handles it, browser and SDK alike).
 */
export function composeHlBatch(orderRequest: unknown): HlBatchMember[] | null {
  const o = orderRequest as OrderRequestLike | null
  if (!o || typeof o !== 'object' || o.protocol !== 'hyperliquid') return null
  const hl = o.hl
  if (!hl || typeof hl !== 'object' || !hl.action || typeof hl.nonce !== 'number' || !o.typedData) return null
  if (hl.feeApproval) return null
  const kind = hl.expected?.kind
  if (kind !== 'open' && kind !== 'close' || typeof hl.expected?.coin !== 'string') return null
  const members: HlBatchMember[] = []
  const pre = hl.pre
  if (pre && typeof pre === 'object' && pre.action && typeof pre.nonce === 'number' && pre.typedData) {
    if (typeof pre.expected?.coin !== 'string' || typeof pre.expected?.leverage !== 'number') return null
    members.push({
      kind: 'leverage',
      action: pre.action as HlWireLeverageAction,
      nonce: pre.nonce,
      typedData: pre.typedData as Record<string, unknown>,
      expected: { coin: pre.expected.coin, leverage: pre.expected.leverage },
    })
  }
  members.push({
    kind: 'order',
    action: hl.action as HlWireOrderAction,
    nonce: hl.nonce,
    typedData: o.typedData as Record<string, unknown>,
    expected: { coin: hl.expected.coin, kind, ...(typeof hl.expected.isBuy === 'boolean' ? { isBuy: hl.expected.isBuy } : {}) },
  })
  return members
}

/**
 * The offer-time guard. Every member is an HL L1 action of a kind the relay accepts, its typed
 * data re-derives from its own action + nonce (canonical key order), nonces ascend, the order
 * member is last and alone, and all members name one coin. Anything else refuses the WHOLE
 * batch — an agent must never be handed a member the relay would reject after it signed.
 */
export function guardHlBatch(batch: unknown, opts: { isTestnet?: boolean } = {}): { ok: true; members: HlBatchMember[] } | { ok: false; reasons: string[] } {
  const reasons: string[] = []
  if (!Array.isArray(batch)) return { ok: false, reasons: ['batch is not an array'] }
  if (batch.length === 0) return { ok: false, reasons: ['batch is empty'] }
  if (batch.length > HL_BATCH_MAX_MEMBERS) return { ok: false, reasons: [`batch carries ${batch.length} members; the limit is ${HL_BATCH_MAX_MEMBERS}`] }
  let lastNonce = -Infinity
  let coin: string | null = null
  batch.forEach((raw, i) => {
    const at = `member ${i + 1}`
    const m = raw as Partial<HlBatchMember> | null
    if (!m || typeof m !== 'object') return void reasons.push(`${at} is not an object`)
    const type = (m.action as { type?: unknown } | undefined)?.type
    if (type !== 'order' && type !== 'updateLeverage') return void reasons.push(`${at} is not a Hyperliquid order or leverage action (type ${JSON.stringify(type ?? null)})`)
    if ((type === 'order') !== (m.kind === 'order') || (type === 'updateLeverage') !== (m.kind === 'leverage')) return void reasons.push(`${at}: kind "${String(m.kind)}" disagrees with action type "${type}"`)
    if (typeof m.nonce !== 'number' || !Number.isFinite(m.nonce)) return void reasons.push(`${at} has no nonce`)
    if (!(m.nonce > lastNonce)) reasons.push(`${at}'s nonce ${m.nonce} does not ascend past ${lastNonce}`)
    lastNonce = m.nonce
    if (m.kind === 'order' && i !== batch.length - 1) reasons.push(`${at} is an order but not the last member`)
    const expectedCoin = (m.expected as { coin?: unknown } | undefined)?.coin
    if (typeof expectedCoin !== 'string' || !expectedCoin) return void reasons.push(`${at} names no coin`)
    if (coin && coin !== expectedCoin.toUpperCase()) reasons.push(`${at} names ${expectedCoin}, not ${coin}`)
    coin = expectedCoin.toUpperCase()
    if (m.kind === 'order') {
      const k = (m.expected as { kind?: unknown }).kind
      if (k !== 'open' && k !== 'close') reasons.push(`${at}: expected.kind must be open|close`)
    } else if (typeof (m.expected as { leverage?: unknown }).leverage !== 'number') reasons.push(`${at}: expected.leverage is required`)
    // The typed data an agent signs MUST be the one the relay re-derives from action + nonce.
    const derived = hlActionTypedData(canonicalizeHlAction(m.action as HlWireAction), m.nonce, opts.isTestnet === true)
    const given = (m.typedData as { message?: { connectionId?: unknown; source?: unknown }; domain?: { chainId?: unknown } } | undefined)
    if (!given?.message || given.message.connectionId !== derived.message.connectionId || given.message.source !== derived.message.source || given.domain?.chainId !== 1337) {
      reasons.push(`${at}'s typed data does not derive from its action + nonce`)
    }
  })
  if (reasons.length) return { ok: false, reasons }
  const orders = batch.filter((m) => (m as HlBatchMember).kind === 'order').length
  if (orders > 1) return { ok: false, reasons: [`batch carries ${orders} orders; at most one`] }
  return { ok: true, members: batch as HlBatchMember[] }
}

/** Attach the guarded batch to a builder's order request (no-op when the shape can't carry one).
 *  Throws when the composed batch fails its own guard — that is a builder bug, never offerable. */
export function withHlBatch<T extends Record<string, unknown>>(orderRequest: T): T {
  const members = composeHlBatch(orderRequest)
  if (!members) return orderRequest
  const isTestnet = (orderRequest as OrderRequestLike).hl?.isTestnet === true
  const guard = guardHlBatch(members, { isTestnet })
  if (!guard.ok) throw new Error(`Hyperliquid batch refused: ${guard.reasons.join('; ')}`)
  return { ...orderRequest, batch: guard.members }
}

/** ms the batch stays signable, measured from its FIRST nonce (the relay refuses at 2 min;
 *  sign surfaces treat 90s as stale). ≤ 0 = re-fetch. */
export function hlBatchStaleAfterMs(batch: readonly { nonce: number }[], now = Date.now()): number {
  const first = batch[0]?.nonce
  if (typeof first !== 'number') return 0
  return HL_NONCE_SIGNABLE_MS - (now - first)
}

export type HlBatchVerdict =
  | { kind: 'none' }
  | { kind: 'done'; submitted: number }
  | { kind: 'reoffer'; failedIndex: number; submitted: number; error: string }

/**
 * Read a completion's `result.batch`. `none` = not a batch completion (a plain single-action or
 * EVM result). `done` = every submitted member answered ok. `reoffer` = a member failed: the step
 * must go back to pending so the next build re-offers from that member. A batch with NO entries
 * is `reoffer` at index 0 (nothing was submitted, nothing is done).
 */
export function batchCompletionVerdict(result: unknown): HlBatchVerdict {
  const r = result as { batch?: unknown } | null
  if (!r || typeof r !== 'object' || !Array.isArray(r.batch)) return { kind: 'none' }
  const entries = r.batch as Partial<HlBatchMemberResult>[]
  if (entries.length === 0) return { kind: 'reoffer', failedIndex: 0, submitted: 0, error: 'no member was submitted' }
  const failedIndex = entries.findIndex((e) => !e || typeof e !== 'object' || e.ok !== true)
  if (failedIndex === -1) return { kind: 'done', submitted: entries.length }
  const e = entries[failedIndex]
  const error = typeof e?.error === 'string' && e.error ? e.error.slice(0, 300) : `member ${failedIndex + 1} did not answer ok`
  return { kind: 'reoffer', failedIndex, submitted: entries.length, error }
}
