import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { isAdminAddress } from '@/lib/admin'
import { claimReceiver, endpointHost, verifyReceiverClaim } from '@/lib/mcp-claim'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ slug: string }> }

function ownerView(o: {
  ownerAddress: string
  verifiedVia: string
  verifiedHost: string | null
  claimedAt: Date
}) {
  return {
    ownerAddress: o.ownerAddress,
    verifiedVia: o.verifiedVia,
    verifiedHost: o.verifiedHost,
    claimedAt: o.claimedAt,
  }
}

/** Public: is this MCP claimed, by whom, and which wallet claims it (its payTo). */
export async function GET(_req: NextRequest, { params }: Params) {
  const { slug } = await params
  const server = await prisma.mcpServer.findUnique({
    where: { slug },
    select: { slug: true, name: true, endpoint: true },
  })
  if (!server) return NextResponse.json({ error: 'Unknown MCP.' }, { status: 404 })

  const owner = await prisma.mcpOwner.findUnique({ where: { mcpSlug: slug } })
  // The wallet an operator must sign in with — read from the MCP's own 402.
  const requiredWallet = owner ? null : await claimReceiver(server.endpoint)
  return NextResponse.json({
    slug: server.slug,
    name: server.name,
    claimed: !!owner,
    owner: owner ? ownerView(owner) : null,
    host: endpointHost(server.endpoint),
    // null when unreadable → operator can't self-verify, needs admin.
    requiredWallet,
  })
}

/** Claim this MCP. SIWE only. Verified by signing in with the MCP's x402 payTo
 *  receiver (read from its own endpoint), or by a Pantessa admin. */
export async function POST(_req: NextRequest, { params }: Params) {
  const { slug } = await params
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Sign in to claim an MCP.' }, { status: 401 })

  const server = await prisma.mcpServer.findUnique({
    where: { slug },
    select: { slug: true, endpoint: true },
  })
  if (!server) return NextResponse.json({ error: 'Unknown MCP.' }, { status: 404 })

  const existing = await prisma.mcpOwner.findUnique({ where: { mcpSlug: slug } })
  if (existing && existing.ownerAddress !== addr) {
    return NextResponse.json({ error: 'This MCP is already claimed.' }, { status: 409 })
  }

  const host = endpointHost(server.endpoint)
  let verifiedVia = 'admin'
  if (!isAdminAddress(addr)) {
    const verdict = await verifyReceiverClaim(server.endpoint, addr)
    if (!verdict.ok) {
      return NextResponse.json({ error: verdict.reason, requiredWallet: verdict.receiver ?? null }, { status: 400 })
    }
    verifiedVia = 'receiver'
  }

  const owner = await prisma.mcpOwner.upsert({
    where: { mcpSlug: slug },
    create: { mcpSlug: slug, ownerAddress: addr, verifiedVia, verifiedHost: host },
    update: { ownerAddress: addr, verifiedVia, verifiedHost: host },
  })
  return NextResponse.json({ claimed: true, owner: ownerView(owner) }, { status: 201 })
}

/** Release a claim. SIWE only; the owner or a Pantessa admin. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { slug } = await params
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Sign in.' }, { status: 401 })

  const owner = await prisma.mcpOwner.findUnique({ where: { mcpSlug: slug } })
  if (!owner || (owner.ownerAddress !== addr && !isAdminAddress(addr))) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }
  await prisma.mcpOwner.delete({ where: { mcpSlug: slug } })
  return NextResponse.json({ ok: true })
}
