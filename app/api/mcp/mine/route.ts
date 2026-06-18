import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { endpointHost } from '@/lib/mcp-claim'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/mcp/mine — the MCP servers tied to the signed-in wallet, on the payee
// side of the dashboard. Two sources, both keyed to the wallet:
//   • CLAIMED  — an McpOwner row owned by this wallet (proven at claim time).
//   • OWNED    — a server whose stored x402 `payTo` receiver IS this wallet but
//                that nobody has claimed yet. These get a one-click Claim.
// A server claimed by a *different* wallet is excluded even if its receiver
// matches (shouldn't happen via self-claim, but admin claims can diverge).
// Wallet-scoped, not org-scoped; joined to the directory record for display.
export async function GET() {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Sign in.' }, { status: 401 })

  const [myClaims, ownedServers] = await Promise.all([
    prisma.mcpOwner.findMany({ where: { ownerAddress: addr } }),
    prisma.mcpServer.findMany({
      where: { receiver: addr },
      select: { slug: true, name: true, category: true, priceUsd: true, callable: true, endpoint: true },
    }),
  ])

  // Which owned slugs already have a claim (and by whom) — to mark them claimed
  // or exclude another wallet's claim.
  const ownedSlugs = ownedServers.map((s) => s.slug)
  const claimsOnOwned = ownedSlugs.length
    ? await prisma.mcpOwner.findMany({ where: { mcpSlug: { in: ownedSlugs } } })
    : []
  const claimOwnerBySlug = new Map(claimsOnOwned.map((o) => [o.mcpSlug, o.ownerAddress]))

  // Server records for everything I've claimed (covers admin claims whose
  // receiver doesn't match my wallet, so they're not in ownedServers).
  const claimSlugs = myClaims.map((o) => o.mcpSlug)
  const claimedServers = claimSlugs.length
    ? await prisma.mcpServer.findMany({
        where: { slug: { in: claimSlugs } },
        select: { slug: true, name: true, category: true, priceUsd: true, callable: true, endpoint: true },
      })
    : []

  type Row = {
    slug: string
    name: string
    category: string
    priceUsd: string | null
    callable: boolean
    host: string | null
    claimed: boolean
  }
  const rows = new Map<string, Row>()
  const add = (
    s: { slug: string; name: string; category: string; priceUsd: string | null; callable: boolean; endpoint: string | null },
    claimed: boolean,
  ) => {
    rows.set(s.slug, {
      slug: s.slug,
      name: s.name,
      category: s.category,
      priceUsd: s.priceUsd,
      callable: s.callable,
      host: endpointHost(s.endpoint),
      claimed,
    })
  }

  for (const s of claimedServers) add(s, true)
  for (const s of ownedServers) {
    if (rows.has(s.slug)) continue
    const owner = claimOwnerBySlug.get(s.slug)
    if (owner && owner !== addr) continue // claimed by someone else — not mine
    add(s, false)
  }

  // Unclaimed (actionable) first, then claimed; alpha within each group.
  const out = [...rows.values()].sort(
    (a, b) => Number(a.claimed) - Number(b.claimed) || a.name.localeCompare(b.name),
  )
  return NextResponse.json(out)
}
