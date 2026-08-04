import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { Prisma } from '@prisma/client'
import { getAuthAddress } from '@/lib/api-key'
import { isAdminAddress, isTestWallet } from '@/lib/admin'
import { alchemyEnabled, getTreasuryInflows, type TreasuryInflow } from '@/lib/alchemy'
import { TREASURY_ADDRESS, FEES_LIVE_SINCE } from '@/lib/fees'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Treasury — what Pantessa has actually COLLECTED, admin-gated.
 *
 * Two lanes, deliberately not summed into one number:
 *
 *   · On-chain inflow (the headline) — every recent transfer INTO the
 *     treasury address across the covered chains. This is ground truth:
 *     swap fees (lib/lifi-venue.ts) are their own transfer step in the SELL
 *     token and are persisted NOWHERE in the DB, and x402 settlements land
 *     here as USDC too. Stables price 1:1, ETH/WETH at spot; anything else
 *     (a fee taken in a stock token) shows unpriced and stays out of USD
 *     totals rather than being guessed.
 *
 *   · x402 ledger — spend_ledger settlements against Pantessa-OWNED services
 *     (host *.yeetful.com; opensea.io / paysponge / etc. are users paying
 *     THIRD PARTIES through their expense accounts — spend, not our
 *     revenue). This is the attributable view (grant → owner wallet), and a
 *     subset of the same money visible on-chain — never add the lanes.
 *
 * Every payer is classified tester (Pantessa's own wallets, lib/admin
 * TEST_WALLETS) vs wild, so the trend shows whether real users are paying.
 */

const WINDOWS = new Set([30, 90])

// The treasury address is an old wallet — it received unrelated transfers
// years before Pantessa existed. Only inflow since FEES_LIVE_SINCE
// (lib/fees.ts — shared with the public /activity fee strip) counts.

/** 4-decimal rounding — sub-cent fees are the norm at test-trade sizes. */
const round4 = (n: number) => Math.round(n * 1e4) / 1e4

interface FeePoint {
  day: string
  testerUsd: number
  wildUsd: number
  cumulativeUsd: number
  events: number
}

/** Bucket priced inflows into per-day tester/wild sums over the window, with
 *  the cumulative line carrying the pre-window base so "total accumulated"
 *  reads true even when the window clips history. */
function dailySeries(inflows: TreasuryInflow[], days: number): FeePoint[] {
  const dayMs = 86_400_000
  const today = Math.floor(Date.now() / dayMs)
  const first = today - days + 1
  const iso = (d: number) => new Date(d * dayMs).toISOString().slice(0, 10)

  const points = new Map<string, FeePoint>()
  for (let d = first; d <= today; d++)
    points.set(iso(d), { day: iso(d), testerUsd: 0, wildUsd: 0, cumulativeUsd: 0, events: 0 })

  let base = 0
  for (const t of inflows) {
    const usd = t.usd ?? 0
    const p = points.get(iso(Math.floor((t.timestamp * 1000) / dayMs)))
    if (!p) {
      base += usd // before the window (or unbucketable) — cumulative base only
      continue
    }
    if (isTestWallet(t.from)) p.testerUsd = round4(p.testerUsd + usd)
    else p.wildUsd = round4(p.wildUsd + usd)
    p.events += 1
  }

  let run = base
  return [...points.values()].map((p) => {
    run += p.testerUsd + p.wildUsd
    return { ...p, cumulativeUsd: round4(run) }
  })
}

