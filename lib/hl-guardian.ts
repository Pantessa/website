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
import type { ClarifyOption } from '@/lib/clarify'
import { ROBINHOOD_TICKER_NAMES, ROBINHOOD_TICKER_SET } from '@/lib/robinhood-tickers'


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

// The name the venue shows under the user's API wallets. One agent per
// wallet serves BOTH the guardian sweep and delegated chat execution
// (hyperliquid-exec: wallet-agnostic execution), so it wears the product
// name, not a feature's. Rows minted under the old name keep working.
export const GUARDIAN_AGENT_NAME = 'pantessa'

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

// ── Duplicate-policy plan ───────────────────────────────────────────────────

export type DupePolicyPlan = { action: 'resume' } | { action: 'affirm' } | { action: 'refuse'; message: string }

/** The terms a dupe comparison runs on — the existing row's vs the ask's. */
export interface DupePolicyTerms {
  triggerMode: GuardianTriggerMode
  triggerValue: number
}

const describeTrigger = (kind: GuardianPolicyKind, t: DupePolicyTerms) =>
  t.triggerMode === 'price' ? `when the mark crosses ${t.triggerValue}` : `${t.triggerValue}% ${kind === 'stop_loss' ? 'against' : 'for'} you from entry`

/**
 * What an arm ask should do when a policy of the same kind already exists on
 * the coin. A PAUSED row resumes — the ask is exactly that protection, and
 * the old blanket refusal ("already armed — pause or retire it first") was a
 * contradiction and a dead end when the row was already paused. An ACTIVE row
 * with the SAME terms affirms: the user asked for the protection they already
 * have, and "pause or remove it first" told them to dismantle it (live
 * 2026-07-30: "protect my SYRUP long with a 10% stop" against an armed 10%
 * stop logged as a wall). Only a real conflict refuses, and the refusal names
 * both sets of terms so the user can decide which one they meant.
 */
export function planForExistingPolicy(
  status: string,
  kind: GuardianPolicyKind,
  coin: string,
  existing?: DupePolicyTerms,
  asked?: DupePolicyTerms
): DupePolicyPlan {
  const label = kind === 'stop_loss' ? 'stop loss' : 'take profit'
  if (status === 'paused') return { action: 'resume' }
  if (status === 'triggered') {
    return { action: 'refuse', message: `The ${label} on ${coin} is executing right now — check the Guardian dashboard.` }
  }
  if (existing && asked && existing.triggerMode === asked.triggerMode && existing.triggerValue === asked.triggerValue) {
    return { action: 'affirm' }
  }
  if (existing && asked) {
    return {
      action: 'refuse',
      message:
        `A ${label} on ${coin} is already armed and watching — it closes ${describeTrigger(kind, existing)}. ` +
        `Pause or remove it first (Protections in the rail, or the Guardian dashboard) to re-arm ${describeTrigger(kind, asked)} instead.`,
    }
  }
  return { action: 'refuse', message: `A ${label} on ${coin} is already armed and watching — pause or remove it first.` }
}

// ── Chat-side arming parse ──────────────────────────────────────────────────

export interface GuardianArmAsk {
  coin: string
  kind: GuardianPolicyKind
  triggerMode: GuardianTriggerMode
  triggerValue: number
}

/**
 * Parse a guardian arming ask — "protect my SYRUP long with a 10% stop",
 * "stop loss on syrup at $0.12", "take profit on eth at +25%". These phrases
 * are perp-native, so no venue word is demanded; the caller still requires a
 * Hyperliquid agent in the set and validates against the LIVE position.
 * Returns null when the message isn't an arming ask.
 */
