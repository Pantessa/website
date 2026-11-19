// ─────────────────────────────────────────────────────────────────────────
//  Dynamic token lists, per chain — RR14 ("Unknown buy token: UNI"), grown
//  multi-chain for the chat chain picker.
//
//  The hand-typed token maps in lib/chains.ts cover the flagship tokens;
//  users ask for UNI/AAVE/VIRTUAL/AAPL/…. Rather than hardcoding addresses
//  by hand (one typo on a swap surface = money bug), we load the OFFICIAL
//  Uniswap Labs token list (tokens.uniswap.org — multi-chain, including
//  Robinhood Chain's 100 tokenized stocks) plus Coingecko's per-chain list
//  to fill gaps. Canonical addresses + decimals, maintained upstream.
//  Cached in-memory per chain for 24h; network failure degrades to the
//  static maps (never throws).
//
//  Sync consumers (resolveToken/tokenDecimals in lib/cow.ts) read the module
//  cache; call ensureTokenList(chainId) once at the swap entry points.
// ─────────────────────────────────────────────────────────────────────────

// Per-chain source URLs, merged with the FIRST taking precedence on symbol
// collisions (Uniswap official first — it's curated). tokens.uniswap.org is
// one multi-chain document; the per-chain Coingecko lists fill the long tail
// (Robinhood Chain has no Coingecko list — the Uniswap list carries it, and
// Robinhood's own stock-token registry fills what that list has not caught
// up with: see ROBINHOOD_REGISTRY_URL below).
const UNISWAP_LIST = 'https://tokens.uniswap.org'

/**
 * Robinhood's stock-token registry (2026-11-19, the Anthropic listing): the
 * issuer's own list of every Stock Token on Robinhood Chain, the document its
 * docs point at for per-asset trading capabilities
 * (docs.robinhood.com/chain/stock-tokens). The Uniswap list is curated by
 * hand and lags a listing by days: on ANT's first day the registry carried it
 * and nine older listings (V, JPM, DIS, UBER, PYPL, MCD, GDX, SKHY, BMNR)
 * that the Uniswap list still did not, while every one of the 194 symbols the
 * two shared had the SAME address. It is read SECOND, so a symbol the Uniswap
 * list names keeps the address it always had; the registry only fills gaps.
 */
export const ROBINHOOD_REGISTRY_URL = 'https://api.robinhood.com/rhj/assets'
const ROBINHOOD_REGISTRY_CHAIN_ID = 4663
/** The registry writes a name as "Apple • Robinhood Token"; the company is the part before the dot. */
const REGISTRY_NAME_SUFFIX = /\s*[•·]\s*Robinhood Token\s*$/i

/**
 * The registry document → token-list rows for one chain. PURE, fail-closed
 * row by row: only an ACTIVE asset with a well-formed symbol, integer
 * decimals and a deployment on this chain becomes a row; anything else is
 * dropped, never guessed. The result goes through buildIndexes like any
 * other list (address shape re-checked there).
 */
export function robinhoodRegistryTokens(doc: unknown, chainId: number = ROBINHOOD_REGISTRY_CHAIN_ID): RawListToken[] {
  const assets = (doc as { assets?: unknown } | null)?.assets
  if (!Array.isArray(assets)) return []
  const out: RawListToken[] = []
  for (const a of assets as Record<string, unknown>[]) {
    if (!a || typeof a !== 'object' || a.status !== 'ASSET_STATUS_ACTIVE') continue
    const symbol = typeof a.tokenSymbol === 'string' ? a.tokenSymbol.trim() : ''
    if (!/^[A-Za-z0-9.]{1,12}$/.test(symbol)) continue
    const decimals = a.tokenDecimals
    if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) continue
    const deployments = Array.isArray(a.deployments) ? (a.deployments as Record<string, unknown>[]) : []
    const here = deployments.filter((d) => d && typeof d === 'object' && d.chainId === chainId)
    // One asset, one contract per chain: two rows for the same chain is not a shape we know.
    if (here.length !== 1) continue
    const address = typeof here[0].contractAddress === 'string' ? here[0].contractAddress : ''
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) continue
    const name = typeof a.tokenName === 'string' ? a.tokenName.replace(REGISTRY_NAME_SUFFIX, '').trim() : ''
    out.push({ chainId, address, symbol, decimals, ...(name ? { name } : {}) })
  }
  return out
}

/** One place a chain's tokens are read from: a URL, and how its document
 *  becomes a token list (`parse` omitted = it already is one). */
