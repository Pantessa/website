// ─────────────────────────────────────────────────────────────────────────
//  THE POLICY POOL — the ledger (LEDGER lane, squad policy-pool 2026-11-02)
//
//  One row per step an intent walks through the desk's policy pool
//  (prisma PolicyPoolEvent → policy_pool_events). Two writers:
//    · BUILDER, off-chain: guard_allowed / guard_refused / attested /
//      handed_off / signed / onchain_revert, via recordPolicyPoolEvent.
//    · the indexer cron (lib/policy-pool/indexer), on-chain: fill + mined,
//      from the hook's DeskFill logs.
//  One reader: /policy-pool + /api/policy-pool/events (list + stats).
//
//  recordPolicyPoolEvent NEVER throws: a ledger outage must never block a
//  build or a signature. It logs and returns.
// ─────────────────────────────────────────────────────────────────────────

import type { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { POLICY_POOL_EVENT_KINDS, type PolicyPoolEventKind } from '@/lib/policy-pool/spec'

export interface PolicyPoolEventInput {
  kind: PolicyPoolEventKind
  intentId?: string
  origin?: string
  swapper?: string
  chainId: number
  amountIn?: string
  amountOut?: string
  usd?: number
  txHash?: string
  blockNumber?: number
  reason?: string
  meta?: Record<string, unknown>
}

/** What the page and the API hand out. Dates as ISO strings. */
export interface PolicyPoolEventRow {
  id: string
  kind: PolicyPoolEventKind
  chainId: number
  intentId: string | null
  origin: string | null
  swapper: string | null
  amountIn: string | null
  amountOut: string | null
  usd: number | null
  txHash: string | null
  blockNumber: number | null
  logIndex: number | null
  reason: string | null
  meta: Record<string, unknown> | null
  createdAt: string
}

const KIND_SET = new Set<string>(POLICY_POOL_EVENT_KINDS)
export const isPolicyPoolEventKind = (k: unknown): k is PolicyPoolEventKind => typeof k === 'string' && KIND_SET.has(k)

/** Kinds that count as a refusal (the chart's red series). */
export const REFUSAL_KINDS: PolicyPoolEventKind[] = ['guard_refused', 'onchain_revert']

const clip = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null
  const s = v.trim()
  return s ? s.slice(0, max) : null
}
const finiteOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const intOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= 2 ** 31 - 1 ? v : null)
const atomsOrNull = (v: unknown): string | null => {
  const s = clip(v, 80)
  return s && /^-?\d+$/.test(s) ? s : null
}

/** The row a valid input becomes, or why it doesn't (pure; the harness can pin it). */
export function normalizePolicyPoolEvent(
  e: unknown,
): { ok: true; data: Prisma.PolicyPoolEventCreateInput } | { ok: false; error: string } {
  if (!e || typeof e !== 'object') return { ok: false, error: 'not an object' }
  const r = e as Record<string, unknown>
  if (!isPolicyPoolEventKind(r.kind)) return { ok: false, error: `unknown kind ${String(r.kind)}` }
  const chainId = intOrNull(r.chainId)
  if (chainId === null || chainId === 0) return { ok: false, error: 'chainId must be a positive integer' }
  const txHash = clip(r.txHash, 80)
  if (txHash && !/^0x[0-9a-fA-F]{64}$/.test(txHash)) return { ok: false, error: 'txHash must be a 32-byte hex' }
  let meta: Prisma.InputJsonValue | undefined
  if (r.meta !== undefined && r.meta !== null) {
    if (typeof r.meta !== 'object' || Array.isArray(r.meta)) return { ok: false, error: 'meta must be an object' }
    try {
      const json = JSON.stringify(r.meta)
      if (json.length > 8_000) return { ok: false, error: 'meta over 8KB' }
      meta = JSON.parse(json) as Prisma.InputJsonValue
    } catch {
      return { ok: false, error: 'meta is not JSON' }
    }
  }
  return {
    ok: true,
    data: {
      kind: r.kind,
      chainId,
      intentId: clip(r.intentId, 200),
      origin: clip(r.origin, 200),
      swapper: clip(r.swapper, 64)?.toLowerCase() ?? null,
      amountIn: atomsOrNull(r.amountIn),
      amountOut: atomsOrNull(r.amountOut),
      usd: finiteOrNull(r.usd),
      txHash: txHash?.toLowerCase() ?? null,
      blockNumber: intOrNull(r.blockNumber),
      reason: clip(r.reason, 500),
      ...(meta !== undefined ? { meta } : {}),
    },
  }
}