export function parseGuardianArm(message: string): GuardianArmAsk | null {
  const m = message.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!/\b(protect|stop[- ]?loss|take[- ]?profit)\b/.test(m)) return null

  const kind: GuardianPolicyKind = /take[- ]?profit/.test(m) ? 'take_profit' : 'stop_loss'
  // The trigger: "$0.12" / "at 0.12" → absolute price; "10%" / "+25%" → percent.
  const pct = m.match(/([\d.]+)\s*%/)
  const px = m.match(/(?:at|@)\s*\$?\s*([\d.]+)(?!\s*%)/)
  let triggerMode: GuardianTriggerMode
  let triggerValue: number
  if (pct) {
    triggerMode = 'price_move_pct'
    triggerValue = Number(pct[1])
  } else if (px) {
    triggerMode = 'price'
    triggerValue = Number(px[1])
  } else return null
  if (!Number.isFinite(triggerValue) || triggerValue <= 0) return null

  // The coin: "my SYRUP long", "on syrup", "protect eth". Skip stop-words and
  // the venue word itself. The venue word is STRIPPED before matching — "my
  // Hyperliquid ETH position" (the /i/stop-loss house link's phrasing) must
  // yield ETH, not a stop-worded miss (live audit 2026-07-22).
  const STOP = new Set(['my', 'the', 'a', 'an', 'on', 'at', 'with', 'stop', 'loss', 'take', 'profit', 'protect', 'position', 'long', 'short', 'perp', 'hyperliquid', 'hl', 'set', 'me', 'please', 'if', 'it', 'drops', 'falls', 'hits', 'from', 'entry', 'below', 'above'])
  const mc = m.replace(/\bhyperliquid\b|\bhl\b/g, ' ').replace(/\s+/g, ' ')
  const coinMatch =
    mc.match(/\b(?:protect|on)\s+(?:my\s+)?([a-z0-9]{2,10})\b/) ??
    mc.match(/\bmy\s+([a-z0-9]{2,10})\s+(?:long|short|position|perp)\b/)
  const coin = coinMatch && !STOP.has(coinMatch[1]) ? coinMatch[1].toUpperCase() : null
  if (!coin) return null
  return { coin, kind, triggerMode, triggerValue }
}

// ── The coin fence ──────────────────────────────────────────────────────────
//
// parseGuardianArm's coin slot is loose on purpose (the grammar itself is the
// "stray stop loss" guard), so it claimed "protect my AAPL with a 5% stop" —
// a Robinhood Chain tokenized stock (Markets squad, 2026-09-11). No guardian
// can build that: the HL Guardian watches Hyperliquid perps and the Spot
// Guardian runs on Base. The fence decides, before any layer claims the
// turn, whether the coin is a market the guardian can watch — against the
// LIVE perp universe (lib/hl-universe.ts, cached) when the caller has it,
// and against the static Robinhood ticker snapshot when it doesn't (the pure
// replica, a cold cache, a feed outage). Cold, a coin that isn't a known
// stock passes: the arm path validates against live meta and refuses there,
// so the one thing the cold fence must never do is refuse a real market.

/** The Hyperliquid perp universe as the fence reads it (lib/hl-universe.ts
 *  builds it from the venue's `meta`). Names keep the venue's casing. */
export interface HlUniverse {
  /** Every perp currently trading — 'BTC', 'HYPE', 'kPEPE'. */
  listed: ReadonlySet<string>
  /** Perps the venue has delisted — still in `meta`, no market. */
  delisted: ReadonlySet<string>
}

/** Robinhood Chain stock tickers that ALSO name a live Hyperliquid perp (a
 *  crypto coin sharing the letters; measured 2026-09-11). The cold fence
 *  never refuses these — the live universe decides. The harness pins the
 *  live intersection ⊆ this set, so a new collision fails a gate instead of
 *  the cold fence walling a real market. */
export const HL_STOCK_TICKER_COLLISIONS: ReadonlySet<string> = new Set(['CASHCAT', 'ZETA'])

export type GuardianCoinFence =
  | { ok: true; coin: string }
  | {
      ok: false
      reason: 'stock' | 'not-listed' | 'delisted'
      /** The chat reply (markdown). */
      reply: string
      /** The same refusal as one plain sentence — job segments, audit notes. */
      problem: string
      /** Heading for the chips (unused when there are none). */
      question: string
      /** Asks that work instead — each round-trips a native gate (pinned). */
      chips: ClarifyOption[]
    }

const findCi = (set: ReadonlySet<string>, coin: string): string | null => {
  if (set.has(coin)) return coin
  const up = coin.toUpperCase()
  for (const name of set) if (name.toUpperCase() === up) return name
  return null
}

