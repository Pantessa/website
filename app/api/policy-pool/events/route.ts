import { NextRequest, NextResponse } from 'next/server'
import { emptyPolicyPoolStats, listPolicyPoolEvents, policyPoolStats } from '@/lib/policy-pool/ledger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/policy-pool/events — the public ledger: newest rows + the stats
// behind /policy-pool's tiles and charts. Looking is free; no auth. Rows are
// what the desk and the chain wrote, nothing private (no keys, no
// signatures). `?intentId=` returns one intent's timeline (oldest first);
// `?cursor=` pages. Cached 10s at the edge and in-process (the page polls).
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const intentId = q.get('intentId')?.slice(0, 200) || undefined
  const cursor = q.get('cursor')?.slice(0, 64) || undefined
  const limit = Number(q.get('limit')) || 50
  try {
    const [list, stats] = await Promise.all([listPolicyPoolEvents({ limit, cursor, intentId }), intentId ? null : policyPoolStats()])
    return NextResponse.json(
      { ok: true, ...list, stats },
      { headers: { 'cache-control': 'public, s-maxage=10, stale-while-revalidate=20' } },
    )
  } catch (e) {
    console.warn(`[policy-pool events] read failed: ${(e as Error).message}`)
    return NextResponse.json({ ok: false, error: 'ledger unavailable', events: [], nextCursor: null, stats: emptyPolicyPoolStats() }, { status: 503 })
  }
}
