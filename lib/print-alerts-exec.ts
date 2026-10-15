// lib/print-alerts-exec.ts — the print-alert sweep behind /api/cron/prints
// (2026-10-13). Every minute: the active rules decide which Dune venues to
// read; each venue is leased (two passes never read one cursor at once),
// opened from its stored cursor (lib/dune-feed-pull) and consumed until the
// tip or the budget; the SAME lib/tape rules the browser runs judge the
// fills (lib/print-alerts evaluatePrintAlert); a firing is written through
// the price alerts' own notification path (lib/alerts-exec
// notifyAlertFired → the bell, the mail); the cursor is stored LAST — after
// the frames were evaluated, the runbook's "persist the checkpoint only
// after the message has been safely handled".
//
// A refused cursor (outside the venue's retained range, measured > 25h on
// 2026-10-13) is never papered over: the gap is written to feed_cursors
// (gap_from · gap_at · gap_note), reported in the response, and only THEN
// does the pass rejoin at the tip and say so. A 1008 (fell behind)
// reconnects once from the last durable cursor after a short backoff.
//
// Fixture fills (POST { fixture: { fills } }) are honored only on an
// authorized call that ALSO declares itself an internal run, and only
// against is_internal rules — a real owner's rule is only ever judged on
// the live feed, whatever the caller sends (the price cron's own rule).

