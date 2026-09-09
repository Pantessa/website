// The splash hero's money map — pure, client-safe. Folds every card's
// MoneyFacts into the wallet-level map the route computed, and reduces it
// to ordered segments the bar draws. Buckets are disjoint by construction
// (lib/splash/types.ts MoneyBucket), so the fold is a plain sum.

import type { MoneyBucket, MoneyFact, MoneyMap, SplashTile } from './types'

/** Bar order = the story left to right: money that's working, money that's
 *  watched, money that's sitting, money that's exposed, money that's stuck. */
export const MONEY_BUCKETS: { bucket: MoneyBucket; label: string; blurb: string }[] = [
  { bucket: 'earning', label: 'earning', blurb: 'lent, staked, or supplied — paying you' },
  { bucket: 'protected', label: 'protected', blurb: 'a guardian is armed on it' },
  { bucket: 'stocks', label: 'stocks', blurb: 'tokenized equities on Robinhood Chain' },
  { bucket: 'spot', label: 'spot', blurb: 'tokens held outright, no guard' },
  { bucket: 'idle', label: 'idle', blurb: 'stables earning nothing' },
  { bucket: 'risk', label: 'at risk', blurb: 'leveraged with no stop armed' },
  { bucket: 'stuck', label: 'stuck', blurb: 'exists, but no gas to move it' },
]

const roundUsd = (n: number) => Math.round(n * 100) / 100

/** Route map + card facts → one map. Null when nothing anywhere carries a
 *  dollar (an empty wallet paints no bar, never a "$0" bar). */
export function mergeMoneyMap(base: MoneyMap | null | undefined, tiles: SplashTile[]): MoneyMap | null {
  const facts: MoneyFact[] = [
    ...(base?.facts ?? []),
    ...tiles.flatMap((t) => t.facts ?? []),
  ].filter((f) => Number.isFinite(f.usd) && f.usd > 0)
  if (facts.length === 0) return null
  return {
    facts,
    readChains: base?.readChains ?? [],
    failedChains: base?.failedChains ?? [],
  }
}

export interface MoneySegment {
  bucket: MoneyBucket
  label: string
  blurb: string
  usd: number
  /** Share of the map, 0–100. */
  pct: number
  /** The facts behind the segment, biggest first (the legend's hover detail). */
  facts: MoneyFact[]
}

export interface MoneySummary {
  totalUsd: number
  segments: MoneySegment[]
  /** Working + protected as a share of the total: the one number the hero
   *  headlines ("62% of what we can see is working or watched"). */
  workingPct: number
}

export function summarizeMoneyMap(map: MoneyMap): MoneySummary {
  const total = map.facts.reduce((n, f) => n + f.usd, 0)
  const segments: MoneySegment[] = []
  for (const b of MONEY_BUCKETS) {
    const facts = map.facts.filter((f) => f.bucket === b.bucket).sort((a, c) => c.usd - a.usd)
    const usd = facts.reduce((n, f) => n + f.usd, 0)
    if (usd <= 0) continue
    segments.push({ bucket: b.bucket, label: b.label, blurb: b.blurb, usd: roundUsd(usd), pct: total > 0 ? (usd / total) * 100 : 0, facts })
  }
  const working = segments.filter((s) => s.bucket === 'earning' || s.bucket === 'protected').reduce((n, s) => n + s.usd, 0)
  return { totalUsd: roundUsd(total), segments, workingPct: total > 0 ? Math.round((working / total) * 100) : 0 }
}
