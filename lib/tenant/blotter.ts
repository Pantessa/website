// lib/tenant/blotter.ts — THE HASH-CHAINED BLOTTER (BLOTTER lane, five-million, 2026-11-03).
//
// Every state transition on a tenant desk is one row: per-tenant monotonic `seq`,
// `prevHash` = the previous row's hash (BLOTTER_GENESIS first), `hash` =
// blotterHash({ prevHash, seq, kind, createdAtIso, payload }) from lib/tenant/spec —
// the chain a firm (or its auditor) can replay from the export alone.
//
// Three rules this file keeps:
//   1. `recordBlotter` NEVER throws. A ledger outage must never block a build;
//      it logs (console.error) and drops.
//   2. `seq` is monotonic under concurrency. Each write is one interactive
//      transaction that takes a per-tenant ADVISORY lock
//      (`pg_advisory_xact_lock(hashtextextended('blotter:<tenant>', 0))`),
//      reads the last row, seals the next one and inserts it. `SELECT … FOR UPDATE`
//      on the last row was the other option the contract named; it locks nothing
//      when a tenant has no rows yet, so two first writes would race to seq 1. The
//      lock covers that case too. A unique violation on (tenant_id, seq) (which the
//      lock makes unreachable) or a lost transaction is retried with jitter.
//   3. The hash covers the COLUMNS too. The spec hashes `payload`; a column
//      (`value_usd`, `tx_hash`, `verification`, …) outside it could be edited
//      without breaking the chain. So the stored payload IS the hashed payload and
//      carries the typed columns under `ledger`; `verify` recomputes the hash AND
//      checks every column against its `ledger` twin. `created_at` is generated
//      here (never by the DB default) and is the exact instant hashed.
//
// The rows TENANT writes (intent, policy_verdict, offered, refused, approval,
// policy_*, key_*) arrive through `recordBlotter`; the rows BLOTTER writes (build,
// signed, settled, statement) arrive through `recordBlotterOnce`, which dedupes
// on a key kept in the payload (`once`) inside the same lock — a retried
// completion, a re-run sweep or a second statement call never writes twice.

import prisma from '@/lib/db'
import { Prisma } from '@prisma/client'
import {
  BLOTTER_GENESIS,
  BLOTTER_KINDS,
  blotterHash,
  canonicalJson,
  type BlotterEvent,
  type BlotterKind,
  type BlotterVerification,
  type TenantVenue,
} from '@/lib/tenant/spec'
import { FEE_BEARING_BUILD_PATHS, netFeeBpsForTurn } from '@/lib/fees'

// ── Constants ───────────────────────────────────────────────────────────────

/** The payload key that carries the typed columns (hashed with the payload). */
export const LEDGER_KEY = 'ledger'
/** The payload key `recordBlotterOnce` dedupes on. */
export const ONCE_KEY = 'once'
/** The columns mirrored into `payload.ledger` — order is the CSV's. */
export const LEDGER_FIELDS = ['intentId', 'jobId', 'deskId', 'keyId', 'venue', 'chainId', 'valueUsd', 'feeUsd', 'feeBps', 'txHash', 'verification'] as const
export type LedgerField = (typeof LEDGER_FIELDS)[number]
const NUMERIC_FIELDS = new Set<LedgerField>(['chainId', 'valueUsd', 'feeUsd', 'feeBps'])
export const BLOTTER_VERIFICATIONS: readonly BlotterVerification[] = ['verified', 'attested', 'unverified', 'mismatch']
/** A string column longer than this is cut (a hash is 66, an id ≤ 40). */
const COLUMN_MAX = 200
/** Rows per page on the JSON read; the CSV export reads up to the export cap. */
export const BLOTTER_PAGE_MAX = 1000
export const BLOTTER_EXPORT_MAX = 10_000
const WRITE_ATTEMPTS = 4

// ── Pure: sealing a row ─────────────────────────────────────────────────────

/** JSON-safe, jsonb-safe copy of a payload: what Postgres will hand back is
 *  exactly what was hashed. Dates → ISO (toJSON), bigint → string, NaN/±Inf →
 *  null, `undefined` keys dropped, NUL characters stripped (jsonb refuses them),
 *  a non-object payload wrapped as `{ value }`. */
