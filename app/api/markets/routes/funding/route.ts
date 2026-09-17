import { NextRequest, NextResponse } from 'next/server'
import { chartPairFor } from '@/lib/charts'
import { primaryStable } from '@/lib/chains'
import { scanFundingSources, type FundingScan } from '@/lib/funding-plan'
import { readFundingShortfall, ROBINHOOD_CHAIN_ID, type FundingShortfall } from '@/lib/lifi-bridge'
import { coinFundRoutes, stockFundRoutes, unreadFundRoutes, type FundRoutesPlan } from '@/lib/fund-routes'
import { tokenHome } from '@/lib/token-home'
import { DEFAULT_ROUTE_USD, fundDestChainFor, type FundRoutesResponse } from '@/lib/symbol-venues'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/markets/routes/funding?symbol=&amount=&address= — the Fund rows
// of the symbol page's route table for ONE wallet (lib/fund-routes): only
// the chains that wallet can actually fund the order from, each sentence
// spending the token it holds there, plus the plain-words facts about the
// money that can't (2026-09-16: "Fund from Base" was offered to wallets with
// nothing on Base).
//
// Public by address, like /api/wallet and /api/markets/position: balances
// are on-chain public data and the table is a connect-to-act surface (#553)
// — a wallet that connected a moment ago has no session and must still see
// its own paths. No write, nothing per-account.
//
// The scans are the chat's own (lib/lifi-bridge readFundingShortfall for a
// Robinhood Chain stock, lib/funding-plan scanFundingSources for a coin),
// cached 30s per wallet per lane, so a table that re-reads on every size
// change costs one scan, not one per click. Never a 500: an unreadable
// scan answers `state: 'unread'` with no rows and says so.

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const SCAN_TTL_MS = 30_000
const SCAN_CACHE_MAX = 500

type Scan = { lane: 'lifi'; value: FundingShortfall } | { lane: 'near'; value: FundingScan }
const g = globalThis as unknown as { __fundRoutesScans?: Map<string, { at: number; scan: Scan }>; __fundRoutesInflight?: Map<string, Promise<Scan>> }
const scans = (g.__fundRoutesScans ??= new Map())
const inflight = (g.__fundRoutesInflight ??= new Map())

async function scanFor(lane: Scan['lane'], address: string): Promise<{ scan: Scan; cached: boolean }> {
  const key = `${lane}|${address.toLowerCase()}`
  const hit = scans.get(key)
  if (hit && Date.now() - hit.at < SCAN_TTL_MS) return { scan: hit.scan, cached: true }
  let p = inflight.get(key)
  if (!p) {
    p = (lane === 'lifi'
      ? readFundingShortfall(address, ROBINHOOD_CHAIN_ID).then((value): Scan => ({ lane, value }))
      : scanFundingSources(address).then((value): Scan => ({ lane, value }))
    )
      .then((scan) => {
        // Bounded: the oldest entry goes first (a Map iterates in insertion order).
        if (scans.size >= SCAN_CACHE_MAX) scans.delete(scans.keys().next().value!)
        scans.set(key, { at: Date.now(), scan })
        return scan
      })
      .finally(() => inflight.delete(key))
    inflight.set(key, p)
  }
  return { scan: await p, cached: false }
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams
  const symbolRaw = sp.get('symbol') ?? ''
  if (!/^[A-Za-z0-9$._-]{1,16}$/.test(symbolRaw)) return NextResponse.json({ error: 'bad symbol' }, { status: 400 })
  const address = sp.get('address')?.trim() ?? ''
  if (!ADDRESS_RE.test(address)) return NextResponse.json({ error: 'address must be a 0x-prefixed 40-hex wallet address.' }, { status: 400 })
  const pair = chartPairFor(symbolRaw)
  if (!pair) return NextResponse.json({ error: `${symbolRaw.toUpperCase()} has no venue map — not a charted symbol.` }, { status: 404 })
  const amountRaw = Number(sp.get('amount') ?? DEFAULT_ROUTE_USD)
  const amount = Number.isFinite(amountRaw) && amountRaw >= 1 && amountRaw <= 100_000 ? Math.round(amountRaw * 100) / 100 : DEFAULT_ROUTE_USD
  const sym = pair.symbol.toUpperCase()
  const headers = { 'cache-control': 'no-store' }

  const reply = (plan: FundRoutesPlan, cached = false) =>
    NextResponse.json({ symbol: sym, amountUsd: amount, ...plan, updatedAt: new Date().toISOString(), cached } satisfies FundRoutesResponse, { headers })

  // A perp chart or a coin whose home isn't an EVM chain has no spot buy for
  // money to land on — the venue map lists no funding for it either.
  if (pair.source === 'hyperliquid' || (pair.source !== 'robinhood' && tokenHome(sym))) {
    return reply({ routes: [], notes: [], state: 'none', failed: [] })
  }

  if (pair.source === 'robinhood') {
    try {
      const { scan, cached } = await scanFor('lifi', address)
      if (scan.lane !== 'lifi') throw new Error('lane mismatch')
      const usdg = primaryStable(ROBINHOOD_CHAIN_ID)
      const holdingUsd = usdg ? Number(scan.value.usdgAtoms) / 10 ** usdg.decimals : 0
      return reply(stockFundRoutes({ sym, buyUsd: amount, holdingUsd, scan: scan.value }), cached)
    } catch {
      return reply(unreadFundRoutes())
    }
  }

  try {
    const { scan, cached } = await scanFor('near', address)
    if (scan.lane !== 'near') throw new Error('lane mismatch')
    return reply(coinFundRoutes({ sym, usd: amount, destChainId: fundDestChainFor(sym), scan: scan.value }), cached)
  } catch {
    return reply(unreadFundRoutes())
  }
}
