// The live Hyperliquid perp universe, cached — what the guardian coin fence
// (lib/hl-guardian fenceGuardianCoin) reads before any layer claims a
// "protect my X" ask. One `meta` read per 10 minutes per server, inflight
// reads shared, a failed read retried after a minute and never fatal: the
// fence falls back to its static stock fence when this returns null, and
// the arm path still validates against live meta before arming anything.
import type { HlUniverse } from '@/lib/hl-guardian'

const HL_INFO_URL = 'https://api.hyperliquid.xyz/info'
const TTL_MS = 10 * 60_000
const RETRY_MS = 60_000
const TIMEOUT_MS = 4_000
/** A universe smaller than this is a broken response, not the venue — a
 *  fence built from it would refuse real markets. */
const MIN_LISTED = 20

let cache: { at: number; universe: HlUniverse } | null = null
let lastFailAt = 0
let inflight: Promise<HlUniverse | null> | null = null

/** Build the fence's universe from a raw `{type:'meta'}` response. PURE;
 *  null on anything malformed or implausibly small. */
export function universeFromMeta(meta: unknown): HlUniverse | null {
  const rows = (meta as { universe?: unknown } | null)?.universe
  if (!Array.isArray(rows)) return null
  const listed = new Set<string>()
  const delisted = new Set<string>()
  for (const row of rows) {
    const name = (row as { name?: unknown })?.name
    if (typeof name !== 'string' || !name) continue
    ;((row as { isDelisted?: unknown }).isDelisted === true ? delisted : listed).add(name)
  }
  return listed.size >= MIN_LISTED ? { listed, delisted } : null
}

/** The last universe read, even if stale, or null before the first good
 *  read. Sync — for the jobs compiler, which runs after the route warms. */
export function hlPerpUniverseCached(): HlUniverse | null {
  return cache?.universe ?? null
}

/** The live universe (cached 10 min). Null only when no read has ever
 *  succeeded — a failed refresh keeps serving the last good one. */
export async function hlPerpUniverse(): Promise<HlUniverse | null> {
  const now = Date.now()
  if (cache && now - cache.at < TTL_MS) return cache.universe
  if (now - lastFailAt < RETRY_MS) return cache?.universe ?? null
  inflight ??= (async () => {
    try {
      const res = await fetch(HL_INFO_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'meta' }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`hyperliquid meta ${res.status}`)
      const universe = universeFromMeta(await res.json())
      if (!universe) throw new Error('hyperliquid meta: malformed universe')
      cache = { at: Date.now(), universe }
      return universe
    } catch {
      lastFailAt = Date.now()
      return cache?.universe ?? null
    } finally {
      inflight = null
    }
  })()
  return inflight
}
