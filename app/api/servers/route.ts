import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { CATALOG } from '@/lib/mcp-data'

/**
 * Serves the x402 MCP directory.
 *
 * The directory lives in Postgres (Neon), ingested from agentic.market via
 * `npm run db:ingest`. When `USE_DB=true` + `DATABASE_URL` are set, this reads
 * from the DB; otherwise it falls back to the curated in-code catalog
 * (`lib/mcp-data.ts`) so the app works with no database at all.
 */
function dbEnabled(): boolean {
  return process.env.USE_DB === 'true' && !!process.env.DATABASE_URL
}

export async function GET() {
  if (!dbEnabled()) {
    return NextResponse.json(CATALOG)
  }
  try {
    const servers = await prisma.mcpServer.findMany({
      // Callable (wired) first, then by category, then alphabetical.
      orderBy: [{ callable: 'desc' }, { category: 'asc' }, { name: 'asc' }],
      // Endpoint count for the card badge (full list loads on the detail route).
      include: { _count: { select: { endpoints: true } } },
    })
    if (servers.length === 0) return NextResponse.json(CATALOG)
    return NextResponse.json(servers)
  } catch (error) {
    console.warn(
      'servers: DB query failed, serving static catalog:',
      error instanceof Error ? error.message : error,
    )
    return NextResponse.json(CATALOG)
  }
}
