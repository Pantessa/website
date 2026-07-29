// ─────────────────────────────────────────────────────────────────────────
//  Native Morpho (Blue) transaction building — the deterministic,
//  guardrailed path from "lend 100 USDC on morpho" (and its collateral /
//  borrow / repay / withdraw siblings) to a signable step chain, with ZERO
//  confirmation round-trips. The lib/aave-supply.ts twin, adapted honestly:
//  same parse → resolve-from-the-agent's-own-tools → build_* → guard
//  recipe, but the GUARD is NOT an Aave port — Morpho calldata carries the
//  full MarketParams TUPLE, not a reserve id:
//
//    op(MarketParams{loanToken,collateralToken,oracle,irm,lltv},
//       assets, [shares,] onBehalf, [receiver|data])
//
//  The 32-byte market id the tools take NEVER appears in calldata — the
//  singleton derives it by hashing the tuple. So the guard binds through
//  the tuple: EVERY field (loanToken, collateralToken, oracle, irm, lltv)
//  must equal the market params we resolved ourselves (on-chain
//  idToMarketParams against the pinned singleton, cross-checked against the
//  agent's own market_info answer). A build that swapped ANY tuple word
//  would target a different market — a different oracle, a different IRM, a
//  different liquidation threshold — and fails CLOSED here.
//
//  Selectors + word layouts in MORPHO_OP_LAYOUT were derived from the
//  pinned Morpho Blue ABI (free-mcps/services/morpho/lib/chain.ts) by
//  encoding each builder's exact arg shape with viem and dumping the words
//  (2026-07-29); the harness re-derives them the same way. Any other shape
//  fails CLOSED. No fallback paths.
// ─────────────────────────────────────────────────────────────────────────

import { decodeFunctionData, erc20Abi, isAddress } from 'viem'
import { chainAlt } from '@/lib/chain-lexicon'
import type { TxChainStep } from '@/lib/transaction-layer'

// ── The working set's Morpho-capable agent ──────────────────────────────────
// Matched on slug/name so custom modal-added rows ("Morpho MCP · Yeetful")
// count too. Descriptions are excluded — other MCPs mention Morpho in passing
// (the robinhood MCP's Morpho-on-4663 lending is a different deployment).
export const MORPHO_MCP_RE = /\bmorpho\b/i

export interface MorphoAgentRead<T> {
  agent?: T
  /** False for an add-MCP shell row (no endpoint) — routing at it makes the
   *  planner hallucinate; the caller answers honestly instead. */
  usable: boolean
}

export function morphoAgentOf<T extends { slug: string; name: string; endpoint?: string | null }>(
  servers: T[],
): MorphoAgentRead<T> {
  const agent = servers.find((s) => MORPHO_MCP_RE.test(`${s.slug} ${s.name}`))
  return { agent, usable: !!agent?.endpoint }
}

// ── Parse ────────────────────────────────────────────────────────────────────

const AMOUNT = '\\d+(?:\\.\\d+)?'
const TOKEN = '\\$?[A-Za-z]{2,12}'
// "1 more USDC" / "5 extra DAI" — filler between amount and token (the same
// live-miss class aave-supply.ts earned on 2026-07-13).
const FILLER = '(?:(?:more|extra|additional)\\s+)?'

// Morpho's chains: Base (8453, the service default) + Ethereum (1). Anything
// else refuses BY NAME at the route site. Typo tolerance via the lexicon.
// Bare "eth" only counts as the CHAIN next to a preposition — "lend 100 USDC
// on morpho with my eth" must not silently flip the build to mainnet.
const BASE_RE = new RegExp(String.raw`\b(?:${chainAlt(['base'])})\b`, 'i')
const ETH_RE = new RegExp(String.raw`\b(?:${chainAlt(['ethereum'])}|ether[aiu]+m)\b|\b(?:on|to|from)\s+eth\b`, 'i')
const OTHER_CHAIN_RE = new RegExp(
  String.raw`\b(?:on|to|from)\s+(${chainAlt(['arbitrum', 'optimism', 'polygon', 'gnosis', 'avalanche', 'bnb', 'scroll', 'solana', 'robinhood'])}|arb|sol)\b`,
  'i',
)

// A different venue named explicitly → not a Morpho ask, fall through.
// `aave` is on this list; lib/aave-supply.ts's OTHER_VENUE_RE and
// COMPETING_VENUE_RE both already list `morpho` (verified 2026-07-29), so
// the two gates are mutually exclusive on venue-worded asks.
const OTHER_VENUE_RE =
  /\b(?:uniswap|cow\s?swap|curve|balancer|sushi|compound|aave|pendle|yearn|hyperliquid|venus|spark)\b/i

/** Pure questions ("should I repay?") never build a card. */
const QUESTION_START_RE = /^\s*(?:should|why|what|when|how|is|are|does|do|can\s+you\s+explain)\b/i

/** 1 = Ethereum, 8453 = Base (the service default). */
export type MorphoChainId = 1 | 8453
export const MORPHO_DEFAULT_CHAIN_ID: MorphoChainId = 8453

/** Resolve the chain slot: named Base/Ethereum → its id; a named OTHER chain
 *  → its word (route site refuses by name); nothing named → Base default. */
function chainSlot(message: string): { chainId: MorphoChainId; otherChain: string | null } {
  const other = message.match(OTHER_CHAIN_RE)
  if (other) return { chainId: MORPHO_DEFAULT_CHAIN_ID, otherChain: other[1].toLowerCase() }
  if (ETH_RE.test(message)) return { chainId: 1, otherChain: null }
  if (BASE_RE.test(message)) return { chainId: 8453, otherChain: null }
  return { chainId: MORPHO_DEFAULT_CHAIN_ID, otherChain: null }
}

