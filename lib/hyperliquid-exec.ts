// ─────────────────────────────────────────────────────────────────────────
//  Hyperliquid execution layer — chat-side trading on HL with the USER'S OWN
//  wallet. Three intents, one discipline:
//
//    · open  ("long 0.01 eth on hyperliquid", "short $50 of btc on hl")
//    · close ("close my syrup long on hyperliquid")
//    · deposit ("deposit 20 usdc to hyperliquid") — the missing on-ramp leg
//
//  HL orders aren't EVM transactions: they're L1 actions signed as EIP-712
//  `Agent { source, connectionId }` where connectionId is the msgpack action
//  hash. The server builds the action deterministically, computes the hash
//  (via @nktkas/hyperliquid/signing — the same canonicalization the venue
//  expects), and hands the wallet ONLY the typed data. The submit relay
//  re-derives everything and re-guards before it ever reaches /exchange —
//  the signature can't be redirected onto a different action.
//
//  Deposits ARE plain EVM transfers (USDC → the official Bridge2 contract on
//  Arbitrum), so they reuse the existing SendTx artifact. The bridge address
//  is pinned from the official docs; below-minimum deposits are burned by
//  the venue, so the guard hard-refuses them.
// ─────────────────────────────────────────────────────────────────────────

import { createL1ActionHash } from '@nktkas/hyperliquid/signing'
import { encodeFunctionData, erc20Abi, parseUnits } from 'viem'
import type { Eip712TypedData } from '@/lib/eip712'
import { buildReport, type GuardrailCheck, type GuardrailReport } from '@/lib/tx-guardrails'
import { formatPx, formatSz } from '@/lib/hl-guardian'
import { HL_BUILDER_FEE_TENTH_BPS, HL_BUILDER_MAX_FEE_RATE, TREASURY_ADDRESS } from '@/lib/fees'

// ── Venue constants (verified against official docs 2026-07-13) ────────────

/** Bridge2 on Arbitrum One — mainnet USDC deposits credit the SENDING
 *  account in <1 min. https://hyperliquid.gitbook.io/hyperliquid-docs →
 *  For developers → API → Bridge2. */
export const HL_BRIDGE2_ARBITRUM = '0x2df1c51e09aecf9cacb7bc98cb1742757f163df7'
/** Deposits below this are NOT credited and are lost forever (venue rule). */
export const HL_MIN_DEPOSIT_USDC = 5
/** USDC (native) on Arbitrum One. */
export const ARBITRUM_USDC = '0xaf88d065e77c8cc2239327c5edb3a432268e5831'
export const ARBITRUM_CHAIN_ID = 42161

/** Venue-enforced minimum order notional. */
export const HL_MIN_ORDER_USD = 10
/** Aggressive-IOC slippage bound vs mark (market-style fills, bounded). */
export const HL_EXEC_SLIPPAGE_BPS = 100

export const HL_EXEC_POLICY_HOST = 'api.hyperliquid.xyz'

// ── Intent parsing ──────────────────────────────────────────────────────────

export interface HlOrderIntent {
  kind: 'open' | 'close'
  coin: string
  /** open only: buy = long, sell = short. close derives side from the live position. */
  isBuy?: boolean
  /** Exactly one of the two on open; close defaults to the full position. */
  sizeUnits?: number
  notionalUsd?: number
  /** open only: explicit leverage from the ask ("2x long …", "with 3x
   *  leverage"). The build sets it venue-side (cross mode) with a guarded
   *  updateLeverage signature BEFORE the order — never silently ignored:
   *  an ask that names leverage either sets it or refuses. */
  leverage?: number
}

export interface HlDepositIntent {
  kind: 'deposit'
  amountUsdc: number
}

export type HlIntent = HlOrderIntent | HlDepositIntent

const VENUE = String.raw`(?:on\s+)?(?:hyperliquid|hl)\b`
// Filler tolerance (the aave-parse lesson): let "please", "for me", "now",
// "a", "my" pepper the phrase without breaking the match.
const FILLER = String.raw`(?:\s+(?:please|for me|now|right away))*`

/**
 * Parse an HL execution ask. Deliberately DEMANDS the venue word — "long eth"
 * alone is ambiguous with spot swaps and belongs to the router; "long eth on
 * hyperliquid" is unambiguous and ours. Returns null when it isn't an HL
 * execution ask (fall through to normal routing).
 */
export function parseHlIntent(message: string): HlIntent | null {
  const m = message.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!new RegExp(VENUE).test(m)) return null

  // deposit 20 usdc to hyperliquid / deposit $20 into hl
  const dep = m.match(new RegExp(String.raw`\bdeposit\s+\$?([\d.]+)\s*(?:usdc?|dollars?)?\s+(?:in|in ?to|to|on)\s+(?:hyperliquid|hl)\b`))
  if (dep) {
    const amountUsdc = Number(dep[1])
    if (Number.isFinite(amountUsdc) && amountUsdc > 0) return { kind: 'deposit', amountUsdc }
  }

  // close my syrup long on hyperliquid / exit my eth position on hl
  const close = m.match(new RegExp(String.raw`\b(?:close|exit)${FILLER}(?:\s+my)?\s+([a-z0-9]{2,10})\s*(?:long|short|position|perp)?\s*${VENUE}`))
  if (close && !['the', 'all', 'every'].includes(close[1])) {
    return { kind: 'close', coin: close[1].toUpperCase() }
  }

  // long 0.01 eth on hyperliquid / short $50 of btc on hl / buy 10 syrup perp on hyperliquid
  const open = m.match(
    new RegExp(
      String.raw`\b(long|short|buy|sell)${FILLER}\s+(?:\$([\d.]+)(?:\s+(?:of|worth of))?\s+([a-z0-9]{2,10})|([\d.]+)\s+([a-z0-9]{2,10}))\s*(?:perp)?\s*${VENUE}`,
    ),
  )
  if (open) {
    const isBuy = open[1] === 'long' || open[1] === 'buy'
    // Leverage rides in two spots: leading "2x long …" (the landing ask —
    // "I want a 2X Long $12 of HYPE…") or trailing "with/at 3x (leverage)".
    // Decimals are CAPTURED here so the guard can refuse them by name —
    // dropping "2.5x" silently would trade at the account's setting instead.
    const lev =
      m.match(/\b(\d{1,3}(?:\.\d+)?)\s*x\s+(?:long|short|buy|sell)\b/) ??
      m.match(/\b(?:with|at|using)\s+(\d{1,3}(?:\.\d+)?)\s*x(?:\s+(?:leverage|margin))?\b/)
    const leverage = lev ? Number(lev[1]) : undefined
    const withLev = leverage && Number.isFinite(leverage) && leverage > 0 ? { leverage } : {}
    if (open[2] && open[3]) {
      const notionalUsd = Number(open[2])
      if (Number.isFinite(notionalUsd) && notionalUsd > 0) return { kind: 'open', coin: open[3].toUpperCase(), isBuy, notionalUsd, ...withLev }
    } else if (open[4] && open[5]) {
      const sizeUnits = Number(open[4])
      if (Number.isFinite(sizeUnits) && sizeUnits > 0) return { kind: 'open', coin: open[5].toUpperCase(), isBuy, sizeUnits, ...withLev }
    }
  }
  return null
}

