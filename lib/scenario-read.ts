// The bars a scenario is read from (browser). The chart's own endpoint, the
// same feed for every page: the window, its warm-up, and up to two older
// pages so the record has history to judge. Nothing here computes anything.

import type { Candle, ChartTf } from '@/lib/charts'

/** Older pages asked for on top of the window and its warm-up (600 bars each). */
export const SCENARIO_OLDER_PAGES = 2

interface WindowBody {
  candles?: Candle[]
  warmup?: Candle[]
  feed?: string
  error?: string
}
interface PageBody {
  older?: Candle[]
  feed?: string
  exhausted?: boolean
  error?: string
}

const sane = (c: Candle) => Number.isFinite(c.t) && [c.o, c.h, c.l, c.c].every((n) => Number.isFinite(n) && n > 0)

/** Ascending, one bar per open time (a later read replaces an earlier one). */
export function mergeCandles(...reads: (readonly Candle[])[]): Candle[] {
  const by = new Map<number, Candle>()
  for (const read of reads) for (const c of read) if (sane(c)) by.set(c.t, c)
  return [...by.values()].sort((a, b) => a.t - b.t)
}

/** Throws with words a card can show when the feed has no bars. */
export async function loadScenarioCandles(symbol: string, tf: ChartTf, signal?: AbortSignal): Promise<Candle[]> {
  const q = `symbol=${encodeURIComponent(symbol)}&tf=${tf}`
  const res = await fetch(`/api/charts/candles?${q}&warmup=1`, { signal, cache: 'no-store' })
  const body = (await res.json().catch(() => ({}))) as WindowBody
  if (!res.ok || !body.candles?.length) throw new Error(body.error === 'feed unavailable' ? 'The price feed did not answer. Try again in a moment.' : 'No bars to read for this market on this frame.')
  let all = mergeCandles(body.warmup ?? [], body.candles)
  for (let page = 0; page < SCENARIO_OLDER_PAGES && all.length; page++) {
    try {
      const r = await fetch(`/api/charts/candles?${q}&before=${all[0].t}`, { signal, cache: 'no-store' })
      const b = (await r.json().catch(() => ({}))) as PageBody
      // A page from another tape is never spliced onto this one.
      if (!r.ok || !b.older?.length || (b.feed && body.feed && b.feed !== body.feed)) break
      all = mergeCandles(b.older, all)
      if (b.exhausted) break
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err
      break
    }
  }
  return all
}
