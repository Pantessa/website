import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { isAdminAddress } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The embed-owner analytics rollup — everything /dashboard/embeds renders:
// MONEY MOVED (notional USD of built/signed transactions — the headline),
// what visitors asked, what the agent did (outcome funnel), the transactions
// it built (chain + explorer links), per-site stats, and the DEAD-END
// sessions that feed "upgrade your MCP" suggestions. A dead end = a session
// that hit friction (clarify / refused / error / credit-gate) and never got
// a transaction built or signed — the visitor came to transact and couldn't.
// Admin viewers additionally get `global`: platform-wide money flow across
// EVERY embed key plus first-party yeetful.com chat (embedKeyId '') — the
// company progress number.

const WINDOW_DAYS = 30
const TURN_CAP = 2000

interface SessionAgg {
  origin: string
  first: Date
  last: Date
  turns: { prompt: string; outcome: string; detail: string | null; createdAt: Date }[]
  txBuilt: boolean
  signed: boolean
  friction: boolean
}

export async function GET() {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000)
  const [keys, sites, turns] = await Promise.all([
    prisma.embedKey.findMany({
      where: { ownerAddress: addr },
      select: { id: true, key: true, label: true, revoked: true },
    }),
    prisma.embedSite.findMany({
      where: { ownerAddress: addr },
      select: { origin: true, pageUrl: true, turns: true, lastSeen: true },
    }),
    prisma.embedTurn.findMany({
      where: { ownerAddress: addr, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: TURN_CAP,
      select: {
        sessionId: true,
        origin: true,
        prompt: true,
        outcome: true,
        artifact: true,
        chain: true,
        detail: true,
        txUrl: true,
        valueUsd: true,
        buildPath: true,
        createdAt: true,
      },
    }),
  ])

  // ── platform-wide money flow (admin viewers only) ─────────────────────────
  // ONE number for "is this working": every dollar the system moved —
  // transaction notional signed through chat + every embed, PLUS the x402
  // call fees actually settled through the router (spend_ledger, real USDC
  // on Base). DB-side aggregates so the TURN_CAP on the per-owner feed never
  // truncates the company metric.
  let global: Record<string, unknown> | null = null
  if (isAdminAddress(addr)) {
    const sum = (where: object) =>
      prisma.embedTurn.aggregate({ where, _sum: { valueUsd: true }, _count: { _all: true } })
    // Settled x402 spend only: ok row, real dollars, never dry-runs.
    const x402Where = { ok: true, amountUsd: { gt: 0 }, NOT: { note: 'dry-run' } }
    const x402 = (extra: object = {}) =>
      prisma.spendLedgerEntry.aggregate({ where: { ...x402Where, ...extra }, _sum: { amountUsd: true }, _count: { _all: true } })
    const [signedAll, signedWindow, builtWindow, chatSignedAll, x402All, x402Window, pathAgg] = await Promise.all([
      sum({ outcome: 'signed' }),
      sum({ outcome: 'signed', createdAt: { gte: since } }),
      sum({ outcome: 'tx-built', createdAt: { gte: since } }),
      sum({ outcome: 'signed', embedKeyId: '' }),
      x402(),
      x402({ createdAt: { gte: since } }),
      // Platform-wide per-build-layer split (window) — covers every embed key
      // AND the first-party chat lane, so it answers "where are transactions
      // being created and failing" for the whole system.
      prisma.embedTurn.groupBy({
        by: ['buildPath', 'outcome'],
        where: { outcome: { in: ['tx-built', 'signed'] }, createdAt: { gte: since } },
        _count: { _all: true },
        _sum: { valueUsd: true },
      }),
    ])
    const round = (n: number) => Math.round(n * 100) / 100
    const allTimeSignedUsd = round(signedAll._sum.valueUsd ?? 0)
    const x402AllTimeUsd = round(x402All._sum.amountUsd ?? 0)
    const globalPerPath = new Map<string, { built: number; signed: number; builtUsd: number; signedUsd: number }>()
    for (const row of pathAgg) {
      const key = row.buildPath ?? 'unattributed'
      const p = globalPerPath.get(key) ?? { built: 0, signed: 0, builtUsd: 0, signedUsd: 0 }
      if (row.outcome === 'tx-built') {
        p.built += row._count._all
        p.builtUsd = round(p.builtUsd + (row._sum.valueUsd ?? 0))
      } else {
        p.signed += row._count._all
        p.signedUsd = round(p.signedUsd + (row._sum.valueUsd ?? 0))
      }
      globalPerPath.set(key, p)
    }
    global = {
      // THE system number: tx notional signed + x402 fees settled, all time.
      systemTotalUsd: round(allTimeSignedUsd + x402AllTimeUsd),
      allTimeSignedUsd,
      allTimeSignedCount: signedAll._count._all,
      windowSignedUsd: round(signedWindow._sum.valueUsd ?? 0),
      windowSignedCount: signedWindow._count._all,
      windowBuiltUsd: round(builtWindow._sum.valueUsd ?? 0),
      windowBuiltCount: builtWindow._count._all,
      chatSignedUsd: round(chatSignedAll._sum.valueUsd ?? 0),
      chatSignedCount: chatSignedAll._count._all,
      x402AllTimeUsd,
      x402AllTimeCount: x402All._count._all,
      x402WindowUsd: round(x402Window._sum.amountUsd ?? 0),
      x402WindowCount: x402Window._count._all,
      perPath: [...globalPerPath.entries()]
        .map(([path, p]) => ({ path, ...p }))
        .sort((a, b) => b.built + b.signed - (a.built + a.signed)),
    }
  }

  // ── session rollup (turns arrive newest-first; rebuild chronological) ─────
  const sessions = new Map<string, SessionAgg>()
  for (const t of [...turns].reverse()) {
    const s = sessions.get(t.sessionId) ?? {
      origin: t.origin,
      first: t.createdAt,
      last: t.createdAt,
      turns: [],
      txBuilt: false,
      signed: false,
      friction: false,
    }
    s.last = t.createdAt
    s.turns.push({ prompt: t.prompt, outcome: t.outcome, detail: t.detail, createdAt: t.createdAt })
    if (t.outcome === 'tx-built') s.txBuilt = true
    if (t.outcome === 'signed') s.signed = true
    if (t.outcome === 'clarify' || t.outcome === 'refused' || t.outcome === 'error' || t.outcome === 'credit-gate')
      s.friction = true
    sessions.set(t.sessionId, s)
  }
  const sessionList = [...sessions.values()]

  const count = (o: string) => turns.filter((t) => t.outcome === o).length
  const txBuilt = count('tx-built')
  const signed = count('signed')
  // money moved: sum of the guardrail-priced notional over the window.
  const sumUsd = (o: string) =>
    Math.round(turns.reduce((acc, t) => acc + (t.outcome === o ? (t.valueUsd ?? 0) : 0), 0) * 100) / 100
  const builtUsd = sumUsd('tx-built')
  const signedUsd = sumUsd('signed')

  // ── per-build-layer breakdown: which layer creates transactions, and which
  // layer's builds die unsigned (aggregate sibling of route_trace_lines'
  // per-turn detail). Turns recorded before build_path existed land in the
  // 'unattributed' bucket — honest, never inferred.
  const perPath = new Map<string, { built: number; signed: number; builtUsd: number; signedUsd: number }>()
  for (const t of turns) {
    if (t.outcome !== 'tx-built' && t.outcome !== 'signed') continue
    const key = t.buildPath ?? 'unattributed'
    const p = perPath.get(key) ?? { built: 0, signed: 0, builtUsd: 0, signedUsd: 0 }
    if (t.outcome === 'tx-built') {
      p.built++
      p.builtUsd = Math.round((p.builtUsd + (t.valueUsd ?? 0)) * 100) / 100
    } else {
      p.signed++
      p.signedUsd = Math.round((p.signedUsd + (t.valueUsd ?? 0)) * 100) / 100
    }
    perPath.set(key, p)
  }

  const deadEnds = sessionList
    .filter((s) => s.friction && !s.txBuilt && !s.signed)
    .sort((a, b) => b.last.getTime() - a.last.getTime())
    .slice(0, 25)
  const builtNotSigned = sessionList
    .filter((s) => s.txBuilt && !s.signed)
    .sort((a, b) => b.last.getTime() - a.last.getTime())
    .slice(0, 25)

  const serializeSession = (s: SessionAgg) => ({
    origin: s.origin,
    startedAt: s.first.toISOString(),
    endedAt: s.last.toISOString(),
    turns: s.turns.map((t) => ({
      prompt: t.prompt,
      outcome: t.outcome,
      detail: t.detail,
      at: t.createdAt.toISOString(),
    })),
  })

  // per-site rollup over the window, joined with the sites ledger for page URLs
  const siteMap = new Map<string, { turns: number; sessions: Set<string>; txBuilt: number; signed: number; signedUsd: number; friction: number; lastAt: Date }>()
  for (const t of turns) {
    const s = siteMap.get(t.origin) ?? { turns: 0, sessions: new Set<string>(), txBuilt: 0, signed: 0, signedUsd: 0, friction: 0, lastAt: t.createdAt }
    s.turns++
    s.sessions.add(t.sessionId)
    if (t.outcome === 'tx-built') s.txBuilt++
    if (t.outcome === 'signed') {
      s.signed++
      s.signedUsd = Math.round((s.signedUsd + (t.valueUsd ?? 0)) * 100) / 100
    }
    if (t.outcome === 'refused' || t.outcome === 'error' || t.outcome === 'credit-gate') s.friction++
    if (t.createdAt > s.lastAt) s.lastAt = t.createdAt
    siteMap.set(t.origin, s)
  }

  return NextResponse.json({
    windowDays: WINDOW_DAYS,
    keys,
    totals: {
      turns: turns.length,
      sessions: sessionList.length,
      answered: count('answered'),
      clarify: count('clarify'),
      txBuilt,
      signed,
      builtUsd,
      signedUsd,
      refused: count('refused'),
      errors: count('error'),
      creditGated: count('credit-gate'),
      // of the transactions the agent built, how many got signed
      signRate: txBuilt > 0 ? signed / txBuilt : null,
      deadEndSessions: sessionList.filter((s) => s.friction && !s.txBuilt && !s.signed).length,
    },
    funnel: {
      sessions: sessionList.length,
      withTxBuilt: sessionList.filter((s) => s.txBuilt).length,
      withSigned: sessionList.filter((s) => s.signed).length,
    },
    recentAsks: turns
      .filter((t) => t.prompt)
      .slice(0, 30)
      .map((t) => ({ prompt: t.prompt, outcome: t.outcome, origin: t.origin, at: t.createdAt.toISOString() })),
    transactions: turns
      .filter((t) => t.outcome === 'tx-built' || t.outcome === 'signed')
      .slice(0, 50)
      .map((t) => ({
        outcome: t.outcome,
        artifact: t.artifact,
        chain: t.chain,
        txUrl: t.txUrl,
        detail: t.detail,
        prompt: t.prompt,
        origin: t.origin,
        valueUsd: t.valueUsd,
        buildPath: t.buildPath,
        at: t.createdAt.toISOString(),
      })),
    // which layer builds → which layer gets signed, most active first
    perPath: [...perPath.entries()]
      .map(([path, p]) => ({ path, ...p }))
      .sort((a, b) => b.built + b.signed - (a.built + a.signed)),
    deadEnds: deadEnds.map(serializeSession),
    builtNotSigned: builtNotSigned.map(serializeSession),
    perSite: [...siteMap.entries()]
      .map(([origin, s]) => ({
        origin,
        pageUrl: sites.find((x) => x.origin === origin)?.pageUrl ?? null,
        turns: s.turns,
        sessions: s.sessions.size,
        txBuilt: s.txBuilt,
        signed: s.signed,
        signedUsd: s.signedUsd,
        friction: s.friction,
        lastAt: s.lastAt.toISOString(),
      }))
      .sort((a, b) => b.turns - a.turns),
    // sites with a mount but no turns yet still show up
    sites: sites.map((s) => ({ origin: s.origin, pageUrl: s.pageUrl, mountTurns: s.turns, lastSeen: s.lastSeen.toISOString() })),
    // platform-wide money flow — present only for admin viewers
    ...(global ? { global } : {}),
  })
}
