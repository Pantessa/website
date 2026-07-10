// ─────────────────────────────────────────────────────────────────────────
//  Native Aave supply building — the deterministic, guardrailed path from
//  "add 1 USDC to an Aave pool on Ethereum" to a signable approve→supply
//  chain, with ZERO confirmation round-trips.
//
//  Why native (live failure, 2026-07-10): the planner/house-model path (a)
//  sent the SYMBOL "USDC" where build_supply's `currency` validates an
//  address regex → MCP -32602 and a dead-end apology, (b) asked "should I
//  proceed?" three separate turns, and (c) FABRICATED wallet data in prose
//  (a "1.5 USDC" then "706 USDC" DATA block on turns where the wallet agent
//  was never called — the real balance was 0). Like the cross-chain sibling
//  (lib/cross-chain-swap.ts), this layer parses the ask itself, resolves the
//  reserve from the agent's `reserves` tool (address + decimals + APY — no
//  symbol/address confusion possible), calls `build_supply` directly, and
//  verifies the returned steps before offering them. The confirmation IS the
//  signature: we build immediately and show everything about the transaction.
// ─────────────────────────────────────────────────────────────────────────

import { decodeFunctionData, erc20Abi, isAddress } from 'viem'
import type { TxChainStep } from '@/lib/transaction-layer'

// ── The working set's Aave-capable agent ────────────────────────────────────
// Matched on slug/name so custom modal-added rows ("Aave MCP · Yeetful")
// count too. Descriptions are excluded — other MCPs mention Aave in passing.
export const AAVE_MCP_RE = /\baave\b/i

export interface AaveAgentRead<T> {
  agent?: T
  /** False for an add-MCP shell row (no endpoint) — routing at it makes the
   *  planner hallucinate; the caller answers honestly instead. */
  usable: boolean
}

export function aaveAgentOf<T extends { slug: string; name: string; endpoint?: string | null }>(
  servers: T[],
): AaveAgentRead<T> {
  const agent = servers.find((s) => AAVE_MCP_RE.test(`${s.slug} ${s.name}`))
  return { agent, usable: !!agent?.endpoint }
}

// ── Parse ────────────────────────────────────────────────────────────────────

const AMOUNT = '\\d+(?:\\.\\d+)?'
const TOKEN = '\\$?[A-Za-z]{2,12}'

// Typo-tolerant Ethereum ("etheraum" seen live) vs. other named chains.
const ETH_RE = /\b(?:ethereum|ether[aiu]+m|eth(?:\s?mainnet)?|mainnet)\b/i
const OTHER_CHAIN_RE =
  /\b(?:on|to)\s+(base|arbitrum|arb|optimism|polygon|matic|gnosis|avalanche|avax|bnb|bsc|scroll|solana|sol)\b/i

// A different venue named explicitly → not an Aave ask, fall through.
const OTHER_VENUE_RE = /\b(?:uniswap|cow\s?swap|curve|balancer|sushi|compound|morpho|pendle|yearn)\b/i

// "(add|supply|deposit|lend|put|park) <amt> <token> (to|into|in|on) …"
const SUPPLY_RE = new RegExp(
  `\\b(?:add|supply|deposit|lend|put|park)\\s+(${AMOUNT})\\s+(${TOKEN})\\b`,
  'i',
)
// Aave named anywhere, or generic pool/lending phrasing ("a pool on ethereum").
const POOLISH_RE = /\b(?:pool|pools|lending|lend|yield|earn(?:ing)?\s+(?:interest|apy))\b/i

// Amount missing but the intent is clearly an Aave deposit → ONE necessary
// clarify (the amount), not a protocol quiz.
const SUPPLY_NO_AMOUNT_RE = new RegExp(
  `\\b(?:add|supply|deposit|lend|put|park)\\s+(?:some\\s+|my\\s+)?(${TOKEN})\\s+(?:to|into|in|on)\\b`,
  'i',
)