export interface MorphoLendParams {
  amount: string
  token: string
  /** True when the message names Morpho itself; false = bare lend-shaped
   *  verb that only routes here when a Morpho agent is in the set. */
  explicitMorpho: boolean
  /** 1 | 8453 — Base is the default when no chain is named. */
  chainId: MorphoChainId
  /** A chain Morpho (this service) doesn't reach, or null. */
  otherChain: string | null
  /** Venue-generic verb (deposit/add/put/park bare) — the SELECTED SET is
   *  the only cue, so the route site builds only when no OTHER selected
   *  agent could serve the verb. */
  weak?: boolean
}

// "(lend|supply|deposit|add|put|park) <amt> <token>" — lend/supply are
// lending-only verbs; the rest are venue-generic (WEAK when bare).
const LEND_RE = new RegExp(
  `\\b(?:lend|supply|deposit|add|put|park)\\s+(${AMOUNT})\\s+${FILLER}(${TOKEN})\\b`,
  'i',
)
// Amount missing but the intent is clearly a Morpho lend → ONE necessary
// clarify (the amount), not a protocol quiz.
const LEND_NO_AMOUNT_RE = new RegExp(
  `\\b(?:lend|supply|deposit|add|put|park)\\s+(?:some\\s+|my\\s+)?(${TOKEN})\\s+(?:to|into|in|on)\\b`,
  'i',
)

// The TOKEN regex is broad — reject grammar words it can catch.
const NOT_TOKENS = new Set([
  'from', 'to', 'into', 'out', 'of', 'my', 'the', 'a', 'an', 'on', 'in', 'at',
  'morpho', 'market', 'markets', 'pool', 'pools', 'debt', 'loan', 'all', 'some',
  'it', 'that', 'and', 'collateral', 'as',
  // The FILLER words — captured as the "token" when nothing follows them.
  'more', 'extra', 'additional',
])

/**
 * Parse an imperative Morpho lend (supply-to-earn). Returns params,
 * `{problem}` when it's clearly a Morpho lend but under-specified, or null
 * when it isn't one (→ normal routing). Collateral asks ("post 0.5 WETH as
 * collateral") belong to parseMorphoOp — a token followed by "collateral"
 * is never a lend.
 */
export function parseMorphoLend(message: string): MorphoLendParams | { problem: string } | null {
  if (OTHER_VENUE_RE.test(message)) return null
  if (QUESTION_START_RE.test(message)) return null
  const explicitMorpho = MORPHO_MCP_RE.test(message)
  const m = message.match(LEND_RE)
  let weak = false
  if (m) {
    // "supply 0.5 WETH collateral" / "… as collateral" is the collateral op.
    const afterToken = message.slice((m.index ?? 0) + m[0].length)
    if (/^\s*(?:as\s+)?collateral\b/i.test(afterToken)) return null
  }
  if (!explicitMorpho) {
    // Bare imperative — no Morpho word in the sentence. The SELECTED SET is
    // the cue (route site requires the Morpho agent). Two strengths:
    // lend/supply are lending-only verbs → route whenever the agent is
    // selected; deposit/add/put/park are venue-generic → WEAK, and the
    // route site additionally requires that no OTHER selected agent could
    // serve the verb (Hyperliquid takes deposits too, and so does Aave).
    // A named destination that isn't Morpho-shaped falls through.
    if (!m) return null
    if (QUESTION_START_RE.test(message)) return null
    const rest = message.slice((m.index ?? 0) + m[0].length)
    const dest = rest.match(/\b(?:to|into|in|on|at)\s+(?:an?\s+|the\s+|my\s+)?([A-Za-z0-9]+)/i)
    if (dest && !/^(?:morpho|market|markets|pool|pools|lending|base|ethereum|eth|mainnet)$/i.test(dest[1])) return null
    weak = !/^(?:supply|lend)\b/i.test(m[0])
  }

  if (!m) {
    if (explicitMorpho && LEND_NO_AMOUNT_RE.test(message)) {
      const t = message.match(LEND_NO_AMOUNT_RE)
      const sym = t ? t[1].replace(/^\$/, '').toUpperCase() : ''
      if (sym && !NOT_TOKENS.has(sym.toLowerCase())) {
        return { problem: `How much ${sym} should I lend? Say e.g. “lend 100 ${sym} on Morpho”.` }
      }
    }
    return null
  }
  const token = m[2].replace(/^\$/, '')
  if (NOT_TOKENS.has(token.toLowerCase())) return null
  const slot = chainSlot(message)
  return {
    amount: m[1],
    token,
    explicitMorpho,
    chainId: slot.chainId,
    otherChain: slot.otherChain,
    ...(weak ? { weak: true } : {}),
  }
}

// ── Withdraw / borrow / repay / collateral ops ──────────────────────────────

export type MorphoOpKind = 'borrow' | 'repay' | 'withdraw' | 'withdraw-collateral' | 'supply-collateral'

export interface MorphoOpParams {
  op: MorphoOpKind
  /** Exact human amount, or null when max ("all"/"everything"/full repay). */
  amount: string | null
  /** Repay/withdraw/withdraw-collateral only — borrow/post never have max. */
  max: boolean
  token: string
  explicitMorpho: boolean
  chainId: MorphoChainId
  otherChain: string | null
  /** Bare venue-generic verb — the selected set is the only hint; the route
   *  site builds only when no competing venue is selected. */
  weak?: boolean
}

