import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { chainById, chainByKey, type AppChain } from '@/lib/chains'
import { INTERNAL_ORIGIN_SQL, REAL_TRAFFIC_WHERE, STANDING_TURN_SQL, STANDING_TURN_WHERE } from '@/lib/value-origin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The public system overview behind /activity — every dollar the system moved,
 * aggregated across ALL surfaces (first-party chat, every embed, the guardian
 * agent, and the x402 payment rail), plus the per-venue and per-MCP breakdowns
 * the page charts. Unauthenticated read-only; CDN-cached.
 *
 * Privacy (same constitution as /api/activity, Run 7):
 *  P1 — no full wallet addresses, no grant/key ids, and NO chat content:
 *       visitor prompts never appear here (they're owner-private on
 *       /dashboard/embeds). Transaction rows carry the artifact label the
 *       build layer wrote (what the tx IS — already public on-chain), never
 *       what anyone typed.
 *  P2 — denials/refusals are aggregate-only.
 */

const SERIES_DAYS = 90
const RECENT_LIMIT = 24
const CHAIN_LIMIT = 8

/** embed_turns.build_path → the venue the native layer built against. */
const VENUE_OF_PATH: Record<string, string> = {
  'native-swap-uniswap': 'uniswap',
  'native-swap-uniswap-v4': 'uniswap',
  'native-swap-cow': 'cow',
  'native-aave-supply': 'aave',
  'native-aave-op': 'aave',
  'native-cross-chain': 'near-intents',
  'native-hl-guardian': 'hyperliquid',
  'native-hl-exec': 'hyperliquid',
  'native-lido': 'lido',
  'native-job': 'jobs',
  planner: 'planner',
  manual: 'manual',
}

/** job_steps.builder → venue, for the builders that only ever appear inside a
 *  chain (VENUE_OF_PATH covers the ones that also tag a standalone turn).
 *  `wait` is deliberately absent: a wait is a settlement predicate, not a
 *  venue, and the chain renders it as its own kind of node. */
const JOB_BUILDER_VENUE: Record<string, string> = {
  'native-lifi-fund': 'lifi',
  'native-lifi-swap': 'lifi',
  'native-swap': 'uniswap',
  'native-transfer': 'transfer',
  'native-nft-transfer': 'opensea',
  'native-nft-list': 'opensea',
  'native-aave': 'aave',
}

export interface VenueRow {
  venue: string
  built: number
  signed: number
  builtUsd: number
  signedUsd: number
}

/** What the tx actually DID, keyed by the layer that built it — "Uniswap swap"
 *  reads far better than a bare "Transaction". Falls back to ARTIFACT_LABEL. */
const BUILD_PATH_LABEL: Record<string, string> = {
  'native-swap-uniswap': 'Uniswap swap',
  'native-swap-uniswap-v4': 'Uniswap swap',
  'native-swap-cow': 'CoW swap',
  'native-swap-lifi': 'Stock swap',
  'native-aave-supply': 'Aave supply',
  'native-aave-op': 'Aave position',
  'native-cross-chain': 'Cross-chain swap',
  'native-hl-guardian': 'Hyperliquid order',
  'native-hl-exec': 'Hyperliquid order',
  'native-lido': 'Lido stake',
  'native-job': 'Multi-step job',
}

/** Human fallback when a turn carries no artifact label (embed_turns.detail). */
const ARTIFACT_LABEL: Record<string, string> = {
  'cow-order': 'CoW order',
  tx: 'Transaction',
  'tx-chain': 'Multi-step transaction',
  vote: 'DAO vote',
  job: 'Multi-step job',
  'job-step': 'Job step',
}

/** embed_turns.chain is free-form ('base' | 'ethereum' | '4663' | '0x…' |
 *  'multi' | 'hyperliquid') — resolve it to the app chain registry so links
 *  and labels come from the SINGLE source of truth (lib/chains.ts). */
function appChainOf(chain: string | null | undefined): AppChain | null {
  if (!chain) return null
  const byKey = chainByKey(chain)
  if (byKey) return byKey
  const id = chain.startsWith('0x') ? parseInt(chain, 16) : Number(chain)
  return Number.isFinite(id) ? chainById(id) : null
}

