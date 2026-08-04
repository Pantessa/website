// ─────────────────────────────────────────────────────────────────────────
//  CoW Protocol (CoW Swap) — quote → signable order.
//
//  The first reference integration for the "safe transaction building" thesis:
//  ask for a swap in English → we fetch a real CoW quote and construct the
//  EIP-712 order the user signs. CoW is intent-based: an order is signed
//  OFF-CHAIN (GPv2 order, EIP-712) and settled by solvers — so it produces an
//  `eip712-order` artifact (lib/transaction-layer), not a raw eth_sendTransaction.
//
//  This module is the decision-free core: quote fetch + token resolution +
//  typed-data builder. Guardrails (slippage/recipient/simulate) = A3; signing +
//  submission to the order book = A4. Verified: CoW Swap is live on Base.
// ─────────────────────────────────────────────────────────────────────────
import { dynamicTokenBySymbol, dynamicTokenByAddress, dynamicTokenByName } from '@/lib/token-list'
import { chainById } from '@/lib/chains'
import { LINK_SWAP_FEE_BPS, SWAP_FEE_BPS, TREASURY_ADDRESS } from '@/lib/fees'

import { keccak256, stringToBytes } from 'viem'

/** GPv2Settlement — the EIP-712 verifying contract. Same address on every
 *  CoW chain (Base included). */
export const GPV2_SETTLEMENT = '0x9008D19f58AAbD9eD0D60971565AA8510560ab41'

/** CoW order-book API base per chain. Base (8453) is the target for the first
 *  swap; mainnet included so the builder isn't chain-locked. */
export const COW_API_BASE: Record<number, string> = {
  8453: 'https://api.cow.fi/base',
  1: 'https://api.cow.fi/mainnet',
  42161: 'https://api.cow.fi/arbitrum_one',
}

/** Hand-pinned symbol maps live per chain in lib/chains.ts (`tokens`) so the
 *  flagship tokens resolve without the dynamic list. Raw 0x addresses pass
 *  through untouched everywhere. */
function staticTokensFor(chainId: number): Record<string, { address: string; decimals: number }> {
  return chainById(chainId)?.tokens ?? {}
}

/** Resolve a token symbol or address to a checksum-free lowercase address.
 *  Returns null if it's neither a known symbol nor a 0x address. */
export function resolveToken(input: string, chainId = 8453): string | null {
  const t = input.trim()
  if (/^0x[0-9a-fA-F]{40}$/.test(t)) return t.toLowerCase()
  const info = staticTokensFor(chainId)[t.toUpperCase()]
  if (info) return info.address.toLowerCase()
  // Dynamic layer (RR14): the official Uniswap token list filtered to this
  // chain, warmed via ensureTokenList(chainId) at the swap entry points —
  // covers UNI/AAVE/VIRTUAL/AAPL/… without hand-typing addresses on a money
  // surface.
  const dyn = dynamicTokenBySymbol(t, chainId)
  if (dyn) return dyn.address
  // Company-name fallback ("NVIDIA" → NVDA on Robinhood Chain) — exact full
  // names only, and never before the symbol maps.
  const byName = dynamicTokenByName(t, chainId)
  if (byName) return byName.address
  return null
}

/** Decimals for a known token symbol (or an address that maps to one).
 *  Null when unknown — callers must fall back to labeling amounts as atoms. */
export function tokenDecimals(input: string, chainId = 8453): number | null {
  const t = input.trim()
  const tokens = staticTokensFor(chainId)
  const bySymbol = tokens[t.toUpperCase()]
  if (bySymbol) return bySymbol.decimals
  if (/^0x[0-9a-fA-F]{40}$/.test(t)) {
    const lower = t.toLowerCase()
    for (const info of Object.values(tokens)) {
      if (info.address.toLowerCase() === lower) return info.decimals
    }
    const dynAddr = dynamicTokenByAddress(lower, chainId)
    if (dynAddr) return dynAddr.decimals
  }
  const dyn = dynamicTokenBySymbol(t, chainId)
  if (dyn) return dyn.decimals
  const byName = dynamicTokenByName(t, chainId)
  if (byName) return byName.decimals
  return null
}

/** Format an atoms amount ("100000000", 6) as a human amount ("100"). Trims
 *  trailing zeros; caps fractional digits so summaries stay readable. */
