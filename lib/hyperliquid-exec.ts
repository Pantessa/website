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
    if (open[2] && open[3]) {
      const notionalUsd = Number(open[2])
      if (Number.isFinite(notionalUsd) && notionalUsd > 0) return { kind: 'open', coin: open[3].toUpperCase(), isBuy, notionalUsd }
    } else if (open[4] && open[5]) {
      const sizeUnits = Number(open[4])
      if (Number.isFinite(sizeUnits) && sizeUnits > 0) return { kind: 'open', coin: open[5].toUpperCase(), isBuy, sizeUnits }
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
}

/**
 * Build the aggressive-IOC order for an intent against the live market.
 * Everything numeric is derived: size from units/notional (or the live
 * position on close), price from mark shaded by the slippage bound. Throws
 * on inconsistent inputs rather than guessing.
 */
export function buildHlOrderAction(intent: HlOrderIntent, snap: HlMarketSnapshot): HlWireOrderAction {
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
  }
}

// ── L1-action typed data for the USER'S wallet ─────────────────────────────

/** The EIP-712 payload a wallet signs for any HL L1 action: the phantom
 *  agent over the canonical msgpack action hash. Domain chainId 1337 is the
 *  venue's constant, not a network the wallet must be on. */
export function hlActionTypedData(action: HlWireOrderAction, nonce: number, isTestnet = false): Eip712TypedData {
  const connectionId = createL1ActionHash({ action: action as unknown as Record<string, unknown>, nonce })
  return {
    domain: { name: 'Exchange', version: '1', chainId: 1337, verifyingContract: '0x0000000000000000000000000000000000000000' },
    types: { Agent: [{ name: 'source', type: 'string' }, { name: 'connectionId', type: 'bytes32' }] },
    primaryType: 'Agent',
    message: { source: isTestnet ? 'b' : 'a', connectionId },
  }
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
      // there); we surface it rather than double-book it.
      checks.push({ id: 'margin', level: 'warn', ok: notionalUsd <= ctx.withdrawableUsd * 3, note: notionalUsd <= ctx.withdrawableUsd * 3 ? 'Comfortably within collateral at ≤3x.' : 'Large vs collateral — the venue may reject on margin.' })
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
  const [meta, mids, state] = await Promise.all([
    info.meta(),
    info.allMids(),
    wallet ? info.clearinghouseState({ user: wallet as `0x${string}` }) : Promise.resolve(null),
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
    withdrawableUsd: state ? Number(state.withdrawable) : 0,
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
  const action = buildHlOrderAction(intent, snap)
  const guard = guardHlExecBuild(intent, action, {
    markPx: snap.markPx,
    assetIndex: snap.assetIndex,
    withdrawableUsd: snap.withdrawableUsd,
    positionSzi: snap.positionSzi,
  })
  if (!guard.ok) {
    const bad = guard.checks.filter((c) => !c.ok && c.level === 'block').map((c) => c.note)
    trace({ type: 'note', level: 'warn', label: `native hl layer: ${intent.kind} refused — ${bad.join(' · ')}` })
    return { reply: `🚫 ${bad.join(' ')}`, guardrails: guard }
  }
  const nonce = Date.now()
  const typedData = hlActionTypedData(action, nonce)
  const o = action.orders[0]
  const verb = intent.kind === 'close' ? 'Close' : o.b ? 'Long' : 'Short'
  const summary = `${verb} ${o.s} ${intent.coin} on Hyperliquid — IOC at ≤${HL_EXEC_SLIPPAGE_BPS}bps from mark ${snap.markPx} (~$${guard.valueUsd})${intent.kind === 'close' ? ', reduce-only' : ''}.`
  const warns = guard.checks.filter((c) => !c.ok && c.level === 'warn').map((c) => ` ⚠️ ${c.note}`).join('')
  trace({ type: 'status', label: `native hl layer: built ${summary}` })
  return {
    reply: `🔏 ${summary}${warns}`,
    orderRequest: {
      protocol: 'hyperliquid',
      typedData,
      hl: { action, nonce, isTestnet: false, expected: { coin: intent.coin, kind: intent.kind, isBuy: o.b } },
    },
    guardrails: guard,
    buildPath: 'native-hl-exec',
  }
}