interface ListSource {
  url: string
  parse?: (doc: unknown) => { tokens?: RawListToken[] }
}
const COINGECKO_BY_CHAIN: Record<number, string> = {
  8453: 'https://tokens.coingecko.com/base/all.json',
  1: 'https://tokens.coingecko.com/ethereum/all.json',
  42161: 'https://tokens.coingecko.com/arbitrum-one/all.json',
  // Coingecko's slug is 'optimistic-ethereum', not 'optimism' (which 403s) —
  // probed 2026-09-04, 862 tokens.
  10: 'https://tokens.coingecko.com/optimistic-ethereum/all.json',
  // Arc (5042): tokens.uniswap.org carries NO Arc rows yet (probed
  // 2026-09-16, launch day), so Coingecko's 19-token list is the only
  // dynamic source. It lists a permissionless 18-decimal "USDC" squat
  // (0x8e98…) beside the real 6-decimal native one — the registry's static
  // map wins every symbol lookup (resolveToken / tokenDecimals consult
  // staticTokensFor first), pinned in test:api.
  5042: 'https://tokens.coingecko.com/arc/all.json',
}

function listSourcesFor(chainId: number): ListSource[] {
  // TOKEN_LIST_URLS override keeps its original meaning: the Base sources.
  if (chainId === 8453 && process.env.TOKEN_LIST_URLS) return process.env.TOKEN_LIST_URLS.split(',').map((url) => ({ url }))
  const sources: ListSource[] = [{ url: UNISWAP_LIST }]
  if (COINGECKO_BY_CHAIN[chainId]) sources.push({ url: COINGECKO_BY_CHAIN[chainId] })
  // After the Uniswap list, so it only ever ADDS a symbol (buildIndexes: the earlier list wins).
  if (chainId === ROBINHOOD_REGISTRY_CHAIN_ID) sources.push({ url: ROBINHOOD_REGISTRY_URL, parse: (doc) => ({ tokens: robinhoodRegistryTokens(doc, chainId) }) })
  return sources
}

const TTL_MS = 24 * 60 * 60 * 1000
/** A PARTIAL warm (one source answered, another timed out) is served but
 *  retried soon — never cached for the full day. 2026-09-08: an 8s blip on
 *  tokens.uniswap.org left a server with only the CoinGecko 4663 list (100
 *  rows, no GOOGL), and every stock ask for "GOOGL" refused with "Robinhood
 *  Chain doesn't list it" until the process restarted. */
const PARTIAL_TTL_MS = 60 * 1000

/**
 * A token the chain's list has no address for — a DEFINITE miss, not an
 * outage: the symbol is not on that chain (MKR on Base), or is not listed
 * anywhere we can price it. Typed so the venue pre-flight can tell it from a
 * transport error and answer "no venue" instead of "couldn't tell"
 * (lib/venue-preflight verdictOfThrow). The message is unchanged from the
 * plain Error it replaces, so every caller that only prints it is untouched.
 */
export class UnknownTokenError extends Error {
  constructor(
    readonly side: 'sell' | 'buy',
    readonly symbol: string,
    chainName: string,
  ) {
    super(`Unknown ${side} token on ${chainName}: ${symbol}`)
    this.name = 'UnknownTokenError'
  }
}

export interface TokenInfo {
  address: string
  decimals: number
  symbol: string
  name?: string
}

interface ChainCache {
  bySymbol: Record<string, TokenInfo>
  byAddress: Record<string, TokenInfo>
  byName: Record<string, TokenInfo>
  loadedAt: number
  inflight: Promise<void> | null
}

const chainCaches = new Map<number, ChainCache>()

function cacheFor(chainId: number): ChainCache {
  let c = chainCaches.get(chainId)
  if (!c) {
    c = { bySymbol: {}, byAddress: {}, byName: {}, loadedAt: 0, inflight: null }
    chainCaches.set(chainId, c)
  }
  return c
}

// Users type company names as often as tickers ("swap USDG for NVIDIA" —
// the list symbol is NVDA). Uppercase + collapse whitespace; EXACT match
// only, this feeds a money surface.
function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toUpperCase()
}

interface RawListToken {
  chainId: number
  address: string
  symbol: string
  decimals: number
  name?: string
}

interface BuiltIndexes {
  bySymbol: Record<string, TokenInfo>
  byAddress: Record<string, TokenInfo>
  byName: Record<string, TokenInfo>
}

/** Merge token-list documents into the three lookup maps. Earlier lists win
 *  on symbol collisions (Uniswap official first). A name that appears at two
 *  DIFFERENT addresses on the same chain is ambiguous (impostor risk in the
 *  long-tail lists) and resolves to nothing. */
