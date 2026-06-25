// ─────────────────────────────────────────────────────────────────────────
//  MCP reputation — turn the call ledger + user ratings into a multi-dimension
//  reputation score per service, aggregated into one overall score + tier.
//
//  Five automated sub-scores (0–100), from data we already log, plus a human
//  rating dimension:
//    • reliability — settle rate, Bayesian-smoothed (1/1 ≠ 100%)
//    • liveness    — recency of the last good settle; recent all-fail → 0
//    • speed       — median settle latency on a curve
//    • adoption    — settled-call volume, log-scaled
//    • value       — price vs. category peers (cheaper = higher)
//    • userRating  — Bayesian-averaged 1–5 stars (null until anyone rates)
//
//  Overall = weighted blend over the AVAILABLE dimensions → tier A+…D / New.
//  Pure-ish: one grouped ledger read + one ratings read, math is deterministic.
// ─────────────────────────────────────────────────────────────────────────

import prisma from '@/lib/db'

const WINDOW_MS = 30 * 86_400_000
/** Min evidence (calls or ratings) for a service to earn a graded tier. Set to
 *  1 — any real call/rating gets an A–F grade; gaming a few calls into a top
 *  rank is already prevented by the adoption (log-volume) dimension in the
 *  blend, not a hard cutoff. Only genuinely untested services (0 calls, 0
 *  ratings) stay "Unrated". */
export const MIN_CALLS_FOR_TIER = 1
export const MIN_RATINGS_FOR_TIER = 1

export interface SubScores {
  reliability: number
  liveness: number
  speed: number | null // null = no latency data yet
  adoption: number
  value: number | null // null = unpriced
  userRating: number | null // null = unrated
}

export interface ReputationScore {
  slug: string
  name: string
  overall: number
  tier: string // A+ | A | B | C | D | New
  scores: SubScores
  settled: number
  failed: number
  settleRate: number
  calls: number
  medianLatencyMs: number | null
  avgPriceUsd: number | null
  ratingAvg: number | null
  ratingCount: number
  lastSettledAt: string | null
  qualified: boolean
}

interface ServerInput {
  slug: string
  name: string
  category: string
  priceUsd: string | null
}

interface LedgerAgg {
  name: string
  settled: number
  failed: number
  median_latency: number | null
  last_settled: Date | null
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n))

// ── Sub-score curves ─────────────────────────────────────────────────────────
// Bayesian settle rate: pull toward the global prior with M pseudo-observations
// so a 1/1 service isn't ranked above a 980/1000 one.
function reliabilityScore(settled: number, failed: number, prior: number, M = 5): number {
  const total = settled + failed
  return clamp((100 * (settled + M * prior)) / (total + M))
}

// Recency of the last successful settle; a service whose only recent calls
// failed scores 0 (this is what sinks a dead gateway like Heurist Mesh).
function livenessScore(settled: number, failed: number, lastSettled: Date | null, now: number): number {
  if (settled === 0) return failed > 0 ? 0 : 50 // never settled: fail-only = dead, silent = unknown
  if (!lastSettled) return 50
  const days = (now - lastSettled.getTime()) / 86_400_000
  if (days <= 1) return 100
  if (days >= 14) return 10
  return clamp(100 - ((days - 1) / 13) * 90)
}

// Latency curve: ≤800ms = 100, ≥8s = 20, linear between. Null = unknown.
function speedScore(medianMs: number | null): number | null {
  if (medianMs == null) return null
  if (medianMs <= 800) return 100
  if (medianMs >= 8000) return 20
  return clamp(100 - ((medianMs - 800) / 7200) * 80)
}

// Volume, log-scaled: ~2k settled calls ≈ 100; 200 ≈ 75; 20 ≈ 50; 2 ≈ 25.
function adoptionScore(settled: number): number {
  if (settled <= 0) return 0
  return clamp((100 * Math.log10(settled + 1)) / Math.log10(2001))
}

// Price vs. category peers — cheaper = higher. Computed across the input set.
function valueScores(servers: ServerInput[]): Map<string, number | null> {
  const byCat = new Map<string, { slug: string; price: number }[]>()
  for (const s of servers) {
    const p = Number(s.priceUsd)
    if (!Number.isFinite(p) || p <= 0) continue
    const arr = byCat.get(s.category) ?? []
    arr.push({ slug: s.slug, price: p })
    byCat.set(s.category, arr)
  }
  const out = new Map<string, number | null>()
  for (const s of servers) out.set(s.slug, null) // unpriced default
  for (const [, arr] of byCat) {
    const sorted = arr.slice().sort((a, b) => a.price - b.price)
    const n = sorted.length
    sorted.forEach((e, i) => {
      // cheapest → 100, priciest → ~40; single-member category → 75 (neutral-good)
      const score = n === 1 ? 75 : clamp(100 - (i / (n - 1)) * 60)
      out.set(e.slug, score)
    })
  }
  return out
}

// Bayesian star rating → 0–100. prior 3.2/5 with M pseudo-votes.
function userRatingScore(sum: number, count: number, M = 3, prior = 3.2): number | null {
  if (count === 0) return null
  const avg = (sum + M * prior) / (count + M)
  return clamp((avg / 5) * 100)
}

// A–F report-card scale. "Unrated" only for services with no evidence at all —
// an untested service isn't failing, so it's not an F.
function tierFor(overall: number, qualified: boolean): string {
  if (!qualified) return 'Unrated'
  if (overall >= 80) return 'A'
  if (overall >= 70) return 'B'
  if (overall >= 60) return 'C'
  if (overall >= 50) return 'D'
  return 'F'
}