function stockRefusal(t: string): GuardianCoinFence {
  const company = ROBINHOOD_TICKER_NAMES[t]
  const what = company && company !== t ? `the ${company} tokenized stock` : 'a tokenized stock'
  return {
    ok: false,
    reason: 'stock',
    reply:
      `🛡️ **${t} isn't a Hyperliquid market** — it's ${what} on Robinhood Chain. ` +
      `The Guardian only protects Hyperliquid perp positions, and the Spot Guardian runs on Base, so there's no stop I can arm on it. ` +
      `Price alerts aren't live yet; on Robinhood Chain I can chart it, set up a DCA, or sell it now.`,
    problem:
      `${t} isn't a Hyperliquid market — it's ${what} on Robinhood Chain. The Guardian only protects Hyperliquid perp positions ` +
      `and the Spot Guardian runs on Base, so there's no stop to arm on it; on Robinhood Chain a DCA or a sell can run instead.`,
    question: `What should I do with ${t} instead?`,
    chips: [
      { label: `Chart ${t}`, resume: `Show me the ${t} chart` },
      { label: `DCA $10 into ${t} weekly`, resume: `DCA $10 into ${t} weekly` },
      { label: `Sell all my ${t}`, resume: `Sell all my ${t} for USDG on Robinhood Chain` },
    ],
  }
}

function notListedRefusal(ask: GuardianArmAsk, t: string): GuardianCoinFence {
  // A stop on a token you hold on Base is the Spot Guardian's job — offer its
  // exact grammar (it refuses what it can't hold on its own). Take-profit has
  // no spot twin, and the spot grammar caps percent stops under 90.
  const spot =
    ask.kind !== 'stop_loss'
      ? null
      : ask.triggerMode === 'price'
        ? `Protect my spot ${t} if it drops to $${ask.triggerValue}`
        : ask.triggerValue < 90
          ? `Protect my spot ${t} with a ${ask.triggerValue}% stop loss`
          : null
  const lead = `${t} isn't a Hyperliquid market, so the Guardian has nothing to watch — it only protects Hyperliquid perp positions.`
  return {
    ok: false,
    reason: 'not-listed',
    reply: `🛡️ **${t} isn't a Hyperliquid market**, so the Guardian has nothing to watch — it only protects Hyperliquid perp positions.` + (spot ? ` If you hold ${t} in your wallet on Base, the Spot Guardian can protect it instead.` : ''),
    problem: lead + (spot ? ` For ${t} held on Base, the Spot Guardian can: "${spot}".` : ''),
    question: `Protect ${t} on Base instead?`,
    chips: spot ? [{ label: `Protect my spot ${t}`, resume: spot }] : [],
  }
}

function delistedRefusal(t: string): GuardianCoinFence {
  const problem = `${t} was delisted on Hyperliquid — there's no market left for the Guardian to watch.`
  return { ok: false, reason: 'delisted', reply: `🛡️ **${t} was delisted on Hyperliquid** — there's no market left for the Guardian to watch.`, problem, question: '', chips: [] }
}

/**
 * Is the arm ask's coin a market the guardian can watch? `ok` carries the
 * venue's own casing ("kpepe" → kPEPE — meta lookups are exact-name). A
 * refusal names the coin and says why, with chips that work instead. Pass
 * `universe: null` when no live read is available (see the block comment).
 */
export function fenceGuardianCoin(ask: GuardianArmAsk, universe: HlUniverse | null): GuardianCoinFence {
  const t = ask.coin.toUpperCase()
  if (universe) {
    const live = findCi(universe.listed, ask.coin)
    if (live) return { ok: true, coin: live }
    if (findCi(universe.delisted, ask.coin)) return delistedRefusal(t)
    return ROBINHOOD_TICKER_SET.has(t) ? stockRefusal(t) : notListedRefusal(ask, t)
  }
  if (ROBINHOOD_TICKER_SET.has(t) && !HL_STOCK_TICKER_COLLISIONS.has(t)) return stockRefusal(t)
  return { ok: true, coin: ask.coin }
}
