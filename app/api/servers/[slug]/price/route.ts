import { NextResponse } from 'next/server'
import { createPublicClient, http, type Address } from 'viem'
import { base, baseSepolia } from 'viem/chains'
import prisma from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Price history + live spot for a launched MCP token's chart. There's no on-chain
// price history and Flaunch's OHLC API is unreliable, so we sample the v4-pool
// spot price ourselves (Flaunch SDK) and append a point — at most one per
// SAMPLE_THROTTLE_MS per token — on read. Never CDN-cached, so each poll can
// sample; the DB throttle (not the cache) bounds the write rate.
const SAMPLE_THROTTLE_MS = 5 * 60 * 1000
const WINDOW_MS = 30 * 24 * 60 * 60 * 1000

type Params = { params: Promise<{ slug: string }> }

export async function GET(_req: Request, { params }: Params) {
  const { slug } = await params
  const server = await prisma.mcpServer.findUnique({ where: { slug }, select: { tokenAddress: true } }).catch(() => null)
  if (!server?.tokenAddress) {
    return NextResponse.json({ launched: false, spot: null, samples: [] }, { headers: { 'cache-control': 'no-store' } })
  }

  let spot: { priceEth: string; priceUsd: number; marketCapUsd: number } | null = null
  try {
    const onBase = process.env.LAUNCH_CHAIN === 'base'
    const pub = createPublicClient({ chain: onBase ? base : baseSepolia, transport: http(process.env.LAUNCH_RPC_URL) })
    const { createFlaunch } = await import('@flaunch/sdk')
    // SDK bundles its own viem → cast the client arg to dodge the nominal clash.
    const sdk = createFlaunch({ publicClient: pub as never }) as {
      coinPriceInETH: (a: Address) => Promise<string>
      getETHUSDCPrice: () => Promise<number>
      getCoinInfo: (a: Address) => Promise<{ formattedTotalSupplyInDecimals: number }>
    }
    const coin = server.tokenAddress as Address
    const [priceEth, ethUsd, info] = await Promise.all([sdk.coinPriceInETH(coin), sdk.getETHUSDCPrice(), sdk.getCoinInfo(coin)])
    const priceUsd = Number(priceEth) * Number(ethUsd)
    spot = { priceEth: String(priceEth), priceUsd, marketCapUsd: priceUsd * Number(info.formattedTotalSupplyInDecimals) }

    const last = await prisma.tokenPriceSample.findFirst({ where: { mcpSlug: slug }, orderBy: { at: 'desc' }, select: { at: true } })
    if (Number.isFinite(priceUsd) && priceUsd > 0 && (!last || Date.now() - last.at.getTime() > SAMPLE_THROTTLE_MS)) {
      await prisma.tokenPriceSample.create({ data: { mcpSlug: slug, priceEth: spot.priceEth, priceUsd, marketCapUsd: spot.marketCapUsd } })
    }
  } catch {
    /* price feed down → still return whatever history we have */
  }

  const rows = await prisma.tokenPriceSample.findMany({
    where: { mcpSlug: slug, at: { gte: new Date(Date.now() - WINDOW_MS) } },
    orderBy: { at: 'asc' },
    select: { at: true, priceUsd: true, marketCapUsd: true },
  })
  return NextResponse.json(
    { launched: true, spot, samples: rows.map((r) => ({ at: r.at.toISOString(), priceUsd: r.priceUsd, marketCapUsd: r.marketCapUsd })) },
    { headers: { 'cache-control': 'no-store' } },
  )
}
