import { NextResponse } from 'next/server'
import { isAddress } from 'viem'
import prisma from '@/lib/db'
import type { McpServer } from '@/lib/store'
import { buildSplash } from '@/lib/splash/sources'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Derive an MCP base URL (…/mcp) from a stored server row: its own `endpoint`
 *  column, else the shared prefix of a child endpoint url — free MCPs keep the
 *  base only in `mcp_endpoints` (the `<base>/mcp#tool` or `/mcp/tool`
 *  convention), so `mcp_servers.endpoint` is null for them. */
function mcpBaseOf(endpoint: string | null, childUrl: string | null): string | null {
  for (const u of [endpoint, childUrl]) {
    if (!u) continue
    const m = u.match(/^(.+\/mcp)(?:[#/].*)?$/)
    if (m) return m[1]
  }
  return null
}

/**
 * The connected-wallet splash. Given a wallet address and the connected MCP
 * set (by slug), returns a tile per MCP that has an "overview" read (Uniswap
 * portfolio, Snapshot proposals, …). Base URLs are resolved server-side from
 * the DB — the client doesn't carry free-MCP endpoints. Pure free-MCP reads:
 * no spend, no auth. The chat UI paints this before the first keystroke.
 */
export async function POST(req: Request) {
  let body: { address?: string; servers?: Pick<McpServer, 'slug'>[] }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const address = typeof body.address === 'string' ? body.address.trim() : ''
  if (!isAddress(address)) {
    // No/invalid wallet → no splash (caller falls back to the normal empty state).
    return NextResponse.json({ address: '', tiles: [] })
  }
  const slugs = [
    ...new Set((Array.isArray(body.servers) ? body.servers : []).map((s) => s?.slug).filter((s): s is string => !!s)),
  ]
  if (slugs.length === 0) return NextResponse.json({ address, tiles: [] })

  try {
    const rows = await prisma.mcpServer.findMany({
      where: { slug: { in: slugs } },
      select: {
        id: true,
        slug: true,
        name: true,
        endpoint: true,
        endpoints: { select: { url: true }, take: 1 },
      },
    })
    // Resolve each to a minimal server carrying the MCP base URL for buildSplash.
    const resolved: McpServer[] = rows
      .map((r) => {
        const base = mcpBaseOf(r.endpoint, r.endpoints[0]?.url ?? null)
        return base ? ({ id: r.id, slug: r.slug, name: r.name, endpoint: base } as McpServer) : null
      })
      .filter((s): s is McpServer => s !== null)

    const tiles = await buildSplash(address, resolved)
    return NextResponse.json({ address, tiles })
  } catch (err) {
    return NextResponse.json({ address, tiles: [], error: err instanceof Error ? err.message : 'splash failed' })
  }
}