export function formatAtoms(atoms: string, decimals: number, maxFractionDigits = 6): string {
  if (!/^\d+$/.test(atoms)) return atoms
  const zero = BigInt(0)
  const v = BigInt(atoms)
  const base = BigInt(10) ** BigInt(decimals)
  const whole = v / base
  let frac = (v % base).toString().padStart(decimals, '0').slice(0, maxFractionDigits)
  frac = frac.replace(/0+$/, '')
  // A tiny-but-nonzero amount must never render as "0" on an approval surface.
  if (whole === zero && !frac && v > zero) return `<0.${'0'.repeat(Math.max(maxFractionDigits - 1, 0))}1`
  return frac ? `${whole}.${frac}` : whole.toString()
}

/** Human label for a token input — the symbol if known, else a shortened
 *  address. Used to build the exact string the user approves against. */
export function tokenLabel(input: string, chainId = 8453): string {
  const t = input.trim()
  if (!/^0x[0-9a-fA-F]{40}$/.test(t)) {
    // A name that resolved via the name index labels as its ticker, so the
    // artifact the user signs reads "1 USDG → NVDA", not "→ NVIDIA".
    const up = t.toUpperCase()
    if (!staticTokensFor(chainId)[up] && !dynamicTokenBySymbol(t, chainId)) {
      const byName = dynamicTokenByName(t, chainId)
      if (byName) return byName.symbol.toUpperCase()
    }
    return up
  }
  const lower = t.toLowerCase()
  for (const [sym, info] of Object.entries(staticTokensFor(chainId))) {
    if (sym !== 'ETH' && info.address.toLowerCase() === lower) return sym
  }
  const dyn = dynamicTokenByAddress(lower, chainId)
  if (dyn) return dyn.symbol.toUpperCase()
  return `${t.slice(0, 6)}…${t.slice(-4)}`
}

/** Convert a human amount ("100", "0.5") to atoms for a token with known
 *  decimals. Null on malformed input or more fractional digits than the token
 *  has (never round money silently). */
export function humanToAtoms(amount: string, decimals: number): string | null {
  const m = amount.trim().match(/^(\d+)(?:\.(\d+))?$/)
  if (!m) return null
  const [, whole, frac = ''] = m
  if (frac.length > decimals) return null
  const atoms = BigInt(whole) * BigInt(10) ** BigInt(decimals) + BigInt(frac.padEnd(decimals, '0') || '0')
  if (atoms <= BigInt(0)) return null
  return atoms.toString()
}

/** Human amount + label: "100 USDC", or "100000000 atoms of 0x1234…abcd" when
 *  the token's decimals are unknown (never silently misrender a magnitude). */
export function describeAmount(atoms: string, token: string, chainId = 8453): string {
  const dec = tokenDecimals(token, chainId)
  const label = tokenLabel(token, chainId)
  if (dec === null) return `${atoms} atoms of ${label}`
  return `${formatAtoms(atoms, dec)} ${label}`
}

export interface CowQuoteParams {
  chainId?: number
  sellToken: string // symbol or address
  buyToken: string // symbol or address
  /** Sell amount in atoms (base units) BEFORE fee, decimal string. */
  sellAmountBeforeFee: string
  from: string
  receiver?: string
  /** Seconds the order stays valid (default 20 min). */
  validForSec?: number
  /** Fee tier for the appData doc (default SWAP_FEE_BPS; link-originated
   *  turns pass LINK_SWAP_FEE_BPS). Must be a canonical tier — the guard
   *  refuses anything outside the two-doc family. */
  feeBps?: number
}

/** The normalized order parameters returned by CoW's /quote (the signable set). */
export interface CowOrderParameters {
  sellToken: string
  buyToken: string
  receiver: string
  sellAmount: string
  buyAmount: string
  validTo: number
  appData: string
  feeAmount: string
  kind: string
  partiallyFillable: boolean
  sellTokenBalance: string
  buyTokenBalance: string
}

export interface CowQuoteResult {
  chainId: number
  from: string
  order: CowOrderParameters
  /** Raw response id — used later for slippage tracking / submission. */
  quoteId?: number
  /** Full appData JSON matching order.appData (its keccak-256). Submission
   *  (A4) must POST this alongside the signed order or the book rejects it. */
  appDataJson?: string
}

