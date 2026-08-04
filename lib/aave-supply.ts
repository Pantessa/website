// ─────────────────────────────────────────────────────────────────────────
//  Native Aave transaction building — the deterministic, guardrailed path
//  from "add 1 USDC to an Aave pool on Ethereum" (and its withdraw / borrow
//  / repay siblings) to a signable step chain, with ZERO confirmation
//  round-trips.
//
//  Why native (live failure, 2026-07-10): the planner/house-model path (a)
//  sent the SYMBOL "USDC" where build_supply's `currency` validates an
//  address regex → MCP -32602 and a dead-end apology, (b) asked "should I
//  proceed?" three separate turns, and (c) FABRICATED wallet data in prose
//  (a "1.5 USDC" then "706 USDC" DATA block on turns where the wallet agent
//  was never called — the real balance was 0). Like the cross-chain sibling
//  (lib/cross-chain-swap.ts), this layer parses the ask itself, resolves the
//  reserve from the agent's `reserves` tool (address + decimals + APY — no
//  symbol/address confusion possible), calls the matching build_* tool
//  directly, and verifies the returned steps before offering them. The
//  confirmation IS the signature: we build immediately and show everything.
//
//  Every op's final-step calldata layout was probed LIVE on
//  aave-mcp.yeetful.com (2026-07-10, construction-only, $0) — see
//  AAVE_OP_SELECTORS. Any other shape fails CLOSED.
// ─────────────────────────────────────────────────────────────────────────

import { decodeFunctionData, erc20Abi, isAddress } from 'viem'
import { chainAlt } from '@/lib/chain-lexicon'
import type { TxChainStep } from '@/lib/transaction-layer'

// ── The working set's Aave-capable agent ────────────────────────────────────
// Matched on slug/name so custom modal-added rows ("Aave MCP · Pantessa")
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
// "1 more USDC" / "5 extra DAI" — filler between amount and token. Live miss
// 2026-07-13: "can I supply 1 more USDC" fell through to the planner, which
// sent the SYMBOL to build_supply's address-regex param → MCP -32602.
const FILLER = '(?:(?:more|extra|additional)\\s+)?'

// Typo-tolerant Ethereum ("etheraum" seen live) vs. other named chains —
// both from the shared lexicon (plus the legacy ether[aiu]+m net).
const ETH_RE = new RegExp(String.raw`\b(?:${chainAlt(['ethereum'])}|ether[aiu]+m|eth(?:\s?mainnet)?)\b`, 'i')
const OTHER_CHAIN_RE = new RegExp(
  String.raw`\b(?:on|to)\s+(${chainAlt(['base', 'arbitrum', 'optimism', 'polygon', 'gnosis', 'avalanche', 'bnb', 'scroll', 'solana'])}|arb|sol)\b`,
  'i',
)

// A different venue named explicitly → not an Aave ask, fall through.
const OTHER_VENUE_RE =
  /\b(?:uniswap|cow\s?swap|curve|balancer|sushi|compound|morpho|pendle|yearn|hyperliquid|venus|spark)\b/i