// ── Order action build (deterministic) ──────────────────────────────────────

export interface HlMarketSnapshot {
  assetIndex: number
  szDecimals: number
  markPx: number
  /** Live signed position size for the coin (0 = flat) — close needs it. */
  positionSzi: number
  /** Venue cap for the asset — the leverage guard's upper bound. */
  maxLeverage: number
  /** The account's CURRENT venue-side leverage setting for this asset
   *  (null = no wallet or the read failed — fail-soft: we then always
   *  offer the updateLeverage step rather than guessing it's already set). */
  accountLeverage: { type: 'cross' | 'isolated'; value: number } | null
  /** The builder-fee cap this wallet has ALREADY approved for our treasury,
   *  in tenths of a bp (null = no wallet / read failed / fee disabled —
   *  fail-soft: the turn then offers the one-time approval signature rather
   *  than guessing). */
  approvedBuilderFeeTenthBps: number | null
}

export interface HlWireOrderAction {
  type: 'order'
  orders: {
    a: number
    b: boolean
    p: string
    s: string
    r: boolean
    t: { limit: { tif: 'Ioc' } }
  }[]
  grouping: 'na'
  /** Venue-native builder fee: b = the fee recipient (OUR treasury, guarded),
   *  f = the fee in tenths of a bp (venue perp cap 100 = 0.1%). Absent when
   *  the fee is env-disabled. */
  builder?: { b: string; f: number }
}

/** The venue's updateLeverage L1 action — signed exactly like an order
 *  (phantom agent over the msgpack action hash). */
export interface HlWireLeverageAction {
  type: 'updateLeverage'
  asset: number
  isCross: boolean
  leverage: number
}

export type HlWireAction = HlWireOrderAction | HlWireLeverageAction

/**
 * Build the venue-side leverage update an explicit-leverage ask needs before
 * its order. Cross mode — the venue default and what "2x long" means without
 * further qualification. Numbers come from the intent + live meta only.
 */
export function buildHlLeverageAction(intent: HlOrderIntent, snap: HlMarketSnapshot): HlWireLeverageAction {
  if (intent.kind !== 'open' || !intent.leverage) throw new Error('leverage action needs an open intent with explicit leverage')
  return { type: 'updateLeverage', asset: snap.assetIndex, isCross: true, leverage: intent.leverage }
}

/** Guard the leverage update (fail closed; runs at BUILD and again at
 *  SUBMIT). Not money moved — valueUsd 0 — but every field is pinned:
 *  the signature must not be redirectable onto a different asset, mode,
 *  or multiple. */
export function guardHlLeverageBuild(
  intent: HlOrderIntent,
  action: HlWireLeverageAction,
  ctx: { assetIndex: number; maxLeverage: number },
): GuardrailReport {
  const checks: GuardrailCheck[] = []
  const block = (id: string, ok: boolean, okNote: string, badNote: string) =>
    checks.push({ id, level: 'block', ok, note: ok ? okNote : badNote })
  block('lev-shape', action.type === 'updateLeverage', 'Leverage update only — no order rides in this signature.', 'Malformed leverage action — refusing.')
  block('lev-asset-pinned', action.asset === ctx.assetIndex, `Asset pinned to ${intent.coin} (index ${ctx.assetIndex}).`, `Leverage asset ${action.asset} ≠ ${intent.coin}'s live index ${ctx.assetIndex}.`)
  block('lev-cross', action.isCross === true, 'Cross margin — the venue default mode.', 'Only cross-margin leverage is built here.')
  block(
    'lev-integer',
    Number.isInteger(action.leverage),
    `${action.leverage}x is a whole number.`,
    `Hyperliquid only takes whole-number leverage — ${action.leverage}x isn't settable. Ask with a whole number (e.g. ${Math.max(1, Math.round(action.leverage))}x).`,
  )
  block(
    'lev-bounds',
    action.leverage >= 1 && action.leverage <= ctx.maxLeverage,
    `${action.leverage}x within ${intent.coin}'s 1–${ctx.maxLeverage}x venue range.`,
    `${intent.coin} allows 1–${ctx.maxLeverage}x — ${action.leverage}x is outside the venue's range.`,
  )
  block('lev-as-asked', action.leverage === intent.leverage, `Sets the ${intent.leverage}x you asked for.`, 'Leverage differs from the ask.')
  return buildReport(0, checks)
}

