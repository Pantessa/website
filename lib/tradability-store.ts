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
import { callMcpTool } from '@/lib/mcp-call'
import { AAVE_MCP } from '@/lib/aave-exec'
import { hlPerpUniverse } from '@/lib/hl-universe'
import { aaveCapability, aaveRefusal, capabilityLegsFor, perpCapability, perpRefusal, type CapabilityLeg, type ReserveListing } from '@/lib/venue-capability'
import {
  LEG_SIDES,
  TRADABILITY_MAX_AGE_MS,
  TRADABILITY_PROBE_USD,
  tradeLegsFor,
  type LegSide,
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
      if (!(LEG_SIDES as readonly string[]).includes(r.side)) continue
      if (r.verdict !== 'fillable' && r.verdict !== 'no-venue') continue
      const t = (map[r.symbol] ??= { symbol: r.symbol, legs: [] })
      t.legs.push({ chainId: r.chainId, side: r.side as LegSide, verdict: r.verdict as LegVerdict, reason: r.reason ?? undefined, checkedAt: r.checkedAt.toISOString() })
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
  /** The venue LISTINGS pass (Aave reserves, the Hyperliquid universe). */
  listings?: ListingRefresh
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
  // The listings first: two venue reads cover every supply and perp chip on
  // the board, so they never wait behind 480 swap quotes.
  if (!opts.legs) out.listings = await refreshListings({ known })
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

const keyOf = (l: Pick<TradeLeg, 'symbol' | 'chainId'> & { side: LegSide }) => `${l.symbol}:${l.chainId}:${l.side}`

// ── Listings: what each venue's own list says about the board's chips ──────

/** Every venue listing the board's own non-swap chips depend on. */
export function boardCapabilityLegs(): CapabilityLeg[] {
  const out: CapabilityLeg[] = []
  for (const section of marketSections()) {
    for (const row of section.rows) {
      const pair = chartPairFor(row.symbol)
      if (pair) out.push(...capabilityLegsFor(row.symbol, pair))
    }
  }
  return out
}

/** A listing moves when a venue lists or delists a market — days, not
 *  minutes — so one pass an hour is plenty, and a leg nobody has measured
 *  yet is measured on the very next pass. */
const LISTINGS_EVERY_MS = 30 * 60_000
const LISTINGS_TIMEOUT_MS = 8_000

export interface ListingRefresh {
  read: number
  listed: number
  notListed: number
  /** Venues whose list could not be read — their legs keep their last verdict. */
  failed: string[]
  skipped?: true
}

/**
 * Read Aave's reserve list and Hyperliquid's perp universe once each and
 * write a verdict for every board leg that depends on them. A venue that
 * doesn't answer writes NOTHING (never a guess): its legs go stale and their
 * chips come back, exactly like an unread swap leg.
 */
export async function refreshListings(opts: { known?: Map<string, number>; force?: boolean } = {}): Promise<ListingRefresh> {
  const legs = boardCapabilityLegs()
  const out: ListingRefresh = { read: 0, listed: 0, notListed: 0, failed: [] }
  const now = Date.now()
  if (!opts.force && opts.known && legs.every((l) => now - (opts.known!.get(keyOf(l)) ?? 0) < LISTINGS_EVERY_MS)) return { ...out, skipped: true }

  const wantAave = legs.some((l) => l.side !== 'perp')
  const wantHl = legs.some((l) => l.side === 'perp')
  const [aaveR, hl] = await Promise.all([
    wantAave
      ? (callMcpTool(AAVE_MCP, 'reserves', { chainId: 1 }, { timeoutMs: LISTINGS_TIMEOUT_MS }) as Promise<{ reserves?: ReserveListing[] }>).then(
          // An empty list is a broken read, not a venue with nothing listed.
          (r) => (Array.isArray(r?.reserves) && r.reserves.length > 0 ? r.reserves : null),
          () => null,
        )
      : null,
    wantHl ? hlPerpUniverse().catch(() => null) : null,
  ])
  if (wantAave && !aaveR) out.failed.push('aave')
  if (wantHl && !hl) out.failed.push('hyperliquid')

  const writes: Promise<void>[] = []
  for (const leg of legs) {
    let ok: boolean
    let reason: string
    if (leg.side === 'perp') {
      if (!hl) continue
      ok = perpCapability(hl, leg.symbol)
      reason = perpRefusal(leg.symbol)
    } else {
      if (!aaveR) continue
      ok = aaveCapability(aaveR, leg.symbol)[leg.side]
      reason = aaveRefusal(leg.symbol, leg.side)
    }
    out.read++
    if (ok) out.listed++
    else out.notListed++
    writes.push(writeLeg(leg, ok ? 'fillable' : 'no-venue', ok ? null : reason))
  }
  await Promise.all(writes)
  forgetTradability()
  return out
}

async function writeLeg(leg: Pick<TradeLeg, 'symbol' | 'chainId'> & { side: LegSide }, verdict: LegVerdict, reason: string | null): Promise<void> {
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