function buildIndexes(chainId: number, lists: { tokens?: RawListToken[] }[]): BuiltIndexes {
  const bySymbol: Record<string, TokenInfo> = {}
  const byAddress: Record<string, TokenInfo> = {}
  const byName: Record<string, TokenInfo> = {}
  const ambiguousNames = new Set<string>()
  for (const list of lists) {
    for (const t of list.tokens ?? []) {
      if (t.chainId !== chainId) continue
      if (!/^0x[0-9a-fA-F]{40}$/.test(t.address) || !Number.isInteger(t.decimals)) continue
      const info: TokenInfo = { address: t.address.toLowerCase(), decimals: t.decimals, symbol: t.symbol, name: t.name }
      if (!bySymbol[t.symbol.toUpperCase()]) bySymbol[t.symbol.toUpperCase()] = info
      if (!byAddress[info.address]) byAddress[info.address] = info
      const name = typeof t.name === 'string' ? normalizeName(t.name) : ''
      if (name && !ambiguousNames.has(name)) {
        const prior = byName[name]
        if (!prior) byName[name] = info
        else if (prior.address !== info.address) {
          delete byName[name]
          ambiguousNames.add(name)
        }
      }
    }
  }
  return { bySymbol, byAddress, byName }
}

/** Warm the dynamic token map for a chain (no-op when fresh). Never throws. */
export async function ensureTokenList(chainId: number = 8453): Promise<void> {
  const c = cacheFor(chainId)
  if (Date.now() - c.loadedAt < TTL_MS && Object.keys(c.bySymbol).length > 0) return
  if (c.inflight) return c.inflight
  c.inflight = (async () => {
    const lists: { tokens?: RawListToken[] }[] = []
    const sources = listSourcesFor(chainId)
    for (const source of sources) {
      try {
        const res = await fetch(source.url.trim(), { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
        if (!res.ok) continue
        const doc: unknown = await res.json()
        lists.push(source.parse ? source.parse(doc) : (doc as { tokens?: RawListToken[] }))
      } catch {
        /* try the next source */
      }
    }
    const built = buildIndexes(chainId, lists)
    if (Object.keys(built.bySymbol).length > 0) {
      // Never let a partial warm shrink a fuller list already in hand.
      const partial = lists.length < sources.length
      if (partial && Object.keys(c.bySymbol).length > Object.keys(built.bySymbol).length) {
        c.loadedAt = Date.now() - TTL_MS + PARTIAL_TTL_MS
      } else {
        c.bySymbol = built.bySymbol
        c.byAddress = built.byAddress
        c.byName = built.byName
        c.loadedAt = partial ? Date.now() - TTL_MS + PARTIAL_TTL_MS : Date.now()
      }
    }
    c.inflight = null
  })()
  return c.inflight
}

/** Populate a chain's cache from in-memory token-list documents (same code
 *  path as the network load). For the offline harness — production warms via
 *  ensureTokenList. */
export function primeTokenList(chainId: number, lists: { tokens?: RawListToken[] }[]): void {
  const c = cacheFor(chainId)
  const built = buildIndexes(chainId, lists)
  c.bySymbol = built.bySymbol
  c.byAddress = built.byAddress
  c.byName = built.byName
  c.loadedAt = Date.now()
}

/** Back-compat alias — the original Base-only entry point. */
export async function ensureBaseTokenList(): Promise<void> {
  return ensureTokenList(8453)
}

/** Sync lookups against the warmed cache (empty until ensureTokenList ran). */
export function dynamicTokenBySymbol(symbol: string, chainId: number = 8453): TokenInfo | undefined {
  return cacheFor(chainId).bySymbol[symbol.trim().toUpperCase()]
}
export function dynamicTokenByAddress(address: string, chainId: number = 8453): TokenInfo | undefined {
  return cacheFor(chainId).byAddress[address.trim().toLowerCase()]
}
/** Exact full-name lookup ("NVIDIA" → NVDA, "Apple" → AAPL). Consulted only
 *  AFTER symbol lookup misses, so a ticker can never be shadowed by a name.
 *  Names ambiguous within the chain's merged lists resolve to nothing. */
export function dynamicTokenByName(name: string, chainId: number = 8453): TokenInfo | undefined {
  return cacheFor(chainId).byName[normalizeName(name)]
}
export function dynamicTokenCount(chainId: number = 8453): number {
  return Object.keys(cacheFor(chainId).bySymbol).length
}
/** Every listed token on a chain (one per symbol) — empty until warmed.
 *  Feeds the Robinhood stock-pairing ladder (lib/stock-pairing.ts). */
export function dynamicTokensFor(chainId: number = 8453): TokenInfo[] {
  return Object.values(cacheFor(chainId).bySymbol)
}
