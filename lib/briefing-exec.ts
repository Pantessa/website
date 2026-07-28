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
import { briefingTile, composeBriefingItems, type BriefingInputs, type FiredEvent } from './briefing'
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

  const [positionsR, protectedR, fundingR, aaveR, spotR, firedR] = await Promise.allSettled([
    withTimeout(fetchPositions(address)),
    prisma.hlGuardianPolicy.findMany({
      where: { wallet, status: { in: ['active', 'triggered'] } },
      select: { coin: true },
    }),
    withTimeout(scanFundingSources(address)),
    withTimeout(callMcpTool(AAVE_MCP, 'portfolio', { user: address }, { timeoutMs: PROVIDER_TIMEOUT_MS })),
    prisma.spotGuardPolicy.findMany({
      where: { wallet, status: { in: ['active', 'triggered'] } },
      select: { tokenSymbol: true },
    }),
    readFiredRecently(wallet),
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

  // A failed spot-policy read hides the SUGGESTION (never claims naked) by
  // reporting every symbol as protected — the honest failure mode.
  const spotProtectedSymbols =
    spotR.status === 'fulfilled' ? spotR.value.map((r) => r.tokenSymbol) : (failed.push('spot-guard-policies'), ['ETH'])

  const firedRecently = firedR.status === 'fulfilled' ? firedR.value : (failed.push('fired-events'), [])

  return { firedRecently, positions, protectedCoins, spotProtectedSymbols, funding, aave, failed }
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

// ── Fired standing intents (7d) — the "while you were away" herald ─────────

const FIRED_WINDOW_MS = 7 * 24 * 3600 * 1000

const agoWord = (d: Date): string => {
  const days = Math.floor((Date.now() - d.getTime()) / (24 * 3600 * 1000))
  return days <= 0 ? 'today' : days === 1 ? 'yesterday' : `${days} days ago`
}

async function readFiredRecently(wallet: string): Promise<FiredEvent[]> {
  const since = new Date(Date.now() - FIRED_WINDOW_MS)
  const [guardian, dcaAuto, spot] = await Promise.all([
    prisma.hlGuardianRun.findMany({
      where: { wallet, action: 'closed', createdAt: { gte: since } },
      include: { policy: { select: { coin: true, side: true, kind: true } } },
      orderBy: { createdAt: 'desc' },
      take: 3,
    }),
    prisma.dcaAutoRun.findMany({
      where: { wallet, status: 'bought', createdAt: { gte: since } },
      include: { schedule: { select: { buyToken: true, buyUsd: true } } },
      orderBy: { createdAt: 'desc' },
      take: 3,
    }),
    prisma.spotGuardRun.findMany({
      where: { wallet, status: 'sold', createdAt: { gte: since } },
      include: { policy: { select: { tokenSymbol: true, amountHuman: true } } },
      orderBy: { createdAt: 'desc' },
      take: 3,
    }),
  ])
  const events: (FiredEvent & { at: Date })[] = [
    ...guardian.map((r) => ({
      kind: 'guardian' as const,
      label: `${r.policy.kind === 'stop_loss' ? 'Stop-loss' : 'Take-profit'} fired · closed your ${r.policy.coin} ${r.policy.side}`,
      valueUsd: r.valueUsd,
      when: agoWord(r.createdAt),
      at: r.createdAt,
    })),
    ...dcaAuto.map((r) => ({
      kind: 'dca-auto' as const,
      label: `Autopilot bought $${r.schedule.buyUsd} of ${r.schedule.buyToken}`,
      valueUsd: r.valueUsd,
      when: agoWord(r.createdAt),
      at: r.createdAt,
    })),
    ...spot.map((r) => ({
      kind: 'spot-guard' as const,
      label: `Spot stop fired · ${r.policy.amountHuman} ${r.policy.tokenSymbol} → USDC in your wallet`,
      valueUsd: r.valueUsd,
      when: agoWord(r.createdAt),
      at: r.createdAt,
    })),
  ]
  return events.sort((a, b) => b.at.getTime() - a.at.getTime()).map(({ at: _at, ...e }) => e)
}

// ── Public /w snapshot ──────────────────────────────────────────────────────
// The shareable "run Yeetful on any wallet" page reads the same pipeline
// plus the multichain portfolio for context. A short per-instance TTL cache
// keeps a shared link from hammering RPCs/MCPs (generateMetadata + the page
// body both read it; the affinity-cache precedent).

import { alchemyEnabled, getMultichainPortfolio, type MultichainPortfolio } from './alchemy'
import type { StatRow } from './splash/types'

export interface WalletSnapshot {
  address: string
  rows: StatRow[]
  needs: number
  portfolio: MultichainPortfolio | null
  /** Providers that failed — the page must hedge, never claim "all clear". */
  failed: string[]
}

const SNAPSHOT_TTL_MS = 120_000
const snapshotCache = new Map<string, { at: number; value: Promise<WalletSnapshot> }>()

export function walletSnapshotFor(address: string): Promise<WalletSnapshot> {
  const key = address.toLowerCase()
  const hit = snapshotCache.get(key)
  if (hit && Date.now() - hit.at < SNAPSHOT_TTL_MS) return hit.value
  const value = (async (): Promise<WalletSnapshot> => {
    const [inputsR, portfolioR] = await Promise.allSettled([
      readBriefingInputs(address),
      alchemyEnabled() ? withTimeout(getMultichainPortfolio(address)) : Promise.resolve(null),
    ])
    const inputs =
      inputsR.status === 'fulfilled'
        ? inputsR.value
        : { firedRecently: [], positions: [], protectedCoins: [], spotProtectedSymbols: [], funding: null, aave: null, failed: ['briefing'] }
    const rows = composeBriefingItems(inputs)
    return {
      address: key,
      rows,
      needs: rows.filter((r) => r.tone === 'neg').length,
      portfolio: portfolioR.status === 'fulfilled' ? portfolioR.value : null,
      failed: [...inputs.failed, ...(portfolioR.status === 'rejected' ? ['portfolio'] : [])],
    }
  })()
  snapshotCache.set(key, { at: Date.now(), value })
  // A rejected snapshot must not poison the cache window.
  value.catch(() => snapshotCache.delete(key))
  return value
}
