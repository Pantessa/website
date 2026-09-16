// SPARKS — a batched 7-day sparkline read for the index (VIZ lane). Server
// only. For each symbol the last SPARK_POINTS daily closes from the same
// candle loader the chart uses (lib/candles-server, its own 5s cache), read
// at most SPARK_CONCURRENCY at a time and cached here for SPARK_TTL_MS. A
// symbol whose feed misses is ABSENT from `sparks` (listed in `missing`),
// never an empty or flat array.

import { loadCandleSeries } from '@/lib/candles-server'
import { chartPairFor } from '@/lib/charts'

export const SPARK_POINTS = 8
export const SPARK_TTL_MS = 10 * 60_000
export const SPARK_CONCURRENCY = 6
export const SPARKS_MAX_SYMBOLS = 60

export interface SparksRead {
  sparks: Record<string, number[]>
  missing: string[]
  asOf: number
}

const cache = new Map<string, { at: number; closes: number[] | null }>()
const inflight = new Map<string, Promise<number[] | null>>()

async function readOne(symbol: string): Promise<number[] | null> {
  const hit = cache.get(symbol)
  if (hit && Date.now() - hit.at < SPARK_TTL_MS) return hit.closes
  let p = inflight.get(symbol)
  if (!p) {
    p = (async () => {
      try {
        const loaded = await loadCandleSeries(symbol, '1d')
        const closes = loaded?.series.candles.slice(-SPARK_POINTS).map((c) => c.c) ?? null
        const out = closes && closes.length >= 2 ? closes : null
        cache.set(symbol, { at: Date.now(), closes: out })
        return out
      } catch {
        // A miss is remembered for a minute so a polling tape doesn't hammer a dead feed.
        cache.set(symbol, { at: Date.now() - SPARK_TTL_MS + 60_000, closes: null })
        return null
      } finally {
        inflight.delete(symbol)
      }
    })()
    inflight.set(symbol, p)
  }
  return p
}

/** Clean a raw symbol list: resolver-cleared, de-duplicated, capped. */
export function cleanSparkSymbols(raw: readonly string[]): { symbols: string[]; junk: string[] } {
  const symbols: string[] = []
  const junk: string[] = []
  for (const r of raw) {
    const pair = chartPairFor(r)
    if (!pair) {
      junk.push(r)
      continue
    }
    if (!symbols.includes(pair.symbol)) symbols.push(pair.symbol)
    if (symbols.length >= SPARKS_MAX_SYMBOLS) break
  }
  return { symbols, junk }
}

export async function readSparks(symbols: readonly string[]): Promise<SparksRead> {
  const sparks: Record<string, number[]> = {}
  const missing: string[] = []
  let i = 0
  const worker = async () => {
    while (i < symbols.length) {
      const s = symbols[i++]
      const closes = await readOne(s)
      if (closes) sparks[s] = closes
      else missing.push(s)
    }
  }
  await Promise.all(Array.from({ length: Math.min(SPARK_CONCURRENCY, symbols.length) }, worker))
  return { sparks, missing, asOf: Date.now() }
}
