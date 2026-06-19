// Network-wide launchpad summary for the public /activity board (x402-launch).
// Two numbers the per-service TokenPanel can't show alone:
//   • stakerRewardsUsd — USDC directed to MCP-token stakers across the network,
//     i.e. the maker-side cut (feeShareBps) of every settled call to a launched
//     MCP. Ledger-derived, USDC-denominated, summable — the "earn fees as the
//     agents work" number. Reads $0 until a tokenized MCP gets a paid call.
//   • tokens[] — each launched token's live on-chain `totalStaked` (per token;
//     different tokens aren't summable, so they're listed, not totalled).
//
// Resilient by construction: any DB/RPC failure returns null (or a token's
// staked falls back to 0) so the activity feed never breaks over launchpad data.

import { createPublicClient, http, parseAbi, formatUnits, type Address } from 'viem'
import { base, baseSepolia } from 'viem/chains'
import prisma from '@/lib/db'

const VAULT_ABI = parseAbi(['function totalStaked() view returns (uint256)'])
const TOKEN_ABI = parseAbi(['function symbol() view returns (string)'])

export type LaunchpadToken = {
  name: string
  slug: string
  symbol: string
  totalStaked: string
  tokenAddress: string
  stakingAddress: string
  explorer: string
}

export type LaunchpadSummary = {
  feeShareBps: number
  stakerRewardsUsd: number
  tokensLive: number
  tokens: LaunchpadToken[]
}

export async function getLaunchpadSummary(): Promise<LaunchpadSummary | null> {
  try {
    const feeShareBps = Number(process.env.LAUNCH_FEE_SHARE_BPS ?? '1000')
    const launched = await prisma.mcpServer.findMany({
      where: { tokenAddress: { not: null }, stakingAddress: { not: null } },
      select: { name: true, slug: true, tokenAddress: true, stakingAddress: true },
    })
    if (launched.length === 0) return { feeShareBps, stakerRewardsUsd: 0, tokensLive: 0, tokens: [] }

    // USDC directed to stakers = the maker-side cut on settled calls to launched
    // MCPs. Joined on serviceName — the same key routeSettledFee resolves by.
    const rewards = await prisma.spendLedgerEntry.aggregate({
      where: { ok: true, serviceName: { in: launched.map((l) => l.name) } },
      _sum: { amountUsd: true },
    })
    const stakerRewardsUsd = ((rewards._sum.amountUsd ?? 0) * feeShareBps) / 10_000

    const onBase = process.env.LAUNCH_CHAIN === 'base'
    const explorer = onBase ? 'https://basescan.org' : 'https://sepolia.basescan.org'
    const pub = createPublicClient({ chain: onBase ? base : baseSepolia, transport: http(process.env.LAUNCH_RPC_URL) })

    const tokens = await Promise.all(
      launched.map(async (l): Promise<LaunchpadToken> => {
        let totalStaked = '0'
        let symbol = ''
        try {
          const [ts, sym] = await Promise.all([
            pub.readContract({ address: l.stakingAddress as Address, abi: VAULT_ABI, functionName: 'totalStaked' }),
            pub.readContract({ address: l.tokenAddress as Address, abi: TOKEN_ABI, functionName: 'symbol' }).catch(() => ''),
          ])
          totalStaked = formatUnits(ts, 18)
          symbol = sym
        } catch {
          /* chain hiccup → show 0 for this token rather than drop the whole board */
        }
        return {
          name: l.name,
          slug: l.slug,
          symbol,
          totalStaked,
          tokenAddress: l.tokenAddress!,
          stakingAddress: l.stakingAddress!,
          explorer,
        }
      }),
    )

    return { feeShareBps, stakerRewardsUsd, tokensLive: launched.length, tokens }
  } catch {
    return null
  }
}