import type { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { notifyAlertFired } from '@/lib/alerts-exec'
import { pullDuneFeed, type PullResult } from '@/lib/dune-feed-pull'
import { duneVenue, type DuneVenueId } from '@/lib/dune'
import { FEED_LEASE_MS, PRINT_CRON_BUDGET_MS, evaluatePrintAlert, gapNote, parseRecent, printNotification, type PullOutcome } from '@/lib/print-alerts'
import { printAlertToShape } from '@/lib/print-alerts-store'
import { canTradeAsk } from '@/lib/trade-venue-gate'
import type { TradabilityMap } from '@/lib/tradability'
import { readTradability } from '@/lib/tradability-store'
import type { TapeFill } from '@/lib/tape'

export interface PrintSweepOptions {
  /** Wall-clock budget for consuming the feeds (every venue in parallel). */
  budgetMs?: number
  /** Fills applied to INTERNAL rules only, in place of the live feed. */
  fixture?: TapeFill[]
  now?: Date
  /** Injection seams for tests; default to the live pull and the live venue gate. */
  pull?: typeof pullDuneFeed
  tradable?: TradabilityMap
  notify?: typeof notifyAlertFired
}

export interface VenuePass {
  venue: DuneVenueId
  leased: boolean
  cursorIn: string | null
  cursorOut: string | null
  resumed: boolean
  outcome: PullOutcome | 'leased-elsewhere'
  frames: number
  fills: number
  firstLagMs: number | null
  lastLagMs: number | null
  tipAt: string | null
  elapsedMs: number
  /** The venue refused the stored cursor: what was recorded before rejoining. */
  gap?: { from: string; note: string }
  /** The second pull's outcome after a refusal (at the tip) or a 1008. */
  retried?: PullOutcome
}

export interface PrintSweepSummary {
  at: string
  elapsedMs: number
  /** Active rules evaluated. */
  evaluated: number
  /** Fixture fills applied (internal rules only). */
  fixture: number
  venues: VenuePass[]
  fired: { notificationId: string; alertId: string; owner: string; rule: string; market: string; title: string; actionAsk: string | null; price: number }[]
  /** Candidates past the per-pass cap (counted in the newest body) and
   *  candidates the per-market cooldown held back. */
  more: number
  cooled: number
  note?: string
}

async function leaseVenue(venue: DuneVenueId, now: Date): Promise<{ cursor: string | null } | null> {
  await prisma.feedCursor.upsert({ where: { venue }, create: { venue }, update: {} })
  const got = await prisma.feedCursor.updateMany({
    where: { venue, OR: [{ leaseUntil: null }, { leaseUntil: { lt: now } }] },
    data: { leaseUntil: new Date(now.getTime() + FEED_LEASE_MS) },
  })
  if (got.count !== 1) return null
  const row = await prisma.feedCursor.findUnique({ where: { venue } })
  return { cursor: row?.cursor ?? null }
}

async function readVenue(venue: DuneVenueId, cursor: string | null, budgetMs: number, pull: typeof pullDuneFeed, now: Date): Promise<{ pass: VenuePass; fills: TapeFill[]; cursorOut: string | null; tipAt: Date | null; gap: { from: string; note: string } | null }> {
  const t0 = Date.now()
  let r: PullResult = await pull(venue, cursor, { budgetMs })
  let gap: { from: string; note: string } | null = null
  let retried: PullOutcome | undefined
  const label = duneVenue(venue)?.label ?? venue
  if (r.outcome === 'rejected' && cursor) {
    // The venue refused the cursor: record the gap, then rejoin at the tip.
    const prev = await prisma.feedCursor.findUnique({ where: { venue } })
    const age = prev?.tipAt ? now.getTime() - prev.tipAt.getTime() : null
    gap = { from: cursor, note: gapNote(label, cursor, age) }
    console.warn(`[prints ${venue}] ${gap.note}`)
    const left = budgetMs - (Date.now() - t0)
    const again = await pull(venue, null, { budgetMs: Math.max(5_000, left) })
    retried = again.outcome
    r = again
  } else if (r.outcome === 'fell-behind') {
    // 1008: a slow consumer. Back off, then once more from the last durable cursor.
    await new Promise((res) => setTimeout(res, 1_000))
    const left = budgetMs - (Date.now() - t0)
    const again = await pull(venue, r.cursorOut ?? cursor, { budgetMs: Math.max(3_000, left) })
    retried = again.outcome
    r = { ...again, fills: [...r.fills, ...again.fills], frames: r.frames + again.frames, cursorOut: again.cursorOut ?? r.cursorOut, resumed: r.resumed }
  }
  const pass: VenuePass = {
    venue,
    leased: true,
    cursorIn: cursor,
    cursorOut: r.cursorOut,
    resumed: r.resumed,
    outcome: r.outcome,
    frames: r.frames,
    fills: r.fills.length,
    firstLagMs: r.firstLagMs,
    lastLagMs: r.lastLagMs,
    tipAt: r.tipAt != null ? new Date(r.tipAt).toISOString() : null,
    elapsedMs: Date.now() - t0,
    ...(gap ? { gap } : {}),
    ...(retried ? { retried } : {}),
  }
  return { pass, fills: r.fills, cursorOut: r.cursorOut, tipAt: r.tipAt != null ? new Date(r.tipAt) : null, gap }
}

export async function runPrintSweep(opts: PrintSweepOptions = {}): Promise<PrintSweepSummary> {
  const now = opts.now ?? new Date()
  const t0 = Date.now()
  const budgetMs = opts.budgetMs ?? PRINT_CRON_BUDGET_MS
  const pull = opts.pull ?? pullDuneFeed
  const notify = opts.notify ?? notifyAlertFired
  const fixture = opts.fixture ?? null
  const rows = await prisma.printAlert.findMany({ where: { status: 'active' }, take: 2000 })
  const summary: PrintSweepSummary = { at: now.toISOString(), elapsedMs: 0, evaluated: rows.length, fixture: fixture?.length ?? 0, venues: [], fired: [], more: 0, cooled: 0 }
  if (rows.length === 0) {
    summary.note = 'no active print alerts; no feed opened'
    summary.elapsedMs = Date.now() - t0
    return summary
  }
  const alerts = rows.map((r) => ({ row: r, shape: printAlertToShape(r), onFixture: !!fixture && r.isInternal }))
  // Which venues the LIVE rules need (fixture-served rules open nothing).
  const need = new Set<DuneVenueId>()
  for (const a of alerts) if (!a.onFixture) for (const v of a.shape.venues) need.add(v)

  // Lease, then read every leased venue in parallel inside one budget.
  const leased: { venue: DuneVenueId; cursor: string | null }[] = []
  for (const venue of need) {
    const lease = await leaseVenue(venue, now)
    if (!lease) {
      summary.venues.push({ venue, leased: false, cursorIn: null, cursorOut: null, resumed: false, outcome: 'leased-elsewhere', frames: 0, fills: 0, firstLagMs: null, lastLagMs: null, tipAt: null, elapsedMs: 0 })
      continue
    }
    leased.push({ venue, cursor: lease.cursor })
  }
  const live = new Map<DuneVenueId, TapeFill[]>()
  const reads = await Promise.all(leased.map((l) => readVenue(l.venue, l.cursor, budgetMs, pull, now)))
  try {
    for (const r of reads) {
      summary.venues.push(r.pass)
      live.set(r.pass.venue, r.fills)
    }

    // Evaluate every rule, write its firings, remember what it saw.
    let tradable: TradabilityMap | null = opts.tradable ?? null
    for (const a of alerts) {
      const fills = a.onFixture ? (fixture as TapeFill[]) : a.shape.venues.flatMap((v) => live.get(v) ?? [])
      if (fills.length === 0) continue
      const recent = parseRecent(a.row.recent)
      const ev = evaluatePrintAlert(a.shape, fills, recent, { now: now.getTime() })
      summary.more += ev.more
      summary.cooled += ev.cooled
      for (let i = 0; i < ev.fires.length; i++) {
        const fire = ev.fires[i]
        let follow = fire.event.follow
        if (follow) {
          if (!tradable) tradable = await readTradability()
          if (!canTradeAsk(follow.ask, tradable)) follow = null
        }
        const notice = printNotification(a.shape, fire, follow, i === 0 ? ev.more : 0)
        const notificationId = await notify({ owner: a.row.owner, alertId: a.row.id, symbol: notice.symbol, title: notice.title, body: notice.body, actionAsk: notice.actionAsk, price: notice.price, isInternal: a.row.isInternal, email: a.row.email, href: notice.href })
        summary.fired.push({ notificationId, alertId: a.row.id, owner: a.row.owner, rule: a.row.rule, market: fire.event.market, title: notice.title, actionAsk: notice.actionAsk, price: notice.price })
      }
      await prisma.printAlert.update({
        where: { id: a.row.id },
        data: {
          recent: ev.recent as unknown as Prisma.InputJsonValue,
          ...(ev.fires.length ? { lastFiredAt: now, firedCount: { increment: ev.fires.length } } : {}),
        },
      })
    }
  } finally {
    // The cursor moves only now — after every rule judged the frames — and
    // the lease is released whatever happened above.
    for (const r of reads) {
      const p = r.pass
      await prisma.feedCursor.update({
        where: { venue: p.venue },
        data: {
          cursor: r.cursorOut ?? p.cursorIn,
          ...(r.tipAt ? { tipAt: r.tipAt } : {}),
          frames: { increment: p.frames },
          fills: { increment: p.fills },
          lastOutcome: p.retried ? `${p.outcome} (after ${p.gap ? 'a refused cursor' : 'a 1008'}: ${p.retried})` : p.outcome,
          lastPassAt: now,
          leaseUntil: null,
          ...(r.gap ? { gapFrom: r.gap.from, gapAt: now, gapNote: r.gap.note } : {}),
        },
      })
    }
  }
  summary.elapsedMs = Date.now() - t0
  return summary
}
