// lib/roster-tryouts-exec.ts — M6 forward-paper tryouts, the I/O half.
//
// Everything the spec makes structural is enforced HERE, not by copy:
//   · a tryout/mark row is the ONLY thing created — no intent_links, no
//     broker_intents, no inbox items, no embed_turns (grep this file:
//     the only prisma models touched are rosterTryout/rosterTryoutMark);
//   · quotes are computed server-side by the executor's own read-only
//     quote path (lib/usd-probe usdPerToken — the QuoterV2 fee-tier scan
//     with the v4 fallback, the exact fns the swap builder re-quotes
//     with). The agent payload contributes ONLY the ask sentence
//     (§1.5-1); a pair the executor can't price refuses by name (#429);
//   · review_at is stamped at creation (+7d) and no code path updates it
//     (§1.5-2); quote_at_review is WRITE-ONCE (the update is guarded on
//     quoteAtReview: null);
//   · append-only — there is no delete anywhere in this module (§1.5-3).

import prisma from '@/lib/db'
import { Prisma } from '@prisma/client'
import { mintSlug } from '@/lib/intent-links'
import { parseMandate } from '@/lib/roster'
import { assertUnderSlotCap, mandateHash } from '@/lib/roster-policy'
import { usdPerToken } from '@/lib/usd-probe'
import { MOSAIC_CHAIN_IDS } from '@/lib/mosaic'
import {
  MARKABLE_KINDS,
  markPeriodKey,
  parseMarkAsk,
  TRYOUT_DAYS,
  TRYOUT_MAX_RUNNING_PER_KIND,
  type TryoutQuote,
} from '@/lib/roster-tryouts'

export interface TryoutRow {
  id: string
  wallet: string
  agentKeyHash: string
  mandateText: string
  mandateKind: string
  capUsd: number
  status: string
  startedAt: Date
  reviewAt: Date
  reviewedAt: Date | null
  isInternal: boolean
}

const TRYOUT_SELECT = {
  id: true,
  wallet: true,
  agentKeyHash: true,
  mandateText: true,
  mandateKind: true,
  capUsd: true,
  status: true,
  startedAt: true,
  reviewAt: true,
  reviewedAt: true,
  isInternal: true,
} as const

/** Create a tryout. The mandate must round-trip parseMandate (canonical
 *  recompose stored — T2); review_at = started_at + 7d, fixed forever. */
export async function createTryout(a: {
  wallet: string
  agentKeyHash: string
  mandate: string
  capUsd: number
  internal: boolean
}): Promise<TryoutRow> {
  const parsed = parseMandate(a.mandate)
  if ('problem' in parsed) throw new Error(parsed.problem)
  // §1.5-3 concurrent cap — per agent per kind, refused by name.
  const running = await prisma.rosterTryout.count({
    where: { agentKeyHash: a.agentKeyHash, mandateKind: parsed.kind, status: 'running' },
  })
  if (running >= TRYOUT_MAX_RUNNING_PER_KIND) {
    throw new Error(
      `This agent already has ${running} running ${parsed.kind} tryouts (the cap is ${TRYOUT_MAX_RUNNING_PER_KIND}) — review or retire one first. Survivorship needs the whole record.`,
    )
  }
  const startedAt = new Date()
  const reviewAt = new Date(startedAt.getTime() + TRYOUT_DAYS * 24 * 60 * 60 * 1000)
  return prisma.rosterTryout.create({
    data: {
      id: mintSlug(10),
      wallet: a.wallet,
      agentKeyHash: a.agentKeyHash,
      mandateText: parsed.mandateText,
      mandateKind: parsed.kind,
      mandateHash: mandateHash(parsed.mandateText),
      capUsd: a.capUsd,
      startedAt,
      reviewAt,
      isInternal: a.internal,
    },
    select: TRYOUT_SELECT,
  })
}

/** The executor's read-only quote for a mark ask — the same fee-tier scan
 *  the swap builder quotes with. Null = the real executor could not price
 *  this pair (the caller refuses by name). */
async function venueQuote(ask: ReturnType<typeof parseMarkAsk>): Promise<{ quote: TryoutQuote; venue: string; routeRef: string } | null> {
  if ('problem' in ask) return null
  const chainId = MOSAIC_CHAIN_IDS[ask.chainWord]
  const probe = await usdPerToken(chainId, ask.quoteToken).catch(() => null)
  if (!probe) return null
  return {
    quote: {
      pair: `${ask.quoteToken}/${ask.side === 'sell' ? ask.buyToken : ask.sellToken}`,
      side: ask.side,
      amountIn: ask.amountUsd,
      quoteOut: probe.usd,
      unit: `USD per ${ask.quoteToken}`,
    },
    venue: probe.via,
    routeRef: probe.via,
  }
}

/** File a paper mark. Server computes the quote; the payload contributes
 *  ONLY the sentence. Cadence quota rides the unique(tryout_id, period_key)
 *  constraint — the DCA no-double-buys pattern. */
