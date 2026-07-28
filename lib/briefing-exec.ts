// ─────────────────────────────────────────────────────────────────────────
//  Wallet briefing I/O shell — reads the world, hands lib/briefing.ts pure
//  inputs. Job-context conventions: every provider gets its own timeout and
//  rides Promise.allSettled — a dead RPC drops its signals (named in
//  `failed`), never the card. The composer never claims absence for a
//  provider that failed.
// ─────────────────────────────────────────────────────────────────────────

import prisma from './db'
import { fetchPositions } from './hl-guardian-store'
import { scanFundingSources } from './funding-plan'
import { callMcpTool } from './mcp-call'
import { AAVE_MCP } from './aave-exec'
import { briefingTile, composeBriefingItems, type BriefingInputs } from './briefing'
import type { RowsTile } from './splash/types'

const PROVIDER_TIMEOUT_MS = 8_000

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('briefing provider timeout')), PROVIDER_TIMEOUT_MS)),
  ])
}

interface AavePortfolioPayload {
  positions?: { healthFactor?: string | null }[]
  borrows?: unknown[]
}

export async function readBriefingInputs(address: string): Promise<BriefingInputs> {
  const wallet = address.toLowerCase()
  const failed: string[] = []

  const [positionsR, protectedR, fundingR, aaveR] = await Promise.allSettled([
    withTimeout(fetchPositions(address)),
    prisma.hlGuardianPolicy.findMany({
      where: { wallet, status: { in: ['active', 'triggered'] } },
      select: { coin: true },
    }),
    withTimeout(scanFundingSources(address)),
    withTimeout(callMcpTool(AAVE_MCP, 'portfolio', { user: address }, { timeoutMs: PROVIDER_TIMEOUT_MS })),
  ])

  const positions =
    positionsR.status === 'fulfilled'
      ? positionsR.value.map((p) => ({
          coin: p.coin,
          side: p.side,
          positionValueUsd: p.positionValueUsd,
          unrealizedPnl: p.unrealizedPnl,
          leverage: p.leverage,
        }))
      : (failed.push('hyperliquid'), [])

  // A failed policy read must NOT make an armed position look naked — the
  // briefing would nag someone who already did the right thing. Positions
  // only surface when BOTH reads landed.
  let protectedCoins: string[] = []
  if (protectedR.status === 'fulfilled') {
    protectedCoins = protectedR.value.map((r) => r.coin)
  } else {
    failed.push('guardian-policies')
    positions.length = 0
  }

  const funding =
    fundingR.status === 'fulfilled'
      ? {
          sources: fundingR.value.sources,
          stranded: fundingR.value.stranded,
          readChains: fundingR.value.readChains,
          failedChains: fundingR.value.failedChains,
        }
      : (failed.push('funding'), null)

  let aave: BriefingInputs['aave'] = null
  if (aaveR.status === 'fulfilled') {
    const data = aaveR.value as AavePortfolioPayload
    const hfRaw = Array.isArray(data.positions) ? data.positions[0]?.healthFactor : null
    const hf = hfRaw != null && Number.isFinite(Number(hfRaw)) ? Number(hfRaw) : null
    aave = { healthFactor: hf, hasBorrows: Array.isArray(data.borrows) && data.borrows.length > 0 }
  } else {
    failed.push('aave')
  }

  return { positions, protectedCoins, funding, aave, failed }
}

/** The whole pipeline as one fail-soft call for /api/splash (and /w). */
export async function briefingTileFor(address: string): Promise<RowsTile | null> {
  try {
    const inputs = await readBriefingInputs(address)
    return briefingTile(composeBriefingItems(inputs))
  } catch {
    return null
  }
}
