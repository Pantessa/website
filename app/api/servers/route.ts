import { NextResponse } from 'next/server'
import { loadCatalog } from '@/lib/catalog'
import { serviceReputation } from '@/lib/route-telemetry'

/**
 * Serves the x402 MCP directory.
 *
 * The directory lives in Postgres (Neon), ingested from agentic.market via
 * `npm run db:ingest`. When `USE_DB=true` + `DATABASE_URL` are set, this reads
 * from the DB; otherwise it falls back to the curated in-code catalog
 * (`lib/mcp-data.ts`) so the app works with no database at all. The loading
 * logic is shared with the Auto-Router via `lib/catalog.loadCatalog`.
 *
 * Each service is enriched with its usage-driven `reputation` (settle rate +
 * settled count from the spend ledger, B18) — aggregate, no PII, absent for
 * services with no history.
 */
export async function GET() {
  const catalog = await loadCatalog()
  const rep = await serviceReputation(catalog.map((s) => s.name))
  const enriched = catalog.map((s) => {
    const r = rep.get(s.name)
    return r ? { ...s, reputation: r } : s
  })
  // Keep callable/auto-callable first (as loadCatalog ordered), then rank by
  // reputation within each tier — the "most reliable" surface, no new UI.
  const repScore = (s: (typeof enriched)[number]) => (s.reputation ? s.reputation.settleRate * Math.log10(s.reputation.settled + 1) : 0)
  enriched.sort((a, b) => Number(b.callable || b.autoCallable) - Number(a.callable || a.autoCallable) || repScore(b) - repScore(a))
  return NextResponse.json(enriched)
}
