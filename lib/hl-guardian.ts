// ─────────────────────────────────────────────────────────────────────────
//  Hyperliquid Guardian — the PURE half (policy evaluation, deterministic
//  order construction, fail-closed guard, approveAgent typed data). No I/O:
//  everything here is a function of its arguments, so the whole safety story
//  is unit-testable. The I/O half (key custody, HL clients, the cron sweep)
//  lives in lib/hl-guardian-store.ts.
//
//  Trust model, same as every native venue: no model writes an order. Policy
//  params were fixed by the USER at arm time; the sweep re-derives everything
//  else (size, side, price) from the LIVE position, and the guard refuses
//  anything that isn't a reduce-only close of the pinned coin. The agent key
//  can never withdraw (venue-enforced); this guard narrows "can trade" down
//  to "can only close the guarded position".
// ─────────────────────────────────────────────────────────────────────────

import type { Eip712TypedData } from '@/lib/eip712'
import { buildReport, type GuardrailCheck, type GuardrailReport } from '@/lib/tx-guardrails'

// ── Types ──────────────────────────────────────────────────────────────────

export type GuardianPolicyKind = 'stop_loss' | 'take_profit'
export type GuardianTriggerMode = 'price_move_pct' | 'price'

export interface GuardianPolicyParams {
  /** Perp coin symbol as HL names it, e.g. "SYRUP". */
  coin: string
  /** Side of the position being guarded (fixed at arm time). */
  side: 'long' | 'short'
  kind: GuardianPolicyKind
  triggerMode: GuardianTriggerMode
  /** price_move_pct → percent move from entry (always positive);
   *  price → absolute mark price to cross. */
  triggerValue: number
}

/** The live position slice the evaluator + guard consume (from
 *  clearinghouseState.assetPositions[].position, numbers parsed). */
export interface GuardianPosition {
  coin: string
  /** Signed size: > 0 long, < 0 short. */
  szi: number
  entryPx: number
}

/** One order in HL /exchange wire shape (what the guard inspects — the same
 *  fields the SDK signs, nothing reconstructed after the check). */
export interface HlWireOrder {
  a: number // asset index
  b: boolean // true = buy
  p: string // limit price
  s: string // size
  r: boolean // reduce-only
  t: { limit: { tif: 'Ioc' } }
}

export interface GuardianCloseAction {
  orders: [HlWireOrder]
  grouping: 'na'
}

// ── Deterministic formatting (HL rejects malformed px/sz strings) ──────────

/** Perp price: ≤ 5 significant figures AND ≤ (6 − szDecimals) decimals,
 *  no trailing zeros. Mirrors the official SDK rounding rules. */
export function formatPx(px: number, szDecimals: number): string {
  if (!Number.isFinite(px) || px <= 0) throw new Error(`formatPx: bad price ${px}`)
  const maxDecimals = Math.max(0, 6 - szDecimals)
  const sig = Number(px.toPrecision(5)) // ≤ 5 significant figures
  return trimZeros(sig.toFixed(maxDecimals)) // ≤ (6 − szDecimals) decimals
}

/** Size rounded DOWN to szDecimals (never oversize a reduce-only close). */
export function formatSz(sz: number, szDecimals: number): string {
  if (!Number.isFinite(sz) || sz <= 0) throw new Error(`formatSz: bad size ${sz}`)
  const f = 10 ** szDecimals
  return trimZeros((Math.floor(sz * f) / f).toFixed(szDecimals))
}