export async function fileMark(tryoutId: string, askRaw: string, internal: boolean) {
  const tryout = await prisma.rosterTryout.findUnique({ where: { id: tryoutId }, select: TRYOUT_SELECT })
  if (!tryout) throw new Error('No such tryout.')
  if (tryout.status !== 'running') throw new Error(`This tryout is ${tryout.status} — marks land on running tryouts only.`)
  if (Date.now() >= tryout.reviewAt.getTime()) throw new Error('This tryout has reached its review date — no further marks; read it to capture the review.')
  if (!MARKABLE_KINDS.has(tryout.mandateKind)) {
    // SPEC GAP G1 — fail-closed: no executor quote fn is defined for this
    // mandate kind, so a mark would have to invent a price. Refuse by name.
    throw new Error(
      `Paper marks for "${tryout.mandateKind}" mandates aren't supported yet — no executor quote path is defined for that kind (spec gap G1, fail-closed). Shape and DCA tryouts take marks today.`,
    )
  }
  const ask = parseMarkAsk(askRaw)
  if ('problem' in ask) throw new Error(ask.problem)
  // The real gate's own cap copy (§1.3) — a paper mark never exceeds what
  // the real slot would allow.
  assertUnderSlotCap(ask.amountUsd, tryout.capUsd, { moneyShaped: true, stage: 'open' })
  // Cadence quota BEFORE the venue quote (deterministic refusal, no wasted
  // RPC); the unique constraint below stays as the race backstop.
  const periodKeyEarly = markPeriodKey(tryout.mandateKind, tryout.mandateText)
  const dupe = await prisma.rosterTryoutMark.findFirst({ where: { tryoutId, periodKey: periodKeyEarly }, select: { id: true } })
  if (dupe) {
    throw new Error(
      `This tryout already has its mark for the current period (${periodKeyEarly}) — the mandate's own cadence bounds paper exactly like real buys (§1.5-4). Next period, next mark.`,
    )
  }
  const quoted = await venueQuote(ask)
  if (!quoted) {
    throw new Error(
      `The executor can't price ${ask.quoteToken} on ${ask.chainWord} right now (unknown ticker or no live pool — the #429 discipline). No mark without a real quote.`,
    )
  }
  const periodKey = periodKeyEarly
  const seq = (await prisma.rosterTryoutMark.count({ where: { tryoutId } })) + 1
  try {
    return await prisma.rosterTryoutMark.create({
      data: {
        id: mintSlug(10),
        tryoutId,
        seq,
        askText: askRaw.trim(),
        venue: quoted.venue,
        routeRef: quoted.routeRef,
        quoteAtPropose: quoted.quote as object,
        periodKey,
        isInternal: internal || tryout.isInternal,
      },
    })
  } catch (e) {
    if (String(e).includes('Unique constraint')) {
      throw new Error(
        `This tryout already has its mark for the current period (${periodKey}) — the mandate's own cadence bounds paper exactly like real buys (§1.5-4). Next period, next mark.`,
      )
    }
    throw e
  }
}

/** The lazy, WRITE-ONCE review capture (the DCA due-detection pattern — no
 *  cron). Early calls refuse BY NAME; the first call at ≥ review_at
 *  captures quote_at_review for every mark with the SAME fn, stamps
 *  reviewed_at, flips status. Calling again is a no-op by construction:
 *  every write is guarded on the not-yet-captured state. */
export async function captureReview(tryoutId: string, opts?: { forceDueForInternal?: boolean }): Promise<TryoutRow> {
  const tryout = await prisma.rosterTryout.findUnique({ where: { id: tryoutId }, select: TRYOUT_SELECT })
  if (!tryout) throw new Error('No such tryout.')
  if (tryout.status === 'reviewed' || tryout.status === 'retired') return tryout
  const due = Date.now() >= tryout.reviewAt.getTime() || (opts?.forceDueForInternal === true && tryout.isInternal)
  if (!due) {
    throw new Error(
      `Too early — this tryout reviews at ${tryout.reviewAt.toISOString()} (fixed at creation, +${TRYOUT_DAYS} days, immutable). Cherry-picked review times are the point of the rule.`,
    )
  }
  const marks = await prisma.rosterTryoutMark.findMany({ where: { tryoutId }, orderBy: { seq: 'asc' } })
  for (const m of marks) {
    if (m.quoteAtReview != null) continue // WRITE-ONCE
    const ask = parseMarkAsk(m.askText)
    const quoted = await venueQuote(ask)
    // A pair that stopped pricing keeps a null review quote — the card says
    // "not yet captured"; it never invents a number.
    if (!quoted) continue
    // Write-once, DB-ENFORCED (security wave-3 audit): the JS null-guard
    // above has a TOCTOU window when two lazy captures race off concurrent
    // GETs — both read null, both quote, second write clobbers the first.
    // The updateMany predicate makes the store itself refuse the second
    // write, so the FIRST captured number is the number, forever.
    await prisma.rosterTryoutMark.updateMany({
      // DbNull: an unwritten quote_at_review is a database NULL (the app
      // never writes a JSON-null there — AnyNull silently matched nothing).
      where: { id: m.id, quoteAtReview: { equals: Prisma.DbNull } },
      data: { quoteAtReview: quoted.quote as object },
    })
  }
  // Same race on the status flip: a guarded update() throws P2025 when a
  // concurrent capture won — updateMany is a no-op instead, and the fresh
  // re-read returns whichever capture landed.
  await prisma.rosterTryout.updateMany({
    where: { id: tryoutId, status: 'running' },
    data: { status: 'reviewed', reviewedAt: new Date() },
  })
  const fresh = await prisma.rosterTryout.findUnique({ where: { id: tryoutId }, select: TRYOUT_SELECT })
  if (!fresh) throw new Error('No such tryout.')
  return fresh
}