/**
 * Build the aggressive-IOC order for an intent against the live market.
 * Everything numeric is derived: size from units/notional (or the live
 * position on close), price from mark shaded by the slippage bound. Throws
 * on inconsistent inputs rather than guessing.
 */
/** The venue's builder floor: an account must hold at least this much HL
 *  perps account value to RECEIVE builder fees — below it the venue rejects
 *  the user's fee-cap approval ("Builder has insufficient balance to be
 *  approved") and every perp build used to WALL there (live 2026-08-04→11,
 *  treasury at $0.00: the flagship YeetCall ask was dead in prod). */
export const HL_BUILDER_MIN_ACCOUNT_USD = 100

/** Pure eligibility rule — split out so the self-heal decision is pinnable. */
export function builderEligibleFromAccountValue(accountValueUsd: number): boolean {
  return Number.isFinite(accountValueUsd) && accountValueUsd >= HL_BUILDER_MIN_ACCOUNT_USD
}

// ~60s cache per network: the probe runs on EVERY perp build; the treasury's
// account value doesn't move fast, and a stale "eligible" at worst re-walls
// one build a minute after a withdrawal.
const builderEligibleCache = new Map<string, { at: number; eligible: boolean }>()

/**
 * Can OUR treasury actually receive builder fees right now? (Q2 self-heal,
 * HANDOFF-gtm-bulletproof §1.2.) THROWS on probe failure — the caller keeps
 * the fee (and therefore the wall) only when the probe itself errors:
 * fail-closed on ambiguity, fee-free on a confirmed-ineligible builder, fee
 * resumes automatically once the account is funded.
 */
export async function builderFeeEligible(isTestnet = false): Promise<boolean> {
  const key = isTestnet ? 'testnet' : 'mainnet'
  const hit = builderEligibleCache.get(key)
  if (hit && Date.now() - hit.at < 60_000) return hit.eligible
  const { InfoClient, HttpTransport } = await import('@nktkas/hyperliquid')
  const info = new InfoClient({ transport: new HttpTransport({ isTestnet }) })
  const state = await info.clearinghouseState({ user: TREASURY_ADDRESS.toLowerCase() as `0x${string}` })
  const eligible = builderEligibleFromAccountValue(Number(state.marginSummary.accountValue))
  builderEligibleCache.set(key, { at: Date.now(), eligible })
  return eligible
}

export function buildHlOrderAction(
  intent: HlOrderIntent,
  snap: HlMarketSnapshot,
  /** builderFee: the build-time self-heal decision. Default = the env config
   *  (back-compat for every existing caller); pass false when the treasury
   *  is verifiably below the venue's builder floor. */
  opts?: { builderFee?: boolean },
): HlWireOrderAction {
  let isBuy: boolean
  let sizeUnits: number
  let reduceOnly: boolean
  if (intent.kind === 'close') {
    if (snap.positionSzi === 0) throw new Error(`no open ${intent.coin} position to close`)
    isBuy = snap.positionSzi < 0
    sizeUnits = Math.abs(snap.positionSzi)
    reduceOnly = true
  } else {
    if (intent.isBuy === undefined) throw new Error('open intent missing side')
    isBuy = intent.isBuy
    sizeUnits = intent.sizeUnits ?? (intent.notionalUsd ? intent.notionalUsd / snap.markPx : 0)
    reduceOnly = false
  }
  if (!(sizeUnits > 0)) throw new Error('order size resolves to zero')
  const limitPx = snap.markPx * (isBuy ? 1 + HL_EXEC_SLIPPAGE_BPS / 10_000 : 1 - HL_EXEC_SLIPPAGE_BPS / 10_000)
  return {
    type: 'order',
    orders: [
      {
        a: snap.assetIndex,
        b: isBuy,
        p: formatPx(limitPx, snap.szDecimals),
        s: formatSz(sizeUnits, snap.szDecimals),
        r: reduceOnly,
        t: { limit: { tif: 'Ioc' } },
      },
    ],
    grouping: 'na',
    // The venue-native interface fee (HANDOFF-yeetcall-gtm): rides inside the
    // signed action, so the guard pins recipient AND rate — the signature
    // cannot be redirected onto someone else's fee.
    ...((opts?.builderFee ?? HL_BUILDER_FEE_TENTH_BPS > 0) && HL_BUILDER_FEE_TENTH_BPS > 0
      ? { builder: { b: TREASURY_ADDRESS.toLowerCase(), f: HL_BUILDER_FEE_TENTH_BPS } }
      : {}),
  }
}

// ── L1-action typed data for the USER'S wallet ─────────────────────────────

/** The EIP-712 payload a wallet signs for any HL L1 action: the phantom
 *  agent over the canonical msgpack action hash. Domain chainId 1337 is the
 *  venue's constant, not a network the wallet must be on. */
export function hlActionTypedData(action: HlWireAction, nonce: number, isTestnet = false): Eip712TypedData {
  const connectionId = createL1ActionHash({ action: action as unknown as Record<string, unknown>, nonce })
  return {
    domain: { name: 'Exchange', version: '1', chainId: 1337, verifyingContract: '0x0000000000000000000000000000000000000000' },
    types: { Agent: [{ name: 'source', type: 'string' }, { name: 'connectionId', type: 'bytes32' }] },
    primaryType: 'Agent',
    message: { source: isTestnet ? 'b' : 'a', connectionId },
  }
}