/** The appData document we attribute orders with. `order.appData` signs its
 *  keccak-256 hash; submission carries the full JSON. When the protocol fee
 *  is on (lib/fees.ts), the doc carries CoW's NATIVE partner-fee field — the
 *  protocol itself settles the bps of the buy amount to the Pantessa
 *  treasury at execution; nothing extra to sign, no separate transfer step.
 *  Schema 1.3.0 + this exact partnerFee shape verified live against the Base
 *  orderbook 2026-07-20 (quote accepted, appDataHash echoed).
 *
 *  TWO-DOC FAMILY (HANDOFF-yeetcall-gtm C2b): the fee is TIERED — organic
 *  chat at SWAP_FEE_BPS, link-originated flow at LINK_SWAP_FEE_BPS — so
 *  there are exactly two canonical documents. EXACT-string discipline
 *  survives: every build site derives its doc from cowAppDataJson(bps),
 *  and the guard + submit relay pin order.appData to MEMBERSHIP in
 *  COW_CANONICAL_APP_DATA_HASHES — never to an unrecognized doc. */
export function cowAppDataJson(bps: number = SWAP_FEE_BPS): string {
  return bps > 0
    ? `{"version":"1.3.0","appCode":"Pantessa","metadata":{"partnerFee":{"bps":${bps},"recipient":"${TREASURY_ADDRESS}"}}}`
    : '{"version":"1.1.0","appCode":"Pantessa"}'
}

export function cowAppDataHash(bps: number = SWAP_FEE_BPS): string {
  return keccak256(stringToBytes(cowAppDataJson(bps)))
}

/** The default-tier doc/hash — the organic-chat rate (backwards-compatible
 *  names; existing call sites read these). */
export const COW_APP_DATA_JSON = cowAppDataJson()
export const COW_APP_DATA_HASH = cowAppDataHash()

/** Every appData hash Pantessa builds with (lowercased): the base tier and
 *  the link tier. A signed order whose appData is outside this set signed
 *  someone ELSE's document — fee-stripped, fatter-fee, or hook-injected —
 *  and never relays. */
export const COW_CANONICAL_APP_DATA_HASHES: ReadonlySet<string> = new Set(
  [SWAP_FEE_BPS, LINK_SWAP_FEE_BPS].map((bps) => cowAppDataHash(bps).toLowerCase()),
)

/** Which tier a signed order's appData hash belongs to — null when it is
 *  not a Pantessa document (refuse). Lets guards NAME the rate they saw. */
export function cowAppDataBpsOf(appDataHash: string | undefined): number | null {
  const h = (appDataHash ?? '').toLowerCase()
  for (const bps of [SWAP_FEE_BPS, LINK_SWAP_FEE_BPS]) {
    if (cowAppDataHash(bps).toLowerCase() === h) return bps
  }
  return null
}

/**
 * Fetch a live CoW quote for a sell order. Throws with a readable message on a
 * bad request (unknown token, unroutable pair, API error). Network-touching —
 * keep it out of pure unit tests; hit it in a route / live smoke instead.
 */