export interface AaveSupplyParams {
  amount: string
  token: string
  /** True when the message names Aave itself; false = generic "a pool"
   *  phrasing that only routes here when an Aave agent is in the set. */
  explicitAave: boolean
  /** A NON-Ethereum chain the user named, or null (Ethereum/default). */
  otherChain: string | null
}

/**
 * Parse an imperative Aave supply. Returns params, `{problem}` when it's
 * clearly an Aave deposit but under-specified, or null when it isn't one
 * (→ normal routing). Conservative: questions ("what's the APY on aave?")
 * carry no supply verb + amount and fall through.
 */
export function parseAaveSupply(message: string): AaveSupplyParams | { problem: string } | null {
  if (OTHER_VENUE_RE.test(message)) return null
  const explicitAave = /\baave\b/i.test(message)
  const poolish = POOLISH_RE.test(message)
  if (!explicitAave && !poolish) return null

  const m = message.match(SUPPLY_RE)
  if (!m) {
    if (explicitAave && SUPPLY_NO_AMOUNT_RE.test(message)) {
      const t = message.match(SUPPLY_NO_AMOUNT_RE)
      return { problem: `How much ${t ? t[1].replace(/^\$/, '').toUpperCase() : ''} should I supply? Say e.g. “supply 25 USDC to Aave”.`.replace('  ', ' ') }
    }
    return null
  }
  const token = m[2].replace(/^\$/, '')
  // Chain words that double as tokens ("a ton of USDC") aren't a risk here —
  // OTHER_CHAIN_RE requires a chain preposition, same rule as detectCrossChain.
  const other = message.match(OTHER_CHAIN_RE)
  return {
    amount: m[1],
    token,
    explicitAave,
    otherChain: other && !ETH_RE.test(other[1]) ? other[1].toLowerCase() : null,
  }
}

// ── Reserve resolution (from the agent's `reserves` tool result) ─────────────

export interface AaveReserveRow {
  reserveId?: string
  spoke?: string | null
  spokeAddress?: string | null
  asset?: { symbol?: string | null; name?: string | null; address?: string | null; decimals?: number | null }
  canSupply?: boolean | null
  canUseAsCollateral?: boolean | null
  active?: boolean | null
  supplied?: string | null
  suppliedUsd?: string | null
  supplyApyPct?: number | null
}

export interface PickedReserve {
  spokeName: string
  spokeAddress: string
  currency: string
  decimals: number
  supplyApyPct: number | null
  /** On-chain reserve id decoded from the base64 reserveId — cross-checked
   *  against the built supply calldata. Null when undecodable. */
  onChainId: bigint | null
  /** USD per token implied by the pool's totals — the money-moved heuristic. */
  priceUsd: number | null
}

const parseUsd = (s?: string | null): number | null => {
  if (!s) return null
  const n = Number(s.replace(/[$,]/g, ''))
  return Number.isFinite(n) ? n : null
}

// reserveId is base64("chainId::spokeAddress::onChainId") — probed live.
function decodeOnChainId(reserveId?: string): bigint | null {
  if (!reserveId) return null
  try {
    const parts = Buffer.from(reserveId, 'base64').toString('utf8').split('::')
    const n = parts[2]
    return n && /^\d+$/.test(n) ? BigInt(n) : null
  } catch {
    return null
  }
}

/**
 * Pick the reserve to supply into: active + supplyable, matching symbol.
 * The `reserves` tool sorts by supplied USD, so the first match is the
 * deepest pool (Main for USDC — also the collateral-enabled one). Collateral
 * capability breaks ties toward the more useful deposit.
 */