// ── Wallet-agnostic execution: delegated signing + per-action consent ──────
// The venue's chainId-1337 phantom-agent domain is exactly what MetaMask
// (and any wallet enforcing EIP-712 domain hygiene) REFUSES to sign: the
// wallet is never "on" chain 1337, so eth_signTypedData_v4 fails before a
// popup ever opens — `Provided chainId "1337" must match the active chainId
// "4663"`. Found live 2026-08-17 on the flagship "Close SYRUP" chip: every
// user-signed HL order/leverage/close was unsignable from MetaMask, on any
// chain, forever. The venue's own answer (its "Enable trading" step) is an
// approved AGENT key that signs L1 actions on the user's behalf; ours is
// the guardian's delegation, reused — one agent per wallet, venue-capped to
// trade-only, never withdraw. The user's per-action say-so becomes a
// personal_sign CONSENT over the action's own hash: chain-agnostic in every
// wallet, recovered server-side, and only then does the agent key sign the
// SAME bytes. One signature per action, same as before; a wallet that can
// sign 1337 directly still may.

export interface HlConsentInput {
  from: string
  action: HlWireAction
  nonce: number
  isTestnet: boolean
  expected: { coin: string; kind?: string; isBuy?: boolean; leverage?: number }
}

export const HL_CONSENT_HEADER = 'Pantessa · Hyperliquid'

/** One human line for the consent text, derived from the ACTION (the
 *  numbers the venue will see) plus the caller's expected coin/kind — both
 *  are re-guarded server-side, so a lie in either dies before the venue. */
export function hlActionSummary(action: HlWireAction, expected: HlConsentInput['expected']): string {
  const coin = expected.coin.toUpperCase()
  if (action.type === 'updateLeverage') {
    return `set ${action.leverage}x ${action.isCross ? 'cross' : 'isolated'} leverage on ${coin}`
  }
  const o = action.orders[0]
  if (!o) return `${expected.kind ?? 'order'} ${coin}`
  const verb = expected.kind === 'close' ? 'close' : o.b ? 'buy (long)' : 'sell (short)'
  const tail = o.r ? ', reduce-only' : ''
  return `${verb} ${o.s} ${coin} @ ≤${o.p} IOC${tail}`
}

/**
 * The exact personal_sign text the wallet shows. Line-keyed so a human can
 * read it and a server can re-derive it byte-for-byte from the action: the
 * `Hash` line is the venue's own L1 action hash over (action, nonce), so the
 * consent binds these bytes and no others.
 */
export function hlConsentMessage(input: HlConsentInput): string {
  const connectionId = createL1ActionHash({ action: input.action as unknown as Record<string, unknown>, nonce: input.nonce })
  return [
    HL_CONSENT_HEADER,
    `Action: ${hlActionSummary(input.action, input.expected)}`,
    `Wallet: ${input.from.toLowerCase()}`,
    `Network: ${input.isTestnet ? 'Testnet' : 'Mainnet'}`,
    `Nonce: ${input.nonce}`,
    `Hash: ${connectionId}`,
    'Signing lets the Pantessa agent you approved submit exactly this action — nothing else, and it can never withdraw.',
  ].join('\n')
}

/** The wallet said "wrong chain for this typed data" — MetaMask's wording
 *  (`Provided chainId "1337" must match the active chainId "4663"`) plus the
 *  generic shapes other wallets use. NOT a user rejection. */