export function normalizePayload(v: unknown): Record<string, unknown> {
  let text: string | undefined
  try {
    text = JSON.stringify(v ?? {}, (_k, x) => (typeof x === 'bigint' ? x.toString() : typeof x === 'string' ? x.replace(/\u0000/g, '') : x))
  } catch {
    text = JSON.stringify({ unserializable: true })
  }
  const parsed: unknown = text === undefined ? {} : JSON.parse(text)
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : { value: parsed }
}

export type LedgerColumns = { [K in LedgerField]: K extends 'chainId' | 'valueUsd' | 'feeUsd' | 'feeBps' ? number | null : string | null }

const strCol = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().slice(0, COLUMN_MAX) : null)
const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const intCol = (v: unknown, lo: number, hi: number): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : null)

/** The typed columns of an event, clamped to what the table can hold. */
export function ledgerColumns(e: Partial<BlotterEvent>): LedgerColumns {
  return {
    intentId: strCol(e.intentId),
    jobId: strCol(e.jobId),
    deskId: strCol(e.deskId),
    keyId: strCol(e.keyId),
    venue: strCol(e.venue),
    chainId: intCol(e.chainId, 1, 2_147_483_647),
    valueUsd: finite(e.valueUsd),
    feeUsd: finite(e.feeUsd),
    feeBps: intCol(e.feeBps, 0, 10_000),
    txHash: strCol(e.txHash),
    verification: typeof e.verification === 'string' && (BLOTTER_VERIFICATIONS as readonly string[]).includes(e.verification) ? e.verification : null,
  }
}

/** The non-null columns, as folded into the payload. */
function ledgerOf(cols: LedgerColumns): Record<string, string | number> {
  const out: Record<string, string | number> = {}
  for (const f of LEDGER_FIELDS) if (cols[f] !== null) out[f] = cols[f] as string | number
  return out
}

export interface SealedRow {
  seq: number
  prevHash: string
  hash: string
  kind: BlotterKind
  createdAt: Date
  createdAtIso: string
  payload: Record<string, unknown>
  columns: LedgerColumns
}

/** Seal the row that follows `prev` (null = the tenant's first row). Pure. */
export function sealRow(prev: { seq: number; hash: string } | null, e: BlotterEvent, createdAt: Date, once?: string): SealedRow {
  const cols = ledgerColumns(e)
  const base = normalizePayload(e.payload)
  // The two reserved keys are ours; a caller's own value under either is kept, renamed.
  const { [LEDGER_KEY]: callerLedger, [ONCE_KEY]: callerOnce, ...rest } = base
  const payload: Record<string, unknown> = { ...rest }
  if (callerLedger !== undefined) payload.callerLedger = callerLedger
  if (callerOnce !== undefined) payload.callerOnce = callerOnce
  payload[LEDGER_KEY] = ledgerOf(cols)
  if (once) payload[ONCE_KEY] = once
  const seq = prev ? prev.seq + 1 : 1
  const prevHash = prev ? prev.hash : BLOTTER_GENESIS
  const createdAtIso = createdAt.toISOString()
  return { seq, prevHash, hash: blotterHash({ prevHash, seq, kind: e.kind, createdAtIso, payload }), kind: e.kind, createdAt, createdAtIso, payload, columns: cols }
}

// ── Pure: replaying a chain ─────────────────────────────────────────────────

/** A stored row as the table (or an export) hands it back. */
export interface StoredBlotterRow {
  seq: number
  prevHash: string
  hash: string
  kind: string
  createdAt: Date | string
  payload: unknown
  intentId?: string | null
  jobId?: string | null
  deskId?: string | null
  keyId?: string | null
  venue?: string | null
  chainId?: number | null
  valueUsd?: number | null
  feeUsd?: number | null
  feeBps?: number | null
  txHash?: string | null
  verification?: string | null
}

