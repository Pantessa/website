// ─────────────────────────────────────────────────────────────────────────
//  The tradability cache — server only.
//
//  A venue read costs a live quote, and /markets draws 238 rows, so the
//  verdicts are measured on a schedule (app/api/cron/tradability) and kept
//  in Neon, one row per (symbol, chain, side). Every surface reads the
//  cache; nothing on a page's critical path ever waits for a quote.
//
//  Fails SOFT in both directions, on purpose:
//  • a read that throws answers `{}` — the page renders with every action
//    offered, exactly as before the cache existed;
//  • a verdict older than TRADABILITY_MAX_AGE_MS is not served, so if the
//    refresher stops, chips come back rather than a market staying dark.
//
//  The refresher walks the board oldest-first inside a time budget, so a
//  30s function covers a slice and the whole board comes round within the
//  hour. A symbol nobody has measured yet is simply unknown.
// ─────────────────────────────────────────────────────────────────────────

import prisma from '@/lib/db'
import { chartPairFor } from '@/lib/charts'
import { marketSections } from '@/lib/markets'
import { preflightFundedBuy } from '@/lib/venue-preflight'
import {
  TRADABILITY_MAX_AGE_MS,
  TRADABILITY_PROBE_USD,
  tradeLegsFor,
  type LegVerdict,
  type SymbolTradability,
  type TradabilityMap,
  type TradeLeg,
} from '@/lib/tradability'

/** One read per minute per server — the verdicts move on the cron's clock. */
const TTL_MS = 60_000
let cache: { at: number; map: TradabilityMap } | null = null

/** Every swap leg the board's own chips would execute, in board order. */
export function boardLegs(): TradeLeg[] {
  const out: TradeLeg[] = []
  for (const section of marketSections()) {
    for (const row of section.rows) {
      const pair = chartPairFor(row.symbol)
      if (!pair) continue
      out.push(...tradeLegsFor(row.symbol, pair))
    }
  }
  return out
}

/** The whole cache, fresh rows only. Never throws. */
export async function readTradability(): Promise<TradabilityMap> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map
  const map = await readUncached()
  cache = { at: Date.now(), map }
  return map
}

/** Drops the memoized copy — the cron calls it so its own writes are visible
 *  to the next render instead of up to a minute later. */
export function forgetTradability(): void {
  cache = null
}

async function readUncached(): Promise<TradabilityMap> {
  try {
    const since = new Date(Date.now() - TRADABILITY_MAX_AGE_MS)
    const rows = await prisma.symbolTradability.findMany({
      where: { checkedAt: { gte: since } },
      select: { symbol: true, chainId: true, side: true, verdict: true, reason: true, checkedAt: true },
    })
    const map: Record<string, SymbolTradability> = {}
    for (const r of rows) {
      if (r.side !== 'buy' && r.side !== 'sell') continue
      if (r.verdict !== 'fillable' && r.verdict !== 'no-venue') continue
      const t = (map[r.symbol] ??= { symbol: r.symbol, legs: [] })
      t.legs.push({ chainId: r.chainId, side: r.side, verdict: r.verdict as LegVerdict, reason: r.reason ?? undefined, checkedAt: r.checkedAt.toISOString() })
    }
    return map
  } catch {
    return {}
  }
}

export interface TradabilityRefresh {
  /** Legs measured this pass. */
  read: number
  fillable: number
  noVenue: number
  /** Definite-miss reads that a re-read didn't confirm, and outages. */
  unknown: number
  /** Legs still waiting for their turn when the budget ran out. */
  left: number
  ms: number
}

/**
 * Measure the stalest legs and write them back. Oldest-first (a leg with no
 * row at all is infinitely old), bounded by a wall-clock budget so the
 * function returns inside its 30s. `unknown` is NOT written: a leg whose
 * read timed out keeps its last verdict and its place in the queue.
 */
export async function refreshTradability(opts: { budgetMs?: number; concurrency?: number; legs?: TradeLeg[] } = {}): Promise<TradabilityRefresh> {
  const budgetMs = opts.budgetMs ?? 20_000
  const concurrency = opts.concurrency ?? 6
  const started = Date.now()
  const legs = opts.legs ?? boardLegs()

  let known = new Map<string, number>()
  try {
    const rows = await prisma.symbolTradability.findMany({ select: { symbol: true, chainId: true, side: true, checkedAt: true } })
    known = new Map(rows.map((r) => [`${r.symbol}:${r.chainId}:${r.side}`, r.checkedAt.getTime()]))
  } catch {
    /* an unreadable cache is a cold cache: measure in board order */
  }
  const queue = [...legs].sort((a, b) => (known.get(keyOf(a)) ?? 0) - (known.get(keyOf(b)) ?? 0))

  const out: TradabilityRefresh = { read: 0, fillable: 0, noVenue: 0, unknown: 0, left: 0, ms: 0 }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
      for (;;) {
        if (Date.now() - started > budgetMs) return
        const leg = queue.shift()
        if (!leg) return
        const v = await preflightFundedBuy({ chainId: leg.chainId, sellToken: leg.sellToken, buyToken: leg.buyToken, amountHuman: TRADABILITY_PROBE_USD.toFixed(2) })
        out.read++
        if (v.kind === 'unknown') {
          out.unknown++
          continue
        }
        if (v.kind === 'fillable') out.fillable++
        else out.noVenue++
        await writeLeg(leg, v.kind, v.kind === 'no-venue' ? v.reason : null)
      }
    }),
  )
  out.left = queue.length
  out.ms = Date.now() - started
  forgetTradability()
  return out
}

const keyOf = (l: TradeLeg) => `${l.symbol}:${l.chainId}:${l.side}`

async function writeLeg(leg: TradeLeg, verdict: LegVerdict, reason: string | null): Promise<void> {
  const data = { verdict, reason, sizeUsd: TRADABILITY_PROBE_USD, checkedAt: new Date() }
  try {
    await prisma.symbolTradability.upsert({
      where: { symbol_chainId_side: { symbol: leg.symbol, chainId: leg.chainId, side: leg.side } },
      update: data,
      create: { symbol: leg.symbol, chainId: leg.chainId, side: leg.side, ...data },
    })
  } catch {
    /* a write that fails leaves the leg stale — it leads the next pass */
  }
}