export function isChainMismatchSignError(message: string): boolean {
  return /must match the active chainId|chain ?id.*(?:mismatch|does not match|doesn't match)|(?:mismatch|does not match).*chain ?id/i.test(message)
}

export function isUserRejectedSignError(message: string): boolean {
  return /rejected|denied|declined|cancell?ed/i.test(message)
}

export type HlSignPath = 'direct' | 'delegated'
export type HlSignFailure = 'declined' | 'switch-to-delegated' | 'error'

/**
 * Pure decision after a DIRECT typed-data sign attempt failed: a wallet that
 * enforces domain.chainId (MetaMask) gets the delegated path — silently, in
 * the same gesture, since its refusal never opened a popup; a human "no"
 * stays a "no"; anything else is an error to show.
 */
export function classifyHlSignFailure(message: string): HlSignFailure {
  if (isUserRejectedSignError(message)) return 'declined'
  if (isChainMismatchSignError(message)) return 'switch-to-delegated'
  return 'error'
}

// ── Builder-fee approval (one-time, user-signed) ────────────────────────────
// Unlike orders (phantom-agent over the msgpack hash), approveBuilderFee is a
// USER-SIGNED action: EIP-712 under the HyperliquidSignTransaction domain
// whose chainId must equal the action's signatureChainId — so the CLIENT
// builds it (it knows the wallet's chain) with this pure builder, and the
// relay re-derives the same payload FROM the action to recover the signer.
// Same never-drift discipline as the guardian's approveAgentArtifacts.

export interface HlWireApproveBuilderFeeAction {
  type: 'approveBuilderFee'
  signatureChainId: string
  hyperliquidChain: 'Mainnet' | 'Testnet'
  maxFeeRate: string
  builder: string
  nonce: number
}

/** Typed data derived from the ACTION alone — the relay's recovery source.
 *  (The uint64 nonce must be signed as a BigInt; viem serializes it back to
 *  the same bytes the venue hashes.) */
export function hlApproveBuilderFeeTypedData(action: HlWireApproveBuilderFeeAction): Eip712TypedData {
  return {
    domain: {
      name: 'HyperliquidSignTransaction',
      version: '1',
      chainId: parseInt(action.signatureChainId, 16),
      verifyingContract: '0x0000000000000000000000000000000000000000',
    },
    types: {
      'HyperliquidTransaction:ApproveBuilderFee': [
        { name: 'hyperliquidChain', type: 'string' },
        { name: 'maxFeeRate', type: 'string' },
        { name: 'builder', type: 'address' },
        { name: 'nonce', type: 'uint64' },
      ],
    },
    primaryType: 'HyperliquidTransaction:ApproveBuilderFee',
    message: {
      hyperliquidChain: action.hyperliquidChain,
      maxFeeRate: action.maxFeeRate,
      builder: action.builder,
      nonce: action.nonce,
    },
  }
}

/** The exact approval the client signs: OUR treasury at OUR rate, nothing
 *  configurable from the outside but the wallet's chain. */
export function approveBuilderFeeArtifacts(input: { nonce: number; signatureChainId: number; isTestnet: boolean }): {
  action: HlWireApproveBuilderFeeAction
  typedData: Eip712TypedData
} {
  const action: HlWireApproveBuilderFeeAction = {
    type: 'approveBuilderFee',
    signatureChainId: `0x${input.signatureChainId.toString(16)}`,
    hyperliquidChain: input.isTestnet ? 'Testnet' : 'Mainnet',
    maxFeeRate: HL_BUILDER_MAX_FEE_RATE,
    builder: TREASURY_ADDRESS.toLowerCase(),
    nonce: input.nonce,
  }
  return { action, typedData: hlApproveBuilderFeeTypedData(action) }
}

/** Relay-side guard for a submitted approval (fail closed): the signature
 *  must cap fees for OUR treasury at EXACTLY our configured rate — a looser
 *  cap or a foreign recipient never reaches the venue. */
export function guardHlBuilderFeeApproval(action: HlWireApproveBuilderFeeAction, isTestnet: boolean): GuardrailReport {
  const checks: GuardrailCheck[] = []
  const block = (id: string, ok: boolean, okNote: string, badNote: string) =>
    checks.push({ id, level: 'block', ok, note: ok ? okNote : badNote })
  block('fee-shape', action.type === 'approveBuilderFee', 'Builder-fee approval only — no order rides in this signature.', 'Malformed approval action — refusing.')
  block('fee-enabled', HL_BUILDER_FEE_TENTH_BPS > 0, 'Builder fee is enabled.', 'Builder fee is disabled — nothing to approve.')
  block(
    'fee-recipient',
    action.builder?.toLowerCase() === TREASURY_ADDRESS.toLowerCase(),
    'Fee recipient pinned to the Pantessa treasury.',
    'Approval names a different fee recipient — refusing.',
  )
  block(
    'fee-rate',
    action.maxFeeRate === HL_BUILDER_MAX_FEE_RATE,
    `Caps the fee at ${HL_BUILDER_MAX_FEE_RATE} — exactly what orders carry, within the venue's 0.1% perp cap.`,
    `Approval rate ${action.maxFeeRate} ≠ the configured ${HL_BUILDER_MAX_FEE_RATE} — refusing.`,
  )
  block(
    'fee-network',
    action.hyperliquidChain === (isTestnet ? 'Testnet' : 'Mainnet'),
    `${action.hyperliquidChain} approval matches the venue network.`,
    'Approval network does not match the venue — refusing.',
  )
  return buildReport(0, checks)
}

// ── Guard (fail closed; runs at BUILD and again at SUBMIT) ──────────────────

export interface HlExecGuardContext {
  markPx: number
  assetIndex: number
  /** Perp account withdrawable USD — 0/absent blocks opens (no collateral). */
  withdrawableUsd: number
  positionSzi: number
}

export function guardHlExecBuild(intent: HlOrderIntent, action: HlWireOrderAction, ctx: HlExecGuardContext): GuardrailReport {
  const checks: GuardrailCheck[] = []
  const block = (id: string, ok: boolean, okNote: string, badNote: string) =>
    checks.push({ id, level: 'block', ok, note: ok ? okNote : badNote })

  const order = action.orders.length === 1 ? action.orders[0] : null
  block('shape', !!order && action.type === 'order' && action.grouping === 'na', 'One order, standard grouping.', 'Malformed action — refusing.')
  let notionalUsd: number | null = null
  if (order) {
    block('asset-pinned', order.a === ctx.assetIndex, `Asset pinned to ${intent.coin} (index ${ctx.assetIndex}).`, `Order asset ${order.a} ≠ ${intent.coin}'s live index ${ctx.assetIndex}.`)
    block('ioc-only', order.t.limit?.tif === 'Ioc', 'Immediate-or-cancel — nothing rests.', 'Only IOC orders are built here.')
    // Builder fee pinned to a two-shape family: when configured the action
    // carries EITHER exactly OUR recipient at exactly OUR rate (≤ the venue's
    // 0.1% perp cap) OR no builder field at all — the Q2 self-heal builds
    // fee-free while the treasury sits under the venue's builder floor, and
    // an omitted fee costs us revenue, never the user (a stripped field also
    // breaks the phantom-agent signature, so this loosens nothing at the
    // venue). A FOREIGN address or an off rate is never ours — refuse. When
    // env-disabled no builder field may ride at all.
    const ourFee =
      action.builder?.b?.toLowerCase() === TREASURY_ADDRESS.toLowerCase() &&
      action.builder.f === HL_BUILDER_FEE_TENTH_BPS &&
      action.builder.f <= 100
    const feeOk = HL_BUILDER_FEE_TENTH_BPS > 0 ? ourFee || action.builder === undefined : action.builder === undefined
    block(
      'builder-fee',
      feeOk,
      HL_BUILDER_FEE_TENTH_BPS > 0
        ? action.builder
          ? `${HL_BUILDER_MAX_FEE_RATE} builder fee to the Pantessa treasury — venue-enforced on the fill; it funds creator kickbacks.`
          : 'Builder fee omitted this build — the treasury is below the venue\'s builder floor, so the order runs fee-free until it is funded.'
        : 'No builder fee configured — none rides the order.',
      'Order carries an unexpected builder fee (wrong recipient or rate) — refusing.',
    )
    const px = Number(order.p)
    const bound = (HL_EXEC_SLIPPAGE_BPS + 10) / 10_000
    block('price-bounded', px > 0 && Math.abs(px - ctx.markPx) / ctx.markPx <= bound, `Limit ${order.p} within ${HL_EXEC_SLIPPAGE_BPS}bps of mark ${ctx.markPx}.`, `Limit ${order.p} strays >${HL_EXEC_SLIPPAGE_BPS}bps from mark ${ctx.markPx}.`)
    const sz = Number(order.s)
    notionalUsd = Number((sz * ctx.markPx).toFixed(2))
    block('min-notional', notionalUsd >= HL_MIN_ORDER_USD, `~$${notionalUsd} notional (venue min $${HL_MIN_ORDER_USD}).`, `~$${notionalUsd} is under the venue's $${HL_MIN_ORDER_USD} minimum — it would be rejected.`)
    if (intent.kind === 'close') {
      block('reduce-only', order.r === true, 'Reduce-only — can only shrink the position.', 'Close builds must be reduce-only.')
      block('side-opposes', ctx.positionSzi !== 0 && order.b === ctx.positionSzi < 0, 'Order opposes the open position.', 'Order does not oppose the open position.')
      block('size-bounded', sz > 0 && sz <= Math.abs(ctx.positionSzi) + 1e-12, `Size ${order.s} ≤ position ${Math.abs(ctx.positionSzi)}.`, `Size ${order.s} exceeds the position ${Math.abs(ctx.positionSzi)}.`)
    } else {
      const sideWord = intent.isBuy ? 'long' : 'short'
      block('side-as-asked', order.b === intent.isBuy, `Opens the ${sideWord} you asked for.`, 'Order side differs from the ask.')
      block('has-collateral', ctx.withdrawableUsd > 0, `$${ctx.withdrawableUsd.toFixed(2)} withdrawable on the account.`, 'No withdrawable collateral on the Hyperliquid account — deposit first ("deposit 10 usdc to hyperliquid").')
      // Margin sufficiency is the venue's final call (leverage settings live
      // there); we surface it rather than double-book it. Explicit leverage
      // tightens the yardstick to the multiple being SET.
      const effLev = intent.leverage ?? 3
      const marginOk = notionalUsd <= ctx.withdrawableUsd * effLev
      checks.push({ id: 'margin', level: 'warn', ok: marginOk, note: marginOk ? `Comfortably within collateral at ≤${effLev}x.` : 'Large vs collateral — the venue may reject on margin.' })
    }
  }
  return buildReport(notionalUsd, checks)
}

// ── Deposit build (plain EVM transfer → existing SendTx artifact) ──────────

export interface HlDepositBuild {
  tx: { to: string; data: string; value: string; chainId: number }
  summary: string
  guardrails: GuardrailReport
}

export function buildHlDeposit(intent: HlDepositIntent, walletUsdcArbitrum: number): HlDepositBuild {
  const checks: GuardrailCheck[] = []
  const ok = (id: string, o: boolean, okNote: string, badNote: string) => checks.push({ id, level: 'block', ok: o, note: o ? okNote : badNote })
  ok(
    'min-deposit',
    intent.amountUsdc >= HL_MIN_DEPOSIT_USDC,
    `${intent.amountUsdc} USDC ≥ the ${HL_MIN_DEPOSIT_USDC} USDC bridge minimum.`,
    `Deposits under ${HL_MIN_DEPOSIT_USDC} USDC are NOT credited by the bridge and are lost — refusing.`,
  )
  ok('balance', walletUsdcArbitrum >= intent.amountUsdc, `Wallet holds ${walletUsdcArbitrum} USDC on Arbitrum.`, `Wallet holds only ${walletUsdcArbitrum} USDC on Arbitrum — bridge funds there first (cross-chain swap).`)
  // The bridge credits the SENDING address on Hyperliquid — recipient checks
  // out by construction; the pinned contract is the verified Bridge2.
  checks.push({ id: 'recipient', level: 'block', ok: true, note: 'Bridge2 credits the sending wallet on Hyperliquid (address pinned from official docs).' })
  const atoms = parseUnits(intent.amountUsdc.toFixed(6), 6)
  return {
    tx: {
      to: ARBITRUM_USDC,
      data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [HL_BRIDGE2_ARBITRUM, atoms] }),
      value: '0',
      chainId: ARBITRUM_CHAIN_ID,
    },
    summary: `Deposit ${intent.amountUsdc} USDC to Hyperliquid (USDC transfer to Bridge2 on Arbitrum; credited to your HL account in <1 min).`,
    guardrails: buildReport(intent.amountUsdc, checks),
  }
}