export interface ChainVerdict {
  ok: boolean
  /** Rows replayed (on a break: rows up to and including the broken one). */
  rows: number
  /** The first seq that does not replay. */
  brokenAt?: number
  reason?: string
  /** The last good row — the number an auditor pins. */
  head?: { seq: number; hash: string } | null
}

function sameCol(field: LedgerField, col: unknown, led: unknown): boolean {
  const c = col === undefined ? null : col
  const l = led === undefined ? null : led
  if (c === null || l === null) return c === null && l === null
  if (NUMERIC_FIELDS.has(field)) return typeof c === 'number' && typeof l === 'number' && c === l
  return String(c) === String(l)
}

/**
 * Replay rows (ascending seq) from `start` (the row before the first one given;
 * null = genesis). Checks, per row: the seq is the next one; `prevHash` is the
 * previous row's hash; the hash recomputes from the stored fields; every typed
 * column equals its `payload.ledger` twin. Pure; incremental through `start`.
 */
export function replayChain(rows: StoredBlotterRow[], start: { seq: number; hash: string } | null = null): ChainVerdict {
  let prev = start
  let n = 0
  for (const r of rows) {
    n++
    const want = prev ? prev.seq + 1 : 1
    const head = prev
    const broken = (reason: string, at = r.seq): ChainVerdict => ({ ok: false, rows: n, brokenAt: at, reason, head })
    if (r.seq !== want) return broken(r.seq > want ? `seq ${want} is missing (the next row is ${r.seq})` : `seq ${r.seq} repeats or runs backwards`, want)
    if (r.prevHash !== (prev ? prev.hash : BLOTTER_GENESIS)) return broken('prev_hash does not name the previous row')
    let iso: string
    try {
      iso = new Date(r.createdAt).toISOString()
    } catch {
      return broken('created_at is not a time')
    }
    const recomputed = blotterHash({ prevHash: r.prevHash, seq: r.seq, kind: r.kind, createdAtIso: iso, payload: r.payload })
    if (recomputed !== r.hash) return broken('the hash does not recompute from the row (payload, kind or time changed)')
    const led = ((r.payload as Record<string, unknown> | null)?.[LEDGER_KEY] ?? {}) as Record<string, unknown>
    for (const f of LEDGER_FIELDS) {
      if (!sameCol(f, (r as unknown as Record<string, unknown>)[f], led[f])) return broken(`column ${f} does not match the hashed ledger`)
    }
    prev = { seq: r.seq, hash: r.hash }
  }
  return { ok: true, rows: n, head: prev }
}

// ── Pure: the export ────────────────────────────────────────────────────────

export const BLOTTER_CSV_COLUMNS = [
  'seq',
  'created_at',
  'kind',
  'intent_id',
  'job_id',
  'desk_id',
  'key_id',
  'venue',
  'chain_id',
  'value_usd',
  'fee_usd',
  'fee_bps',
  'tx_hash',
  'verification',
  'prev_hash',
  'hash',
  'payload',
] as const

/** RFC 4180 cell: quoted when it carries a comma, quote or line break; a text
 *  cell a spreadsheet would run as a formula (= + - @, tab, CR) gets a leading
 *  apostrophe. Numbers and the payload (always `{…}`) are never touched, so the
 *  payload cell replays as exported. */
export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  let s = String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** The CSV an auditor replays: header + one line per row, CRLF, the payload as
 *  canonical JSON (the exact bytes the hash covers). Pure. */
export function blotterCsv(rows: StoredBlotterRow[]): string {
  const lines = [BLOTTER_CSV_COLUMNS.join(',')]
  for (const r of rows) {
    lines.push(
      [
        r.seq,
        new Date(r.createdAt).toISOString(),
        r.kind,
        r.intentId,
        r.jobId,
        r.deskId,
        r.keyId,
        r.venue,
        r.chainId,
        r.valueUsd,
        r.feeUsd,
        r.feeBps,
        r.txHash,
        r.verification,
        r.prevHash,
        r.hash,
        canonicalJson(r.payload),
      ]
        .map(csvCell)
        .join(','),
    )
  }
  return lines.join('\r\n') + '\r\n'
}

