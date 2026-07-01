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

/** Well-known Base tokens so a natural-language swap ("USDC → WETH") resolves
 *  to addresses. Raw 0x addresses pass through untouched. */
const BASE_TOKENS: Record<string, string> = {
  USDC: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  WETH: '0x4200000000000000000000000000000000000006',
  ETH: '0x4200000000000000000000000000000000000006', // treated as WETH for ERC-20 swaps
  CBETH: '0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22',
  DAI: '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb',
  USDBC: '0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA',
}

/** Resolve a token symbol or address to a checksum-free lowercase address.
 *  Returns null if it's neither a known symbol nor a 0x address. */
export function resolveToken(input: string, chainId = 8453): string | null {
  const t = input.trim()
  if (/^0x[0-9a-fA-F]{40}$/.test(t)) return t.toLowerCase()
  if (chainId === 8453) {
    const addr = BASE_TOKENS[t.toUpperCase()]
    if (addr) return addr.toLowerCase()
  }
  return null
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
    appData: '{"version":"1.1.0","appCode":"Yeetful"}',
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

  return { chainId, from: data.from ?? params.from, order, quoteId: data.id }
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
  }
}
