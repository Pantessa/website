import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { isAdminAddress } from '@/lib/admin'
import { readLaunch } from '@/lib/launch-contracts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ slug: string }> }

/**
 * Confirm a token launch and link it to the directory. The client calls this
 * AFTER its `factory.launch` tx confirms — but we don't trust that: we read the
 * factory's on-chain registry (`mcpById`) ourselves and only write what the
 * chain says. The registry is the index; no listener/indexer needed.
 *
 * SIWE-gated to the claimed owner (or an admin).
 */
export async function POST(_req: NextRequest, { params }: Params) {
  const { slug } = await params
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Sign in.' }, { status: 401 })

  const server = await prisma.mcpServer.findUnique({ where: { slug }, select: { slug: true } })
  if (!server) return NextResponse.json({ error: 'Unknown MCP.' }, { status: 404 })

  const owner = await prisma.mcpOwner.findUnique({ where: { mcpSlug: slug } })
  if (!owner || (owner.ownerAddress !== addr && !isAdminAddress(addr))) {
    return NextResponse.json({ error: 'Claim this MCP before launching its token.' }, { status: 403 })
  }

  // The trustless step: read the launch from the factory on-chain.
  let launch: Awaited<ReturnType<typeof readLaunch>>
  try {
    launch = await readLaunch(slug)
  } catch {
    return NextResponse.json({ error: 'Could not read the launch on-chain. Try again.' }, { status: 502 })
  }
  if (!launch) {
    return NextResponse.json({ error: 'No token found on-chain yet — wait for the launch to confirm, then retry.' }, { status: 400 })
  }

  await prisma.mcpServer.update({
    where: { slug },
    data: { tokenAddress: launch.token, stakingAddress: launch.staking },
  })
  return NextResponse.json({ launched: true, tokenAddress: launch.token, stakingAddress: launch.staking })
}
