// ─────────────────────────────────────────────────────────────────────────
//  Route trace stream — persist each routed turn's line-by-line reasoning to
//  the shared DB so the Activity page can replay it in (near) real time, for
//  anyone, including turns generated from a local dev machine (local + prod
//  share one Neon DB). This is the raw trace; RouteEvent (lib/route-telemetry)
//  stays the per-turn aggregate.
//
//  Privacy: SAME posture as /api/activity — engine-derived intent, service
//  slugs, prices, public tx hashes only. The raw user question is NEVER an
//  argument here (the chat route only forwards trace-type events, which carry
//  paraphrased intent, not the verbatim message).
// ─────────────────────────────────────────────────────────────────────────

import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'

// The trace-event types safe to stream publicly (mirrors the chat route's
// TRACE_TYPES; excludes 'reply'/'done' which carry answer content).
const PUBLIC_TYPES = new Set([
  'status', 'analyze', 'shortlist', 'candidate', 'select', 'pay', 'receipt', 'tool', 'eip712', 'note', 'error',
])

const RETENTION_MS = 2 * 86_400_000 // keep ~2 days of live trace

/** A stable id for one routed turn (groups its trace lines). */
export function newTurnId(): string {
  return globalThis.crypto.randomUUID()
}

/**
 * Fire-and-forget: persist one trace line. NEVER throws / awaits into the turn.
 * Called from the chat SSE chokepoint for every trace-type event. `seq` orders
 * lines within a turn; `payer` is 'burner' | 'agent' | 'wallet' | null.
 */
export function recordTraceLine(turnId: string, seq: number, event: unknown, payer?: string | null): void {
  if (process.env.USE_DB !== 'true' || !process.env.DATABASE_URL) return
  const type = event && typeof event === 'object' ? (event as { type?: string }).type : undefined
  if (!type || !PUBLIC_TYPES.has(type)) return
  const txHash =
    type === 'receipt'
      ? ((event as { receipt?: { txHash?: string } }).receipt?.txHash ?? null)
      : null
  prisma.routeTraceLine
    .create({
      data: {
        turnId,
        seq,
        type,
        event: event as Prisma.InputJsonValue,
        txHash,
        payer: payer ?? null,
      },
    })
    .then(() => {
      // Best-effort retention prune — cheap, occasional, never blocks a turn.
      if (Math.random() < 0.02) {
        return prisma.routeTraceLine.deleteMany({
          where: { createdAt: { lt: new Date(Date.now() - RETENTION_MS) } },
        })
      }
    })
    .catch(() => {})
}

export interface TraceLineRow {
  n: number
  turnId: string
  seq: number
  type: string
  event: unknown
  txHash: string | null
  payer: string | null
  createdAt: string
}

export interface LiveTracePayload {
  lines: TraceLineRow[]
  cursor: number // max `n` returned; pass back as ?since= to poll for more
}

/**
 * Read the live trace for /api/activity/live.
 *  • since omitted  → the most recent `limit` lines (seed the view), asc by n.
 *  • since provided → only lines with n > since (incremental poll), asc by n.
 */
export async function readTraceLines(since: number | undefined, limit = 200): Promise<LiveTracePayload> {
  if (process.env.USE_DB !== 'true' || !process.env.DATABASE_URL) return { lines: [], cursor: since ?? 0 }
  const rows =
    since === undefined
      ? // newest `limit`, then flip to ascending so the client appends in order
        (await prisma.routeTraceLine.findMany({ orderBy: { n: 'desc' }, take: limit })).reverse()
      : await prisma.routeTraceLine.findMany({ where: { n: { gt: since } }, orderBy: { n: 'asc' }, take: limit })

  const lines: TraceLineRow[] = rows.map((r) => ({
    n: r.n,
    turnId: r.turnId,
    seq: r.seq,
    type: r.type,
    event: r.event,
    txHash: r.txHash,
    payer: r.payer,
    createdAt: r.createdAt.toISOString(),
  }))
  const cursor = lines.length ? lines[lines.length - 1].n : (since ?? 0)
  return { lines, cursor }
}

/** The full ordered trace of one turn — for the incident/logs detail view. */
export async function getTurnTrace(turnId: string): Promise<unknown[]> {
  if (process.env.USE_DB !== 'true' || !process.env.DATABASE_URL) return []
  try {
    const rows = await prisma.routeTraceLine.findMany({
      where: { turnId },
      orderBy: { seq: 'asc' },
      select: { event: true },
    })
    return rows.map((r) => r.event)
  } catch {
    return []
  }
}
