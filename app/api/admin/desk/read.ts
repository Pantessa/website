// app/api/admin/desk/read.ts — the desk log's I/O (UI lane). Shared by GET /api/admin/desk
// and the Desk section of GET /api/admin/growth, so both screens read one loader and can
// never disagree. Every table is read fail-soft: a section that fails reads as empty and
// is NAMED in `failed`, and the page still loads.

import prisma from '@/lib/db'
import { TEST_WALLETS } from '@/lib/admin'
import { foldDeskIntent, sortDeskRows, type DeskIntentRaw, type DeskJobRaw, type DeskLinkEventRaw, type DeskLogRow, type DeskTurnRaw } from '@/lib/desk-activity'

export const DESK_ROW_CAP = 400

async function soft<T>(label: string, failed: string[], q: Promise<T>, fallback: T): Promise<T> {
  try {
    return await q
  } catch (e) {
    console.warn(`[admin/desk] ${label} failed:`, e instanceof Error ? e.message.split('\n')[0] : e)
    failed.push(label)
    return fallback
  }
}

export interface DeskRead {
  rows: DeskLogRow[]
  /** More intents exist in the window than the cap; the newest `DESK_ROW_CAP` are here. */
  truncated: boolean
  failed: string[]
}

/** Every broker intent opened since `since` (newest first, capped), folded with its job, its
 *  link's events, and the receipt-counted turns of its wallet. */
export async function readDeskRows(since: Date): Promise<DeskRead> {
  const failed: string[] = []
  const intents = await soft(
    'intents',
    failed,
    prisma.brokerIntent.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: DESK_ROW_CAP + 1,
      select: { id: true, ask: true, wallet: true, agent: true, agentKeyHash: true, isInternal: true, state: true, plan: true, linkSlug: true, jobId: true, createdAt: true, updatedAt: true },
    }),
    [] as DeskIntentRaw[],
  )
  const truncated = intents.length > DESK_ROW_CAP
  const page = intents.slice(0, DESK_ROW_CAP)
  const jobIds = page.map((i) => i.jobId).filter((x): x is string => !!x)
  const slugs = page.map((i) => i.linkSlug).filter((x): x is string => !!x)

  const [jobs, linkEvents, turns] = await Promise.all([
    jobIds.length
      ? soft(
          'jobs',
          failed,
          prisma.job.findMany({
            where: { id: { in: jobIds } },
            select: {
              id: true, status: true, valueUsd: true, failReason: true, isInternal: true, createdAt: true, updatedAt: true,
              steps: { orderBy: { seq: 'asc' }, select: { seq: true, kind: true, status: true, builder: true, title: true, artifact: true, result: true, valueUsd: true, expiresAt: true, createdAt: true, updatedAt: true } },
            },
          }),
          [] as DeskJobRaw[],
        )
      : Promise.resolve([] as DeskJobRaw[]),
    slugs.length
      ? soft(
          'link events',
          failed,
          prisma.intentLinkEvent.findMany({
            where: { slug: { in: slugs } },
            orderBy: { createdAt: 'asc' },
            select: { slug: true, kind: true, wallet: true, valueUsd: true, txHash: true, chainId: true, verification: true, createdAt: true },
          }),
          [] as (DeskLinkEventRaw & { slug: string })[],
        )
      : Promise.resolve([] as (DeskLinkEventRaw & { slug: string })[]),
    // The money rows the server writes per signed leg (squad round 2, lib/job-step-money):
    // session_id `job-<jobId>-<seq>`. Read ALL verdicts — the fold shows a mismatch as one.
    jobIds.length
      ? soft(
          'turns',
          failed,
          prisma.embedTurn.findMany({
            where: { outcome: 'signed', originKind: 'job-step', OR: jobIds.map((id) => ({ sessionId: { startsWith: `job-${id}-` } })) },
            select: { sessionId: true, valueUsd: true, verification: true, txUrl: true, isInternal: true, origin: true, createdAt: true },
          }),
          [] as DeskTurnRaw[],
        )
      : Promise.resolve([] as DeskTurnRaw[]),
  ])

  const jobById = new Map(jobs.map((j) => [j.id, j]))
  const eventsBySlug = new Map<string, DeskLinkEventRaw[]>()
  for (const e of linkEvents) {
    const list = eventsBySlug.get(e.slug) ?? []
    list.push(e)
    eventsBySlug.set(e.slug, list)
  }
  const turnsByJob = new Map<string, DeskTurnRaw[]>()
  for (const t of turns) {
    // `job-<jobId>-<seq>`: the id is whatever sits between the prefix and the trailing digits.
    const jobId = t.sessionId.match(/^job-(.+)-\d+$/)?.[1]
    if (!jobId) continue
    const list = turnsByJob.get(jobId) ?? []
    list.push(t)
    turnsByJob.set(jobId, list)
  }
  const testers = new Set(Array.from(TEST_WALLETS).map((w) => w.toLowerCase()))

  const rows = page.map((intent) =>
    foldDeskIntent({
      intent,
      job: intent.jobId ? jobById.get(intent.jobId) ?? null : null,
      linkEvents: intent.linkSlug ? eventsBySlug.get(intent.linkSlug) ?? [] : [],
      turns: intent.jobId ? turnsByJob.get(intent.jobId) ?? [] : [],
      testers,
    }),
  )
  return { rows: sortDeskRows(rows), truncated, failed }
}

/** The window's start (UTC midnight, `days` days back) — the Growth page's own rule. */
export function deskSince(days: number, now = Date.now()): Date {
  const since = new Date(now - (days - 1) * 86_400_000)
  since.setUTCHours(0, 0, 0, 0)
  return since
}
