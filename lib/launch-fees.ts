// Launchpad fee routing (x402-launch M4b). When a paid call to an MCP settles,
// a configurable cut of that USDC is routed on-chain to the MCP token's
// YeetfulStaking vault, where it's split across stakers — "earn fees as the
// agents work." This is the off-chain trigger; the on-chain split lives in the
// YeetfulFeeRouter contract (repo `x402-launch`).
//
// SAFE BY DEFAULT: a no-op until the launchpad is deployed AND configured via
// env. It never throws into a chat turn — fee routing must not break payments.
//
// Economic note: the cut is paid by the house settlement wallet (PRIVATE_KEY),
// so for now this is meaningful for Yeetful-OPERATED MCPs (we share our own
// service revenue). Routing a cut from a third-party service's own PAYMENT_ADDRESS
// belongs in the x402-services service-kit — a follow-up.
//
// TODO(perf): one tx per settled call is simplest but costly; batch by MCP on a
// timer or threshold once volume warrants.

import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  maxUint256,
  type Address,
} from 'viem'
import { base, baseSepolia } from 'viem/chains'
import prisma from '@/lib/db'
import { getAgentAccount, hasAgentWallet } from '@/lib/agent-wallet'

const FEE_ROUTER_ABI = parseAbi(['function routeForMcp(string mcpId, uint256 amount)'])
const ERC20_ABI = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 value) returns (bool)',
])

type LaunchFeeConfig = {
  router: Address
  usdc: Address
  bps: number
  chain: typeof base | typeof baseSepolia
  rpcUrl?: string
}

function config(): LaunchFeeConfig | null {
  const router = process.env.LAUNCH_FEE_ROUTER as Address | undefined
  const usdc = process.env.LAUNCH_USDC as Address | undefined
  const bps = Number(process.env.LAUNCH_FEE_SHARE_BPS ?? '0')
  if (!router || !usdc || !Number.isFinite(bps) || bps <= 0) return null
  if (!hasAgentWallet()) return null
  return {
    router,
    usdc,
    bps,
    chain: process.env.LAUNCH_CHAIN === 'base' ? base : baseSepolia,
    rpcUrl: process.env.LAUNCH_RPC_URL,
  }
}

/** Whether launchpad fee routing is live (deployed + configured). */
export function launchFeesEnabled(): boolean {
  return config() !== null
}

/**
 * Route a cut of one settled call's fee to its MCP's stakers. Resolves the MCP
 * by its directory `serviceName`; no-ops unless that MCP has a launched token
 * and routing is configured. Fire-and-forget: callers should `void` this.
 */
export async function routeSettledFee(serviceName: string, amountUsd: number): Promise<void> {
  const cfg = config()
  if (!cfg || amountUsd <= 0) return

  try {
    const server = await prisma.mcpServer.findFirst({
      where: { name: serviceName },
      select: { slug: true, tokenAddress: true },
    })
    if (!server?.tokenAddress || !server.slug) return // not launched → nothing to route

    const cutUsd = (amountUsd * cfg.bps) / 10_000
    const cutUnits = BigInt(Math.floor(cutUsd * 1e6)) // USDC has 6 decimals
    if (cutUnits <= BigInt(0)) return

    const account = getAgentAccount()
    const transport = http(cfg.rpcUrl)
    const pub = createPublicClient({ chain: cfg.chain, transport })
    const wallet = createWalletClient({ account, chain: cfg.chain, transport })

    const allowance = await pub.readContract({
      address: cfg.usdc,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [account.address, cfg.router],
    })
    if (allowance < cutUnits) {
      const approveHash = await wallet.writeContract({
        address: cfg.usdc,
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [cfg.router, maxUint256],
      })
      await pub.waitForTransactionReceipt({ hash: approveHash })
    }

    await wallet.writeContract({
      address: cfg.router,
      abi: FEE_ROUTER_ABI,
      functionName: 'routeForMcp',
      args: [server.slug, cutUnits],
    })
  } catch (err) {
    // Never break a chat turn over fee routing.
    console.error('[launch-fees] routeSettledFee failed', err)
  }
}
