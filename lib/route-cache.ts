// ─────────────────────────────────────────────────────────────────────────
//  Route response cache — don't pay twice for the same data.
//
//  A short-TTL in-memory cache for SUCCESSFUL routed GET reads, keyed by the
//  normalized request. A second identical question within the window reuses the
//  result for $0.00 instead of re-paying — a direct cost + latency win.
//
//  Safety: GET reads only (POSTs may be user-specific or mutating); successes
//  only; the caller must NOT cache signable-action payloads (votes/txns). The
//  key is request-only (no owner) — correct for public data endpoints (prices,
//  search, listings), which is what the planner routes to. v1 is per-instance
//  (in-memory LRU); the key/TTL shape lets a shared store (Redis/DB) drop in.
// ─────────────────────────────────────────────────────────────────────────

const TTL_MS = 45_000
const MAX_ENTRIES = 500

interface Entry {
  value: unknown
  expires: number
}
const store = new Map<string, Entry>()

/** Only idempotent GET reads are cacheable. */
export function isCacheable(req: { method: string }): boolean {
  return req.method.toUpperCase() === 'GET'
}

/** Stable key: method + origin + path + SORTED query (param order doesn't matter). */
export function routeCacheKey(req: { method: string; url: string; body?: string }): string {
  const method = req.method.toUpperCase()
  try {
    const u = new URL(req.url)
    u.searchParams.sort()
    return `${method} ${u.origin}${u.pathname}?${u.searchParams.toString()}`
  } catch {
    return `${method} ${req.url}`
  }
}

export function getCached(key: string, nowMs: number = Date.now()): unknown | undefined {
  const e = store.get(key)
  if (!e) return undefined
  if (e.expires <= nowMs) {
    store.delete(key)
    return undefined
  }
  // LRU touch: move to most-recently-used.
  store.delete(key)
  store.set(key, e)
  return e.value
}

export function setCached(key: string, value: unknown, ttlMs: number = TTL_MS, nowMs: number = Date.now()): void {
  if (store.size >= MAX_ENTRIES) {
    const oldest = store.keys().next().value
    if (oldest !== undefined) store.delete(oldest)
  }
  store.set(key, { value, expires: nowMs + ttlMs })
}

/** Test/maintenance hook. */
export function clearRouteCache(): void {
  store.clear()
}
