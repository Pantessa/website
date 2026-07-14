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
// (Robinhood Chain has no Coingecko list — the Uniswap list carries it).
const UNISWAP_LIST = 'https://tokens.uniswap.org'
const COINGECKO_BY_CHAIN: Record<number, string> = {
  8453: 'https://tokens.coingecko.com/base/all.json',
  1: 'https://tokens.coingecko.com/ethereum/all.json',
  42161: 'https://tokens.coingecko.com/arbitrum-one/all.json',
}

function listUrlsFor(chainId: number): string[] {
  // TOKEN_LIST_URLS override keeps its original meaning: the Base sources.
  if (chainId === 8453 && process.env.TOKEN_LIST_URLS) return process.env.TOKEN_LIST_URLS.split(',')
  const urls = [UNISWAP_LIST]
  if (COINGECKO_BY_CHAIN[chainId]) urls.push(COINGECKO_BY_CHAIN[chainId])
  return urls
}

const TTL_MS = 24 * 60 * 60 * 1000

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
    for (const url of listUrlsFor(chainId)) {
      try {
        const res = await fetch(url.trim(), { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
        if (!res.ok) continue
        lists.push((await res.json()) as { tokens?: RawListToken[] })
      } catch {
        /* try the next source */
      }
    }
    const built = buildIndexes(chainId, lists)
    if (Object.keys(built.bySymbol).length > 0) {
      c.bySymbol = built.bySymbol
      c.byAddress = built.byAddress
      c.byName = built.byName
      c.loadedAt = Date.now()
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