export function pickSupplyReserve(rows: AaveReserveRow[], token: string): PickedReserve | null {
  const sym = token.toUpperCase()
  const candidates = rows.filter(
    (r) =>
      r.active === true &&
      r.canSupply === true &&
      (r.asset?.symbol ?? '').toUpperCase() === sym &&
      typeof r.spokeAddress === 'string' &&
      isAddress(r.spokeAddress) &&
      typeof r.asset?.address === 'string' &&
      isAddress(r.asset.address) &&
      typeof r.asset?.decimals === 'number',
  )
  if (candidates.length === 0) return null
  const pick = candidates.find((r) => r.canUseAsCollateral === true) ?? candidates[0]
  const supplied = pick.supplied ? Number(pick.supplied) : null
  const suppliedUsd = parseUsd(pick.suppliedUsd)
  return {
    spokeName: pick.spoke ?? 'Aave v4',
    spokeAddress: pick.spokeAddress!,
    currency: pick.asset!.address!,
    decimals: pick.asset!.decimals!,
    supplyApyPct: typeof pick.supplyApyPct === 'number' ? pick.supplyApyPct : null,
    onChainId: decodeOnChainId(pick.reserveId),
    priceUsd: supplied && suppliedUsd && supplied > 0 ? suppliedUsd / supplied : null,
  }
}

// ── Guard: verify what build_supply returned before it can be signed ─────────

interface BuiltStep {
  action?: string
  label?: string
  summary?: string
  tx?: { to?: string; data?: string; value?: string; chainId?: number }
}
export interface AaveBuiltPlan {
  operation?: string
  spoke?: string
  asset?: string
  requiredAllowance?: string | null
  currentAllowance?: string | null
  steps?: BuiltStep[]
}

export interface AaveGuardExpectation {
  chainId: number
  /** The exact supply amount in token atoms (from OUR decimals conversion). */
  atoms: bigint
  /** Token + spoke addresses WE resolved from the official reserves list. */
  currency: string
  spoke: string
  /** The connected wallet — the deposit must credit this address. */
  user: string
  /** Cross-check for the supply calldata's reserve id (null = skip). */
  onChainId: bigint | null
}

