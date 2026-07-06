import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { loadCatalog } from '@/lib/catalog'
import { serviceReputation } from '@/lib/route-telemetry'
import { getAuthAddress } from '@/lib/api-key'
import { discoverMcpTools } from '@/lib/mcp-introspect'

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

const CATEGORIES = new Set([
  'Inference', 'Data', 'Search', 'Media', 'Social', 'Trading', 'Infra', 'Storage', 'Travel', 'Other', 'Custom',
])

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/** Find a free slug: base, then base-2, base-3, … */
async function uniqueSlug(base: string): Promise<string> {
  const root = base || 'custom-server'
  for (let i = 1; i < 100; i++) {
    const slug = i === 1 ? root : `${root}-${i}`
    const existing = await prisma.mcpServer.findUnique({ where: { slug }, select: { id: true } })
    if (!existing) return slug
  }
  return `${root}-${Date.now()}`
}

/**
 * Add a custom MCP server to the directory. Paste a base URL (e.g.
 * https://cow-mcp.yeetful.com/) and every tool is discovered from the server's
 * own `tools/list` and wired as a routable free (non-gated) endpoint — matching
 * the shape `lib/endpoint-planner.ts` expects, so the row is planner-callable,
 * not a dead listing. SIWE session (or Bearer key) required — this writes to the
 * shared directory. Rows are marked source:'custom' so db:ingest/audit leave
 * them alone and only they can be deleted.
 */
export async function POST(req: NextRequest) {
  const address = await getAuthAddress(req)
  if (!address) {
    return NextResponse.json({ error: 'Sign in to add a server to the directory.' }, { status: 401 })
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  const category = typeof body.category === 'string' ? body.category.trim() : ''
  const color = typeof body.color === 'string' ? body.color : null
  const websiteUrl = typeof body.websiteUrl === 'string' && body.websiteUrl ? body.websiteUrl : null
  const mcpUrl = typeof body.mcpUrl === 'string' && body.mcpUrl ? body.mcpUrl : websiteUrl

  if (!name || !description || !category) {
    return NextResponse.json({ error: 'Name, description, and category are required.' }, { status: 400 })
  }
  if (!CATEGORIES.has(category)) {
    return NextResponse.json({ error: `Unknown category "${category}".` }, { status: 400 })
  }

  // Discover the tool surface from the MCP base URL. A failure isn't fatal — we
  // still create a directory listing (just not planner-callable) — but we report
  // the reason so the UI can surface it.
  let base: string | null = null
  let tools: Awaited<ReturnType<typeof discoverMcpTools>>['tools'] = []
  let discoveryError: string | null = null
  if (mcpUrl) {
    try {
      const discovery = await discoverMcpTools(mcpUrl)
      base = discovery.base
      tools = discovery.tools
    } catch (e) {
      discoveryError = e instanceof Error ? e.message : 'MCP discovery failed'
    }
  }

  const plannableCount = tools.filter((t) => t.plannable).length
  const slug = await uniqueSlug(slugify(name))
  const kind = category === 'Inference' ? 'inference' : 'data'

  const server = await prisma.mcpServer.create({
    data: {
      slug,
      name,
      description,
      category: category === 'Custom' ? 'Other' : category,
      kind,
      // '0' marks it explicitly free so the planner will call it (a null price
      // also numbers to 0 but is treated as "unknown" and skipped).
      priceUsd: tools.length > 0 ? '0' : null,
      networks: [],
      gated: false,
      callable: false, // the PLANNER calls the tools (autoCallable via endpoints)
      color,
      websiteUrl,
      source: 'custom',
      featured: false,
    },
  })

  if (base && tools.length > 0) {
    await prisma.mcpEndpoint.createMany({
      data: tools.map((t, i) => ({
        serverId: server.id,
        method: 'POST',
        // Path style `<base>/<tool>` where base ends in /mcp — mcpToolOf parses
        // it back to a tools/call (allowed for priceUsd '0' rows only).
        url: `${base}/${t.name}`,
        description: t.description ?? t.title ?? null,
        priceUsd: '0',
        scheme: 'exact',
        network: 'Base',
        provider: 'Custom (MCP)',
        position: i,
        // Display-only tools (param-less / signing) get DbNull params so the
        // planner never constructs them.
        parameters: t.plannable ? (t.params as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      })),
    })
  }

  return NextResponse.json({
    ...server,
    endpointCount: tools.length,
    plannableCount,
    mcpBase: base,
    discoveredTools: tools.map((t) => t.name),
    discoveryError,
  })
}

/**
 * Delete a custom server (and its endpoints, via cascade). Only source:'custom'
 * rows are removable — the ingested catalog is protected. SIWE/Bearer required.
 */
export async function DELETE(req: NextRequest) {
  const address = await getAuthAddress(req)
  if (!address) {
    return NextResponse.json({ error: 'Sign in required.' }, { status: 401 })
  }
  const id = req.nextUrl.searchParams.get('id')
  const slug = req.nextUrl.searchParams.get('slug')
  if (!id && !slug) {
    return NextResponse.json({ error: 'id or slug required.' }, { status: 400 })
  }
  const server = await prisma.mcpServer.findFirst({
    where: id ? { id } : { slug: slug! },
    select: { id: true, source: true },
  })
  if (!server) {
    return NextResponse.json({ error: 'Server not found.' }, { status: 404 })
  }
  if (server.source !== 'custom') {
    return NextResponse.json({ error: 'Only custom servers can be deleted.' }, { status: 403 })
  }
  await prisma.mcpServer.delete({ where: { id: server.id } })
  return NextResponse.json({ ok: true })
}
