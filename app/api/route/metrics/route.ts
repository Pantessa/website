import { NextResponse } from 'next/server'
import { routeMetrics } from '@/lib/route-telemetry'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Public, aggregate-only routing metrics (B14) — makes the engine observable:
 * turns, avg cost per answered turn, total $ saved, cache-hit rate, avg
 * shortlist size, p50/p95 latency, and per-MCP settle rates. No PII (mirrors
 * /api/activity's privacy posture); short-cached.
 */
export async function GET() {
  try {
    const metrics = await routeMetrics()
    return NextResponse.json(metrics, {
      headers: { 'Cache-Control': 's-maxage=120, stale-while-revalidate=300' },
    })
  } catch {
    return NextResponse.json(
      { turns: 0, avgCostUsd: 0, totalSavedUsd: 0, cacheHitRate: 0, avgShortlisted: 0, blockedRate: 0, latencyMs: { p50: 0, p95: 0 }, services: [] },
      { headers: { 'Cache-Control': 's-maxage=120, stale-while-revalidate=300' } },
    )
  }
}