export async function GET(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!isAdminAddress(addr)) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })

  const raw = Number(req.nextUrl.searchParams.get('days'))
  const days = WINDOWS.has(raw) ? raw : 30
  const since = new Date(Date.now() - days * 86_400_000)

  const [rawInflows, x402Rows, x402Recent] = await Promise.all([
    alchemyEnabled() ? getTreasuryInflows(TREASURY_ADDRESS, 400).catch(() => []) : Promise.resolve([]),
    prisma.$queryRaw<{ all_usd: number; window_usd: number; all_n: number; window_n: number }[]>(Prisma.sql`
      SELECT coalesce(sum(amount_usd), 0)::float AS all_usd,
             coalesce(sum(amount_usd) FILTER (WHERE created_at >= ${since}), 0)::float AS window_usd,
             count(*)::int AS all_n,
             count(*) FILTER (WHERE created_at >= ${since})::int AS window_n
      FROM spend_ledger
      WHERE ok AND coalesce(note, '') <> 'dry-run' AND amount_usd > 0
        AND host LIKE '%.yeetful.com'
    `),
    prisma.$queryRaw<
      { created_at: Date; amount_usd: number; service_name: string | null; host: string; tx_hash: string | null; owner_address: string }[]
    >(Prisma.sql`
      SELECT l.created_at, l.amount_usd, l.service_name, l.host, l.tx_hash, g.owner_address
      FROM spend_ledger l JOIN spend_grants g ON g.id = l.grant_id
      WHERE l.ok AND coalesce(l.note, '') <> 'dry-run' AND l.amount_usd > 0
        AND l.host LIKE '%.yeetful.com'
      ORDER BY l.created_at DESC
      LIMIT 12
    `),
  ])

  const inflows = rawInflows.filter((t) => t.timestamp * 1000 >= FEES_LIVE_SINCE)
  const priced = inflows.filter((t) => t.usd !== null)
  const inWindow = (t: TreasuryInflow) => t.timestamp * 1000 >= since.getTime()
  const sum = (ts: TreasuryInflow[]) => round4(ts.reduce((s, t) => s + (t.usd ?? 0), 0))

  const byKey = (key: (t: TreasuryInflow) => string) => {
    const m = new Map<string, { usd: number; n: number }>()
    for (const t of priced) {
      const k = key(t)
      const e = m.get(k) ?? { usd: 0, n: 0 }
      e.usd = round4(e.usd + (t.usd ?? 0))
      e.n += 1
      m.set(k, e)
    }
    return [...m.entries()].map(([k, v]) => ({ key: k, usd: v.usd, n: v.n })).sort((a, b) => b.usd - a.usd)
  }

  const x = x402Rows[0]
  return NextResponse.json({
    windowDays: days,
    treasury: TREASURY_ADDRESS,
    onchain: {
      enabled: alchemyEnabled(),
      allTimeUsd: sum(priced),
      windowUsd: sum(priced.filter(inWindow)),
      wildWindowUsd: sum(priced.filter((t) => inWindow(t) && !isTestWallet(t.from))),
      transfers: inflows.length,
      unpriced: inflows.length - priced.length,
      payers: new Set(inflows.map((t) => t.from)).size,
      wildPayers: new Set(inflows.filter((t) => !isTestWallet(t.from)).map((t) => t.from)).size,
      daily: dailySeries(inflows, days),
      byAsset: byKey((t) => t.asset),
      byChain: byKey((t) => t.chain),
      recent: inflows.slice(0, 30).map((t) => ({
        at: new Date(t.timestamp * 1000).toISOString(),
        chain: t.chain,
        asset: t.asset,
        amount: t.amount,
        usd: t.usd,
        from: t.from,
        test: isTestWallet(t.from),
        explorerUrl: t.explorerUrl,
      })),
    },
    x402: {
      allTimeUsd: round4(x?.all_usd ?? 0),
      windowUsd: round4(x?.window_usd ?? 0),
      allTimeCalls: x?.all_n ?? 0,
      windowCalls: x?.window_n ?? 0,
      recent: x402Recent.map((r) => ({
        at: r.created_at.toISOString(),
        service: r.service_name ?? r.host,
        usd: round4(r.amount_usd),
        wallet: r.owner_address.startsWith('org:') ? null : r.owner_address.toLowerCase(),
        test: r.owner_address.startsWith('org:') ? false : isTestWallet(r.owner_address),
        txHash: r.tx_hash,
      })),
    },
  })
}