// "(add|supply|deposit|lend|put|park) <amt> <token> (to|into|in|on) …"
const SUPPLY_RE = new RegExp(
  `\\b(?:add|supply|deposit|lend|put|park)\\s+(${AMOUNT})\\s+${FILLER}(${TOKEN})\\b`,
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
  /** Venue-generic verb (deposit/add/put/park bare, withdraw with no
   *  context) — the SELECTED SET is the only cue, so the route site builds
   *  only when no OTHER selected agent could serve the verb. */
  weak?: boolean
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
  const m = message.match(SUPPLY_RE)
  let weak = false
  if (!explicitAave && !poolish) {
    // Bare imperative — no Aave/pool cue in the sentence ("can I supply 1
    // more USDC", live 2026-07-13: the context was the previous Aave turn,
    // and the fall-through planner died on build_supply's address regex).
    // The SELECTED SET is the cue here (explicitAave stays false → the
    // route site requires the Aave agent in the set). Two strengths:
    // supply/lend are lending-only verbs → route whenever the agent is
    // selected; deposit/add/put/park are venue-generic → WEAK, and the
    // route site additionally requires that no OTHER selected agent could
    // serve the verb (Hyperliquid takes deposits too). All bare forms:
    // not a question, and no destination named that isn't Aave-shaped
    // ("deposit 5 USDC to my savings account" falls through).
    if (!m) return null
    if (QUESTION_START_RE.test(message)) return null
    const rest = message.slice((m.index ?? 0) + m[0].length)
    const dest = rest.match(/\b(?:to|into|in|on|at)\s+(?:an?\s+|the\s+|my\s+)?([A-Za-z0-9]+)/i)
    if (dest && !/^(?:aave|pool|pools|lending|ethereum|eth|mainnet)$/i.test(dest[1])) return null
    weak = !/^(?:supply|lend)\b/i.test(m[0])
  }

  if (!m) {
    if (explicitAave && SUPPLY_NO_AMOUNT_RE.test(message)) {
      const t = message.match(SUPPLY_NO_AMOUNT_RE)
      return { problem: `How much ${t ? t[1].replace(/^\$/, '').toUpperCase() : ''} should I supply? Say e.g. “supply 25 USDC to Aave”.`.replace('  ', ' ') }
    }
    return null
  }
  const token = m[2].replace(/^\$/, '')
  // The FILLER group is optional, so a trailing "supply 1 more" (no real
  // token) would capture the filler word itself — reject grammar words.
  if (NOT_TOKENS.has(token.toLowerCase())) return null
  // Chain words that double as tokens ("a ton of USDC") aren't a risk here —
  // OTHER_CHAIN_RE requires a chain preposition, same rule as detectCrossChain.
  const other = message.match(OTHER_CHAIN_RE)
  return {
    amount: m[1],
    token,
    explicitAave,
    otherChain: other && !ETH_RE.test(other[1]) ? other[1].toLowerCase() : null,
    ...(weak ? { weak: true } : {}),
  }
}

// ── Set-aware disambiguation for WEAK (venue-generic) verbs ──────────────────
// "deposit 5 USDC" / "withdraw 100 USDC" with the Aave agent selected: the
// set IS the hint — unless another selected agent could serve the same verb,
// in which case normal routing decides the venue instead of assuming Aave.
const COMPETING_VENUE_RE = /hyperliquid|binance|coinbase|kraken|exchange|morpho|compound|venus|spark/i

/** The first selected agent (non-Aave) that also takes deposits/withdrawals,
 *  or null when Aave is the only plausible venue in the set. */
export function competingVenueOf<T extends { slug?: string | null; name?: string | null }>(
  servers: T[],
): string | null {
  const hit = servers.find(
    (s) =>
      !AAVE_MCP_RE.test(`${s.slug} ${s.name}`) && COMPETING_VENUE_RE.test(`${s.slug ?? ''} ${s.name ?? ''}`),
  )
  return hit ? (hit.name ?? hit.slug ?? 'another venue') : null
}

// ── Reserve resolution (from the agent's `reserves` tool result) ─────────────

export interface AaveReserveRow {
  reserveId?: string
  spoke?: string | null
  spokeAddress?: string | null
  asset?: { symbol?: string | null; name?: string | null; address?: string | null; decimals?: number | null }
  canSupply?: boolean | null
  canBorrow?: boolean | null
  canUseAsCollateral?: boolean | null
  active?: boolean | null
  supplied?: string | null
  suppliedUsd?: string | null
  supplyApyPct?: number | null
  borrowApyPct?: number | null
}

export interface PickedReserve {
  spokeName: string
  spokeAddress: string
  currency: string
  decimals: number
  supplyApyPct: number | null
  borrowApyPct: number | null
  /** On-chain reserve id decoded from the base64 reserveId — cross-checked
   *  against the built calldata. Null when undecodable. */
  onChainId: bigint | null
  /** USD per token implied by the pool's totals — the money-moved heuristic. */
  priceUsd: number | null
}

