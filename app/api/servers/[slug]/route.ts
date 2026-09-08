import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getAuthAddress } from '@/lib/api-key'
import { isLiveServer, isReviewerAddress } from '@/lib/mcp-review'
import { getSessionAddress } from '@/lib/auth'
import { isAdminAddress } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ slug: string }> }

/**
 * Service detail: a single directory service plus its full x402 endpoint
 * surface (the mcp_endpoints child table), ordered for display. Endpoints live
 * only in the DB, so this route is DB-only — no static catalog fallback.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { slug } = await params
  try {
    const server = await prisma.mcpServer.findUnique({
      where: { slug },
      include: { endpoints: { orderBy: { position: 'asc' } } },
    })
    if (!server) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    // A row under review exists only for its requester and reviewers; to
    // everyone else it doesn't (lib/mcp-review.ts). The requester's wallet
    // never leaves the server.
    const { ownerAddress, ...publicRow } = server
    if (!isLiveServer(server)) {
      const viewer = (await getAuthAddress(_req))?.toLowerCase() ?? null
      if (!viewer || (viewer !== ownerAddress && !isReviewerAddress(viewer))) {
        return NextResponse.json({ error: 'Not found.' }, { status: 404 })
      }
    }
    return NextResponse.json(publicRow)
  } catch (error) {
    console.warn('server detail: DB query failed:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Unavailable.' }, { status: 503 })
  }
}

/**
 * Delete a service from the directory. Pantessa ADMIN ONLY (SIWE session, checked
 * against isAdminAddress) — the "Delete Server" control on the detail page hits
 * this. Cascades the endpoint surface + approvals via Prisma relations; the
 * slug-keyed side rows (owner claim + ratings) have no FK, so we drop them
 * explicitly in the same transaction. Irreversible.
 */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { slug } = await params
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Sign in.' }, { status: 401 })
  if (!isAdminAddress(addr)) return NextResponse.json({ error: 'Admins only.' }, { status: 403 })

  try {
    const server = await prisma.mcpServer.findUnique({ where: { slug }, select: { id: true } })
    if (!server) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

    await prisma.$transaction([
      prisma.mcpOwner.deleteMany({ where: { mcpSlug: slug } }),
      prisma.mcpRating.deleteMany({ where: { serviceSlug: slug } }),
      // Cascades mcp_endpoints + agent_approvals via their onDelete: Cascade relations.
      prisma.mcpServer.delete({ where: { slug } }),
    ])
    return NextResponse.json({ ok: true, deleted: slug })
  } catch (error) {
    console.warn('server delete failed:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Delete failed.' }, { status: 500 })
  }
}
