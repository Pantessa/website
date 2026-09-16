// GET /api/markets/earn — the yield board's rows: Aave v4 supplyable
// reserves (Ethereum spokes), Lido's 7-day APR, Morpho's curated markets on
// Base + Ethereum. Read from each venue's OWN reader (the same tools the
// native layers build against), composed by lib/earn, cached 60s, and
// fail-soft per venue: a venue that didn't answer is NAMED in `failed`, its
// rows absent — never a zero rate. Public, no wallet, no address anywhere.
import { NextResponse } from 'next/server'
import { callMcpTool } from '@/lib/mcp-call'
import { AAVE_MCP } from '@/lib/aave-exec'
import { LIDO_MCP } from '@/lib/lido-stake'
import { readMorphoMarkets } from '@/lib/morpho-exec'
import type { AaveReserveRow } from '@/lib/aave-supply'
import { readQuotes } from '@/lib/quotes'
import { readLido } from '@/lib/viz/flow-readers'
import { aaveRows, lidoRow, morphoRows, rankEarnRows, rowsToWire, type EarnResponse, type EarnRow, type EarnVenue } from '@/lib/earn'

export const dynamic = 'force-dynamic'

const TTL_MS = 60_000
const PROVIDER_TIMEOUT_MS = 12_000
let cache: { at: number; body: EarnResponse } | null = null
let inflight: Promise<EarnResponse> | null = null

async function ethUsd(): Promise<number | null> {
  try {
    const { quotes } = await readQuotes(['ETH'])
    const q = quotes.ETH
    return q && q.last > 0 ? q.last : null
  } catch {
    return null
  }
}

async function compose(): Promise<EarnResponse> {
  const failed: EarnVenue[] = []
  const [aave, lidoStats, lidoFlow, morphoBase, morphoEth, eth] = await Promise.allSettled([
    callMcpTool(AAVE_MCP, 'reserves', { chainId: 1 }, { timeoutMs: PROVIDER_TIMEOUT_MS }) as Promise<{ reserves?: AaveReserveRow[] }>,
    callMcpTool(LIDO_MCP, 'stats', {}, { timeoutMs: PROVIDER_TIMEOUT_MS }) as Promise<{ apr?: { smaAprPct?: number | null; latestAprPct?: number | null } }>,
    readLido('ETH'),
    readMorphoMarkets(8453),
    readMorphoMarkets(1),
    ethUsd(),
  ])
  const price = eth.status === 'fulfilled' ? eth.value : null
  const rows: EarnRow[] = []

  if (aave.status === 'fulfilled' && Array.isArray(aave.value?.reserves)) rows.push(...aaveRows(aave.value.reserves))
  else failed.push('aave')

  if (lidoStats.status === 'fulfilled') {
    const a = lidoStats.value?.apr
    const apr = typeof a?.smaAprPct === 'number' ? a.smaAprPct : typeof a?.latestAprPct === 'number' ? a.latestAprPct : null
    const tvl = lidoFlow.status === 'fulfilled' && lidoFlow.value && typeof lidoFlow.value.usd === 'number' ? lidoFlow.value.usd : null
    rows.push(lidoRow(apr, tvl, price))
  } else failed.push('lido')

  const morphoOk = [morphoBase, morphoEth].filter((m) => m.status === 'fulfilled')
  if (morphoOk.length === 0) failed.push('morpho')
  if (morphoBase.status === 'fulfilled') rows.push(...morphoRows(morphoBase.value, 8453))
  if (morphoEth.status === 'fulfilled') rows.push(...morphoRows(morphoEth.value, 1))

  return { rows: rowsToWire(rankEarnRows(rows), price), failed, ethUsd: price, asOf: new Date().toISOString() }
}

export async function GET() {
  const now = Date.now()
  if (cache && now - cache.at < TTL_MS) return NextResponse.json({ ...cache.body, cached: true }, { headers: { 'cache-control': 'public, max-age=30' } })
  try {
    inflight ??= compose().finally(() => {
      inflight = null
    })
    const body = await inflight
    // Don't cache an all-failed read — the next visitor retries the venues.
    if (body.rows.length > 0) cache = { at: Date.now(), body }
    return NextResponse.json(body, { headers: { 'cache-control': 'public, max-age=30' } })
  } catch (e) {
    // Never a 500 for a board: name the outage, keep the last good read if any.
    const stale = cache?.body
    return NextResponse.json(
      stale ? { ...stale, cached: true, stale: true } : { rows: [], failed: ['aave', 'lido', 'morpho'], ethUsd: null, asOf: new Date().toISOString(), error: e instanceof Error ? e.message.slice(0, 200) : 'read failed' },
      { status: 200 },
    )
  }
}