export const parseUsd = (s?: string | null): number | null => {
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

/** Structurally-complete reserve rows for one symbol (addresses + decimals). */
function candidateRows(rows: AaveReserveRow[], token: string): AaveReserveRow[] {
  const sym = token.toUpperCase()
  return rows.filter(
    (r) =>
      r.active === true &&
      (r.asset?.symbol ?? '').toUpperCase() === sym &&
      typeof r.spokeAddress === 'string' &&
      isAddress(r.spokeAddress) &&
      typeof r.asset?.address === 'string' &&
      isAddress(r.asset.address) &&
      typeof r.asset?.decimals === 'number',
  )
}

function toPicked(pick: AaveReserveRow): PickedReserve {
  const supplied = pick.supplied ? Number(pick.supplied) : null
  const suppliedUsd = parseUsd(pick.suppliedUsd)
  return {
    spokeName: pick.spoke ?? 'Aave v4',
    spokeAddress: pick.spokeAddress!,
    currency: pick.asset!.address!,
    decimals: pick.asset!.decimals!,
    supplyApyPct: typeof pick.supplyApyPct === 'number' ? pick.supplyApyPct : null,
    borrowApyPct: typeof pick.borrowApyPct === 'number' ? pick.borrowApyPct : null,
    onChainId: decodeOnChainId(pick.reserveId),
    priceUsd: supplied && suppliedUsd && supplied > 0 ? suppliedUsd / supplied : null,
  }
}

/**
 * Pick the reserve to supply into: active + supplyable, matching symbol.
 * The `reserves` tool sorts by supplied USD, so the first match is the
 * deepest pool (Main for USDC — also the collateral-enabled one). Collateral
 * capability breaks ties toward the more useful deposit.
 */
export function pickSupplyReserve(rows: AaveReserveRow[], token: string): PickedReserve | null {
  const candidates = candidateRows(rows, token).filter((r) => r.canSupply === true)
  if (candidates.length === 0) return null
  return toPicked(candidates.find((r) => r.canUseAsCollateral === true) ?? candidates[0])
}

/**
 * Resolve the reserve for an op on a KNOWN spoke — withdraw/repay anchor to
 * the spoke the user's position actually lives on (from `portfolio`), never
 * the deepest pool. The same asset can appear as separate supply-leg /
 * borrow-leg rows on one spoke with DIFFERENT on-chain ids (the MCP's
 * resolveReserve picks by leg the same way), so the op decides which row is
 * the calldata cross-check.
 */
export function reserveForOp(
  rows: AaveReserveRow[],
  token: string,
  spokeAddress: string,
  need: 'supply' | 'borrow',
): PickedReserve | null {
  const onSpoke = candidateRows(rows, token).filter((r) => eqAddr(r.spokeAddress!, spokeAddress))
  const pick = onSpoke.find((r) => (need === 'borrow' ? r.canBorrow === true : r.canSupply === true))
  return pick ? toPicked(pick) : null
}

/**
 * ALL on-chain reserve ids of `token`'s active legs on one spoke that can
 * serve the op — the guard's cross-check set. One spoke can list an asset
 * twice (mixed + borrow-only leg, different ids) and AaveKit resolves the
 * leg from its own unsorted row order, so a single-id expectation flakes.
 */
export function reserveLegIds(
  rows: AaveReserveRow[],
  token: string,
  spokeAddress: string,
  need: 'supply' | 'borrow',
): bigint[] {
  return candidateRows(rows, token)
    .filter((r) => eqAddr(r.spokeAddress!, spokeAddress) && (need === 'borrow' ? r.canBorrow === true : r.canSupply === true))
    .map((r) => decodeOnChainId(r.reserveId))
    .filter((id): id is bigint => id !== null)
}

// ── Guard: verify what a build_* tool returned before it can be signed ───────

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

export type AaveGuardOp = 'supply' | 'withdraw' | 'borrow' | 'repay'

/**
 * 4-byte selectors of each op's final spoke call, probed LIVE 2026-07-10
 * (aave-mcp.yeetful.com, construction-only): supply(id, amount, onBehalfOf) /
 * withdraw(id, amount, receiver) / borrow(id, amount, receiver) /
 * repay(id, amount, onBehalfOf) — all three-word. Pinning the selector means
 * a build for one op can never smuggle another op's calldata past the guard
 * (a borrow and a withdraw both "send the user tokens" but only one of them
 * opens a debt position).
 */
export const AAVE_OP_SELECTORS: Record<AaveGuardOp, string> = {
  supply: '852a56a5',
  withdraw: '0ad58d2f',
  borrow: 'd6bda0c0',
  repay: 'b1e8f8ef',
}

/** "Withdraw everything" amount word, probed live: 2^255 − 1 (NOT uint max). */
export const WITHDRAW_MAX_SENTINEL = (BigInt(1) << BigInt(255)) - BigInt(1)

/**
 * How the final step's amount word must verify.
 * - exact: the asked amount, converted with the reserve's real decimals.
 * - withdraw-max: the live-probed 2^255−1 sentinel (the contract resolves it
 *   to the full balance at execution time).
 * - repay-max: AaveKit encodes the QUOTED debt plus a small accrued-interest
 *   buffer (probed: ~1% over) — verified against the debt we read from the
 *   user's own portfolio, capped at +5% (the contract takes only what's owed;
 *   the approval is equally bounded).
 */
export type AaveAmountRule =
  | { kind: 'exact'; atoms: bigint }
  | { kind: 'withdraw-max' }
  | { kind: 'repay-max'; debtAtoms: bigint }

export interface AaveOpGuardExpectation {
  op: AaveGuardOp
  chainId: number
  amount: AaveAmountRule
  /** Token + spoke addresses WE resolved from the official reserves list. */
  currency: string
  spoke: string
  /** The connected wallet — funds must move to/for this address only. */
  user: string
  /**
   * Cross-check for the final calldata's reserve id (null = skip). A SET
   * because one spoke can list the same asset as separate legs with
   * different on-chain ids (live: Bluechip USDC = mixed row 4 + borrow-only
   * row 7) and AaveKit resolves the leg from its own unsorted row order —
   * any active leg of OUR asset on OUR spoke matching the op is legitimate.
   */
  onChainIds: bigint[] | null
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

// Per-op guard shape: what the final spoke call means, and whether ERC-20
// approve pre-steps are legitimate (only ops that PULL tokens from the
// wallet need an allowance; a withdraw/borrow build growing an approve step
// is exactly the kind of surprise that must fail closed).
const OP_GUARD: Record<
  AaveGuardOp,
  { noun: string; layout: string; allowsApproves: boolean; wrongUser: string }
> = {
  supply: {
    noun: 'supply',
    layout: 'supply(reserve, amount, onBehalfOf)',
    allowsApproves: true,
    wrongUser: 'The deposit would credit a different address than your wallet.',
  },
  withdraw: {
    noun: 'withdrawal',
    layout: 'withdraw(reserve, amount, receiver)',
    allowsApproves: false,
    wrongUser: 'The withdrawal would send funds to a different address than your wallet.',
  },
  borrow: {
    noun: 'borrow',
    layout: 'borrow(reserve, amount, receiver)',
    allowsApproves: false,
    wrongUser: 'The borrowed funds would go to a different address than your wallet.',
  },
  repay: {
    noun: 'repayment',
    layout: 'repay(reserve, amount, onBehalfOf)',
    allowsApproves: true,
    wrongUser: "The repayment would pay down a different address's debt than your wallet's.",
  },
}

/**
 * Verify a `build_*` result. The safety property: every transaction the user
 * signs must (a) run on the expected chain, (b) touch ONLY the token + spoke
 * addresses we resolved from the official reserves list, (c) move EXACTLY
 * the asked amount (or the live-probed max encoding), and (d) move funds
 * to/for the USER's own address. Selectors + calldata layouts were probed
 * live 2026-07-10 — any other shape fails CLOSED (refusal, never a warning).
 */
export function guardAaveOpBuild(built: AaveBuiltPlan, exp: AaveOpGuardExpectation): AaveGuardResult {
  const reasons: string[] = []
  const warnings: string[] = []
  const steps = built.steps ?? []
  const op = OP_GUARD[exp.op]

  if (steps.length === 0 || steps.length > 3) {
    return { ok: false, reasons: ['The build returned no signable plan.'], warnings }
  }
  if (!op.allowsApproves && steps.length !== 1) {
    return {
      ok: false,
      reasons: [`A ${op.noun} should be a single transaction, but the build returned ${steps.length} steps — refusing.`],
      warnings,
    }
  }

  for (const s of steps) {
    const tx = s.tx
    if (s.action !== 'send_transaction' || !tx?.to || !isAddress(tx.to)) {
      return { ok: false, reasons: ['A step is not a plain signable transaction.'], warnings }
    }
    if (tx.chainId !== exp.chainId) reasons.push(`A step targets chain ${tx.chainId ?? '?'}, not ${exp.chainId}.`)
    if ((tx.value ?? '0') !== '0') reasons.push(`A token ${op.noun} must carry zero native value.`)
  }
  if (reasons.length) return { ok: false, reasons, warnings }

  // The final step is the op's call on the spoke we resolved ourselves —
  // selector pinned, three words: reserve id, amount, user.
  const final = steps[steps.length - 1].tx!
  if (!eqAddr(final.to, exp.spoke)) {
    reasons.push(`The ${op.noun} transaction does not target the Aave spoke from the official reserves list.`)
  }
  const finalHex = (final.data ?? '0x').toLowerCase().replace(/^0x/, '')
  if (finalHex.slice(0, 8) !== AAVE_OP_SELECTORS[exp.op]) {
    reasons.push(`The transaction is not the known ${op.layout} call — refusing.`)
  }
  const words = dataWords(final.data ?? '0x')
  let finalAmount: bigint | null = null
  if (!words || words.length !== 3) {
    reasons.push(`The ${op.noun} calldata is not the known ${op.layout} shape — refusing.`)
  } else {
    if (exp.onChainIds !== null && !exp.onChainIds.some((id) => wordEqBigint(words[0], id))) {
      reasons.push(`The ${op.noun} calldata names a different reserve than the one resolved.`)
    }
    finalAmount = BigInt(`0x${words[1]}`)
    const rule = exp.amount
    if (rule.kind === 'exact' && finalAmount !== rule.atoms) {
      reasons.push(`The ${op.noun} amount does not match your ask.`)
    } else if (rule.kind === 'withdraw-max' && finalAmount !== WITHDRAW_MAX_SENTINEL) {
      reasons.push('A full withdrawal must use the withdraw-everything sentinel — refusing.')
    } else if (rule.kind === 'repay-max') {
      // Quoted debt + accrued-interest buffer, bounded by OUR portfolio read
      // (debt only grows between the read and the build, so the floor is
      // safe; the probed buffer was ~1%, capped here at +5%).
      const ceiling = rule.debtAtoms + rule.debtAtoms / BigInt(20) + BigInt(1)
      if (finalAmount < rule.debtAtoms || finalAmount > ceiling) {
        reasons.push('The full-repay amount does not match your outstanding debt (plus a small interest buffer).')
      }
    }
    if (!wordEqAddr(words[2], exp.user)) reasons.push(op.wrongUser)
  }

  // Every step before the last must be an ERC-20 approve OF OUR TOKEN, TO THE
  // SPOKE, for at least the final amount (a 0-amount allowance reset is fine
  // when another approve follows — the USDT pattern).
  const approves = steps.slice(0, -1)
  approves.forEach((s, i) => {
    const tx = s.tx!
    if (!eqAddr(tx.to, exp.currency)) {
      reasons.push(`An approval step targets a different contract than the ${op.noun} token.`)
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
      const needed = finalAmount ?? BigInt(0)
      const isReset = amt === BigInt(0) && i < approves.length - 1
      if (!isReset && amt < needed) reasons.push(`An approval is for less than the ${op.noun} amount.`)
      if (!isReset && amt > needed) warnings.push(`The approval allows more than the ${op.noun} amount (allowance reuse).`)
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

/** Verify a `build_supply` result — the op guard with an exact-amount rule. */
export function guardAaveSupplyBuild(built: AaveBuiltPlan, exp: AaveGuardExpectation): AaveGuardResult {
  return guardAaveOpBuild(built, {
    op: 'supply',
    chainId: exp.chainId,
    amount: { kind: 'exact', atoms: exp.atoms },
    currency: exp.currency,
    spoke: exp.spoke,
    user: exp.user,
    onChainIds: exp.onChainId !== null ? [exp.onChainId] : null,
  })
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

// ─────────────────────────────────────────────────────────────────────────────
//  Withdraw / borrow / repay — the same recipe as supply: parse the ask,
//  anchor to the user's REAL position (`portfolio`), resolve the reserve from
//  the official list, call the matching build_* tool, guard every step.
// ─────────────────────────────────────────────────────────────────────────────

export type AaveOpKind = 'withdraw' | 'borrow' | 'repay'

export interface AaveOpParams {
  op: AaveOpKind
  /** Exact human amount, or null when max ("all"/"everything"/full repay). */
  amount: string | null
  /** Withdraw/repay only — build with max:true (borrow never has a max). */
  max: boolean
  token: string
  explicitAave: boolean
  otherChain: string | null
  /** Withdraw with no Aave/lending cue — the selected set is the only hint;
   *  the route site builds only when no competing venue is selected. */
  weak?: boolean
}

// "all my USDC" / "everything" / "max" — the withdraw/repay full-amount forms.
const ALL_SRC = 'all(?:\\s+(?:of\\s+)?(?:my|the))?|everything|max(?:imum)?'
const AMOUNT_OR_ALL = `(?:(${AMOUNT})|(?:${ALL_SRC}))`

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
// "pay off my USDT debt" / "repay my USDC loan" — full repay, no amount word.
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

// Withdraw is a generic verb (exchanges, banks) — it only routes here with
// Aave named or lending context. Borrow/repay are lending-specific verbs.
const OP_CONTEXT_RE = /\b(?:pool|pools|lending|lend|supplied|supply|deposit(?:ed)?|position|yield|collateral|earn(?:ing)?)\b/i

// The TOKEN regex is broad — reject grammar words it can catch when the
// amount form is "all"/"everything" ("withdraw all from aave").
const NOT_TOKENS = new Set([
  'from', 'to', 'into', 'out', 'of', 'my', 'the', 'a', 'an', 'on', 'in', 'at',
  'aave', 'pool', 'pools', 'debt', 'loan', 'all', 'some', 'it', 'that', 'and',
  // The FILLER words — captured as the "token" when nothing follows them.
  'more', 'extra', 'additional',
])

/** Pure questions ("should I repay?") never build a card. */
const QUESTION_START_RE = /^\s*(?:should|why|what|when|how|is|are|does|do)\b/i

/**
 * Parse an imperative Aave withdraw / borrow / repay. Same contract as
 * parseAaveSupply: params, `{op, problem}` when clearly the op but
 * under-specified, or null (→ normal routing).
 */
export function parseAaveOp(message: string): AaveOpParams | { op: AaveOpKind; problem: string } | null {
  if (OTHER_VENUE_RE.test(message)) return null
  if (QUESTION_START_RE.test(message)) return null
  const explicitAave = /\baave\b/i.test(message)
  const other = message.match(OTHER_CHAIN_RE)
  const otherChain = other && !ETH_RE.test(other[1]) ? other[1].toLowerCase() : null
  const shape = (op: AaveOpKind, amount: string | null, token: string): AaveOpParams | null => {
    if (NOT_TOKENS.has(token.toLowerCase())) return null
    return { op, amount, max: amount === null, token: token.replace(/^\$/, ''), explicitAave, otherChain }
  }

  const b = message.match(BORROW_RE)
  if (b) return shape('borrow', b[1], b[2])

  const rf = message.match(REPAY_FULL_RE)
  const r = message.match(REPAY_RE)
  if (r) {
    const parsed = shape('repay', r[1] ?? null, r[2])
    if (parsed) return parsed
  }
  if (rf) {
    const parsed = shape('repay', null, rf[1])
    if (parsed) return parsed
  }

  const w = message.match(WITHDRAW_RE)
  if (w && (explicitAave || OP_CONTEXT_RE.test(message))) {
    const parsed = shape('withdraw', w[1] ?? null, w[2])
    if (parsed) return parsed
  } else if (w) {
    // Bare "withdraw 100 USDC" — no Aave/lending cue; the selected set is
    // the hint (WEAK: the route site requires the Aave agent selected AND
    // no competing venue in the set). A named source that isn't Aave-shaped
    // ("withdraw 100 USDC from binance") still falls through.
    const rest = message.slice((w.index ?? 0) + w[0].length)
    const src = rest.match(/\b(?:from|to|into|in|on|at|out\s+of)\s+(?:an?\s+|the\s+|my\s+)?([A-Za-z0-9]+)/i)
    if (!src || /^(?:aave|pool|pools|lending|wallet|ethereum|eth|mainnet)$/i.test(src[1])) {
      const parsed = shape('withdraw', w[1] ?? null, w[2])
      if (parsed) return { ...parsed, weak: true }
    }
  }

  if (explicitAave) {
    const wna = message.match(WITHDRAW_NO_AMOUNT_RE)
    if (wna && !NOT_TOKENS.has(wna[1].toLowerCase())) {
      const t = wna[1].replace(/^\$/, '').toUpperCase()
      return { op: 'withdraw', problem: `How much ${t} should I withdraw? Say e.g. “withdraw 25 ${t} from Aave” — or “withdraw all my ${t}”.` }
    }
    const bna = message.match(BORROW_NO_AMOUNT_RE)
    if (bna && !NOT_TOKENS.has(bna[1].toLowerCase())) {
      const t = bna[1].replace(/^\$/, '').toUpperCase()
      return { op: 'borrow', problem: `How much ${t} should I borrow? Say e.g. “borrow 100 ${t} from Aave”.` }
    }
  }
  return null
}

// ── Position anchoring (from the agent's `portfolio` tool result) ────────────
// Withdraw/repay/borrow act on what the user actually holds — the position
// row names the spoke, so "the deepest pool" is never guessed.

export interface AavePortfolioSupplyRow {
  spoke?: string | null
  spokeAddress?: string | null
  token?: { symbol?: string | null; address?: string | null; decimals?: number | null }
  balance?: string | null
  balanceUsd?: string | null
  withdrawable?: string | null
  isCollateral?: boolean | null
}

export interface AavePortfolioBorrowRow {
  spoke?: string | null
  spokeAddress?: string | null
  token?: { symbol?: string | null; address?: string | null; decimals?: number | null }
  debt?: string | null
  debtUsd?: string | null
}

export interface AavePortfolioPosition {
  spoke?: string | null
  spokeAddress?: string | null
  healthFactor?: string | null
  remainingBorrowingPowerUsd?: string | null
}

const rowValid = (r: { spokeAddress?: string | null; token?: { address?: string | null; decimals?: number | null } }) =>
  typeof r.spokeAddress === 'string' && isAddress(r.spokeAddress) && typeof r.token?.address === 'string' && isAddress(r.token.address)

/** The user's supply of `token` with the most withdrawable — if the largest
 *  can't cover the ask, nothing can. */
export function pickWithdrawPosition(supplies: AavePortfolioSupplyRow[], token: string): AavePortfolioSupplyRow | null {
  const sym = token.toUpperCase()
  const rows = supplies.filter((s) => (s.token?.symbol ?? '').toUpperCase() === sym && rowValid(s))
  rows.sort((a, b) => Number(b.withdrawable ?? 0) - Number(a.withdrawable ?? 0))
  return rows[0] ?? null
}

/** The user's largest `token` debt — the position a repay pays down. */
export function pickRepayPosition(borrows: AavePortfolioBorrowRow[], token: string): AavePortfolioBorrowRow | null {
  const sym = token.toUpperCase()
  const rows = borrows.filter((b) => (b.token?.symbol ?? '').toUpperCase() === sym && rowValid(b))
  rows.sort((a, b) => Number(b.debt ?? 0) - Number(a.debt ?? 0))
  return rows[0] ?? null
}

/**
 * Where to borrow `token`: among the spokes the user has BORROWING POWER on
 * (collateral already supplied), the one with the most remaining power that
 * actually lists the token as borrowable. Null = no collateral anywhere, or
 * the token isn't borrowable on any of the user's spokes.
 */
export function pickBorrowReserve(
  rows: AaveReserveRow[],
  token: string,
  positions: AavePortfolioPosition[],
): { picked: PickedReserve; position: AavePortfolioPosition } | null {
  const powered = positions
    .filter((p) => typeof p.spokeAddress === 'string' && isAddress(p.spokeAddress) && (parseUsd(p.remainingBorrowingPowerUsd) ?? 0) > 0)
    .sort((a, b) => (parseUsd(b.remainingBorrowingPowerUsd) ?? 0) - (parseUsd(a.remainingBorrowingPowerUsd) ?? 0))
  for (const position of powered) {
    const picked = reserveForOp(rows, token, position.spokeAddress!, 'borrow')
    if (picked) return { picked, position }
  }
  return null
}

// ── Op follow-ups (cancel / amend / affirm) against a pending build ──────────

export const AAVE_OP_PENDING_KINDS = ['aave-withdraw', 'aave-borrow', 'aave-repay'] as const

export type AaveOpFollowUp =
  | { kind: 'cancel' }
  | { kind: 'amend'; params: AaveOpParams }
  | { kind: 'noop' }

/** Same contract as parseAaveSupplyFollowUp, for the three op pendings. */
export function parseAaveOpFollowUp(
  message: string,
  pending: { kind: string; data: Record<string, string> } | undefined,
): AaveOpFollowUp | null {
  if (!pending || !(AAVE_OP_PENDING_KINDS as readonly string[]).includes(pending.kind)) return null
  const op = pending.kind.replace(/^aave-/, '') as AaveOpKind
  const text = message.trim()
  if (CANCEL_RE.test(text)) return { kind: 'cancel' }
  const amend = text.match(AMEND_RE)
  if (amend) {
    return {
      kind: 'amend',
      params: { op, amount: amend[1], max: false, token: pending.data.token ?? '', explicitAave: true, otherChain: null },
    }
  }
  if (/^(?:ok(?:ay)?|yes|yep|yeah|confirm|go(?:\s+ahead)?|do\s+it|proceed|send\s+it|sign)[.!\s]*$/i.test(text)) {
    return { kind: 'noop' }
  }
  return null
}

export function aaveOpPending(params: AaveOpParams, spokeName: string, summary: string) {
  return {
    kind: `aave-${params.op}`,
    summary,
    data: { op: params.op, amount: params.amount ?? 'all', token: params.token, spoke: spokeName },
  }
}
