import { NextRequest, NextResponse } from 'next/server'
import { createPublicClient, http, parseAbiItem, formatUnits, type Address } from 'viem'
import prisma from '@/lib/db'
import { LAUNCH_CHAIN, STAKING_ABI, TOKEN_DECIMALS } from '@/lib/launch-contracts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ slug: string }> }

const STAKED_EVENT = parseAbiItem('event Staked(address indexed staker, uint256 amount)')
// Bounded window so public RPCs don't reject the getLogs (≈ weeks on Base).
// Long-term we'd pin the vault's deploy block; fine for a fresh launchpad.
const LOOKBACK = BigInt(1_000_000)

/** Who's staking this MCP's token, read from the vault's Staked event logs —
 *  no indexer, just an on-demand log scan + a current-balance read per staker. */
export async function GET(_req: NextRequest, { params }: Params) {
  const { slug } = await params
  const server = await prisma.mcpServer.findUnique({ where: { slug }, select: { stakingAddress: true } })
  if (!server?.stakingAddress) return NextResponse.json({ stakers: [] })

  const vault = server.stakingAddress as Address
  const pub = createPublicClient({ chain: LAUNCH_CHAIN, transport: http(process.env.LAUNCH_RPC_URL) })

  try {
    const latest = await pub.getBlockNumber()
    const fromBlock = latest > LOOKBACK ? latest - LOOKBACK : BigInt(0)
    const logs = await pub.getLogs({ address: vault, event: STAKED_EVENT, fromBlock, toBlock: 'latest' })

    const uniq = [...new Set(logs.map((l) => (l.args.staker ?? '').toLowerCase()).filter(Boolean))] as Address[]
    if (uniq.length === 0) return NextResponse.json({ stakers: [] })

    // Current staked balance per address (people may have unstaked since).
    const balances = await Promise.all(
      uniq.map((a) =>
        pub.readContract({ address: vault, abi: STAKING_ABI, functionName: 'stakedOf', args: [a] }).catch(() => BigInt(0)),
      ),
    )
    const stakers = uniq
      .map((address, i) => ({ address, staked: formatUnits(balances[i], TOKEN_DECIMALS) }))
      .filter((s) => Number(s.staked) > 0)
      .sort((a, b) => Number(b.staked) - Number(a.staked))
      .slice(0, 50)

    return NextResponse.json({ stakers })
  } catch {
    return NextResponse.json({ stakers: [] }) // RPC limit/unreachable → show none rather than break
  }
}