function trimZeros(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

// ── Policy evaluation ──────────────────────────────────────────────────────

export interface GuardianVerdict {
  fired: boolean
  /** Human-readable trigger explanation — persisted verbatim on the run row. */
  reason: string
}

/**
 * Does this policy fire at the given mark? Direction is derived from
 * kind + side, so a mis-stored trigger can never fire the wrong way:
 *   stop_loss long   → fires as price FALLS (mark ≤ threshold)
 *   stop_loss short  → fires as price RISES (mark ≥ threshold)
 *   take_profit long → fires as price RISES; short as it falls.
 */
export function evaluatePolicy(p: GuardianPolicyParams, pos: GuardianPosition, markPx: number): GuardianVerdict {
  const adverse = p.kind === 'stop_loss'
  const long = p.side === 'long'
  // The price the trigger crosses.
  const threshold =
    p.triggerMode === 'price'
      ? p.triggerValue
      : long === adverse // long stop / short take-profit → below entry
        ? pos.entryPx * (1 - p.triggerValue / 100)
        : pos.entryPx * (1 + p.triggerValue / 100)
  const firesBelow = long === adverse
  const fired = firesBelow ? markPx <= threshold : markPx >= threshold
  const movePct = pos.entryPx > 0 ? ((markPx - pos.entryPx) / pos.entryPx) * 100 : 0
  return {
    fired,
    reason:
      `${p.coin} mark ${markPx} vs ${p.kind === 'stop_loss' ? 'stop' : 'target'} ${threshold.toPrecision(6)} ` +
      `(${p.triggerMode === 'price' ? `abs px ${p.triggerValue}` : `${p.triggerValue}% from entry ${pos.entryPx}`}; ` +
      `move ${movePct.toFixed(2)}%) → ${fired ? 'FIRED' : 'holding'}`,
  }
}

// ── Deterministic close build ──────────────────────────────────────────────

/** Aggressive-IOC slippage bound vs mark, in basis points. The close must
 *  fill NOW (it's protective), but never at an unbounded price. */
export const GUARDIAN_SLIPPAGE_BPS = 100

/**
 * Build the reduce-only IOC close for the guarded position. Everything is
 * derived, nothing is chosen: side opposes the live position, size is the
 * live |szi|, price is mark shaded by the slippage bound in the fill
 * direction. Throws rather than build from inconsistent inputs.
 */
export function buildGuardianClose(
  p: GuardianPolicyParams,
  pos: GuardianPosition,
  assetIndex: number,
  markPx: number,
  szDecimals: number,
): GuardianCloseAction {
  if (pos.coin !== p.coin) throw new Error(`position coin ${pos.coin} ≠ policy coin ${p.coin}`)
  if (pos.szi === 0) throw new Error('position already flat')
  const posLong = pos.szi > 0
  if ((p.side === 'long') !== posLong) throw new Error(`live position is ${posLong ? 'long' : 'short'}, policy guards ${p.side}`)
  const isBuy = !posLong // closing long = sell, closing short = buy
  const limitPx = markPx * (isBuy ? 1 + GUARDIAN_SLIPPAGE_BPS / 10_000 : 1 - GUARDIAN_SLIPPAGE_BPS / 10_000)
  return {
    orders: [
      {
        a: assetIndex,
        b: isBuy,
        p: formatPx(limitPx, szDecimals),
        s: formatSz(Math.abs(pos.szi), szDecimals),
        r: true,
        t: { limit: { tif: 'Ioc' } },
      },
    ],
    grouping: 'na',
  }
}

// ── Fail-closed guard ──────────────────────────────────────────────────────

export interface GuardianGuardContext {
  /** Delegation row status — anything but 'active' blocks. */
  delegationStatus: string
  delegationExpiresAt: Date | null
  /** The wallet's kill switch (spend_grants.paused) — an emergency freeze
   *  stops even protective closes; that's what "freeze everything" means. */
  killSwitchPaused: boolean
  /** Result of the atomic active→triggered flip; false = another tick won. */
  policyFlipWon: boolean
  markPx: number
  assetIndex: number
  szDecimals: number
}

/**
 * The gate between "the loop wants to close" and "an order is signed".
 * Independent of the builder: it re-checks the finished action against the
 * policy, the LIVE position, and the delegation — the same fail-closed
 * posture as guardUniswapV4Build / the cross-chain transfer guard.
 */
export function guardGuardianClose(
  p: GuardianPolicyParams,
  pos: GuardianPosition,
  action: GuardianCloseAction,
  ctx: GuardianGuardContext,
): GuardrailReport {
  const checks: GuardrailCheck[] = []
  const block = (id: string, ok: boolean, okNote: string, badNote: string) =>
    checks.push({ id, level: 'block', ok, note: ok ? okNote : badNote })

  block(
    'delegation',
    ctx.delegationStatus === 'active' && (!ctx.delegationExpiresAt || ctx.delegationExpiresAt > new Date()),
    'Delegation active and unexpired.',
    `Delegation ${ctx.delegationStatus}${ctx.delegationExpiresAt && ctx.delegationExpiresAt <= new Date() ? ' (expired)' : ''} — refusing to act.`,
  )
  block('kill-switch', !ctx.killSwitchPaused, 'Kill switch clear.', 'Account is FROZEN (kill switch) — guardian stands down.')
  block('single-fire', ctx.policyFlipWon, 'This tick owns the trigger.', 'Another tick already claimed this trigger — refusing a double fire.')

  const order = action.orders.length === 1 ? action.orders[0] : null
  block('shape', !!order && action.grouping === 'na', 'One order, standard grouping.', `Expected exactly 1 order/grouping na, got ${action.orders.length}/${action.grouping}.`)

  if (order) {
    block('reduce-only', order.r === true && !!order.t.limit && order.t.limit.tif === 'Ioc', 'Reduce-only IOC — can only shrink the position.', 'NOT a reduce-only IOC order — the guardian never opens or rests exposure.')
    block('asset-pinned', order.a === ctx.assetIndex, `Asset pinned to ${p.coin} (index ${ctx.assetIndex}).`, `Order asset ${order.a} ≠ ${p.coin}'s index ${ctx.assetIndex}.`)
    const posLong = pos.szi > 0
    block('side-opposes', order.b === !posLong, `Closes the ${posLong ? 'long' : 'short'} (${order.b ? 'buy' : 'sell'}).`, 'Order does NOT oppose the guarded position — that would grow it.')
    const sz = Number(order.s)
    block('size-bounded', sz > 0 && sz <= Math.abs(pos.szi) + 1e-12, `Size ${order.s} ≤ live position ${Math.abs(pos.szi)}.`, `Size ${order.s} exceeds the live position ${Math.abs(pos.szi)}.`)
    const px = Number(order.p)
    const bound = (GUARDIAN_SLIPPAGE_BPS + 10) / 10_000 // +10bps rounding headroom
    const within = px > 0 && Math.abs(px - ctx.markPx) / ctx.markPx <= bound
    block('price-bounded', within, `Limit ${order.p} within ${GUARDIAN_SLIPPAGE_BPS}bps of mark ${ctx.markPx}.`, `Limit ${order.p} strays >${GUARDIAN_SLIPPAGE_BPS}bps from mark ${ctx.markPx}.`)
  }

  const verdict = evaluatePolicy(p, pos, ctx.markPx)
  block('condition-live', verdict.fired, verdict.reason, `Trigger no longer true at build time: ${verdict.reason}`)

  // Notional being closed — the money-moved value of this protective action.
  const valueUsd = order ? Number((Math.min(Number(order.s), Math.abs(pos.szi)) * ctx.markPx).toFixed(2)) : null
  return buildReport(valueUsd, checks)
}

// ── approveAgent typed data (signed by the USER's wallet, in the browser) ──

/** Delegation lifetime we request via the agentName `valid_until` suffix —
 *  venue-enforced; the venue caps at 180 days. */
export const GUARDIAN_DELEGATION_DAYS = 90

export const GUARDIAN_AGENT_NAME = 'yeetful-guardian'

export interface ApproveAgentInput {
  agentAddress: string
  /** ms timestamp; doubles as the action nonce. */
  nonce: number
  /** ms timestamp the delegation expires (encoded into agentName). */
  validUntil: number
  /** Chain the signing wallet reports (wagmi chainId) — HL accepts any, it
   *  just has to match what was signed. */
  signatureChainId: number
  isTestnet: boolean
}

export function guardianAgentName(validUntil: number): string {
  return `${GUARDIAN_AGENT_NAME} valid_until ${validUntil}`
}

/** The exact EIP-712 payload the user's wallet signs, and the exact action
 *  body we then submit to /exchange with that signature. Keeping both in one
 *  builder means they can never drift. */
export function approveAgentArtifacts(input: ApproveAgentInput): {
  typedData: Eip712TypedData
  action: Record<string, unknown>
} {
  const agentName = guardianAgentName(input.validUntil)
  const hyperliquidChain = input.isTestnet ? 'Testnet' : 'Mainnet'
  const message = {
    hyperliquidChain,
    agentAddress: input.agentAddress.toLowerCase(),
    agentName,
    nonce: input.nonce,
  }
  return {
    typedData: {
      domain: {
        name: 'HyperliquidSignTransaction',
        version: '1',
        chainId: input.signatureChainId,
        verifyingContract: '0x0000000000000000000000000000000000000000',
      },
      types: {
        'HyperliquidTransaction:ApproveAgent': [
          { name: 'hyperliquidChain', type: 'string' },
          { name: 'agentAddress', type: 'address' },
          { name: 'agentName', type: 'string' },
          { name: 'nonce', type: 'uint64' },
        ],
      },
      primaryType: 'HyperliquidTransaction:ApproveAgent',
      message,
    },
    action: {
      type: 'approveAgent',
      signatureChainId: `0x${input.signatureChainId.toString(16)}`,
      ...message,
    },
  }
}

/** Split a 65-byte 0x signature into HL's {r, s, v} wire shape. */
export function splitSignature(sig: string): { r: string; s: string; v: 27 | 28 } {
  if (!/^0x[0-9a-fA-F]{130}$/.test(sig)) throw new Error('malformed signature')
  const v = parseInt(sig.slice(130, 132), 16)
  return {
    r: `0x${sig.slice(2, 66)}`,
    s: `0x${sig.slice(66, 130)}`,
    v: (v >= 27 ? v : v + 27) as 27 | 28,
  }
}
