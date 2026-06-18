import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { CLAIM_PATH, claimFileContent, isValidRepo, verifyRepoClaim } from '@/lib/mcp-claim'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ slug: string }> }

function ownerView(o: { ownerAddress: string; repo: string; githubLogin: string | null; claimedAt: Date }) {
  return { ownerAddress: o.ownerAddress, repo: o.repo, githubLogin: o.githubLogin, claimedAt: o.claimedAt }
}

/** Public: is this MCP claimed, by whom, and how to claim it. */
export async function GET(_req: NextRequest, { params }: Params) {
  const { slug } = await params
  const server = await prisma.mcpServer.findUnique({ where: { slug }, select: { slug: true, name: true } })
  if (!server) return NextResponse.json({ error: 'Unknown MCP.' }, { status: 404 })

  const owner = await prisma.mcpOwner.findUnique({ where: { mcpSlug: slug } })
  return NextResponse.json({
    slug: server.slug,
    name: server.name,
    claimed: !!owner,
    owner: owner ? ownerView(owner) : null,
    // How to claim: commit this file to the repo that backs the MCP.
    instructions: { path: CLAIM_PATH, contentExample: claimFileContent('<your-wallet-address>') },
  })
}

/** Claim this MCP. SIWE only (it binds ownership to a wallet). Body: { repo }. */
export async function POST(req: NextRequest, { params }: Params) {
  const { slug } = await params
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Sign in to claim an MCP.' }, { status: 401 })

  const server = await prisma.mcpServer.findUnique({ where: { slug }, select: { slug: true } })
  if (!server) return NextResponse.json({ error: 'Unknown MCP.' }, { status: 404 })

  const body = (await req.json().catch(() => ({}))) as { repo?: string }
  const repo = (body.repo ?? '').trim()
  if (!isValidRepo(repo)) return NextResponse.json({ error: 'Provide the backing GitHub repo as "owner/name".' }, { status: 400 })

  const existing = await prisma.mcpOwner.findUnique({ where: { mcpSlug: slug } })
  if (existing && existing.ownerAddress !== addr) {
    return NextResponse.json({ error: 'This MCP is already claimed.' }, { status: 409 })
  }

  const verdict = await verifyRepoClaim(repo, addr)
  if (!verdict.ok) return NextResponse.json({ error: verdict.reason, claimFile: { path: CLAIM_PATH, content: claimFileContent(addr) } }, { status: 400 })

  const owner = await prisma.mcpOwner.upsert({
    where: { mcpSlug: slug },
    create: { mcpSlug: slug, ownerAddress: addr, repo, githubLogin: verdict.login ?? null },
    update: { repo, githubLogin: verdict.login ?? null },
  })
  return NextResponse.json({ claimed: true, owner: ownerView(owner) }, { status: 201 })
}

/** Release a claim. SIWE only; current owner only. */
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { slug } = await params
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Sign in.' }, { status: 401 })

  const owner = await prisma.mcpOwner.findUnique({ where: { mcpSlug: slug } })
  if (!owner || owner.ownerAddress !== addr) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }
  await prisma.mcpOwner.delete({ where: { mcpSlug: slug } })
  return NextResponse.json({ ok: true })
}