// Weighted blend over the dimensions that have a value (null dims drop out and
// their weight is redistributed proportionally).
const WEIGHTS: Record<keyof SubScores, number> = {
  reliability: 0.3,
  liveness: 0.2,
  adoption: 0.15,
  speed: 0.15,
  value: 0.1,
  userRating: 0.1,
}
function blend(scores: SubScores): number {
  let num = 0
  let den = 0
  for (const k of Object.keys(WEIGHTS) as (keyof SubScores)[]) {
    const v = scores[k]
    if (v == null) continue
    num += v * WEIGHTS[k]
    den += WEIGHTS[k]
  }
  return den === 0 ? 0 : clamp(num / den)
}

/**
 * Compute reputation for the given services. One grouped ledger read + one
 * ratings read; everything else is in-memory math.
 */
export async function computeReputation(servers: ServerInput[]): Promise<Map<string, ReputationScore>> {
  const out = new Map<string, ReputationScore>()
  if (servers.length === 0) return out
  const dbOn = process.env.USE_DB === 'true' && !!process.env.DATABASE_URL
  const since = new Date(Date.now() - WINDOW_MS)
  const now = Date.now()

  let ledger: LedgerAgg[] = []
  let ratings: { service_slug: string; sum: number; count: number; avg: number }[] = []
  if (dbOn) {
    try {
      ;[ledger, ratings] = await Promise.all([
        prisma.$queryRaw<LedgerAgg[]>`
          SELECT service_name AS name,
                 COUNT(*) FILTER (WHERE ok)::int AS settled,
                 COUNT(*) FILTER (WHERE NOT ok)::int AS failed,
                 percentile_cont(0.5) WITHIN GROUP (ORDER BY latency_ms) FILTER (WHERE ok AND latency_ms IS NOT NULL) AS median_latency,
                 MAX(created_at) FILTER (WHERE ok) AS last_settled
          FROM spend_ledger
          WHERE created_at >= ${since} AND service_name IS NOT NULL
          GROUP BY 1`,
        prisma.$queryRaw<{ service_slug: string; sum: number; count: number; avg: number }[]>`
          SELECT service_slug, SUM(rating)::int AS sum, COUNT(*)::int AS count, AVG(rating)::float AS avg
          FROM mcp_ratings GROUP BY 1`,
      ])
    } catch {
      /* reputation is advisory — never throw the directory on a read */
    }
  }

  const byName = new Map(ledger.map((r) => [r.name, r]))
  const ratingBySlug = new Map(ratings.map((r) => [r.service_slug, r]))
  const valueBySlug = valueScores(servers)

  // Global prior settle rate for the Bayesian reliability smoothing.
  const totSettled = ledger.reduce((a, r) => a + Number(r.settled), 0)
  const totCalls = ledger.reduce((a, r) => a + Number(r.settled) + Number(r.failed), 0)
  const prior = totCalls > 0 ? totSettled / totCalls : 0.85

  for (const s of servers) {
    const l = byName.get(s.name)
    const settled = Number(l?.settled ?? 0)
    const failed = Number(l?.failed ?? 0)
    const calls = settled + failed
    const medianLatencyMs = l?.median_latency != null ? Math.round(Number(l.median_latency)) : null
    const lastSettled = l?.last_settled ?? null
    const rt = ratingBySlug.get(s.slug)
    const ratingCount = Number(rt?.count ?? 0)
    const ratingSum = Number(rt?.sum ?? 0)
    const ratingAvg = ratingCount > 0 ? Number(rt?.avg) : null

    const scores: SubScores = {
      reliability: reliabilityScore(settled, failed, prior),
      liveness: livenessScore(settled, failed, lastSettled, now),
      speed: speedScore(medianLatencyMs),
      adoption: adoptionScore(settled),
      value: valueBySlug.get(s.slug) ?? null,
      userRating: userRatingScore(ratingSum, ratingCount),
    }
    const overall = Math.round(blend(scores))
    const qualified = calls >= MIN_CALLS_FOR_TIER || ratingCount >= MIN_RATINGS_FOR_TIER

    out.set(s.slug, {
      slug: s.slug,
      name: s.name,
      overall,
      tier: tierFor(overall, qualified),
      scores: {
        reliability: Math.round(scores.reliability),
        liveness: Math.round(scores.liveness),
        speed: scores.speed == null ? null : Math.round(scores.speed),
        adoption: Math.round(scores.adoption),
        value: scores.value == null ? null : Math.round(scores.value),
        userRating: scores.userRating == null ? null : Math.round(scores.userRating),
      },
      settled,
      failed,
      settleRate: calls > 0 ? settled / calls : 0,
      calls,
      medianLatencyMs,
      avgPriceUsd: Number.isFinite(Number(s.priceUsd)) ? Number(s.priceUsd) : null,
      ratingAvg,
      ratingCount,
      lastSettledAt: lastSettled ? lastSettled.toISOString() : null,
      qualified,
    })
  }
  return out
}

/** Recent paid calls ("pings") for one service — the success/fail timeline. */
export async function recentPings(serviceName: string, limit = 20) {
  if (process.env.USE_DB !== 'true' || !process.env.DATABASE_URL) return []
  try {
    const rows = await prisma.spendLedgerEntry.findMany({
      where: { serviceName },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, ok: true, amountUsd: true, txHash: true, note: true, latencyMs: true, createdAt: true },
    })
    return rows.map((r) => ({
      id: r.id,
      ok: r.ok,
      amountUsd: r.amountUsd,
      txHash: r.txHash,
      note: r.note,
      latencyMs: r.latencyMs,
      createdAt: r.createdAt.toISOString(),
    }))
  } catch {
    return []
  }
}
