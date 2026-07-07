import { NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The embed-owner analytics rollup — everything /dashboard/embeds renders:
// what visitors asked, what the agent did (outcome funnel), the transactions
// it built (chain + explorer links), per-site stats, and the DEAD-END
// sessions that feed "upgrade your MCP" suggestions. A dead end = a session
// that hit friction (clarify / refused / error / credit-gate) and never got
// a transaction built or signed — the visitor came to transact and couldn't.

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
        createdAt: true,
      },
    }),
  ])

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
  const siteMap = new Map<string, { turns: number; sessions: Set<string>; txBuilt: number; signed: number; friction: number; lastAt: Date }>()
  for (const t of turns) {
    const s = siteMap.get(t.origin) ?? { turns: 0, sessions: new Set<string>(), txBuilt: 0, signed: 0, friction: 0, lastAt: t.createdAt }
    s.turns++
    s.sessions.add(t.sessionId)
    if (t.outcome === 'tx-built') s.txBuilt++
    if (t.outcome === 'signed') s.signed++
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
        at: t.createdAt.toISOString(),
      })),
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
        friction: s.friction,
        lastAt: s.lastAt.toISOString(),
      }))
      .sort((a, b) => b.turns - a.turns),
    // sites with a mount but no turns yet still show up
    sites: sites.map((s) => ({ origin: s.origin, pageUrl: s.pageUrl, mountTurns: s.turns, lastSeen: s.lastSeen.toISOString() })),
  })
}