/** A friendly chain name for the receipts feed ('4663' → 'Robinhood'). */
function chainName(chain: string | null | undefined): string | null {
  if (!chain) return null
  if (chain === 'multi') return 'multi-chain'
  return appChainOf(chain)?.short ?? chain
}

/** The explorer link for a signed tx — rebuilt from the chain registry when we
 *  can (the write path historically hardcoded basescan for EVERY chain, so a
 *  Robinhood or Arbitrum tx pointed at the wrong explorer), else the stored
 *  url. The 66-char tx hash is lifted out of whatever url was stored. */
const TX_HASH_RE = /0x[0-9a-fA-F]{64}/
function txLink(chain: string | null | undefined, storedUrl: string | null): string | null {
  const appChain = appChainOf(chain)
  const hash = storedUrl?.match(TX_HASH_RE)?.[0]
  if (appChain && hash) return `${appChain.explorerTx}${hash}`
  return storedUrl
}

const r2 = (n: number) => Math.round(n * 100) / 100
const dayKey = (d: Date) => d.toISOString().slice(0, 10)

export async function GET() {
  const since = new Date(Date.now() - SERIES_DAYS * 86_400_000)
  // Settled x402 spend only: ok rows, real dollars, never dry-runs.
  const x402Where = { ok: true, amountUsd: { gt: 0 }, NOT: { note: 'dry-run' } }
  const guardianWhere = { action: 'closed', valueUsd: { gt: 0 } }

  const [
    signedAgg,
    standingTurnAgg,
    builtAgg,
    x402Agg,
    guardianAgg,
    outcomeAgg,
    pathAgg,
    turnDaily,
    x402Daily,
    guardianDaily,
    railRows,
    servers,
    walletRow,
    recentTurns,
    recentReceipts,
    recentGuardian,
    flowRows,
    chainJobs,
  ] = await Promise.all([
    // Real traffic only, everywhere embed_turns is aggregated here — localhost
    // dev drives and harness origins write real rows but the PUBLIC activity
    // page must never count them (lib/value-origin.ts isInternalOrigin +
    // mirrors; ~$62k of an ~$80k week was dev sessions, 2026-07-27).
    prisma.embedTurn.aggregate({ where: { outcome: 'signed', ...REAL_TRAFFIC_WHERE }, _sum: { valueUsd: true }, _count: { _all: true } }),
    // STANDING signed turns (job steps + DCA runs) — the subset of signedAgg
    // a standing intent fired; attended = signed − standing (lib/value-origin).
    prisma.embedTurn.aggregate({ where: { outcome: 'signed', ...STANDING_TURN_WHERE, ...REAL_TRAFFIC_WHERE }, _sum: { valueUsd: true }, _count: { _all: true } }),
    prisma.embedTurn.aggregate({ where: { outcome: 'tx-built', ...REAL_TRAFFIC_WHERE }, _sum: { valueUsd: true }, _count: { _all: true } }),
    prisma.spendLedgerEntry.aggregate({ where: x402Where, _sum: { amountUsd: true }, _count: { _all: true } }),
    prisma.hlGuardianRun.aggregate({ where: guardianWhere, _sum: { valueUsd: true }, _count: { _all: true } }),
    prisma.embedTurn.groupBy({ by: ['outcome'], where: REAL_TRAFFIC_WHERE, _count: { _all: true } }),
    // Per-build-layer built → signed, all time — the venue conversion table.
    prisma.embedTurn.groupBy({
      by: ['buildPath', 'outcome'],
      where: { outcome: { in: ['tx-built', 'signed'] }, ...REAL_TRAFFIC_WHERE },
      _count: { _all: true },
      _sum: { valueUsd: true },
    }),
    prisma.$queryRaw<{ day: Date; signed_usd: number; standing_usd: number; built_usd: number; signed_n: bigint }[]>`
      SELECT date_trunc('day', created_at) AS day,
             COALESCE(SUM(value_usd) FILTER (WHERE outcome = 'signed'), 0)::float AS signed_usd,
             COALESCE(SUM(value_usd) FILTER (WHERE outcome = 'signed' AND ${Prisma.raw(STANDING_TURN_SQL)}), 0)::float AS standing_usd,
             COALESCE(SUM(value_usd) FILTER (WHERE outcome = 'tx-built'), 0)::float AS built_usd,
             COUNT(*) FILTER (WHERE outcome = 'signed') AS signed_n
      FROM embed_turns WHERE created_at >= ${since} AND NOT ${Prisma.raw(INTERNAL_ORIGIN_SQL)}
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ day: Date; usd: number; n: bigint }[]>`
      SELECT date_trunc('day', created_at) AS day,
             COALESCE(SUM(amount_usd), 0)::float AS usd, COUNT(*) AS n
      FROM spend_ledger
      WHERE ok AND amount_usd > 0 AND COALESCE(note, '') <> 'dry-run' AND created_at >= ${since}
      GROUP BY 1 ORDER BY 1`,
    prisma.$queryRaw<{ day: Date; usd: number; n: bigint }[]>`
      SELECT date_trunc('day', created_at) AS day,
             COALESCE(SUM(value_usd), 0)::float AS usd, COUNT(*) AS n
      FROM hl_guardian_runs
      WHERE action = 'closed' AND value_usd > 0 AND created_at >= ${since}
      GROUP BY 1 ORDER BY 1`,
    // The rails: every MCP the router actually called, paid or free — call
    // volume, settled fees, and settle rate, straight from the ledger.
    prisma.$queryRaw<
      { service: string; calls: bigint; failed: bigint; usd: number; free: boolean; last_at: Date }[]
    >`
      SELECT COALESCE(service_name, host) AS service,
             COUNT(*) FILTER (WHERE ok) AS calls,
             COUNT(*) FILTER (WHERE NOT ok AND note LIKE 'error:%') AS failed,
             COALESCE(SUM(amount_usd) FILTER (WHERE ok), 0)::float AS usd,
             BOOL_AND(COALESCE(amount_usd, 0) = 0) AS free,
             MAX(created_at) AS last_at
      FROM spend_ledger
      WHERE COALESCE(note, '') <> 'dry-run'
      GROUP BY 1 HAVING COUNT(*) FILTER (WHERE ok) > 0
      ORDER BY 3 DESC, 2 DESC
      LIMIT 14`,
    // Directory rows so the client can render each rail's brand mark/logo.
    prisma.mcpServer.findMany({ select: { slug: true, name: true, iconSlug: true, logoUrl: true, gated: true } }),
    prisma.$queryRaw<[{ accounts: bigint }]>`
      SELECT COUNT(DISTINCT g.owner_address) AS accounts
      FROM spend_ledger l JOIN spend_grants g ON g.id = l.grant_id`,
    // Recent value events — artifact labels only, never prompts (P1).
    prisma.embedTurn.findMany({
      where: { outcome: { in: ['signed', 'tx-built'] }, ...REAL_TRAFFIC_WHERE },
      orderBy: { createdAt: 'desc' },
      take: RECENT_LIMIT,
      select: { outcome: true, artifact: true, chain: true, detail: true, txUrl: true, valueUsd: true, buildPath: true, createdAt: true },
    }),
    prisma.spendLedgerEntry.findMany({
      where: x402Where,
      orderBy: { createdAt: 'desc' },
      take: RECENT_LIMIT,
      select: { serviceName: true, host: true, amountUsd: true, txHash: true, createdAt: true },
    }),
    prisma.hlGuardianRun.findMany({
      where: guardianWhere,
      orderBy: { createdAt: 'desc' },
      take: 8,
      select: { valueUsd: true, reason: true, createdAt: true },
    }),
    // ── the flow: every signed dollar, by where the ask CAME FROM × which
    // layer built it. The four source buckets are a clean partition (standing
    // wins over link so nothing is counted twice), which is what lets the
    // page draw it as a flow instead of two unrelated tables.
    prisma.$queryRaw<{ src: string; path: string; usd: number; n: bigint }[]>`
      SELECT CASE
               WHEN ${Prisma.raw(STANDING_TURN_SQL)} THEN 'standing'
               WHEN intent_link_slug IS NOT NULL THEN 'link'
               WHEN origin_kind = 'embed' THEN 'embed'
               ELSE 'chat'
             END AS src,
             COALESCE(build_path, 'unattributed') AS path,
             COALESCE(SUM(value_usd), 0)::float AS usd,
             COUNT(*) AS n
      FROM embed_turns
      WHERE outcome = 'signed' AND value_usd > 0 AND NOT ${Prisma.raw(INTERNAL_ORIGIN_SQL)}
      GROUP BY 1, 2`,
    // ── chains built: the SHAPE of multi-step work, never its content.
    // Production-env jobs only (the same rule internal traffic follows — dev
    // and preview runners write real rows), and the select is deliberately
    // narrow: no title, no wallet, no params, no artifact. A step's builder +
    // kind + status is enough to draw the chain and leaks nothing (P1).
    prisma.job.findMany({
      where: { originEnv: 'production' },
      orderBy: { createdAt: 'desc' },
      take: CHAIN_LIMIT,
      select: {
        status: true,
        valueUsd: true,
        createdAt: true,
        steps: {
          orderBy: { seq: 'asc' },
          select: { seq: true, kind: true, status: true, builder: true, valueUsd: true },
        },
      },
    }),
  ])

  const signedUsd = r2(signedAgg._sum.valueUsd ?? 0)
  const builtUsd = r2(builtAgg._sum.valueUsd ?? 0)
  const x402Usd = r2(x402Agg._sum.amountUsd ?? 0)
  const guardianUsd = r2(guardianAgg._sum.valueUsd ?? 0)

  // ── the falsifiable-test split: attended vs standing ─────────────────────
  // ATTENDED = a human typed it and signed in the moment (chat + embed turns).
  // STANDING = a standing intent fired it: job steps + DCA runs (embed_turns
  // subset) + guardian autonomous closes + x402 agent-call fees. The company
  // exists the week the standing line grows on its own.
  const standingTurnUsd = r2(standingTurnAgg._sum.valueUsd ?? 0)
  const standingTurnCount = standingTurnAgg._count._all
  const attendedUsd = r2(signedUsd - standingTurnUsd)
  const attendedCount = signedAgg._count._all - standingTurnCount
  const standingUsd = r2(standingTurnUsd + x402Usd + guardianUsd)
  const standingCount = standingTurnCount + x402Agg._count._all + guardianAgg._count._all

  // ── daily series: merge the three sources on the UTC day ──────────────────
  const days = new Map<string, { signedUsd: number; standingUsd: number; builtUsd: number; x402Usd: number; events: number }>()
  const at = (d: Date) => {
    const k = dayKey(d)
    const row = days.get(k) ?? { signedUsd: 0, standingUsd: 0, builtUsd: 0, x402Usd: 0, events: 0 }
    days.set(k, row)
    return row
  }
  for (const d of turnDaily) {
    const row = at(d.day)
    row.signedUsd += d.signed_usd
    row.standingUsd += d.standing_usd
    row.builtUsd += d.built_usd
    row.events += Number(d.signed_n)
  }
  for (const d of x402Daily) {
    const row = at(d.day)
    row.x402Usd += d.usd
    row.standingUsd += d.usd
    row.events += Number(d.n)
  }
  for (const d of guardianDaily) {
    const row = at(d.day)
    row.signedUsd += d.usd
    row.standingUsd += d.usd
    row.events += Number(d.n)
  }
  // Fill the gaps from the first active day so the cumulative line is honest
  // (flat where nothing happened) — but never render an all-empty window.
  // Start the running total at everything that moved BEFORE the window, so
  // the curve stays all-time even once history outgrows SERIES_DAYS.
  const windowMoved = [...days.values()].reduce((acc, d) => acc + d.signedUsd + d.x402Usd, 0)
  const allTimeMoved = signedUsd + x402Usd + guardianUsd
  const preWindowBase = Math.max(0, r2(allTimeMoved - windowMoved))
  const keys = [...days.keys()].sort()
  const series: { day: string; signedUsd: number; x402Usd: number; attendedUsd: number; standingUsd: number; cumulativeUsd: number; events: number }[] = []
  if (keys.length > 0) {
    let cum = preWindowBase
    const cursor = new Date(`${keys[0]}T00:00:00Z`)
    const today = new Date()
    while (cursor.getTime() <= today.getTime()) {
      const k = dayKey(cursor)
      const row = days.get(k)
      // Day total = turn signed (incl. guardian) + x402; standing = job/DCA
      // turns + guardian + x402 — so attended falls out as total − standing.
      const dayTotal = row ? row.signedUsd + row.x402Usd : 0
      cum = r2(cum + dayTotal)
      series.push({
        day: k,
        signedUsd: r2(row?.signedUsd ?? 0),
        x402Usd: r2(row?.x402Usd ?? 0),
        attendedUsd: r2(Math.max(0, dayTotal - (row?.standingUsd ?? 0))),
        standingUsd: r2(row?.standingUsd ?? 0),
        cumulativeUsd: cum,
        events: row?.events ?? 0,
      })
      cursor.setUTCDate(cursor.getUTCDate() + 1)
    }
  }

  // ── per-venue built → signed (embed_turns) + the guardian's own lane ──────
  const venues = new Map<string, VenueRow>()
  for (const row of pathAgg) {
    const venue = VENUE_OF_PATH[row.buildPath ?? ''] ?? (row.buildPath ? row.buildPath : 'unattributed')
    const v = venues.get(venue) ?? { venue, built: 0, signed: 0, builtUsd: 0, signedUsd: 0 }
    if (row.outcome === 'tx-built') {
      v.built += row._count._all
      v.builtUsd = r2(v.builtUsd + (row._sum.valueUsd ?? 0))
    } else {
      v.signed += row._count._all
      v.signedUsd = r2(v.signedUsd + (row._sum.valueUsd ?? 0))
    }
    venues.set(venue, v)
  }
  if (guardianAgg._count._all > 0) {
    const v = venues.get('guardian') ?? { venue: 'guardian', built: 0, signed: 0, builtUsd: 0, signedUsd: 0 }
    // Autonomous closes execute server-side the moment they trigger — every
    // "built" is an execution, so they land as signed.
    v.signed += guardianAgg._count._all
    v.signedUsd = r2(v.signedUsd + guardianUsd)
    venues.set('guardian', v)
  }

  // ── the rails: ledger rows + directory identity (for logos) ──────────────
  const byName = new Map(servers.map((s) => [s.name.toLowerCase(), s]))
  const rails = railRows.map((row) => {
    const s = byName.get(row.service.toLowerCase())
    const calls = Number(row.calls)
    const failed = Number(row.failed)
    return {
      service: row.service,
      slug: s?.slug ?? null,
      iconSlug: s?.iconSlug ?? null,
      logoUrl: s?.logoUrl ?? null,
      free: s ? !s.gated : row.free,
      calls,
      usd: r2(row.usd),
      settleRate: calls + failed > 0 ? calls / (calls + failed) : null,
      lastAt: row.last_at.toISOString(),
    }
  })

  // ── funnel (all time, embed_turns outcomes) ───────────────────────────────
  const outcome = (o: string) => outcomeAgg.find((x) => x.outcome === o)?._count._all ?? 0
  const turns = outcomeAgg.reduce((acc, x) => acc + x._count._all, 0)

  // ── recent value events, merged newest-first ──────────────────────────────
  type RecentEvent = {
    kind: 'tx' | 'x402' | 'guardian'
    label: string
    outcome: string
    chain: string | null
    venue: string | null
    usd: number | null
    link: string | null
    at: string
  }
  const recent: RecentEvent[] = [
    ...recentTurns.map((t): RecentEvent => ({
      kind: 'tx',
      label: t.detail ?? BUILD_PATH_LABEL[t.buildPath ?? ''] ?? ARTIFACT_LABEL[t.artifact ?? ''] ?? 'Transaction',
      outcome: t.outcome,
      chain: chainName(t.chain),
      venue: VENUE_OF_PATH[t.buildPath ?? ''] ?? null,
      usd: t.valueUsd,
      // Only signed turns have a real on-chain tx; rebuild the link on the
      // correct explorer (fixes non-Base chains the write path mislabeled).
      link: t.outcome === 'signed' ? txLink(t.chain, t.txUrl) : null,
      at: t.createdAt.toISOString(),
    })),
    ...recentReceipts.map((x): RecentEvent => ({
      kind: 'x402',
      label: x.serviceName ?? x.host,
      outcome: 'settled',
      chain: 'Base',
      venue: null,
      usd: x.amountUsd,
      link: x.txHash ? `https://basescan.org/tx/${x.txHash}` : null,
      at: x.createdAt.toISOString(),
    })),
    ...recentGuardian.map((g): RecentEvent => ({
      kind: 'guardian',
      label: g.reason || 'Guardian autonomous close',
      outcome: 'executed',
      chain: null,
      venue: 'guardian',
      usd: g.valueUsd,
      link: null,
      at: g.createdAt.toISOString(),
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, RECENT_LIMIT)

  // ── the flow: source → venue, with the two non-turn rails folded in ──────
  // Guardian closes and x402 call fees never touch embed_turns, so they're
  // appended as their own edges — otherwise the flow's total wouldn't equal
  // the hero figure, and a diagram that doesn't add up is worse than none.
  const flow: { source: string; venue: string; usd: number; n: number }[] = flowRows
    .map((r) => ({
      source: r.src,
      // JOB_BUILDER_VENUE second: some layers only ever tag a turn from inside
      // a chain (native-nft-list), and an unmapped key renders as a raw
      // build_path in a public diagram.
      venue: VENUE_OF_PATH[r.path] ?? JOB_BUILDER_VENUE[r.path] ?? (r.path === 'unattributed' ? 'unattributed' : r.path),
      usd: r2(r.usd),
      n: Number(r.n),
    }))
    .filter((e) => e.usd > 0)
  if (guardianUsd > 0) flow.push({ source: 'guardian', venue: 'hyperliquid', usd: guardianUsd, n: guardianAgg._count._all })
  if (x402Usd > 0) flow.push({ source: 'agents', venue: 'x402', usd: x402Usd, n: x402Agg._count._all })

  // ── chains: shape only. A step's public label comes from its builder, so
  // nothing a user typed can reach this array by construction.
  const chains = chainJobs
    .filter((j) => j.steps.length > 1)
    .map((j) => ({
      status: j.status,
      usd: r2(j.valueUsd ?? j.steps.reduce((acc, s) => acc + (s.valueUsd ?? 0), 0)),
      at: j.createdAt.toISOString(),
      steps: j.steps.map((s) => ({
        kind: s.kind,
        status: s.status,
        builder: s.builder,
        venue: VENUE_OF_PATH[s.builder] ?? JOB_BUILDER_VENUE[s.builder] ?? null,
        usd: s.valueUsd ?? null,
      })),
    }))

  return NextResponse.json(
    {
      seriesDays: SERIES_DAYS,
      hero: {
        // THE number: tx notional signed + x402 fees settled + guardian closes.
        systemTotalUsd: r2(signedUsd + x402Usd + guardianUsd),
        // The falsifiable test: attended (human typed it) vs standing (a job,
        // schedule, guardian, or funded agent fired it). attended + standing
        // = systemTotal. Standing sublines let the page show WHAT ran alone.
        attendedUsd,
        attendedCount,
        standingUsd,
        standingCount,
        standing: {
          jobsUsd: standingTurnUsd,
          jobsCount: standingTurnCount,
          guardianUsd,
          guardianCount: guardianAgg._count._all,
          x402Usd,
          x402Count: x402Agg._count._all,
        },
        signedUsd,
        signedCount: signedAgg._count._all,
        builtUsd,
        builtCount: builtAgg._count._all,
        x402Usd,
        x402Count: x402Agg._count._all,
        guardianUsd,
        guardianCount: guardianAgg._count._all,
        wallets: Number(walletRow[0]?.accounts ?? 0),
        mcps: servers.length,
        freeMcps: servers.filter((s) => !s.gated).length,
      },
      series,
      venues: [...venues.values()].sort(
        (a, b) => b.signedUsd + b.builtUsd - (a.signedUsd + a.builtUsd) || b.built + b.signed - (a.built + a.signed),
      ),
      rails,
      funnel: {
        turns,
        answered: outcome('answered'),
        clarify: outcome('clarify'),
        txBuilt: outcome('tx-built'),
        signed: outcome('signed'),
        refused: outcome('refused') + outcome('error') + outcome('credit-gate'),
      },
      recent,
      flow,
      chains,
    },
    { headers: { 'cache-control': 'public, s-maxage=30, stale-while-revalidate=120' } },
  )
}
