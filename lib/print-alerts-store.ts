// lib/print-alerts-store.ts — the print_alerts rows behind /api/print-alerts
// and the feed_cursors status the rail shows. Owner-gated the way the
// price alerts are (lib/watchlists-store): every read and write is scoped
// to the lowercased SIWE wallet; another wallet's row is a 404.

import type { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { mintSlug } from '@/lib/intent-links'
import { PRINT_ALERT_MAX_PER_OWNER, parseThresholds, parseVenues, readPrintAlertBody, type FeedStatusShape, type PrintAlertShape } from '@/lib/print-alerts'
import { readAlertEmail } from '@/lib/watchlists-store'
import type { TriggerRule } from '@/lib/tape'

type Row = NonNullable<Awaited<ReturnType<typeof prisma.printAlert.findUnique>>>

export function printAlertToShape(r: Row): PrintAlertShape {
  return {
    id: r.id,
    owner: r.owner,
    rule: r.rule as TriggerRule,
    market: r.market,
    venues: parseVenues(r.venues) ?? [],
    thresholds: parseThresholds(r.thresholds),
    status: r.status === 'paused' ? 'paused' : 'active',
    email: r.email,
    lastFiredAt: r.lastFiredAt?.toISOString() ?? null,
    firedCount: r.firedCount,
    createdAt: r.createdAt.toISOString(),
  }
}

export async function listPrintAlerts(owner: string): Promise<PrintAlertShape[]> {
  const rows = await prisma.printAlert.findMany({ where: { owner: owner.toLowerCase() }, orderBy: { createdAt: 'desc' } })
  return rows.map(printAlertToShape)
}

export type CreatePrintAlertResult = { alert: PrintAlertShape } | { problem: string; status: 400 | 409 }

export async function createPrintAlert(owner: string, body: unknown, isInternal: boolean): Promise<CreatePrintAlertResult> {
  const read = readPrintAlertBody(body)
  if ('problem' in read) return { problem: read.problem, status: 400 }
  const mail = await readAlertEmail((body as { email?: unknown } | null)?.email)
  if ('problem' in mail) return { problem: mail.problem, status: 400 }
  const o = owner.toLowerCase()
  const held = await prisma.printAlert.count({ where: { owner: o } })
  if (held >= PRINT_ALERT_MAX_PER_OWNER) return { problem: `This wallet already holds ${PRINT_ALERT_MAX_PER_OWNER} stream rules — remove one first.`, status: 409 }
  const row = await prisma.printAlert.create({
    data: {
      id: mintSlug(10),
      owner: o,
      rule: read.input.rule,
      market: read.input.market,
      venues: read.input.venues as unknown as Prisma.InputJsonValue,
      thresholds: read.input.thresholds as unknown as Prisma.InputJsonValue,
      email: mail.email,
      isInternal,
    },
  })
  return { alert: printAlertToShape(row) }
}

export type SetPrintAlertResult = { alert: PrintAlertShape } | { problem: string; status: 404 | 409 }

export async function setPrintAlertStatus(owner: string, id: string, op: 'pause' | 'resume'): Promise<SetPrintAlertResult> {
  const row = await prisma.printAlert.findFirst({ where: { id, owner: owner.toLowerCase() } })
  if (!row) return { problem: 'No such rule on this wallet.', status: 404 }
  const want = op === 'pause' ? 'paused' : 'active'
  if (row.status === want) return { problem: `Already ${want}.`, status: 409 }
  const next = await prisma.printAlert.update({ where: { id: row.id }, data: { status: want } })
  return { alert: printAlertToShape(next) }
}

export async function deletePrintAlert(owner: string, id: string): Promise<boolean> {
  const r = await prisma.printAlert.deleteMany({ where: { id, owner: owner.toLowerCase() } })
  return r.count === 1
}

/** Where the cron left every venue: what the rail's status line reads. No
 *  owner scope (a cursor is the venue's, not anyone's); the words carry no
 *  key and no address. */
export async function feedStatus(): Promise<FeedStatusShape[]> {
  const rows = await prisma.feedCursor.findMany({ orderBy: { venue: 'asc' } })
  return rows.map((r) => ({
    venue: r.venue as FeedStatusShape['venue'],
    cursor: r.cursor,
    tipAt: r.tipAt?.toISOString() ?? null,
    lastOutcome: r.lastOutcome,
    lastPassAt: r.lastPassAt?.toISOString() ?? null,
    gapAt: r.gapAt?.toISOString() ?? null,
    gapNote: r.gapNote,
  }))
}