const ALL_SRC = 'all(?:\\s+(?:of\\s+)?(?:my|the))?|everything|max(?:imum)?'
const AMOUNT_OR_ALL = `(?:(${AMOUNT})|(?:${ALL_SRC}))`

// Collateral variants FIRST — "withdraw 0.5 WETH collateral" would otherwise
// half-match the plain withdraw grammar and lose the collateral marker.
const WITHDRAW_COLLATERAL_RE = new RegExp(
  `\\b(?:withdraw|remove|pull(?:\\s+out)?|take\\s+out)\\s+${AMOUNT_OR_ALL}\\s+${FILLER}(?:of\\s+)?(?:my\\s+)?(${TOKEN})\\s+collateral\\b`,
  'i',
)
const SUPPLY_COLLATERAL_RE = new RegExp(
  `\\b(?:post|pledge|put\\s+up|supply|deposit|add)\\s+(${AMOUNT})\\s+${FILLER}(${TOKEN})\\s+(?:as\\s+)?collateral\\b`,
  'i',
)
const WITHDRAW_RE = new RegExp(
  `\\b(?:withdraw|redeem|pull(?:\\s+out)?|take\\s+out)\\s+${AMOUNT_OR_ALL}\\s+${FILLER}(?:of\\s+)?(?:my\\s+)?(${TOKEN})\\b`,
  'i',
)
const BORROW_RE = new RegExp(
  `\\b(?:borrow|take\\s+(?:out\\s+)?a\\s+loan\\s+of)\\s+(${AMOUNT})\\s+${FILLER}(${TOKEN})\\b`,
  'i',
)
const REPAY_RE = new RegExp(
  `\\b(?:repay|pay\\s+(?:back|off|down))\\s+${AMOUNT_OR_ALL}\\s+${FILLER}(?:of\\s+)?(?:my\\s+)?(${TOKEN})\\b`,
  'i',
)
// "pay off my USDC debt on morpho" — full repay, no amount word.
const REPAY_FULL_RE = new RegExp(
  `\\b(?:repay|pay\\s+(?:back|off|down)|clear)\\s+(?:all\\s+)?(?:of\\s+)?(?:my\\s+)?(${TOKEN})\\s+(?:debt|loan|borrow(?:ing)?s?)\\b`,
  'i',
)
// Amount missing but the op is clear → ONE necessary clarify.
const WITHDRAW_NO_AMOUNT_RE = new RegExp(
  `\\b(?:withdraw|redeem)\\s+(?:some\\s+|my\\s+)?(${TOKEN})\\s+(?:from|out\\s+of)\\b`,
  'i',
)
const BORROW_NO_AMOUNT_RE = new RegExp(`\\bborrow\\s+(?:some\\s+)?(${TOKEN})\\b`, 'i')

// Withdraw is a generic verb (exchanges, banks) — bare forms only route with
// lending context or the set hint. Borrow/repay are lending-specific.
const OP_CONTEXT_RE = /\b(?:market|markets|pool|pools|lending|lend|lent|supplied|supply|deposit(?:ed)?|position|yield|collateral|earn(?:ing)?)\b/i

/**
 * Parse an imperative Morpho borrow / repay / withdraw /
 * withdraw-collateral / supply-collateral. Same contract as parseMorphoLend:
 * params, `{op, problem}` when clearly the op but under-specified, or null
 * (→ normal routing).
 */
export function parseMorphoOp(message: string): MorphoOpParams | { op: MorphoOpKind; problem: string } | null {
  if (OTHER_VENUE_RE.test(message)) return null
  if (QUESTION_START_RE.test(message)) return null
  const explicitMorpho = MORPHO_MCP_RE.test(message)
  const slot = chainSlot(message)
  const shape = (op: MorphoOpKind, amount: string | null, token: string, weak = false): MorphoOpParams | null => {
    if (NOT_TOKENS.has(token.toLowerCase())) return null
    return {
      op,
      amount,
      max: amount === null,
      token: token.replace(/^\$/, ''),
      explicitMorpho,
      chainId: slot.chainId,
      otherChain: slot.otherChain,
      ...(weak ? { weak: true } : {}),
    }
  }

  const b = message.match(BORROW_RE)
  if (b) return shape('borrow', b[1], b[2])

  const r = message.match(REPAY_RE)
  if (r) {
    const parsed = shape('repay', r[1] ?? null, r[2])
    if (parsed) return parsed
  }
  const rf = message.match(REPAY_FULL_RE)
  if (rf) {
    const parsed = shape('repay', null, rf[1])
    if (parsed) return parsed
  }

  const sc = message.match(SUPPLY_COLLATERAL_RE)
  if (sc) return shape('supply-collateral', sc[1], sc[2])

  const wc = message.match(WITHDRAW_COLLATERAL_RE)
  if (wc && (explicitMorpho || OP_CONTEXT_RE.test(message))) {
    const parsed = shape('withdraw-collateral', wc[1] ?? null, wc[2])
    if (parsed) return parsed
  }

  const w = message.match(WITHDRAW_RE)
  if (w && (explicitMorpho || OP_CONTEXT_RE.test(message))) {
    const parsed = shape('withdraw', w[1] ?? null, w[2])
    if (parsed) return parsed
  } else if (w) {
    // Bare "withdraw 100 USDC" — no Morpho/lending cue; the selected set is
    // the hint (WEAK). A named source that isn't Morpho-shaped falls through
    // ("withdraw 100 USDC from binance").
    const rest = message.slice((w.index ?? 0) + w[0].length)
    const src = rest.match(/\b(?:from|to|into|in|on|at|out\s+of)\s+(?:an?\s+|the\s+|my\s+)?([A-Za-z0-9]+)/i)
    if (!src || /^(?:morpho|market|markets|pool|pools|lending|wallet|base|ethereum|eth|mainnet)$/i.test(src[1])) {
      const parsed = shape('withdraw', w[1] ?? null, w[2], true)
      if (parsed) return parsed
    }
  }

  if (explicitMorpho) {
    const wna = message.match(WITHDRAW_NO_AMOUNT_RE)
    if (wna && !NOT_TOKENS.has(wna[1].toLowerCase())) {
      const t = wna[1].replace(/^\$/, '').toUpperCase()
      return { op: 'withdraw', problem: `How much ${t} should I withdraw? Say e.g. “withdraw 25 ${t} from Morpho” — or “withdraw all my ${t}”.` }
    }
    const bna = message.match(BORROW_NO_AMOUNT_RE)
    if (bna && !NOT_TOKENS.has(bna[1].toLowerCase())) {
      const t = bna[1].replace(/^\$/, '').toUpperCase()
      return { op: 'borrow', problem: `How much ${t} should I borrow? Say e.g. “borrow 100 ${t} on Morpho”.` }
    }
  }
  return null
}