export async function fetchCowQuote(params: CowQuoteParams): Promise<CowQuoteResult> {
  const chainId = params.chainId ?? 8453
  const apiBase = COW_API_BASE[chainId]
  if (!apiBase) throw new Error(`CoW is not configured for chain ${chainId}.`)

  const sellToken = resolveToken(params.sellToken, chainId)
  const buyToken = resolveToken(params.buyToken, chainId)
  if (!sellToken) throw new Error(`Unknown sell token: ${params.sellToken}`)
  if (!buyToken) throw new Error(`Unknown buy token: ${params.buyToken}`)
  if (!/^\d+$/.test(params.sellAmountBeforeFee) || params.sellAmountBeforeFee === '0') {
    throw new Error('sellAmountBeforeFee must be a positive integer amount (in token atoms).')
  }

  const body = {
    sellToken,
    buyToken,
    from: params.from,
    receiver: params.receiver ?? params.from,
    kind: 'sell' as const,
    sellAmountBeforeFee: params.sellAmountBeforeFee,
    validFor: params.validForSec ?? 1200,
    signingScheme: 'eip712' as const,
    onchainOrder: false,
    priceQuality: 'optimal' as const,
    appData: cowAppDataJson(params.feeBps),
  }

  const res = await fetch(`${apiBase}/api/v1/quote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    const detail =
      (err && typeof err === 'object' && 'description' in err && (err as { description?: string }).description) ||
      (err && typeof err === 'object' && 'errorType' in err && (err as { errorType?: string }).errorType) ||
      `HTTP ${res.status}`
    throw new Error(`CoW quote failed: ${detail}`)
  }
  const data = (await res.json()) as { quote: Record<string, unknown>; from?: string; id?: number }
  const q = data.quote ?? {}

  const order: CowOrderParameters = {
    sellToken: String(q.sellToken),
    buyToken: String(q.buyToken),
    receiver: String(q.receiver ?? params.receiver ?? params.from),
    sellAmount: String(q.sellAmount),
    buyAmount: String(q.buyAmount),
    validTo: Number(q.validTo),
    // Sign the 32-byte appData hash, not the JSON string.
    appData: String((q as { appDataHash?: unknown }).appDataHash ?? q.appData),
    feeAmount: String(q.feeAmount ?? '0'),
    kind: String(q.kind ?? 'sell'),
    partiallyFillable: Boolean(q.partiallyFillable ?? false),
    sellTokenBalance: String(q.sellTokenBalance ?? 'erc20'),
    buyTokenBalance: String(q.buyTokenBalance ?? 'erc20'),
  }

  return { chainId, from: data.from ?? params.from, order, quoteId: data.id, appDataJson: cowAppDataJson(params.feeBps) }
}

/**
 * Apply slippage tolerance to a quoted SELL order: lower the signed minimum
 * `buyAmount` by `bps` so the order still fills if the price moves slightly
 * between quote and settlement. Signing the raw quoted buyAmount = zero
 * tolerance (may never fill). Returns a new result; never mutates.
 */
export function applySlippage(quote: CowQuoteResult, bps: number): CowQuoteResult {
  if (!Number.isInteger(bps) || bps < 0 || bps > 10_000) {
    throw new Error(`slippageBps must be an integer between 0 and 10000 (got ${bps}).`)
  }
  const buyAmount = ((BigInt(quote.order.buyAmount) * BigInt(10_000 - bps)) / BigInt(10_000)).toString()
  return { ...quote, order: { ...quote.order, buyAmount } }
}

// ── Limit orders ────────────────────────────────────────────────────────────

export interface CowLimitOrderParams {
  chainId?: number
  sellToken: string // symbol or address
  buyToken: string // symbol or address
  /** Exact sell amount in atoms, decimal string. */
  sellAmount: string
  /** Minimum buy amount in atoms — the user's limit price, decimal string. */
  buyAmountAtLeast: string
  from: string
  receiver?: string
  /** Seconds the order stays open (default 7 days — limits wait for price). */
  validForSec?: number
  /** Limit orders default to partially fillable (fill-or-kill = false). */
  partiallyFillable?: boolean
  /** Fee tier for the appData doc (default SWAP_FEE_BPS; link turns pass
   *  LINK_SWAP_FEE_BPS). */
  feeBps?: number
}

/**
 * Build a CoW LIMIT order locally — no quote needed, the user names the price.
 * `feeAmount` is 0: CoW's fee on limit orders comes out of surplus when a
 * solver fills at-or-better than the limit. Pure (no network); the order-book
 * POST (A4) validates the pair server-side. Returns the same shape as
 * fetchCowQuote so the typed-data builder + tx layer treat both identically.
 */
export function buildCowLimitOrder(params: CowLimitOrderParams): CowQuoteResult {
  const chainId = params.chainId ?? 8453
  if (!COW_API_BASE[chainId]) throw new Error(`CoW is not configured for chain ${chainId}.`)
  const sellToken = resolveToken(params.sellToken, chainId)
  const buyToken = resolveToken(params.buyToken, chainId)
  if (!sellToken) throw new Error(`Unknown sell token: ${params.sellToken}`)
  if (!buyToken) throw new Error(`Unknown buy token: ${params.buyToken}`)
  if (sellToken === buyToken) throw new Error('sellToken and buyToken must differ.')
  for (const [label, v] of [['sellAmount', params.sellAmount], ['buyAmountAtLeast', params.buyAmountAtLeast]] as const) {
    if (!/^\d+$/.test(v) || v === '0') throw new Error(`${label} must be a positive integer amount (in token atoms).`)
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(params.from)) throw new Error('A valid `from` wallet address is required.')

  const validTo = Math.floor(Date.now() / 1000) + (params.validForSec ?? 7 * 24 * 3600)
  const order: CowOrderParameters = {
    sellToken,
    buyToken,
    receiver: (params.receiver ?? params.from).toLowerCase(),
    sellAmount: params.sellAmount,
    buyAmount: params.buyAmountAtLeast,
    validTo,
    appData: cowAppDataHash(params.feeBps),
    feeAmount: '0',
    kind: 'sell',
    partiallyFillable: params.partiallyFillable ?? true,
    sellTokenBalance: 'erc20',
    buyTokenBalance: 'erc20',
  }
  return { chainId, from: params.from.toLowerCase(), order, appDataJson: cowAppDataJson(params.feeBps) }
}

/** The EIP-712 Order type — the canonical GPv2 order struct. `kind` and the
 *  balance fields are signed as strings ("sell", "erc20"). */
export const COW_ORDER_TYPES = {
  Order: [
    { name: 'sellToken', type: 'address' },
    { name: 'buyToken', type: 'address' },
    { name: 'receiver', type: 'address' },
    { name: 'sellAmount', type: 'uint256' },
    { name: 'buyAmount', type: 'uint256' },
    { name: 'validTo', type: 'uint32' },
    { name: 'appData', type: 'bytes32' },
    { name: 'feeAmount', type: 'uint256' },
    { name: 'kind', type: 'string' },
    { name: 'partiallyFillable', type: 'bool' },
    { name: 'sellTokenBalance', type: 'string' },
    { name: 'buyTokenBalance', type: 'string' },
  ],
} as const

/** Build the EIP-712 typed-data payload the user signs for a CoW order. */
export function buildCowOrderTypedData(quote: CowQuoteResult) {
  return {
    domain: {
      name: 'Gnosis Protocol',
      version: 'v2',
      chainId: quote.chainId,
      verifyingContract: GPV2_SETTLEMENT,
    },
    primaryType: 'Order' as const,
    types: COW_ORDER_TYPES,
    message: quote.order,
  }
}

/**
 * Produce the action payload the transaction layer recognizes
 * (`buildSignableArtifact` → `eip712-order`). This is what a CoW swap tool
 * returns so the built order flows to the sign UI (A4) with guardrails (A3).
 */
export function cowOrderAction(quote: CowQuoteResult, summary: string) {
  return {
    action: 'sign_order' as const,
    protocol: 'cow',
    summary,
    chainId: quote.chainId,
    typedData: buildCowOrderTypedData(quote),
    submitUrl: `${COW_API_BASE[quote.chainId]}/api/v1/orders`,
    // Submission (A4) POSTs the full appData JSON with the signed order —
    // the book rejects a bare hash it has never seen.
    appDataJson: quote.appDataJson,
    quoteId: quote.quoteId,
  }
}

/** CoW explorer path segment per chain (order pages). */
export const COW_EXPLORER_CHAIN: Record<number, string> = {
  8453: 'base',
  1: 'mainnet',
  42161: 'arb1',
}

/**
 * Build the order-book submission body (POST /api/v1/orders) from a signed
 * order. Pure — the book validates the signature against `from`. The full
 * appData JSON must accompany the signed hash or the book rejects the order.
 */
export function buildCowSubmitBody(
  order: CowOrderParameters,
  signature: string,
  from: string,
  appDataJson?: string,
  quoteId?: number,
) {
  return {
    sellToken: order.sellToken,
    buyToken: order.buyToken,
    receiver: order.receiver,
    sellAmount: order.sellAmount,
    buyAmount: order.buyAmount,
    validTo: order.validTo,
    feeAmount: order.feeAmount,
    kind: order.kind,
    partiallyFillable: order.partiallyFillable,
    sellTokenBalance: order.sellTokenBalance,
    buyTokenBalance: order.buyTokenBalance,
    signingScheme: 'eip712' as const,
    signature,
    from,
    appData: appDataJson ?? COW_APP_DATA_JSON,
    appDataHash: order.appData,
    ...(quoteId !== undefined ? { quoteId } : {}),
  }
}

/** One-line human description of a built order — the exact string the user
 *  approves against, in token units (never atoms). */
export function describeCowOrder(quote: CowQuoteResult, kind: 'swap' | 'limit'): string {
  const { order, chainId } = quote
  const sell = describeAmount(order.sellAmount, order.sellToken, chainId)
  const buy = describeAmount(order.buyAmount, order.buyToken, chainId)
  const chain = chainById(chainId)?.name ?? `chain ${chainId}`
  return kind === 'limit'
    ? `Limit order via CoW on ${chain}: sell ${sell} for at least ${buy}`
    : `Swap ${sell} → ~${buy} via CoW on ${chain}`
}