export interface AaveGuardResult {
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
 * Verify a `build_supply` result. The safety property: every transaction the
 * user signs must (a) run on the expected chain, (b) touch ONLY the token +
 * spoke addresses we resolved from the official reserves list, (c) move
 * EXACTLY the asked amount, and (d) credit the USER's own address. The spoke
 * calldata layout was probed live 2026-07-10: supply(onChainId, amount,
 * onBehalfOf) — any other shape fails CLOSED (refusal, never a warning).
 */
export function guardAaveSupplyBuild(built: AaveBuiltPlan, exp: AaveGuardExpectation): AaveGuardResult {
  const reasons: string[] = []
  const warnings: string[] = []
  const steps = built.steps ?? []

  if (steps.length === 0 || steps.length > 3) {
    return { ok: false, reasons: ['The build returned no signable plan.'], warnings }
  }

  for (const s of steps) {
    const tx = s.tx
    if (s.action !== 'send_transaction' || !tx?.to || !isAddress(tx.to)) {
      return { ok: false, reasons: ['A step is not a plain signable transaction.'], warnings }
    }
    if (tx.chainId !== exp.chainId) reasons.push(`A step targets chain ${tx.chainId ?? '?'}, not ${exp.chainId}.`)
    if ((tx.value ?? '0') !== '0') reasons.push('A token supply must carry zero native value.')
  }
  if (reasons.length) return { ok: false, reasons, warnings }

  // Every step before the last must be an ERC-20 approve OF OUR TOKEN, TO THE
  // SPOKE, for at least the supply amount (a 0-amount allowance reset is fine
  // when another approve follows — the USDT pattern).
  const approves = steps.slice(0, -1)
  approves.forEach((s, i) => {
    const tx = s.tx!
    if (!eqAddr(tx.to, exp.currency)) {
      reasons.push('An approval step targets a different contract than the supplied token.')
      return
    }
    try {
      const decoded = decodeFunctionData({ abi: erc20Abi, data: (tx.data ?? '0x') as `0x${string}` })
      if (decoded.functionName !== 'approve') {
        reasons.push(`A pre-step calls "${decoded.functionName}", not approve — refusing.`)
        return
      }
      const [spender, amt] = decoded.args as [string, bigint]
      if (!eqAddr(spender, exp.spoke)) reasons.push('An approval names a spender that is not the Aave spoke.')
      const isReset = amt === BigInt(0) && i < approves.length - 1
      if (!isReset && amt < exp.atoms) reasons.push('An approval is for less than the supply amount.')
      if (!isReset && amt > exp.atoms) warnings.push('The approval allows more than the supply amount (allowance reuse).')
    } catch {
      reasons.push('Could not decode an approval step — refusing to sign opaque calldata.')
    }
  })

  // The final step is the supply call on the spoke we resolved ourselves.
  const supply = steps[steps.length - 1].tx!
  if (!eqAddr(supply.to, exp.spoke)) {
    reasons.push('The supply transaction does not target the Aave spoke from the official reserves list.')
  }
  const words = dataWords(supply.data ?? '0x')
  if (!words || words.length !== 3) {
    reasons.push('The supply calldata is not the known supply(reserve, amount, onBehalfOf) shape — refusing.')
  } else {
    if (exp.onChainId !== null && !wordEqBigint(words[0], exp.onChainId)) {
      reasons.push('The supply calldata names a different reserve than the one resolved.')
    }
    if (!wordEqBigint(words[1], exp.atoms)) reasons.push('The supply amount does not match your ask.')
    if (!wordEqAddr(words[2], exp.user)) reasons.push('The deposit would credit a different address than your wallet.')
  }

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

// ── Pending-action follow-ups (cancel / amend / affirm), xchain pattern ──────

const CANCEL_RE =
  /^(?:no[,.!]?\s*)?(?:cancel|scratch|drop|abandon|abort|forget|nevermind|never\s+mind|don'?t)(?:\s+(?:it|that|this|the))?(?:\s+(?:supply|deposit|one))?[.!\s]*$/i
const AMEND_RE = new RegExp(
  `^(?:ok(?:ay)?[,.]?\\s*)?(?:actually[,.]?\\s*)?(?:make\\s+(?:it|that)|change\\s+(?:it|that)(?:\\s+to)?|do)\\s+(${AMOUNT})(?:\\s+[A-Za-z]{2,12})?(?:\\s+instead)?[.!?\\s]*$`,
  'i',
)

export type AaveSupplyFollowUp =
  | { kind: 'cancel' }
  | { kind: 'amend'; params: AaveSupplyParams }
  | { kind: 'noop' }

/** Resolve a follow-up against a pending (already-built) supply. "confirm"/
 *  "yes" is a noop — the card is already there; we never rebuild on an
 *  affirmation. Anything else → null (routes normally). */
export function parseAaveSupplyFollowUp(
  message: string,
  pending: { kind: string; data: Record<string, string> } | undefined,
): AaveSupplyFollowUp | null {
  if (!pending || pending.kind !== 'aave-supply') return null
  const text = message.trim()
  if (CANCEL_RE.test(text)) return { kind: 'cancel' }
  const amend = text.match(AMEND_RE)
  if (amend) {
    return {
      kind: 'amend',
      params: {
        amount: amend[1],
        token: pending.data.token ?? '',
        explicitAave: true,
        otherChain: null,
      },
    }
  }
  if (/^(?:ok(?:ay)?|yes|yep|yeah|confirm|go(?:\s+ahead)?|do\s+it|proceed|send\s+it|sign)[.!\s]*$/i.test(text)) {
    return { kind: 'noop' }
  }
  return null
}

export function aaveSupplyPending(params: AaveSupplyParams, spokeName: string, summary: string) {
  return {
    kind: 'aave-supply',
    summary,
    data: { amount: params.amount, token: params.token, spoke: spokeName },
  }
}