// ── Set-aware disambiguation for WEAK (venue-generic) verbs ──────────────────
// "deposit 5 USDC" / "withdraw 100 USDC" with the Morpho agent selected: the
// set IS the hint — unless another selected agent could serve the same verb,
// in which case normal routing decides the venue instead of assuming Morpho.
const COMPETING_VENUE_RE = /hyperliquid|binance|coinbase|kraken|exchange|aave|compound|venus|spark/i

/** The first selected agent (non-Morpho) that also takes deposits/
 *  withdrawals, or null when Morpho is the only plausible venue in the set. */
export function morphoCompetingVenueOf<T extends { slug?: string | null; name?: string | null }>(
  servers: T[],
): string | null {
  const hit = servers.find(
    (s) =>
      !MORPHO_MCP_RE.test(`${s.slug} ${s.name}`) && COMPETING_VENUE_RE.test(`${s.slug ?? ''} ${s.name ?? ''}`),
  )
  return hit ? (hit.name ?? hit.slug ?? 'another venue') : null
}

// ── Market / position resolution (from the agent's own tool results) ─────────

/** One row of the agent's `markets` tool answer. */
export interface MorphoMarketRow {
  marketId?: string
  curated?: boolean
  loan?: string
  collateral?: string
  lltv?: string
  supplyApy?: string | null
  borrowApy?: string | null
  utilization?: string | null
  totalSupplyUsd?: number | null
  totalBorrowUsd?: number | null
}

const MARKET_ID_RE = /^0x[0-9a-fA-F]{64}$/

const marketRowValid = (r: MorphoMarketRow): r is MorphoMarketRow & { marketId: string } =>
  typeof r.marketId === 'string' && MARKET_ID_RE.test(r.marketId)

/**
 * The market to lend `token` into: curated, loan asset matching, deepest by
 * supplied USD (the tool already sorts by size — first match wins).
 */
export function pickLendMarket(rows: MorphoMarketRow[], token: string): MorphoMarketRow | null {
  const sym = token.toUpperCase()
  return rows.find((r) => marketRowValid(r) && r.curated !== false && (r.loan ?? '').toUpperCase() === sym) ?? null
}

/**
 * The market to post `token` collateral into: prefer a market the user
 * already has a position in with this collateral (posDebtMarketIds — a
 * top-up should land where the debt is), else the deepest curated market
 * taking this collateral.
 */
export function pickCollateralMarket(
  rows: MorphoMarketRow[],
  token: string,
  positionMarketIds: string[],
): MorphoMarketRow | null {
  const sym = token.toUpperCase()
  const candidates = rows.filter((r) => marketRowValid(r) && r.curated !== false && (r.collateral ?? '').toUpperCase() === sym)
  const existing = candidates.find((r) => positionMarketIds.some((id) => id.toLowerCase() === r.marketId!.toLowerCase()))
  return existing ?? candidates[0] ?? null
}

/** One row of the agent's `position` tool answer. */
export interface MorphoPositionRow {
  marketId?: string
  /** "USDC / cbBTC (lltv 86.0%)" */
  market?: string
  supplied?: { amount?: string; asset?: string; apy?: string } | null
  collateral?: { amount?: string; asset?: string } | null
  borrowed?: { amount?: string; asset?: string; apy?: string } | null
  borrowingPower?: { maxBorrow?: string; remaining?: string; asset?: string } | null
  healthFactor?: number | null
}

const posRowValid = (r: MorphoPositionRow): r is MorphoPositionRow & { marketId: string } =>
  typeof r.marketId === 'string' && MARKET_ID_RE.test(r.marketId)