// ── Working-set detection + the chat turn builder ───────────────────────────

/** The Hyperliquid agent in the user's working set, mirroring
 *  crossChainAgentOf: `agent` = the row (or null), `usable` = it has a
 *  callable endpoint (an add-MCP shell row parses but can't be called). */
export function hlAgentOf<T extends { slug: string; name: string; endpoint?: string | null }>(
  servers: T[],
): { agent: T | null; usable: boolean } {
  const agent = servers.find((s) => s.slug === 'hyperliquid-free' || /hyperliquid/i.test(s.name)) ?? null
  return { agent, usable: !!agent?.endpoint }
}

/** Live market + account snapshot for one coin/wallet (meta + mids +
 *  clearinghouse in two round-trips). Throws on unknown coin. */
export async function fetchHlSnapshot(coin: string, wallet: string | undefined, isTestnet = false): Promise<HlMarketSnapshot & { withdrawableUsd: number }> {
  const { InfoClient, HttpTransport } = await import('@nktkas/hyperliquid')
  const info = new InfoClient({ transport: new HttpTransport({ isTestnet }) })
  const [meta, mids, state, active, approvedFee] = await Promise.all([
    info.meta(),
    info.allMids(),
    wallet ? info.clearinghouseState({ user: wallet as `0x${string}` }) : Promise.resolve(null),
    // The account's current leverage setting for THIS asset (set even when
    // flat). Fail-soft: null just means an explicit-leverage ask always
    // offers the updateLeverage signature instead of skipping it.
    wallet ? info.activeAssetData({ user: wallet as `0x${string}`, coin }).catch(() => null) : Promise.resolve(null),
    // The builder-fee cap already approved for OUR treasury (venue unit:
    // tenths of a bp). Fail-soft null → the turn offers the approval step.
    wallet && HL_BUILDER_FEE_TENTH_BPS > 0
      ? info.maxBuilderFee({ user: wallet as `0x${string}`, builder: TREASURY_ADDRESS.toLowerCase() as `0x${string}` }).catch(() => null)
      : Promise.resolve(null),
  ])
  const assetIndex = meta.universe.findIndex((u) => u.name === coin)
  if (assetIndex < 0) throw new Error(`${coin} is not a Hyperliquid perp`)
  const markPx = mids[coin] != null ? Number(mids[coin]) : NaN
  if (!Number.isFinite(markPx)) throw new Error(`no live mark for ${coin}`)
  const pos = state?.assetPositions.find((ap) => ap.position.coin === coin)
  return {
    assetIndex,
    szDecimals: meta.universe[assetIndex].szDecimals,
    markPx,
    positionSzi: pos ? Number(pos.position.szi) : 0,
    maxLeverage: meta.universe[assetIndex].maxLeverage,
    accountLeverage: active?.leverage ? { type: active.leverage.type, value: Number(active.leverage.value) } : null,
    approvedBuilderFeeTenthBps: typeof approvedFee === 'number' && Number.isFinite(approvedFee) ? approvedFee : null,
    withdrawableUsd: state ? Number(state.withdrawable) : 0,
  }
}

