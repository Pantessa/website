// ─────────────────────────────────────────────────────────────────────────
//  MCP directory loader — the authoritative server-side catalog.
//
//  Extracted from /api/servers so the Auto-Router (which picks services with
//  NO client selection) can read the SAME directory server-side: prices,
//  endpoints, and callability come from the DB, never from a client payload.
//
//  Reads Postgres (Neon) when USE_DB=true + DATABASE_URL are set; otherwise
//  falls back to the curated in-code catalog so the app works with no DB.
// ─────────────────────────────────────────────────────────────────────────

import prisma from '@/lib/db'
import { CATALOG } from '@/lib/mcp-data'
import { FREE_FLEET_FALLBACK } from '@/lib/free-fleet'
import { autoCallableServerIds } from '@/lib/endpoint-planner'
import type { McpServer } from '@/lib/store'

// No-DB fallback: the free first-party fleet leads (it's the default
// directory view — a paid-only fallback would render it empty), then the
// static x402 catalog.
const STATIC_CATALOG = [...FREE_FLEET_FALLBACK, ...(CATALOG as unknown as McpServer[])]

export function catalogDbEnabled(): boolean {
  return process.env.USE_DB === 'true' && !!process.env.DATABASE_URL
}

/**
 * Local-dev catalog extension: EXTRA_MCP_ROWS = a JSON array of partial
 * McpServer-shaped objects (each with a `slug`), merged into the loaded
 * catalog — matching slugs are overlaid (extras win), new slugs appended.
 * Lets a not-yet-seeded MCP (e.g. cow-free) be exercised locally without
 * touching the shared Neon DB. Unset in prod → a no-op.
 */
function withExtraRows(catalog: McpServer[]): McpServer[] {
  const raw = process.env.EXTRA_MCP_ROWS
  if (!raw) return catalog
  try {
    const extras = JSON.parse(raw) as (Partial<McpServer> & { slug: string })[]
    if (!Array.isArray(extras)) return catalog
    const out = [...catalog]
    for (const extra of extras) {
      if (!extra || typeof extra.slug !== 'string') continue
      const i = out.findIndex((s) => s.slug === extra.slug)
      if (i >= 0) out[i] = { ...out[i], ...extra }
      else
        out.push({
          id: `extra-${extra.slug}`,
          name: extra.slug,
          description: '',
          category: 'Other',
          websiteUrl: null,
          color: null,
          ...extra,
        } as McpServer)
    }
    return out
  } catch {
    console.warn('catalog: EXTRA_MCP_ROWS is not valid JSON — ignored')
    return catalog
  }
}

/**
 * The full MCP directory: callable/auto-callable services first, then by
 * category. Mirrors what GET /api/servers returns (and is now its source).
 */
export async function loadCatalog(): Promise<McpServer[]> {
  return withExtraRows(await loadCatalogBase())
}

async function loadCatalogBase(): Promise<McpServer[]> {
  if (!catalogDbEnabled()) return STATIC_CATALOG
  try {
    const [servers, autoIds] = await Promise.all([
      prisma.mcpServer.findMany({
        orderBy: [{ callable: 'desc' }, { category: 'asc' }, { name: 'asc' }],
        include: { _count: { select: { endpoints: true } } },
      }),
      autoCallableServerIds(),
    ])
    if (servers.length === 0) return STATIC_CATALOG
    const enriched = servers.map((s) => ({ ...s, autoCallable: autoIds.has(s.id) }))
    enriched.sort((a, b) => Number(b.callable || b.autoCallable) - Number(a.callable || a.autoCallable))
    return enriched as unknown as McpServer[]
  } catch (error) {
    console.warn('catalog: DB query failed, using static catalog:', error instanceof Error ? error.message : error)
    return STATIC_CATALOG
  }
}
