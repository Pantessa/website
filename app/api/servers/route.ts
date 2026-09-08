import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { loadCatalog } from '@/lib/catalog'
import { serviceReputation } from '@/lib/route-telemetry'
import { getAuthAddress } from '@/lib/api-key'
import { discoverMcpTools, bestIconSrc } from '@/lib/mcp-introspect'
import { canManageServer, isReviewerAddress, MAX_PENDING_PER_WALLET, pendingCountFor } from '@/lib/mcp-review'

/**
 * Accept only a safe image logo: an https:// URL or an inline data:image/ URI.
 * Rejects javascript:/http:/other schemes and anything over ~256KB (a data URI
 * that large is abuse, not a favicon). Returns null for anything invalid so a
 * bad value simply falls back to the glyph.
 */
function sanitizeLogoUrl(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  if (!v) return null
  if (v.length > 256_000) return null
  if (/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);/i.test(v)) return v
  try {
    return new URL(v).protocol === 'https:' ? v : null
  } catch {
    return null
  }
}

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
export async function GET(req: NextRequest) {
  // The viewer's own pending/rejected requests ride along (status visible to
  // the requester only); everyone else sees approved rows. The requester's
  // wallet never leaves the server — it collapses to a `mine` flag.
  const viewer = (await getAuthAddress(req))?.toLowerCase() ?? null
  const catalog = await loadCatalog({ viewer })
  const rep = await serviceReputation(catalog.map((s) => s.name))
  const enriched = catalog.map((s) => {
    const r = rep.get(s.name)
    const { ownerAddress, ...rest } = s as typeof s & { ownerAddress?: string | null }
    const row = { ...rest, mine: !!viewer && ownerAddress === viewer }
    return r ? { ...row, reputation: r } : row
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
 * not a dead listing. SIWE session (or Bearer key) required. Rows are marked
 * source:'custom' so db:ingest/audit leave them alone and only they can be
 * deleted. ADMISSION GATE (2026-09-08, lib/mcp-review.ts): a non-reviewer's
 * row is born `pending` — visible only to them, callable by nobody — until a
 * reviewer approves it. Reviewers' own adds go live immediately.
 */
export async function POST(req: NextRequest) {
  const address = (await getAuthAddress(req))?.toLowerCase() ?? null
  if (!address) {
    return NextResponse.json({ error: 'Sign in to request an MCP.' }, { status: 401 })
  }
  // ADMISSION GATE (lib/mcp-review.ts): a reviewer's own add goes live at
  // once; anyone else's lands `pending` — private to them, never callable —
  // until a reviewer approves it from /dashboard/mcp-requests.
  const reviewer = isReviewerAddress(address)
  const reviewStatus = reviewer ? 'approved' : 'pending'
  if (!reviewer && (await pendingCountFor(address)) >= MAX_PENDING_PER_WALLET) {
    return NextResponse.json(
      { error: `You already have ${MAX_PENDING_PER_WALLET} MCPs awaiting review — wait for a decision before requesting another.` },
      { status: 429 },
    )
  }

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  // Tool names the submitter flagged as "ping first" — a new connected account's
  // quick view calls these first, and the endpoint planner reads them as the
  // service's starting hints. Marked featured on the endpoint rows below.
  const featuredTools = new Set(
    Array.isArray(body.featuredTools)
      ? (body.featuredTools as unknown[]).filter((t): t is string => typeof t === 'string')
      : [],
  )

  const name = typeof body.name === 'string' ? body.name.trim().slice(0, 80) : ''
  const description = typeof body.description === 'string' ? body.description.trim().slice(0, 600) : ''
  // Why the requester wants it / who runs it — shown to the reviewer only.
  const requestNote = typeof body.requestNote === 'string' ? body.requestNote.trim().slice(0, 500) || null : null
  const category = typeof body.category === 'string' ? body.category.trim() : ''
  const color = typeof body.color === 'string' ? body.color : null
  const websiteUrl = typeof body.websiteUrl === 'string' && body.websiteUrl ? body.websiteUrl : null
  const mcpUrl = typeof body.mcpUrl === 'string' && body.mcpUrl ? body.mcpUrl : websiteUrl
  // A logo the submitter linked/uploaded (legacy field name: iconUrl). If absent
  // we fall back to whatever the MCP declares in serverInfo.icons below.
  let logoUrl = sanitizeLogoUrl(body.logoUrl) ?? sanitizeLogoUrl(body.iconUrl)

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
      // Auto-pull the MCP's own declared logo (serverInfo.icons) when the
      // submitter didn't provide one — the "SET LOGO" the server ships itself.
      if (!logoUrl) logoUrl = sanitizeLogoUrl(bestIconSrc(discovery.serverInfo))
    } catch (e) {
      discoveryError = e instanceof Error ? e.message : 'MCP discovery failed'
    }
  }

  const plannableCount = tools.filter((t) => t.plannable).length
  const kind = category === 'Inference' ? 'inference' : 'data'

  const data = {
    name,
    description,
    category: category === 'Custom' ? 'Other' : category,
    kind,
    // '0' marks it explicitly free so the planner will call it (a null price
    // also numbers to 0 but is treated as "unknown" and skipped).
    priceUsd: tools.length > 0 ? '0' : null,
    networks: [] as string[],
    gated: false,
    callable: false, // the PLANNER calls the tools (autoCallable via endpoints)
    // The MCP base ON THE ROW, like the seeded first-party rows — surfaces
    // that judge callability read s.endpoint (the cross-chain agent guard
    // false-negatived on a modal row that only had endpoint children,
    // live 2026-07-10).
    endpoint: base,
    protocol: base ? 'mcp' : null,
    color,
    logoUrl,
    websiteUrl,
    source: 'custom',
    featured: false,
    ownerAddress: address,
    reviewStatus,
    requestNote,
    requestedAt: new Date(),
    // A fresh request or re-request always clears the last decision.
    reviewNote: null,
    reviewedBy: null,
    reviewedAt: null,
  }

  // Idempotent re-add: the same MCP base UPDATES the existing custom row
  // (fresh tools, fresh metadata) instead of minting a sibling slug —
  // re-adding was creating duplicate directory rows (live 2026-07-10).
  const existing = base
    ? await prisma.mcpServer.findFirst({
        where: {
          source: 'custom',
          OR: [{ endpoint: base }, { endpoints: { some: { url: { startsWith: `${base}/` } } } }],
        },
        select: { id: true, source: true, ownerAddress: true, reviewStatus: true },
      })
    : null
  // Only the wallet that requested the row (or a reviewer) may refresh it —
  // re-adding used to let ANY signed-in wallet repoint another user's row
  // (name, logo, tool surface) at their own server.
  if (existing && !canManageServer(existing, address)) {
    return NextResponse.json({ error: 'That MCP base is already listed by another wallet.' }, { status: 409 })
  }

  const server = existing
    ? await prisma.mcpServer.update({ where: { id: existing.id }, data })
    : await prisma.mcpServer.create({ data: { ...data, slug: await uniqueSlug(slugify(name)) } })

  // Replace the tool surface wholesale (no-op on a fresh row).
  await prisma.mcpEndpoint.deleteMany({ where: { serverId: server.id } })
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
        featured: featuredTools.has(t.name),
      })),
    })
  }

  const { ownerAddress: _owner, ...publicRow } = server
  void _owner
  return NextResponse.json({
    ...publicRow,
    mine: true,
    // 'pending' → the requester sees it in THEIR directory as awaiting review;
    // it routes nowhere until a reviewer approves it.
    pending: server.reviewStatus === 'pending',
    endpointCount: tools.length,
    plannableCount,
    mcpBase: base,
    discoveredTools: tools.map((t) => t.name),
    discoveryError,
    // True when this add refreshed an existing row instead of creating one.
    updated: !!existing,
    // Lets the freshly added row paint the connect-time quick view immediately
    // (the catalog derives the same flag from mcp_endpoints.featured).
    splashReady: tools.some((t) => featuredTools.has(t.name)),
  })
}

/**
 * Delete a custom server (and its endpoints, via cascade). Only source:'custom'
 * rows are removable — the ingested catalog is protected — and only by the
 * wallet that requested the row or a reviewer (any signed-in wallet could
 * delete any custom row before 2026-09-08). SIWE/Bearer required.
 */
export async function DELETE(req: NextRequest) {
  const address = (await getAuthAddress(req))?.toLowerCase() ?? null
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
    select: { id: true, source: true, ownerAddress: true },
  })
  if (!server) {
    return NextResponse.json({ error: 'Server not found.' }, { status: 404 })
  }
  if (server.source !== 'custom') {
    return NextResponse.json({ error: 'Only custom servers can be deleted.' }, { status: 403 })
  }
  if (!canManageServer(server, address)) {
    return NextResponse.json({ error: 'Only the wallet that requested this MCP (or a reviewer) can remove it.' }, { status: 403 })
  }
  await prisma.mcpServer.delete({ where: { id: server.id } })
  return NextResponse.json({ ok: true })
}