/** Write one ledger row. Never throws — logs and returns on any failure. */
export async function recordPolicyPoolEvent(e: PolicyPoolEventInput): Promise<void> {
  try {
    const n = normalizePolicyPoolEvent(e)
    if (!n.ok) {
      console.warn(`[policy-pool ledger] refused row: ${n.error}`)
      return
    }
    await prisma.policyPoolEvent.create({ data: n.data })
    statsCache = null
  } catch (err) {
    console.warn(`[policy-pool ledger] write failed: ${(err as Error)?.message ?? err}`)
  }
}

type DbRow = Awaited<ReturnType<typeof prisma.policyPoolEvent.findMany>>[number]
export function toRow(r: DbRow): PolicyPoolEventRow {
  return {
    id: r.id,
    kind: r.kind as PolicyPoolEventKind,
    chainId: r.chainId,
    intentId: r.intentId,
    origin: r.origin,
    swapper: r.swapper,
    amountIn: r.amountIn,
    amountOut: r.amountOut,
    usd: r.usd,
    txHash: r.txHash,
    blockNumber: r.blockNumber,
    logIndex: r.logIndex,
    reason: r.reason,
    meta: (r.meta && typeof r.meta === 'object' && !Array.isArray(r.meta) ? r.meta : null) as Record<string, unknown> | null,
    createdAt: r.createdAt.toISOString(),
  }
}

/** Newest first. `cursor` = the last row id of the previous page. With
 *  `intentId`, every row of that intent, OLDEST first (the timeline). */
