// ─────────────────────────────────────────────────────────────────────────
//  Dynamic Base token list — RR14 ("Unknown buy token: UNI").
//
//  The hand-typed BASE_TOKENS map in lib/cow.ts covers 6 tokens; users ask
//  for UNI/AAVE/VIRTUAL/…. Rather than hardcoding 40 addresses by hand (one
//  typo on a swap surface = money bug), we load the OFFICIAL Uniswap Labs
//  token list (tokens.uniswap.org) filtered to Base (8453) — canonical
//  addresses + decimals, maintained upstream. Cached in-memory for 24h;
//  network failure degrades to the static map (never throws).
//
//  Sync consumers (resolveToken/tokenDecimals in lib/cow.ts) read the module
//  cache; call ensureBaseTokenList() once at the swap entry points to warm it.
// ─────────────────────────────────────────────────────────────────────────

// Two canonical sources, merged with the FIRST taking precedence on symbol
// collisions: Uniswap Labs' default list (curated, but thin on Base — no
// LINK), then Coingecko's per-chain Base list (~2.3k tokens) to fill gaps.
const LIST_URLS = (process.env.TOKEN_LIST_URLS || 'https://tokens.uniswap.org,https://tokens.coingecko.com/base/all.json').split(',')
const TTL_MS = 24 * 60 * 60 * 1000

export interface TokenInfo {
  address: string
  decimals: number
  symbol: string
}

let cache: Record<string, TokenInfo> = {}
let byAddress: Record<string, TokenInfo> = {}
let loadedAt = 0
let inflight: Promise<void> | null = null

/** Warm the dynamic Base token map (no-op when fresh). Never throws. */
export async function ensureBaseTokenList(): Promise<void> {
  if (Date.now() - loadedAt < TTL_MS && Object.keys(cache).length > 0) return
  if (inflight) return inflight
  inflight = (async () => {
    const next: Record<string, TokenInfo> = {}
    const nextByAddr: Record<string, TokenInfo> = {}
    for (const url of LIST_URLS) {
      try {
        const res = await fetch(url.trim(), { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
        if (!res.ok) continue
        const json = (await res.json()) as { tokens?: { chainId: number; address: string; symbol: string; decimals: number }[] }
        for (const t of json.tokens ?? []) {
          if (t.chainId !== 8453) continue
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
      cache = next
      byAddress = nextByAddr
      loadedAt = Date.now()
    }
    inflight = null
  })()
  return inflight
}

/** Sync lookups against the warmed cache (empty until ensureBaseTokenList ran). */
export function dynamicTokenBySymbol(symbol: string): TokenInfo | undefined {
  return cache[symbol.trim().toUpperCase()]
}
export function dynamicTokenByAddress(address: string): TokenInfo | undefined {
  return byAddress[address.trim().toLowerCase()]
}
export function dynamicTokenCount(): number {
  return Object.keys(cache).length
}
