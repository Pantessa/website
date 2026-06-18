import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/mcp/mine — the MCP servers the signed-in wallet has claimed: its
// payees, the services it operates and collects x402 revenue from. Ownership is
// per-wallet (McpOwner.ownerAddress, proven at claim time via the payTo
// receiver), so this is scoped to the session address, not the active org. We
// join to the directory record for display + the detail-page link.
export async function GET() {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Sign in.' }, { status: 401 })

  const owners = await prisma.mcpOwner.findMany({
    where: { ownerAddress: addr },
    orderBy: { claimedAt: 'desc' },
  })
  if (owners.length === 0) return NextResponse.json([])

  const servers = await prisma.mcpServer.findMany({
    where: { slug: { in: owners.map((o) => o.mcpSlug) } },
    select: { slug: true, name: true, category: true, priceUsd: true, callable: true },
  })
  const bySlug = new Map(servers.map((s) => [s.slug, s]))

  // A claim can outlive its directory row (e.g. a pruned ingest); skip those —
  // there's no detail page to link to.
  const rows = owners.flatMap((o) => {
    const s = bySlug.get(o.mcpSlug)
    if (!s) return []
    return [
      {
        slug: s.slug,
        name: s.name,
        category: s.category,
        priceUsd: s.priceUsd,
        callable: s.callable,
        host: o.verifiedHost,
        verifiedVia: o.verifiedVia,
        claimedAt: o.claimedAt,
      },
    ]
  })
  return NextResponse.json(rows)
}