export async function listPolicyPoolEvents({
  limit = 50,
  cursor,
  intentId,
}: { limit?: number; cursor?: string; intentId?: string } = {}): Promise<{ events: PolicyPoolEventRow[]; nextCursor: string | null }> {
  const take = Math.min(Math.max(Math.floor(limit) || 50, 1), 200)
  if (intentId) {
    const rows = await prisma.policyPoolEvent.findMany({
      where: { intentId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 200,
    })
    return { events: rows.map(toRow).sort(walkOrder), nextCursor: null }
  }
  const rows = await prisma.policyPoolEvent.findMany({
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: take + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  })
  const more = rows.length > take
  const page = more ? rows.slice(0, take) : rows
  return { events: page.map(toRow).sort((x, y) => walkOrder(y, x)), nextCursor: more ? page[page.length - 1].id : null }
}

const KIND_RANK = new Map<string, number>(POLICY_POOL_EVENT_KINDS.map((k, i) => [k, i]))
/** Oldest first; rows stamped the same instant (an indexed `mined` + `fill`
 *  share their block's timestamp) fall in the order an intent walks them. */
export function walkOrder(a: Pick<PolicyPoolEventRow, 'createdAt' | 'kind'>, b: Pick<PolicyPoolEventRow, 'createdAt' | 'kind'>): number {
  const t = Date.parse(a.createdAt) - Date.parse(b.createdAt)
  return t !== 0 ? t : (KIND_RANK.get(a.kind) ?? 99) - (KIND_RANK.get(b.kind) ?? 99)
}

// ── Stats ────────────────────────────────────────────────────────────────

export interface PolicyPoolBucket {
  /** Bucket start, ISO. */
  t: string
  fills: number
  refusals: number
  volumeUsd: number
}

/** The intent walk, in order: how many distinct intents reached each step. */
export const FUNNEL_STEPS: { key: string; label: string; kinds: PolicyPoolEventKind[] }[] = [
  { key: 'guard', label: 'Guard', kinds: ['guard_allowed', 'guard_refused'] },
  { key: 'attested', label: 'Attested', kinds: ['attested'] },
  { key: 'handed_off', label: 'Handed off', kinds: ['handed_off'] },
  { key: 'signed', label: 'Signed', kinds: ['signed'] },
  { key: 'mined', label: 'Mined', kinds: ['mined'] },
  { key: 'fill', label: 'Fill', kinds: ['fill'] },
  { key: 'dune_seen', label: 'Seen in Dune', kinds: ['dune_seen'] },
]

export interface PolicyPoolStats {
  counts: Record<PolicyPoolEventKind, number>
  total: number
  fills: number
  refusedGuard: number
  refusedOnchain: number
  volumeUsd: number
  lastFillAt: string | null
  distinctIntents: number
  hourly: PolicyPoolBucket[]
  daily: PolicyPoolBucket[]
  funnel: { key: string; label: string; count: number }[]
  generatedAt: string
}

const HOUR = 3_600_000
const DAY = 86_400_000

/** Empty, gap-free buckets ending at the current one (pure). */
export function emptyBuckets(now: number, stepMs: number, n: number): PolicyPoolBucket[] {
  const last = Math.floor(now / stepMs) * stepMs
  return Array.from({ length: n }, (_, i) => ({ t: new Date(last - (n - 1 - i) * stepMs).toISOString(), fills: 0, refusals: 0, volumeUsd: 0 }))
}

/** Drop rows into buckets (pure): fills + their USD, refusals = guard + on-chain. */
export function fillBuckets(
  buckets: PolicyPoolBucket[],
  stepMs: number,
  rows: { kind: string; usd: number | null; createdAt: Date | string }[],
): PolicyPoolBucket[] {
  const at = new Map(buckets.map((b, i) => [Date.parse(b.t), i]))
  for (const r of rows) {
    const t = typeof r.createdAt === 'string' ? Date.parse(r.createdAt) : r.createdAt.getTime()
    const i = at.get(Math.floor(t / stepMs) * stepMs)
    if (i === undefined) continue
    const b = buckets[i]
    if (r.kind === 'fill') {
      b.fills += 1
      if (typeof r.usd === 'number' && Number.isFinite(r.usd)) b.volumeUsd += r.usd
    } else if ((REFUSAL_KINDS as string[]).includes(r.kind)) b.refusals += 1
  }
  for (const b of buckets) b.volumeUsd = Math.round(b.volumeUsd * 100) / 100
  return buckets
}

const STATS_TTL_MS = 10_000
let statsCache: { at: number; value: Promise<PolicyPoolStats> } | null = null

/** The page's numbers, cached ten seconds in-process (the page polls). */
export function policyPoolStats(): Promise<PolicyPoolStats> {
  const now = Date.now()
  if (statsCache && now - statsCache.at < STATS_TTL_MS) return statsCache.value
  const value = readStats(now).catch((err) => {
    statsCache = null
    throw err
  })
  statsCache = { at: now, value }
  return value
}

async function readStats(now: number): Promise<PolicyPoolStats> {
  const since = new Date(Math.floor(now / DAY) * DAY - 13 * DAY)
  const [byKind, fillAgg, intents, recent, funnelRows] = await Promise.all([
    prisma.policyPoolEvent.groupBy({ by: ['kind'], _count: { _all: true } }),
    prisma.policyPoolEvent.aggregate({ where: { kind: 'fill' }, _sum: { usd: true }, _max: { createdAt: true } }),
    prisma.policyPoolEvent.findMany({ where: { intentId: { not: null } }, distinct: ['intentId'], select: { intentId: true } }),
    prisma.policyPoolEvent.findMany({
      where: { createdAt: { gte: since }, kind: { in: ['fill', ...REFUSAL_KINDS] } },
      select: { kind: true, usd: true, createdAt: true },
    }),
    prisma.policyPoolEvent.groupBy({ by: ['kind', 'intentId'], where: { intentId: { not: null } } }),
  ])
  const counts = Object.fromEntries(POLICY_POOL_EVENT_KINDS.map((k) => [k, 0])) as Record<PolicyPoolEventKind, number>
  let total = 0
  for (const g of byKind) {
    if (isPolicyPoolEventKind(g.kind)) counts[g.kind] = g._count._all
    total += g._count._all
  }
  const intentsByKind = new Map<string, Set<string>>()
  for (const r of funnelRows) {
    if (!r.intentId) continue
    let s = intentsByKind.get(r.kind)
    if (!s) intentsByKind.set(r.kind, (s = new Set()))
    s.add(r.intentId)
  }
  const funnel = FUNNEL_STEPS.map((step) => {
    const u = new Set<string>()
    for (const k of step.kinds) for (const id of intentsByKind.get(k) ?? []) u.add(id)
    return { key: step.key, label: step.label, count: u.size }
  })
  return {
    counts,
    total,
    fills: counts.fill,
    refusedGuard: counts.guard_refused,
    refusedOnchain: counts.onchain_revert,
    volumeUsd: Math.round((fillAgg._sum.usd ?? 0) * 100) / 100,
    lastFillAt: fillAgg._max.createdAt?.toISOString() ?? null,
    distinctIntents: intents.length,
    hourly: fillBuckets(emptyBuckets(now, HOUR, 24), HOUR, recent),
    daily: fillBuckets(emptyBuckets(now, DAY, 14), DAY, recent),
    funnel,
    generatedAt: new Date(now).toISOString(),
  }
}

/** Empty stats — what the page renders when the DB can't be read. */
export function emptyPolicyPoolStats(now = Date.now()): PolicyPoolStats {
  return {
    counts: Object.fromEntries(POLICY_POOL_EVENT_KINDS.map((k) => [k, 0])) as Record<PolicyPoolEventKind, number>,
    total: 0,
    fills: 0,
    refusedGuard: 0,
    refusedOnchain: 0,
    volumeUsd: 0,
    lastFillAt: null,
    distinctIntents: 0,
    hourly: emptyBuckets(now, HOUR, 24),
    daily: emptyBuckets(now, DAY, 14),
    funnel: FUNNEL_STEPS.map((s) => ({ key: s.key, label: s.label, count: 0 })),
    generatedAt: new Date(now).toISOString(),
  }
}