/** Collateral an OPEN order should have behind it: notional over the
 *  leverage actually being set (default 3 — the historical ≈2–3x effective
 *  yardstick when the ask names none), floored at the bridge minimum —
 *  smaller deposits are lost, not credited. An explicit "2x long $12" needs
 *  $6 behind it, not $4. */
export function hlCollateralTargetUsd(notionalUsd: number, leverage = 3): number {
  return Math.max(HL_MIN_DEPOSIT_USDC, Math.ceil((notionalUsd / leverage) * 100) / 100)
}

export interface HlOpenShortfall {
  /** The deposit that makes the order buildable (≥ the bridge minimum). */
  depositUsdc: number
  withdrawableUsd: number
  notionalUsd: number
}

/**
 * "You have an intent — we do the rest": would this OPEN order build against
 * an under-collateralized account? Returns the deposit that fixes it, or
 * null when the account is funded — or when the read fails (fail-soft: the
 * build's own has-collateral guard still fails closed downstream).
 */
export async function hlOpenCollateralShortfall(intent: HlOrderIntent, wallet: string): Promise<HlOpenShortfall | null> {
  if (intent.kind !== 'open') return null
  try {
    const snap = await fetchHlSnapshot(intent.coin, wallet)
    const notionalUsd = intent.notionalUsd ?? (intent.sizeUnits ? intent.sizeUnits * snap.markPx : 0)
    if (!(notionalUsd > 0)) return null
    const lev = intent.leverage ?? 3
    const target = hlCollateralTargetUsd(notionalUsd, lev)
    if (snap.withdrawableUsd >= notionalUsd / lev) return null
    const depositUsdc = Math.max(HL_MIN_DEPOSIT_USDC, Number((target - snap.withdrawableUsd).toFixed(2)))
    return { depositUsdc, withdrawableUsd: snap.withdrawableUsd, notionalUsd: Number(notionalUsd.toFixed(2)) }
  } catch {
    return null
  }
}

/** USDC balance on Arbitrum (the deposit leg's funding check). */
export async function arbitrumUsdcBalance(wallet: string): Promise<number> {
  const { createPublicClient, http, formatUnits } = await import('viem')
  const { arbitrum } = await import('viem/chains')
  const pub = createPublicClient({ chain: arbitrum, transport: http() })
  const atoms = await pub.readContract({
    address: ARBITRUM_USDC,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [wallet as `0x${string}`],
  })
  return Number(formatUnits(atoms, 6))
}

export interface HlExecTurn {
  reply: string
  orderRequest?: Record<string, unknown>
  txRequest?: Record<string, unknown>
  guardrails?: GuardrailReport
  buildPath?: 'native-hl-exec'
}

/**
 * The whole native turn: intent → live snapshot → deterministic build →
 * guard → signable artifact (HL typed data for orders, plain SendTx for the
 * bridge deposit). Refusals explain themselves; nothing signable is offered
 * unless the guard passed.
 */