const num = (s?: string | null): number => {
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

/** The user's largest supplied-`token` position — a withdraw's anchor. */
export function pickSuppliedPosition(rows: MorphoPositionRow[], token: string): MorphoPositionRow | null {
  const sym = token.toUpperCase()
  const hits = rows.filter((r) => posRowValid(r) && (r.supplied?.asset ?? '').toUpperCase() === sym)
  hits.sort((a, b) => num(b.supplied?.amount) - num(a.supplied?.amount))
  return hits[0] ?? null
}

/** The user's largest `token` debt — a repay's anchor. */
export function pickDebtPosition(rows: MorphoPositionRow[], token: string): MorphoPositionRow | null {
  const sym = token.toUpperCase()
  const hits = rows.filter((r) => posRowValid(r) && (r.borrowed?.asset ?? '').toUpperCase() === sym)
  hits.sort((a, b) => num(b.borrowed?.amount) - num(a.borrowed?.amount))
  return hits[0] ?? null
}

/** The user's largest posted-`token`-collateral position. */
export function pickCollateralPosition(rows: MorphoPositionRow[], token: string): MorphoPositionRow | null {
  const sym = token.toUpperCase()
  const hits = rows.filter((r) => posRowValid(r) && (r.collateral?.asset ?? '').toUpperCase() === sym)
  hits.sort((a, b) => num(b.collateral?.amount) - num(a.collateral?.amount))
  return hits[0] ?? null
}

/**
 * Where to borrow `token`: among the user's positions with collateral
 * posted, the market whose LOAN asset is the token with the most remaining
 * borrowing power. Null = no collateral anywhere that unlocks this token.
 * The market label's loan symbol ("USDC / cbBTC (…)") is the match key —
 * borrowingPower.asset carries the same symbol when present.
 */
export function pickBorrowPosition(rows: MorphoPositionRow[], token: string): MorphoPositionRow | null {
  const sym = token.toUpperCase()
  const loanSymOf = (r: MorphoPositionRow): string => {
    const fromPower = (r.borrowingPower?.asset ?? '').toUpperCase()
    if (fromPower) return fromPower
    const m = (r.market ?? '').match(/^(\S+)\s*\//)
    return m ? m[1].toUpperCase() : ''
  }
  const hits = rows.filter((r) => posRowValid(r) && num(r.collateral?.amount) > 0 && loanSymOf(r) === sym)
  hits.sort((a, b) => num(b.borrowingPower?.remaining) - num(a.borrowingPower?.remaining))
  return hits[0] ?? null
}

// ── The guard: verify what a build_* tool returned before it can be signed ───

/** The canonical Morpho Blue singleton — SAME address on Ethereum and Base
 *  (bytecode-verified per free-mcps/services/morpho/lib/registry.ts,
 *  2026-07-29). Every final step must target it; every approve must name it
 *  as the spender. */
export const MORPHO_SINGLETON = '0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb'

/** The full MarketParams tuple — the guard's binding anchor. Resolved
 *  on-chain (idToMarketParams on the pinned singleton) by lib/morpho-exec,
 *  cross-checked against the agent's own market_info answer; NEVER taken
 *  from a build result. */
export interface MorphoMarketParams {
  loanToken: string
  collateralToken: string
  oracle: string
  irm: string
  lltv: bigint
}

export type MorphoGuardOp = 'lend' | 'supply-collateral' | 'borrow' | 'repay' | 'withdraw' | 'withdraw-collateral'

/**
 * 4-byte selectors of each op's singleton call — keccak of the pinned ABI
 * signatures (MarketParams = (address,address,address,address,uint256)),
 * re-derived by the harness with viem's toFunctionSelector. Pinning the
 * selector means a build for one op can never smuggle another op's calldata
 * past the guard (a borrow and a withdraw both "send the user tokens" but
 * only one opens a debt position).
 */
export const MORPHO_OP_SELECTORS: Record<MorphoGuardOp, string> = {
  lend: 'a99aad89', // supply(params,assets,shares,onBehalf,data)
  'supply-collateral': '238d6579', // supplyCollateral(params,assets,onBehalf,data)
  borrow: '50d8cd4b', // borrow(params,assets,shares,onBehalf,receiver)
  repay: '20b76e81', // repay(params,assets,shares,onBehalf,data)
  withdraw: '5c2bea49', // withdraw(params,assets,shares,onBehalf,receiver)
  'withdraw-collateral': '8720316d', // withdrawCollateral(params,assets,onBehalf,receiver)
}

/**
 * Per-op calldata layout — 32-byte word indices AFTER the 4-byte selector,
 * derived 2026-07-29 by encoding each builder's exact viem arg shape and
 * dumping the words. The MarketParams tuple is static, so it inlines as
 * words 0–4 (loanToken, collateralToken, oracle, irm, lltv) in EVERY op.
 *
 *   op                  selector  words  assets shares onBehalf receiver tail(bytes)
 *   lend                a99aad89  10     5      6      7        —        [8]=0x120,[9]=0
 *   supply-collateral   238d6579   9     5      —      6        —        [7]=0x100,[8]=0
 *   borrow              50d8cd4b   9     5      6      7        8        —
 *   repay               20b76e81  10     5      6      7        —        [8]=0x120,[9]=0
 *   withdraw            5c2bea49   9     5      6      7        8        —
 *   withdraw-collateral 8720316d   8     5      —      6        7        —
 *
 * allowsApproves: only ops that PULL tokens from the wallet (lend, post
 * collateral, repay) may carry ERC-20 approve pre-steps; a withdraw/borrow
 * build growing an approve is exactly the surprise that must fail closed.
 * approveToken: which tuple word the approve must target — the loan asset
 * for lend/repay, the collateral asset for supply-collateral.
 */
export const MORPHO_OP_LAYOUT: Record<
  MorphoGuardOp,
  {
    noun: string
    words: number
    assetsWord: number
    /** null = the op has no shares slot (collateral ops are asset-exact). */
    sharesWord: number | null
    onBehalfWord: number
    receiverWord: number | null
    /** [index, expectedHexValue] pairs for the trailing bytes head words. */
    tail: Array<[number, bigint]>
    allowsApproves: boolean
    approveToken: 'loanToken' | 'collateralToken' | null
    wrongUser: string
  }
> = {
  lend: {
    noun: 'lend',
    words: 10,
    assetsWord: 5,
    sharesWord: 6,
    onBehalfWord: 7,
    receiverWord: null,
    tail: [[8, BigInt(0x120)], [9, BigInt(0)]],
    allowsApproves: true,
    approveToken: 'loanToken',
    wrongUser: 'The supplied assets would credit a different address than your wallet.',
  },
  'supply-collateral': {
    noun: 'collateral deposit',
    words: 9,
    assetsWord: 5,
    sharesWord: null,
    onBehalfWord: 6,
    receiverWord: null,
    tail: [[7, BigInt(0x100)], [8, BigInt(0)]],
    allowsApproves: true,
    approveToken: 'collateralToken',
    wrongUser: 'The collateral would credit a different address than your wallet.',
  },
  borrow: {
    noun: 'borrow',
    words: 9,
    assetsWord: 5,
    sharesWord: 6,
    onBehalfWord: 7,
    receiverWord: 8,
    tail: [],
    allowsApproves: false,
    approveToken: null,
    wrongUser: 'The borrowed funds would move for/to a different address than your wallet.',
  },
  repay: {
    noun: 'repayment',
    words: 10,
    assetsWord: 5,
    sharesWord: 6,
    onBehalfWord: 7,
    receiverWord: null,
    tail: [[8, BigInt(0x120)], [9, BigInt(0)]],
    allowsApproves: true,
    approveToken: 'loanToken',
    wrongUser: "The repayment would pay down a different address's debt than your wallet's.",
  },
  withdraw: {
    noun: 'withdrawal',
    words: 9,
    assetsWord: 5,
    sharesWord: 6,
    onBehalfWord: 7,
    receiverWord: 8,
    tail: [],
    allowsApproves: false,
    approveToken: null,
    wrongUser: 'The withdrawal would move funds for/to a different address than your wallet.',
  },
  'withdraw-collateral': {
    noun: 'collateral withdrawal',
    words: 8,
    assetsWord: 5,
    sharesWord: null,
    onBehalfWord: 6,
    receiverWord: 7,
    tail: [],
    allowsApproves: false,
    approveToken: null,
    wrongUser: 'The collateral would move for/to a different address than your wallet.',
  },
}

/**
 * How the final step's amount words must verify.
 * - exact: assets word == the asked amount in atoms (converted with the
 *   asset's REAL decimals), shares word (when the op has one) == 0. The
 *   only mode for lend, supply-collateral, borrow, withdraw-collateral.
 * - max-shares: assets word == 0 and shares word != 0 — the service's
 *   by-shares encoding that clears a debt / empties a supply EXACTLY even
 *   as interest drifts between build and sign. ONLY legal for max repay and
 *   max withdraw. anchorAtoms = the debt/supplied balance WE read from the
 *   agent's `position` before building — a repay-max approve must sit in
 *   [anchorAtoms, anchorAtoms + 0.2%] (the service buffers ~0.05% for
 *   accrual; interest only grows after our read, so the floor is safe).
 */
export type MorphoAmountRule =
  | { kind: 'exact'; atoms: bigint }
  | { kind: 'max-shares'; anchorAtoms: bigint }

interface BuiltStep {
  action?: string
  label?: string
  summary?: string
  tx?: { to?: string; data?: string; value?: string; chainId?: number }
}

/** What a build_* tool returned (steps only — everything else is display). */
export interface MorphoBuiltPlan {
  operation?: string
  marketId?: string
  steps?: BuiltStep[]
}

export interface MorphoOpGuardExpectation {
  op: MorphoGuardOp
  chainId: MorphoChainId
  amount: MorphoAmountRule
  /** The FULL market params tuple resolved on-chain by us — every word of
   *  the calldata tuple must match every field. */
  params: MorphoMarketParams
  /** The pinned Morpho Blue singleton — the only legal final-step target
   *  and approve spender. */
  morpho: string
  /** The connected wallet — funds must move to/for this address only. */
  user: string
}

export interface MorphoGuardResult {
  ok: boolean
  /** Block reasons — when non-empty NOTHING is offered for signing. */
  reasons: string[]
  warnings: string[]
  /** Verified steps ready for the SendTxChain card. */
  steps?: TxChainStep[]
}

const eqAddr = (a?: string, b?: string): boolean => !!a && !!b && a.toLowerCase() === b.toLowerCase()

/** 32-byte calldata words after the 4-byte selector (lowercase, no 0x). */
function dataWords(data: string): string[] | null {
  const hex = data.toLowerCase().replace(/^0x/, '')
  if (hex.length < 8 || (hex.length - 8) % 64 !== 0) return null
  const words: string[] = []
  for (let i = 8; i < hex.length; i += 64) words.push(hex.slice(i, i + 64))
  return words
}

const wordEqBigint = (word: string, n: bigint): boolean => BigInt(`0x${word}`) === n
const wordEqAddr = (word: string, addr: string): boolean =>
  word === addr.toLowerCase().replace(/^0x/, '').padStart(64, '0')

/**
 * Verify a `build_*` result. The safety property: every transaction the
 * user signs must (a) run on the expected chain with zero native value,
 * (b) call the pinned op selector ON the pinned Morpho singleton, (c) name
 * OUR market in the tuple — loanToken, collateralToken, oracle, irm, AND
 * lltv all matching the params we resolved on-chain ourselves (the market
 * id never appears in calldata; the tuple IS the market), (d) move EXACTLY
 * the asked amount (or the shares-mode max encoding, only where max is
 * legal), (e) move funds to/for the USER's own address, and (f) carry
 * nothing but decodable exact-amount ERC-20 approves of the expected token
 * to the singleton before the final call. Any other shape fails CLOSED
 * (refusal, never a warning). No fallback paths.
 */
export function guardMorphoOpBuild(built: MorphoBuiltPlan, exp: MorphoOpGuardExpectation): MorphoGuardResult {
  const reasons: string[] = []
  const warnings: string[] = []
  const steps = built.steps ?? []
  const layout = MORPHO_OP_LAYOUT[exp.op]

  if (steps.length === 0 || steps.length > 3) {
    return { ok: false, reasons: ['The build returned no signable plan.'], warnings }
  }
  if (!layout.allowsApproves && steps.length !== 1) {
    return {
      ok: false,
      reasons: [`A ${layout.noun} should be a single transaction, but the build returned ${steps.length} steps — refusing.`],
      warnings,
    }
  }

  for (const s of steps) {
    const tx = s.tx
    if (s.action !== 'send_transaction' || !tx?.to || !isAddress(tx.to)) {
      return { ok: false, reasons: ['A step is not a plain signable transaction.'], warnings }
    }
    if (tx.chainId !== exp.chainId) reasons.push(`A step targets chain ${tx.chainId ?? '?'}, not ${exp.chainId}.`)
    if ((tx.value ?? '0') !== '0') reasons.push(`A Morpho ${layout.noun} must carry zero native value.`)
  }
  if (reasons.length) return { ok: false, reasons, warnings }

  // The final step: the op's pinned selector on the pinned singleton.
  const final = steps[steps.length - 1].tx!
  if (!eqAddr(final.to, exp.morpho)) {
    reasons.push(`The ${layout.noun} transaction does not target the Morpho contract.`)
  }
  const finalHex = (final.data ?? '0x').toLowerCase().replace(/^0x/, '')
  if (finalHex.slice(0, 8) !== MORPHO_OP_SELECTORS[exp.op]) {
    reasons.push(`The transaction is not the known Morpho ${layout.noun} call — refusing.`)
  }
  const words = dataWords(final.data ?? '0x')
  let approveNeed: { floor: bigint; ceiling: bigint } | null = null
  if (!words || words.length !== layout.words) {
    reasons.push(`The ${layout.noun} calldata is not the known Morpho shape — refusing.`)
  } else {
    // (c) The MarketParams tuple — EVERY field binds the calldata to the
    // market we resolved. A single swapped word = a different market.
    const tuple: Array<[string, (w: string) => boolean]> = [
      ['loan asset', (w) => wordEqAddr(w, exp.params.loanToken)],
      ['collateral asset', (w) => wordEqAddr(w, exp.params.collateralToken)],
      ['oracle', (w) => wordEqAddr(w, exp.params.oracle)],
      ['interest-rate model', (w) => wordEqAddr(w, exp.params.irm)],
      ['liquidation threshold (lltv)', (w) => wordEqBigint(w, exp.params.lltv)],
    ]
    tuple.forEach(([name, okFn], i) => {
      if (!okFn(words[i])) reasons.push(`The calldata's ${name} does not match the resolved market — refusing.`)
    })

    // (d) Amounts.
    const assets = BigInt(`0x${words[layout.assetsWord]}`)
    const shares = layout.sharesWord !== null ? BigInt(`0x${words[layout.sharesWord]}`) : null
    if (exp.amount.kind === 'exact') {
      if (assets !== exp.amount.atoms) reasons.push(`The ${layout.noun} amount does not match your ask.`)
      if (shares !== null && shares !== BigInt(0)) {
        reasons.push(`An exact-amount ${layout.noun} must not be shares-denominated — refusing.`)
      }
      approveNeed = { floor: exp.amount.atoms, ceiling: exp.amount.atoms }
    } else {
      // max-shares — legal ONLY for max repay / max withdraw.
      if (exp.op !== 'repay' && exp.op !== 'withdraw') {
        reasons.push(`A shares-denominated ${layout.noun} is never legal — refusing.`)
      } else if (shares === null || assets !== BigInt(0) || shares === BigInt(0)) {
        reasons.push(`A full ${layout.noun} must be shares-denominated (assets 0, shares set) — refusing.`)
      }
      // The service buffers its approve ~0.05% over the live debt for
      // accrual between build and sign; our anchor was read moments before,
      // so [anchor, anchor + 0.2%] bounds it without flaking.
      approveNeed = {
        floor: exp.amount.anchorAtoms,
        ceiling: exp.amount.anchorAtoms + exp.amount.anchorAtoms / BigInt(500) + BigInt(1),
      }
    }

    // (e) The user's own address in every to/for slot.
    if (!wordEqAddr(words[layout.onBehalfWord], exp.user)) reasons.push(layout.wrongUser)
    if (layout.receiverWord !== null && !wordEqAddr(words[layout.receiverWord], exp.user)) {
      reasons.push(layout.wrongUser)
    }

    // The trailing bytes head words (offset + zero length) — pinned so no
    // callback payload can ride along (a non-empty `data` arg makes the
    // singleton call back into the supplied address mid-transaction).
    for (const [i, expected] of layout.tail) {
      if (!wordEqBigint(words[i], expected)) {
        reasons.push(`The ${layout.noun} calldata carries an unexpected callback payload — refusing.`)
        break
      }
    }
  }

  // (f) Every step before the last: a decodable ERC-20 approve of the
  // expected token, to the Morpho singleton, for exactly the expected
  // amount (bounded-window for the interest-buffered repay-max approve).
  const approves = steps.slice(0, -1)
  const approveTokenAddr = layout.approveToken === 'loanToken' ? exp.params.loanToken : exp.params.collateralToken
  approves.forEach((s) => {
    const tx = s.tx!
    if (!eqAddr(tx.to, approveTokenAddr)) {
      reasons.push(`An approval step targets a different contract than the ${layout.noun} token.`)
      return
    }
    try {
      const decoded = decodeFunctionData({ abi: erc20Abi, data: (tx.data ?? '0x') as `0x${string}` })
      if (decoded.functionName !== 'approve') {
        reasons.push(`A pre-step calls "${decoded.functionName}", not approve — refusing.`)
        return
      }
      const [spender, amt] = decoded.args as [string, bigint]
      if (!eqAddr(spender, exp.morpho)) reasons.push('An approval names a spender that is not the Morpho contract.')
      if (approveNeed === null) return // amount checks already refused above
      if (amt < approveNeed.floor) reasons.push(`An approval is for less than the ${layout.noun} amount.`)
      if (amt > approveNeed.ceiling) reasons.push(`An approval allows more than the ${layout.noun} needs — refusing.`)
    } catch {
      reasons.push('Could not decode an approval step — refusing to sign opaque calldata.')
    }
  })

  if (reasons.length) return { ok: false, reasons, warnings }
  return {
    ok: true,
    reasons,
    warnings,
    steps: steps.map((s) => ({
      label: s.label ?? 'transaction',
      title: s.summary ?? s.label ?? 'Sign transaction',
      tx: { to: s.tx!.to!, data: s.tx!.data ?? '0x', value: s.tx!.value ?? '0', chainId: s.tx!.chainId, action: s.label },
    })),
  }
}

// ── Pending-action follow-ups (cancel / amend / affirm), the aave pattern ────

const CANCEL_RE =
  /^(?:no[,.!]?\s*)?(?:cancel|scratch|drop|abandon|abort|forget|nevermind|never\s+mind|don'?t)(?:\s+(?:it|that|this|the))?(?:\s+(?:lend|supply|deposit|one))?[.!\s]*$/i
const AMEND_RE = new RegExp(
  `^(?:ok(?:ay)?[,.]?\\s*)?(?:actually[,.]?\\s*)?(?:make\\s+(?:it|that)|change\\s+(?:it|that)(?:\\s+to)?|do)\\s+(${AMOUNT})(?:\\s+[A-Za-z]{2,12})?(?:\\s+instead)?[.!?\\s]*$`,
  'i',
)
const AFFIRM_RE = /^(?:ok(?:ay)?|yes|yep|yeah|confirm|go(?:\s+ahead)?|do\s+it|proceed|send\s+it|sign)[.!\s]*$/i

export type MorphoLendFollowUp =
  | { kind: 'cancel' }
  | { kind: 'amend'; params: MorphoLendParams }
  | { kind: 'noop' }

/** Resolve a follow-up against a pending (already-built) lend. "confirm"/
 *  "yes" is a noop — the card is already there; we never rebuild on an
 *  affirmation. Anything else → null (routes normally). */
export function parseMorphoLendFollowUp(
  message: string,
  pending: { kind: string; data: Record<string, string> } | undefined,
): MorphoLendFollowUp | null {
  if (!pending || pending.kind !== 'morpho-lend') return null
  const text = message.trim()
  if (CANCEL_RE.test(text)) return { kind: 'cancel' }
  const amend = text.match(AMEND_RE)
  if (amend) {
    const chainId = Number(pending.data.chainId)
    return {
      kind: 'amend',
      params: {
        amount: amend[1],
        token: pending.data.token ?? '',
        explicitMorpho: true,
        chainId: chainId === 1 ? 1 : 8453,
        otherChain: null,
      },
    }
  }
  if (AFFIRM_RE.test(text)) return { kind: 'noop' }
  return null
}

export function morphoLendPending(params: MorphoLendParams, marketLabel: string, summary: string) {
  return {
    kind: 'morpho-lend',
    summary,
    data: { amount: params.amount, token: params.token, market: marketLabel, chainId: String(params.chainId) },
  }
}

export const MORPHO_OP_PENDING_KINDS = [
  'morpho-borrow',
  'morpho-repay',
  'morpho-withdraw',
  'morpho-withdraw-collateral',
  'morpho-supply-collateral',
] as const

export type MorphoOpFollowUp =
  | { kind: 'cancel' }
  | { kind: 'amend'; params: MorphoOpParams }
  | { kind: 'noop' }

/** Same contract as parseMorphoLendFollowUp, for the five op pendings. */
export function parseMorphoOpFollowUp(
  message: string,
  pending: { kind: string; data: Record<string, string> } | undefined,
): MorphoOpFollowUp | null {
  if (!pending || !(MORPHO_OP_PENDING_KINDS as readonly string[]).includes(pending.kind)) return null
  const op = pending.kind.replace(/^morpho-/, '') as MorphoOpKind
  const text = message.trim()
  if (CANCEL_RE.test(text)) return { kind: 'cancel' }
  const amend = text.match(AMEND_RE)
  if (amend) {
    const chainId = Number(pending.data.chainId)
    return {
      kind: 'amend',
      params: {
        op,
        amount: amend[1],
        max: false,
        token: pending.data.token ?? '',
        explicitMorpho: true,
        chainId: chainId === 1 ? 1 : 8453,
        otherChain: null,
      },
    }
  }
  if (AFFIRM_RE.test(text)) return { kind: 'noop' }
  return null
}

export function morphoOpPending(params: MorphoOpParams, marketLabel: string, summary: string) {
  return {
    kind: `morpho-${params.op}`,
    summary,
    data: {
      op: params.op,
      amount: params.amount ?? 'all',
      token: params.token,
      market: marketLabel,
      chainId: String(params.chainId),
    },
  }
}
