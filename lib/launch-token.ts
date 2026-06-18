// Launchpad token panel data (x402-launch M6). Read-side: given an MCP, return
// its claim status + (if a token has launched) live on-chain staking stats, for
// the per-service token panel. The on-chain YeetfulLaunchFactory is the source
// of truth; mcp_servers.tokenAddress/stakingAddress mirror it for fast reads.

import { createPublicClient, http, parseAbi, formatUnits, type Address } from 'viem'
import { base, baseSepolia } from 'viem/chains'
import prisma from '@/lib/db'

const VAULT_ABI = parseAbi(['function totalStaked() view returns (uint256)'])

function chainCfg() {
  const onBase = process.env.LAUNCH_CHAIN === 'base'
  return {
    chain: onBase ? base : baseSepolia,
    rpcUrl: process.env.LAUNCH_RPC_URL,
    explorer: onBase ? 'https://basescan.org' : 'https://sepolia.basescan.org',
  }
}

export type TokenPanelData = {
  state: 'unclaimed' | 'claimed' | 'launched'
  owner: { ownerAddress: string; verifiedVia: string } | null
  token: { address: string; staking: string; totalStaked: string; explorerUrl: string } | null
  /** Maker-side take rate routed to stakers, in basis points (default 10%). */
  feeShareBps: number
}

export async function getTokenPanel(server: {
  slug: string
  tokenAddress: string | null
  stakingAddress: string | null
}): Promise<TokenPanelData> {
  const ownerRow = await prisma.mcpOwner.findUnique({ where: { mcpSlug: server.slug } }).catch(() => null)
  const owner = ownerRow
    ? { ownerAddress: ownerRow.ownerAddress, verifiedVia: ownerRow.verifiedVia }
    : null
  const feeShareBps = Number(process.env.LAUNCH_FEE_SHARE_BPS ?? '1000')

  if (server.tokenAddress && server.stakingAddress) {
    const { chain, rpcUrl, explorer } = chainCfg()
    let totalStaked = '0'
    try {
      const pub = createPublicClient({ chain, transport: http(rpcUrl) })
      const ts = await pub.readContract({
        address: server.stakingAddress as Address,
        abi: VAULT_ABI,
        functionName: 'totalStaked',
      })
      totalStaked = formatUnits(ts, 18)
    } catch {
      /* chain unavailable → show 0 rather than crash the page */
    }
    return {
      state: 'launched',
      owner,
      token: {
        address: server.tokenAddress,
        staking: server.stakingAddress,
        totalStaked,
        explorerUrl: `${explorer}/address/${server.tokenAddress}`,
      },
      feeShareBps,
    }
  }

  return { state: owner ? 'claimed' : 'unclaimed', owner, token: null, feeShareBps }
}

/** "10" or "12.5" — the take rate as a percentage string. */
export function feeSharePct(bps: number): string {
  return (bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)
}

/** 0x1234…abcd */
export function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}
