import { NextResponse } from 'next/server'
import { loadCatalog } from '@/lib/catalog'

/**
 * Serves the x402 MCP directory.
 *
 * The directory lives in Postgres (Neon), ingested from agentic.market via
 * `npm run db:ingest`. When `USE_DB=true` + `DATABASE_URL` are set, this reads
 * from the DB; otherwise it falls back to the curated in-code catalog
 * (`lib/mcp-data.ts`) so the app works with no database at all. The loading
 * logic is shared with the Auto-Router via `lib/catalog.loadCatalog`.
 */
export async function GET() {
  return NextResponse.json(await loadCatalog())
}
