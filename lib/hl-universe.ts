// The live Hyperliquid perp universe, cached — what the guardian coin fence
// (lib/hl-guardian fenceGuardianCoin) reads before any layer claims a
// "protect my X" ask, and (2026-10-13) what the chart pair table
// (lib/charts chartPairFor) reads so every perp the venue lists charts,
// quotes and alerts — not just the static few. One `meta` read per DEX per
// 10 minutes per process, inflight reads shared, a failed read retried after
// a minute and never fatal: the fence falls back to its static stock fence
// when this returns null, the pair table to its static perp set, and the arm
// path still validates against live meta before arming anything.
//
// Two dexes: the MAIN book ('BTC', 'HYPE', 'kPEPE' …) and the `xyz` dex
// (HIP-3: 'xyz:NVDA', 'xyz:GOLD' …) — the same two halves lib/tape-feed
// readTapeUniverse reads for the live tape, which primes these caches from
// its own answer (primeHlUniverse) so a browser on /live never pays twice.
import type { HlUniverse } from '@/lib/hl-guardian-fence'

const HL_INFO_URL = 'https://api.hyperliquid.xyz/info'
const TTL_MS = 10 * 60_000
const RETRY_MS = 60_000
const TIMEOUT_MS = 4_000
/** A universe smaller than this is a broken response, not the venue — a
 *  fence built from it would refuse real markets. */
const MIN_LISTED = 20

/** The dexes we read: the main perp book, and the xyz (HIP-3) dex. */
export type HlDex = 'main' | 'xyz'
export const HL_DEXES: readonly HlDex[] = ['main', 'xyz']

interface DexCache {
  cache: { at: number; universe: HlUniverse } | null
  lastFailAt: number
  inflight: Promise<HlUniverse | null> | null
}
const dexes: Record<HlDex, DexCache> = {
  main: { cache: null, lastFailAt: 0, inflight: null },
  xyz: { cache: null, lastFailAt: 0, inflight: null },
}

/** Build the fence's universe from a raw `{type:'meta'}` response. PURE;
 *  null on anything malformed or implausibly small. */
export function universeFromMeta(meta: unknown): HlUniverse | null {
  const rows = (meta as { universe?: unknown } | null)?.universe
  if (!Array.isArray(rows)) return null
  return universeFromRows(rows as { name?: unknown; isDelisted?: unknown; delisted?: unknown }[])
}

/** The same shape from rows that already carry `name` + a delisted flag
 *  (`isDelisted` as the venue spells it, or `delisted` as lib/tape's
 *  UniverseRow does). PURE; null when too small to be the venue. */
export function universeFromRows(rows: readonly { name?: unknown; isDelisted?: unknown; delisted?: unknown }[]): HlUniverse | null {
  const listed = new Set<string>()
  const delisted = new Set<string>()
  for (const row of rows) {
    const name = row?.name
    if (typeof name !== 'string' || !name) continue
    ;(row.isDelisted === true || row.delisted === true ? delisted : listed).add(name)
  }
  return listed.size >= MIN_LISTED ? { listed, delisted } : null
}

/** The last universe read, even if stale, or null before the first good
 *  read. Sync — for the jobs compiler, which runs after the route warms. */
export function hlPerpUniverseCached(dex: HlDex = 'main'): HlUniverse | null {
  return dexes[dex].cache?.universe ?? null
}

/** When the cached read for a dex landed (ms), or null before one did. */
export function hlPerpUniverseAt(dex: HlDex = 'main'): number | null {
  return dexes[dex].cache?.at ?? null
}

/** Is this dex's cache inside its TTL? (A stale cache still SERVES; this
 *  says whether a read would hit the venue.) */
export function hlPerpUniverseFresh(dex: HlDex = 'main', now = Date.now()): boolean {
  const c = dexes[dex].cache
  return !!c && now - c.at < TTL_MS
}

/** The live universe of one dex (cached 10 min). Null only when no read has
 *  ever succeeded — a failed refresh keeps serving the last good one. */
export async function hlPerpUniverse(dex: HlDex = 'main'): Promise<HlUniverse | null> {
  const d = dexes[dex]
  const now = Date.now()
  if (d.cache && now - d.cache.at < TTL_MS) return d.cache.universe
  if (now - d.lastFailAt < RETRY_MS) return d.cache?.universe ?? null
  d.inflight ??= (async () => {
    try {
      const res = await fetch(HL_INFO_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(dex === 'main' ? { type: 'meta' } : { type: 'meta', dex }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
      if (!res.ok) throw new Error(`hyperliquid meta ${res.status}`)
      const universe = universeFromMeta(await res.json())
      if (!universe) throw new Error('hyperliquid meta: malformed universe')
      d.cache = { at: Date.now(), universe }
      return universe
    } catch {
      d.lastFailAt = Date.now()
      return d.cache?.universe ?? null
    } finally {
      d.inflight = null
    }
  })()
  return d.inflight
}

/** Both dexes at once (one read each, shared + cached as above). A dex that
 *  never answered is null; the other still serves. */
export async function hlUniverses(): Promise<Record<HlDex, HlUniverse | null>> {
  const [main, xyz] = await Promise.all([hlPerpUniverse('main'), hlPerpUniverse('xyz')])
  return { main, xyz }
}

/**
 * Prime a dex's cache from rows another reader already holds (lib/tape-feed
 * readTapeUniverse's answer in the browser, lib/quotes' metaAndAssetCtxs
 * read on the server, the /t page's handoff to its client shell). The rows
 * must look like the venue (≥ MIN_LISTED listed names) or nothing changes —
 * a broken payload never primes a fence. Returns whether the cache took it.
 */
export function primeHlUniverse(dex: HlDex, rows: readonly { name?: unknown; isDelisted?: unknown; delisted?: unknown }[]): boolean {
  const universe = universeFromRows(rows)
  if (!universe) return false
  dexes[dex].cache = { at: Date.now(), universe }
  return true
}
