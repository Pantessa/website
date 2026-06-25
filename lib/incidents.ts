// ─────────────────────────────────────────────────────────────────────────
//  Route incidents — the self-heal loop's unit of work. A routing FAILURE is
//  deduplicated by signature (service + error class) into one incident with a
//  count + state machine, so the autonomous fixer (Phase 2) fires ONCE per bug
//  instead of N times. Each incident links to a failing turn's full trace
//  (route_trace_lines) — the "what the user tried + what they got" a fix cites.
//
//  Fire-and-forget from the chat failure path; never blocks or fails a turn.
// ─────────────────────────────────────────────────────────────────────────

import prisma from '@/lib/db'

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

/** Bucket an error message into a coarse class for grouping. */
export function classifyError(message: string): string {
  const m = message.toLowerCase()
  if (/unresolved path/.test(m)) return 'unresolved-path'
  if (/timed?\s?out|etimedout|aborted|abort(ed)?\b|esockettimedout/.test(m)) return 'timeout'
  if (/no 402|payment verification|settlement|errorreason|insufficient_balance|invalid_exact/.test(m)) return 'settlement'
  const status = m.match(/\b([45]\d\d)\b/)?.[1]
  if (status) return status
  if (/enotfound|econnrefused|fetch failed|network/.test(m)) return 'network'
  return 'error'
}

/**
 * Record a routing failure as a deduplicated incident. Upserts by signature:
 * a repeat bumps the count + lastSeen (and reopens a resolved one); a new kind
 * opens a fresh incident. NEVER call for policy blocks (those are expected) —
 * only for genuine call failures.
 */
export function recordIncident(input: { service: string; message: string; turnId?: string }): void {
  if (process.env.USE_DB !== 'true' || !process.env.DATABASE_URL) return
  const errorClass = classifyError(input.message)
  const signature = `${slug(input.service) || 'unknown'}:${errorClass}`
  const lastError = input.message.slice(0, 300)
  const title = `${input.service} — ${errorClass}`
  const now = new Date()
  prisma.routeIncident
    .upsert({
      where: { signature },
      create: {
        signature,
        service: input.service,
        errorClass,
        title,
        status: 'open',
        count: 1,
        exampleTurnId: input.turnId ?? null,
        lastError,
      },
      update: {
        count: { increment: 1 },
        lastSeenAt: now,
        lastError,
      },
    })
    // Status isn't touched in the upsert; a cheap follow-up reopens a
    // resolved/wontfix incident that's failing again (Prisma can't branch on
    // the existing row inside an upsert).
    .then((inc) =>
      inc.status === 'resolved' || inc.status === 'wontfix'
        ? prisma.routeIncident.update({ where: { id: inc.id }, data: { status: 'open', resolvedAt: null } })
        : null,
    )
    .catch(() => {})
}

export interface IncidentRow {
  id: string
  signature: string
  service: string | null
  errorClass: string | null
  title: string
  status: string
  count: number
  exampleTurnId: string | null
  lastError: string | null
  prUrl: string | null
  firstSeenAt: string
  lastSeenAt: string
}

export async function listIncidents(): Promise<IncidentRow[]> {
  if (process.env.USE_DB !== 'true' || !process.env.DATABASE_URL) return []
  try {
    const rows = await prisma.routeIncident.findMany({ orderBy: [{ status: 'asc' }, { lastSeenAt: 'desc' }], take: 200 })
    return rows.map((r) => ({
      id: r.id,
      signature: r.signature,
      service: r.service,
      errorClass: r.errorClass,
      title: r.title,
      status: r.status,
      count: r.count,
      exampleTurnId: r.exampleTurnId,
      lastError: r.lastError,
      prUrl: r.prUrl,
      firstSeenAt: r.firstSeenAt.toISOString(),
      lastSeenAt: r.lastSeenAt.toISOString(),
    }))
  } catch {
    return []
  }
}

export async function getIncident(id: string): Promise<IncidentRow | null> {
  if (process.env.USE_DB !== 'true' || !process.env.DATABASE_URL) return null
  try {
    const r = await prisma.routeIncident.findUnique({ where: { id } })
    if (!r) return null
    return {
      id: r.id,
      signature: r.signature,
      service: r.service,
      errorClass: r.errorClass,
      title: r.title,
      status: r.status,
      count: r.count,
      exampleTurnId: r.exampleTurnId,
      lastError: r.lastError,
      prUrl: r.prUrl,
      firstSeenAt: r.firstSeenAt.toISOString(),
      lastSeenAt: r.lastSeenAt.toISOString(),
    }
  } catch {
    return null
  }
}