export async function buildHlExecTurn(
  intent: HlIntent,
  walletAddress: string | undefined,
  trace: (event: unknown) => void,
): Promise<HlExecTurn> {
  if (!walletAddress) {
    return { reply: '📈 Connect your wallet first — Hyperliquid orders are signed by YOUR wallet (it is your HL account).' }
  }

  if (intent.kind === 'deposit') {
    const balance = await arbitrumUsdcBalance(walletAddress).catch(() => 0)
    const built = buildHlDeposit(intent, balance)
    if (!built.guardrails.ok) {
      const bad = built.guardrails.checks.filter((c) => !c.ok && c.level === 'block').map((c) => c.note)
      trace({ type: 'note', level: 'warn', label: `native hl layer: deposit refused — ${bad.join(' · ')}` })
      return { reply: `🚫 ${bad.join(' ')}`, guardrails: built.guardrails }
    }
    trace({ type: 'status', label: `native hl layer: built deposit of ${intent.amountUsdc} USDC → Bridge2 (Arbitrum)` })
    return {
      reply: `🔏 ${built.summary}`,
      txRequest: { ...built.tx, action: 'deposit to Hyperliquid' },
      guardrails: built.guardrails,
      buildPath: 'native-hl-exec',
    }
  }

  const snap = await fetchHlSnapshot(intent.coin, walletAddress)
  // Q2 self-heal (HANDOFF-gtm-bulletproof §1.2): before attaching the
  // builder fee, ask the venue whether our treasury can actually RECEIVE it.
  // Confirmed-ineligible → build WITHOUT the fee (traced below) so the
  // flagship never walls on OUR unfunded account; the fee resumes on its own
  // once the treasury is funded. A probe ERROR keeps the fee — ambiguity
  // keeps the wall (fail-closed), never a silent revenue leak.
  let feeOn = HL_BUILDER_FEE_TENTH_BPS > 0
  if (feeOn) {
    try {
      if (!(await builderFeeEligible())) {
        feeOn = false
        trace({
          type: 'note',
          level: 'warn',
          label: `native hl layer: builder fee OMITTED — treasury HL account is below the venue's $${HL_BUILDER_MIN_ACCOUNT_USD} builder floor; the order builds fee-free and the fee resumes automatically once it is funded`,
        })
      }
    } catch {
      /* probe failed — keep the fee; the approval wall is the fail-closed state */
    }
  }
  const action = buildHlOrderAction(intent, snap, { builderFee: feeOn })
  let guard = guardHlExecBuild(intent, action, {
    markPx: snap.markPx,
    assetIndex: snap.assetIndex,
    withdrawableUsd: snap.withdrawableUsd,
    positionSzi: snap.positionSzi,
  })

  // Explicit leverage ("2x long $12 of HYPE…"): a guarded updateLeverage
  // signature rides AHEAD of the order — never silently ignored. Skipped
  // only when the account is verifiably ALREADY at that cross multiple.
  let pre: { action: HlWireLeverageAction; nonce: number; typedData: Eip712TypedData; expected: { coin: string; leverage: number } } | undefined
  let levPhrase = ''
  if (intent.kind === 'open' && intent.leverage) {
    const already = snap.accountLeverage?.type === 'cross' && snap.accountLeverage.value === intent.leverage
    if (already) {
      levPhrase = ` Account is already at ${intent.leverage}x cross on ${intent.coin} — no leverage change needed.`
    } else {
      const levAction = buildHlLeverageAction(intent, snap)
      const levGuard = guardHlLeverageBuild(intent, levAction, { assetIndex: snap.assetIndex, maxLeverage: snap.maxLeverage })
      // One merged report on the card: the leverage checks lead, the order
      // checks follow; a failure on EITHER side refuses the whole turn.
      guard = { ...guard, ok: guard.ok && levGuard.ok, checks: [...levGuard.checks, ...guard.checks] }
      if (levGuard.ok) {
        // Distinct nonce (venue nonces must be unique) strictly below the
        // order's — the leverage set is submitted first.
        const levNonce = Date.now() - 1
        pre = { action: levAction, nonce: levNonce, typedData: hlActionTypedData(levAction, levNonce), expected: { coin: intent.coin, leverage: intent.leverage } }
        levPhrase = ` Signs ${intent.leverage}x cross leverage first, then the order — two signatures, one card.`
      }
    }
  }
  if (!guard.ok) {
    const bad = guard.checks.filter((c) => !c.ok && c.level === 'block').map((c) => c.note)
    trace({ type: 'note', level: 'warn', label: `native hl layer: ${intent.kind} refused — ${bad.join(' · ')}` })
    return { reply: `🚫 ${bad.join(' ')}`, guardrails: guard }
  }
  // One-time builder-fee approval: needed when the fee is on and the wallet
  // hasn't yet capped it for our treasury (unknown reads offer it too —
  // approving an already-approved cap is harmless; skipping a needed one
  // bounces the order at the venue). The CLIENT builds the typed data (it
  // knows the wallet's chainId); we ship only the facts.
  const needsFeeApproval =
    feeOn && (snap.approvedBuilderFeeTenthBps == null || snap.approvedBuilderFeeTenthBps < HL_BUILDER_FEE_TENTH_BPS)
  const feePhrase = feeOn
    ? needsFeeApproval
      ? ` Includes the ${HL_BUILDER_MAX_FEE_RATE} builder fee — first tap approves that cap (one-time), then the order.`
      : ` Includes the ${HL_BUILDER_MAX_FEE_RATE} builder fee (cap already approved).`
    : ''
  const nonce = Date.now()
  const typedData = hlActionTypedData(action, nonce)
  const o = action.orders[0]
  const verb = intent.kind === 'close' ? 'Close' : o.b ? 'Long' : 'Short'
  const levTag = intent.kind === 'open' && intent.leverage ? ` at ${intent.leverage}x (cross)` : ''
  const summary = `${verb} ${o.s} ${intent.coin}${levTag} on Hyperliquid — IOC at ≤${HL_EXEC_SLIPPAGE_BPS}bps from mark ${snap.markPx} (~$${guard.valueUsd})${intent.kind === 'close' ? ', reduce-only' : ''}.`
  const warns = guard.checks.filter((c) => !c.ok && c.level === 'warn').map((c) => ` ⚠️ ${c.note}`).join('')
  trace({ type: 'status', label: `native hl layer: built ${summary}${pre ? ' (+ leverage pre-step)' : ''}${needsFeeApproval ? ' (+ fee-cap approval)' : ''}` })
  return {
    reply: `🔏 ${summary}${levPhrase}${feePhrase}${warns}`,
    orderRequest: {
      protocol: 'hyperliquid',
      typedData,
      hl: {
        action,
        nonce,
        isTestnet: false,
        expected: { coin: intent.coin, kind: intent.kind, isBuy: o.b },
        ...(pre ? { pre } : {}),
        ...(needsFeeApproval ? { feeApproval: { builder: TREASURY_ADDRESS.toLowerCase(), maxFeeRate: HL_BUILDER_MAX_FEE_RATE, feeTenthBps: HL_BUILDER_FEE_TENTH_BPS } } : {}),
      },
    },
    guardrails: guard,
    buildPath: 'native-hl-exec',
  }
}
