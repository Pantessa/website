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
}

interface ChainCache {
  bySymbol: Record<string, TokenInfo>
  byAddress: Record<string, TokenInfo>
  loadedAt: number
  inflight: Promise<void> | null
}

const chainCaches = new Map<number, ChainCache>()

function cacheFor(chainId: number): ChainCache {
  let c = chainCaches.get(chainId)
  if (!c) {
    c = { bySymbol: {}, byAddress: {}, loadedAt: 0, inflight: null }
    chainCaches.set(chainId, c)
  }
  return c
}

/** Warm the dynamic token map for a chain (no-op when fresh). Never throws. */
export async function ensureTokenList(chainId: number = 8453): Promise<void> {
  const c = cacheFor(chainId)
  if (Date.now() - c.loadedAt < TTL_MS && Object.keys(c.bySymbol).length > 0) return
  if (c.inflight) return c.inflight
  c.inflight = (async () => {
    const next: Record<string, TokenInfo> = {}
    const nextByAddr: Record<string, TokenInfo> = {}
    for (const url of listUrlsFor(chainId)) {
      try {
        const res = await fetch(url.trim(), { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
        if (!res.ok) continue
        const json = (await res.json()) as { tokens?: { chainId: number; address: string; symbol: string; decimals: number }[] }
        for (const t of json.tokens ?? []) {
          if (t.chainId !== chainId) continue
          if (!/^0x[0-9a-fA-F]{40}$/.test(t.address) || !Number.isInteger(t.decimals)) continue
          const info: TokenInfo = { address: t.address.toLowerCase(), decimals: t.decimals, symbol: t.symbol }
          // Earlier list wins on symbol collisions (Uniswap official first).
          if (!next[t.symbol.toUpperCase()]) next[t.symbol.toUpperCase()] = info
          if (!nextByAddr[info.address]) nextByAddr[info.address] = info
        }
      } catch {
        /* try the next source */
      }
    }
    if (Object.keys(next).length > 0) {
      c.bySymbol = next
      c.byAddress = nextByAddr
      c.loadedAt = Date.now()
    }
    c.inflight = null
  })()
  return c.inflight
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
export function dynamicTokenCount(chainId: number = 8453): number {
  return Object.keys(cacheFor(chainId).bySymbol).length
}