/** The JSON shape a row is served in (dates as ISO). */
export function rowJson(r: StoredBlotterRow & { id?: string }) {
  return {
    seq: r.seq,
    createdAt: new Date(r.createdAt).toISOString(),
    kind: r.kind,
    intentId: r.intentId ?? null,
    jobId: r.jobId ?? null,
    deskId: r.deskId ?? null,
    keyId: r.keyId ?? null,
    venue: r.venue ?? null,
    chainId: r.chainId ?? null,
    valueUsd: r.valueUsd ?? null,
    feeUsd: r.feeUsd ?? null,
    feeBps: r.feeBps ?? null,
    txHash: r.txHash ?? null,
    verification: r.verification ?? null,
    prevHash: r.prevHash,
    hash: r.hash,
    payload: r.payload,
  }
}

// ── Pure: reading a query ───────────────────────────────────────────────────

export interface BlotterQuery {
  from: Date | null
  /** Exclusive. A date-only `to` covers that whole UTC day. */
  to: Date | null
  kinds: BlotterKind[] | null
  afterSeq: number
  limit: number
  format: 'json' | 'csv'
}

function parseWhen(raw: string, endOfDay: boolean): Date | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(`${raw}T00:00:00.000Z`)
    if (Number.isNaN(d.getTime())) return null
    return endOfDay ? new Date(d.getTime() + 86_400_000) : d
  }
  if (/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|[+-]\d{2}:?\d{2})$/.test(raw)) {
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

/** `?from&to&kind&format&limit&after` → a query, or the refusal in words. Pure. */
export function parseBlotterQuery(sp: URLSearchParams): { ok: true; query: BlotterQuery } | { ok: false; error: string } {
  const format = (sp.get('format') ?? 'json').toLowerCase()
  if (format !== 'json' && format !== 'csv') return { ok: false, error: 'format must be json or csv' }
  const fromRaw = sp.get('from')
  const toRaw = sp.get('to')
  const from = fromRaw ? parseWhen(fromRaw, false) : null
  if (fromRaw && !from) return { ok: false, error: 'from must be YYYY-MM-DD or an ISO time with a zone' }
  const to = toRaw ? parseWhen(toRaw, true) : null
  if (toRaw && !to) return { ok: false, error: 'to must be YYYY-MM-DD or an ISO time with a zone' }
  if (from && to && from >= to) return { ok: false, error: 'from must be before to' }
  let kinds: BlotterKind[] | null = null
  const kindRaw = sp.get('kind')
  if (kindRaw) {
    const asked = [...new Set(kindRaw.split(',').map((k) => k.trim()).filter(Boolean))]
    const unknown = asked.filter((k) => !(BLOTTER_KINDS as readonly string[]).includes(k))
    if (unknown.length) return { ok: false, error: `unknown kind: ${unknown.slice(0, 3).join(', ')} (kinds: ${BLOTTER_KINDS.join(', ')})` }
    kinds = asked as BlotterKind[]
  }
  const cap = format === 'csv' ? BLOTTER_EXPORT_MAX : BLOTTER_PAGE_MAX
  const limitRaw = sp.get('limit')
  const limit = limitRaw === null ? (format === 'csv' ? BLOTTER_EXPORT_MAX : 200) : Number(limitRaw)
  if (!Number.isInteger(limit) || limit < 1 || limit > cap) return { ok: false, error: `limit must be an integer from 1 to ${cap}` }
  const afterRaw = sp.get('after')
  const afterSeq = afterRaw === null ? 0 : Number(afterRaw)
  if (!Number.isInteger(afterSeq) || afterSeq < 0) return { ok: false, error: 'after must be a non-negative seq' }
  return { ok: true, query: { from, to, kinds, afterSeq, limit, format } }
}

// ── Pure: the vocabulary bridges ────────────────────────────────────────────

/** build_path → the policy's venue id (lib/tenant/spec TENANT_VENUES). */
const VENUE_OF_BUILD_PATH: Record<string, TenantVenue> = {
  'native-aave-supply': 'aave-v4',
  'native-aave-op': 'aave-v4',
  'native-morpho-lend': 'morpho',
  'native-morpho-op': 'morpho',
  'native-swap-uniswap': 'uniswap-v3',
  'native-swap-uniswap-v4': 'uniswap-v4',
  'native-swap-lifi': 'lifi',
  'native-fund-bridge': 'lifi',
  'native-swap-cow': 'cow',
  'native-cross-chain': 'near-intents',
  'native-cross-chain-leg': 'near-intents',
  'native-transfer': 'transfer',
  'native-nft-transfer': 'opensea',
  'native-nft-list': 'opensea',
  'native-nft-buy': 'opensea',
  'native-lido': 'lido',
  'native-hl-guardian': 'hyperliquid',
  'native-hl-exec': 'hyperliquid',
  'native-hl-deposit': 'hyperliquid',
  'native-swap-policy-pool': 'policy-pool',
}
export function tenantVenueOfBuildPath(path: string | null | undefined): TenantVenue | null {
  return (path && VENUE_OF_BUILD_PATH[path]) || null
}

/** The net bps Pantessa keeps on a leg (what rides the calldata), 0 on a fee-free path. */
export function legFeeBps(buildPath: string | null | undefined, stampedBps: number | null | undefined): number {
  if (!buildPath || !FEE_BEARING_BUILD_PATHS.has(buildPath)) return 0
  return netFeeBpsForTurn(buildPath, stampedBps)
}
export function legFeeUsd(valueUsd: number | null | undefined, bps: number): number | null {
  if (typeof valueUsd !== 'number' || !Number.isFinite(valueUsd)) return null
  return Math.round(valueUsd * bps * 100) / 1_000_000 // valueUsd × bps / 10_000, kept to 1e-4 USD
}

/** Midnight UTC of `now`'s day. */
export function utcDayStart(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

// ── I/O: the writer ─────────────────────────────────────────────────────────

export interface BlotterWrite {
  written: boolean
  seq: number
  hash?: string
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
function retriable(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code
  // P2002 unique (tenant_id, seq) · P2034 write conflict · P2028 transaction API (timeout / closed)
  return code === 'P2002' || code === 'P2034' || code === 'P2028' || /deadlock|could not serialize|Transaction already closed|expired/i.test(String((err as Error)?.message ?? ''))
}

async function writeRow(e: BlotterEvent, once?: string): Promise<BlotterWrite | null> {
  const tenantId = typeof e?.tenantId === 'string' ? e.tenantId.trim() : ''
  if (!tenantId) {
    console.error('[blotter] dropped a row with no tenantId', e?.kind)
    return null
  }
  if (!(BLOTTER_KINDS as readonly string[]).includes(e.kind)) {
    console.error('[blotter] dropped a row of unknown kind', tenantId, e.kind)
    return null
  }
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`blotter:${tenantId}`}, 0))`
          if (once) {
            const dup = await tx.$queryRaw<{ seq: number; hash: string }[]>`SELECT seq, hash FROM blotter_rows WHERE tenant_id = ${tenantId} AND kind = ${e.kind} AND payload->>'once' = ${once} ORDER BY seq ASC LIMIT 1`
            if (dup.length) return { written: false, seq: Number(dup[0].seq), hash: dup[0].hash }
          }
          const last = await tx.blotterRow.findFirst({ where: { tenantId }, orderBy: { seq: 'desc' }, select: { seq: true, hash: true, createdAt: true } })
          // Time runs with seq: a lambda whose clock is behind the last writer's
          // never stamps a row earlier than the row it follows.
          const createdAt = new Date(Math.max(Date.now(), last ? last.createdAt.getTime() : 0))
          const sealed = sealRow(last, { ...e, tenantId }, createdAt, once)
          await tx.blotterRow.create({
            data: {
              tenantId,
              seq: sealed.seq,
              prevHash: sealed.prevHash,
              hash: sealed.hash,
              kind: sealed.kind,
              ...sealed.columns,
              payload: sealed.payload as Prisma.InputJsonValue,
              createdAt: sealed.createdAt,
            },
          })
          return { written: true, seq: sealed.seq, hash: sealed.hash }
        },
        { maxWait: 10_000, timeout: 20_000 },
      )
    } catch (err) {
      if (attempt < WRITE_ATTEMPTS && retriable(err)) {
        await sleep(25 * attempt + Math.floor(Math.random() * 50))
        continue
      }
      throw err
    }
  }
}

/** Append one row to the tenant's chain. NEVER throws (contract): a failure is
 *  logged and the row is dropped. */
export async function recordBlotter(e: BlotterEvent): Promise<void> {
  try {
    await writeRow(e)
  } catch (err) {
    console.error('[blotter] dropped', e?.tenantId, e?.kind, (err as Error)?.message ?? err)
  }
}

/** Append one row unless a row of the same kind already carries `once` in this
 *  tenant's chain (checked inside the per-tenant lock). Never throws; null =
 *  the write failed and was logged. */
export async function recordBlotterOnce(once: string, e: BlotterEvent): Promise<BlotterWrite | null> {
  try {
    return await writeRow(e, once.slice(0, 200))
  } catch (err) {
    console.error('[blotter] dropped', e?.tenantId, e?.kind, once, (err as Error)?.message ?? err)
    return null
  }
}

// ── I/O: the readers ────────────────────────────────────────────────────────

/** The desk's signed notional so far today (UTC), from the blotter's `signed`
 *  rows. THROWS when the blotter cannot be read: a day cap must never read $0
 *  by accident — the gate's caller refuses on the error. */
export async function spentTodayUsd(tenantId: string, deskId: string, now = new Date()): Promise<number> {
  const agg = await prisma.blotterRow.aggregate({
    where: { tenantId, deskId, kind: 'signed', createdAt: { gte: utcDayStart(now) } },
    _sum: { valueUsd: true },
  })
  return agg._sum.valueUsd ?? 0
}

const ROW_SELECT = {
  seq: true,
  prevHash: true,
  hash: true,
  kind: true,
  createdAt: true,
  payload: true,
  intentId: true,
  jobId: true,
  deskId: true,
  keyId: true,
  venue: true,
  chainId: true,
  valueUsd: true,
  feeUsd: true,
  feeBps: true,
  txHash: true,
  verification: true,
} as const

/** One page of a tenant's rows, ascending seq. */
export async function readBlotterRows(tenantId: string, q: Pick<BlotterQuery, 'from' | 'to' | 'kinds' | 'afterSeq' | 'limit'>): Promise<StoredBlotterRow[]> {
  return prisma.blotterRow.findMany({
    where: {
      tenantId,
      ...(q.afterSeq > 0 ? { seq: { gt: q.afterSeq } } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) } } : {}),
      ...(q.kinds ? { kind: { in: q.kinds } } : {}),
    },
    orderBy: { seq: 'asc' },
    take: q.limit,
    select: ROW_SELECT,
  })
}

/** The chain's head (null = no rows yet). */
export async function blotterHead(tenantId: string): Promise<{ seq: number; hash: string } | null> {
  return prisma.blotterRow.findFirst({ where: { tenantId }, orderBy: { seq: 'desc' }, select: { seq: true, hash: true } })
}

/** Replay a tenant's whole chain from seq 1, a thousand rows at a time. */
export async function verifyChain(tenantId: string): Promise<ChainVerdict> {
  let start: { seq: number; hash: string } | null = null
  let total = 0
  for (;;) {
    const page: StoredBlotterRow[] = await prisma.blotterRow.findMany({
      where: { tenantId, ...(start ? { seq: { gt: start.seq } } : {}) },
      orderBy: { seq: 'asc' },
      take: 1000,
      select: ROW_SELECT,
    })
    if (!page.length) return { ok: true, rows: total, head: start }
    const v = replayChain(page, start)
    if (!v.ok) return { ...v, rows: total + v.rows }
    total += v.rows
    start = v.head ?? start
    if (page.length < 1000) return { ok: true, rows: total, head: start }
  }
}

// ── I/O: the tenant behind a route ──────────────────────────────────────────

export interface TenantRow {
  id: string
  slug: string
  name: string
  ownerAddress: string
  admins: unknown
  plan: string
  feeBps: number | null
  status: string
  sandbox: boolean
  isInternal: boolean
  createdAt: Date
  signers: unknown
}

/** Owner ∪ admins, lowercased. Pure. */
export function tenantAdminsOf(t: Pick<TenantRow, 'ownerAddress' | 'admins'>): string[] {
  const admins = Array.isArray(t.admins) ? t.admins.filter((a): a is string => typeof a === 'string') : []
  return [...new Set([t.ownerAddress, ...admins].map((a) => a.toLowerCase()))]
}

/** The tenant, when `address` is its owner or one of its admins; else null
 *  (a route answers 404 either way — a tenant id never confirms itself). */
export async function tenantForAdmin(tenantId: string, address: string | null): Promise<TenantRow | null> {
  if (!address || !tenantId || tenantId.length > 64) return null
  const t = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, slug: true, name: true, ownerAddress: true, admins: true, plan: true, feeBps: true, status: true, sandbox: true, isInternal: true, createdAt: true, signers: true },
  })
  if (!t) return null
  return tenantAdminsOf(t).includes(address.toLowerCase()) ? t : null
}

/** The desk id a desk key is bound to (null when unknown or unreadable). */
export async function deskIdOfKey(keyId: string | null | undefined): Promise<string | null> {
  if (!keyId) return null
  try {
    const k = await prisma.deskKey.findUnique({ where: { id: keyId }, select: { deskId: true } })
    return k?.deskId ?? null
  } catch {
    return null
  }
}

// ── The sign-site row (the embed telemetry route + the statement's sweep) ────

/**
 * A browser-signed turn through a TENANT's desk-minted link (/i/<slug> bound to a
 * broker intent with `tenant_id`): one `signed` row and its `settled` row, written
 * only once the receipt is VERIFIED (lib/link-receipt-verify: the tx came from the
 * signer, hit the link's expected contract and selector, and the hash was not
 * reused). The telemetry beacon is public and self-reported, so nothing short of
 * a verified receipt may enter a tenant's chain from it — a forged beacon writes
 * nothing. `value_usd` is the beacon's (the verifier does not price the tx);
 * the payload says so. Never throws.
 */
export async function recordTenantTurn(t: {
  tenantId: string
  deskKeyId: string | null
  intentId: string | null
  turnId: string
  wallet: string | null
  valueUsd: number | null
  buildPath: string | null
  stampedFeeBps: number | null
  chainId: number | null
  txHash: string | null
  artifact: string | null
  signers?: unknown
}): Promise<void> {
  try {
    const deskId = await deskIdOfKey(t.deskKeyId)
    const bps = legFeeBps(t.buildPath, t.stampedFeeBps)
    const venue = tenantVenueOfBuildPath(t.buildPath) ?? t.buildPath
    const signers = Array.isArray(t.signers) ? t.signers.filter((s): s is string => typeof s === 'string').map((s) => s.toLowerCase()) : []
    const base = { tenantId: t.tenantId, intentId: t.intentId, deskId, keyId: t.deskKeyId, venue, chainId: t.chainId, txHash: t.txHash }
    const signed = await recordBlotterOnce(`turn:${t.turnId}:signed`, {
      ...base,
      kind: 'signed',
      valueUsd: t.valueUsd,
      feeUsd: legFeeUsd(t.valueUsd, bps),
      feeBps: bps,
      payload: {
        source: 'turn',
        turnId: t.turnId,
        artifact: t.artifact,
        buildPath: t.buildPath,
        wallet: t.wallet,
        // Custody check, for the auditor: was the signer one the tenant lists?
        signerListed: signers.length && t.wallet ? signers.includes(t.wallet.toLowerCase()) : null,
        valueSource: 'beacon',
      },
    })
    if (!signed) return
    await recordBlotterOnce(`turn:${t.turnId}:settled`, {
      ...base,
      kind: 'settled',
      verification: 'verified',
      payload: { source: 'turn', turnId: t.turnId, signedSeq: signed.seq, how: 'receipt: sender, target contract and selector matched the link (lib/link-receipt-verify)' },
    })
  } catch (err) {
    console.error('[blotter] tenant turn dropped', t.tenantId, t.turnId, (err as Error)?.message ?? err)
  }
}
