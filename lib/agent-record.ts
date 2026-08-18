// lib/agent-record.ts — the per-agent track record (M4), the moat seed.
//
// The desk (M1) binds an agent identity (agent_key) to every agent-signed
// intent. This turns that identity into a PUBLIC receipt: how many intents an
// agent brokered, how many its humans signed, and how much real money moved
// through the guarded path under its name. "Clears through Pantessa" becomes a
// badge an agent can point at — and reputation compounds where features can't.
//
// Two honesty rules carry this:
//   1. The raw agent_key is NEVER exposed. The public handle is a hash prefix
//      (agentHandleFor) — the key becomes the x402-payer credential in M6, so
//      it must not leak in a URL.
//   2. Money moved is REAL money only, and intents are ORGANIC only (broker_intents.is_internal excluded). The embed_turns join composes
//      REAL_TRAFFIC_WHERE (the is_internal + internal-origin exclusion), the
//      same predicate every public scoreboard uses — an agent's record can
//      never be inflated by our own harness.
//
// Raw receipts only — no score yet. Scoring (a single "trust number") is a
// later editorial decision; v1 shows the honest counts and lets a reader judge.

import { createHash } from 'node:crypto'
import prisma from '@/lib/db'
import { REAL_TRAFFIC_WHERE } from '@/lib/value-origin'

/** The public handle for an agent identity: the first 16 hex of its SHA-256.
 *  Stable, shareable, and it never reveals the raw key. */
export function agentHandleFor(agentKey: string): string {
  return createHash('sha256').update(agentKey).digest('hex').slice(0, 16)
}

export interface AgentRecord {
  handle: string
  /** The agent's most recent self-reported display name, or null. */
  displayName: string | null
  intents: number
  handoffs: number
  signedTurns: number
  moneyMovedUsd: number
  firstSeen: Date
  lastSeen: Date
}

/** Build the public record for a handle, or null if no agent matches. Reads
 *  only server truth; money is REAL-traffic only. */
export async function getAgentRecord(handle: string): Promise<AgentRecord | null> {
  if (!/^[0-9a-f]{16}$/.test(handle)) return null

  // is_internal excluded: our own harness/drill intents (lib/internal-run.ts)
  // never headline a public record — a handle with only internal intents 404s.
  const intents = await prisma.brokerIntent.findMany({
    where: { agentKeyHash: handle, isInternal: false },
    select: { agent: true, linkSlug: true, createdAt: true, updatedAt: true },
    orderBy: { createdAt: 'asc' },
  })
  if (intents.length === 0) return null

  const slugs = intents.map((i) => i.linkSlug).filter((s): s is string => !!s)
  const displayName =
    [...intents].reverse().find((i) => i.agent && i.agent.trim())?.agent?.trim() ?? null

  // Real signed money attributed to this agent's links — is_internal excluded.
  let signedTurns = 0
  let moneyMovedUsd = 0
  if (slugs.length) {
    const agg = await prisma.embedTurn.aggregate({
      where: { intentLinkSlug: { in: slugs }, outcome: 'signed', ...REAL_TRAFFIC_WHERE },
      _count: { _all: true },
      _sum: { valueUsd: true },
    })
    signedTurns = agg._count._all
    moneyMovedUsd = Math.round((agg._sum.valueUsd ?? 0) * 100) / 100
  }

  return {
    handle,
    displayName,
    intents: intents.length,
    handoffs: slugs.length,
    signedTurns,
    moneyMovedUsd,
    firstSeen: intents[0].createdAt,
    lastSeen: intents.reduce((a, i) => (i.updatedAt > a ? i.updatedAt : a), intents[0].updatedAt),
  }
}
