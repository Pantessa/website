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

const LIST_URL = process.env.TOKEN_LIST_URL || 'https://tokens.uniswap.org'
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
    try {
      const res = await fetch(LIST_URL, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) })
      if (!res.ok) return
      const json = (await res.json()) as { tokens?: { chainId: number; address: string; symbol: string; decimals: number }[] }
      const next: Record<string, TokenInfo> = {}
      const nextByAddr: Record<string, TokenInfo> = {}
      for (const t of json.tokens ?? []) {
        if (t.chainId !== 8453) continue
        if (!/^0x[0-9a-fA-F]{40}$/.test(t.address) || !Number.isInteger(t.decimals)) continue
        const info: TokenInfo = { address: t.address.toLowerCase(), decimals: t.decimals, symbol: t.symbol }
        // First-listed wins on symbol collisions (the list orders canonical first).
        if (!next[t.symbol.toUpperCase()]) next[t.symbol.toUpperCase()] = info
        nextByAddr[info.address] = info
      }
      if (Object.keys(next).length > 0) {
        cache = next
        byAddress = nextByAddr
        loadedAt = Date.now()
      }
    } catch {
      /* degrade to the static map */
    } finally {
      inflight = null
    }
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
