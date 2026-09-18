// lib/journey-server.ts — the write side of the journey log.
//
// Two writers, one table (visitor_events):
//   · writeJourneyBatch — what a browser beaconed to /api/journey.
//   · recordTurn        — what our own chat route saw: the ask, and the
//     shape of what it handed back. Same visitor id as the browser's rows
//     (lib/visitor-id derives it from the request), so "asked" and "hit a
//     wall" land on the timeline the browser started, with no client help.
//
// Everything here fails soft and quiet. A journey row is never worth a slow
// page or a broken chat turn.

import type { Prisma } from '@prisma/client'
import { isAdminAddress, isTestWallet } from '@/lib/admin'
import { moneyShaped } from '@/lib/ask-failure'
import { isInternalRun } from '@/lib/internal-run'
import { MAX_AGO_MS, scrub, type CleanEvent } from '@/lib/journey-events'
import { bumpAndCheckJourney } from '@/lib/journey-limits'
import { deviceOf, externalReferrerHost, isBotUa, replyShape } from '@/lib/user-flows'
import { optedOut, visitorFrom } from '@/lib/visitor-id'
import { clientIpFrom } from '@/lib/turn-limits'

/** Hosts whose traffic is the public's. Previews and localhost are ours. */
const PUBLIC_HOST = /(^|\.)(pantessa\.com|yeetful\.com)$/

export function isPublicHost(host: string | null | undefined): boolean {
  if (!host) return false
  return PUBLIC_HOST.test(host.split(':')[0].toLowerCase())
}

interface RowBase {
  vid: string
  net: string | null
  wallet: string | null
  country: string | null
  device: string
  isTeam: boolean
  teamClaimed: boolean
  isInternal: boolean
  isBot: boolean
}

async function baseFor(headers: Headers, wallet: string | null, opts: { team?: boolean; body?: unknown; sessionAddress?: string | null }): Promise<RowBase> {
  const who = await visitorFrom(headers)
  const ua = headers.get('user-agent')
  const host = headers.get('x-forwarded-host') ?? headers.get('host')
  return {
    vid: who.vid,
    net: who.net,
    wallet,
    country: (headers.get('x-vercel-ip-country') ?? '').slice(0, 2).toUpperCase() || null,
    device: deviceOf(ua),
    // Two strengths of "ours", kept apart on purpose. The session cookie is
    // verified; the body flag and the wallet are whatever the sender typed.
    // Only the verified one may hide anybody else's rows (the flows route).
    isTeam: isAdminAddress(opts.sessionAddress) || isTestWallet(opts.sessionAddress),
    teamClaimed: opts.team === true || isTestWallet(wallet) || isAdminAddress(wallet),
    isInternal: who.local || !isPublicHost(host) || isInternalRun(headers, opts.body),
    isBot: isBotUa(ua),
  }
}

export type BatchVerdict = 'ok' | 'opted-out' | 'limited' | 'empty'

/** Persist one sanitized beacon batch. */
export async function writeJourneyBatch(
  headers: Headers,
  clean: { events: CleanEvent[]; wallet: string | null; team: boolean; ref: string | null; utm: string | null },
  opts: { body?: unknown; sessionAddress?: string | null } = {},
): Promise<BatchVerdict> {
  if (optedOut(headers)) return 'opted-out'
  if (clean.events.length === 0) return 'empty'
  if (await bumpAndCheckJourney(clientIpFrom(headers), clean.events.length)) return 'limited'
  const base = await baseFor(headers, clean.wallet, { team: clean.team, body: opts.body, sessionAddress: opts.sessionAddress })
  const referrer = externalReferrerHost(clean.ref) || null
  const now = Date.now()
  const { default: prisma } = await import('@/lib/db')
  let firstView = true
  await prisma.visitorEvent.createMany({
    data: clean.events.map((e) => {
      // The referrer belongs to the view that carried it in, not to every
      // click of the visit.
      const carries = e.kind === 'view' && firstView
      if (carries) firstView = false
      return {
        ...base,
        kind: e.kind,
        path: e.path,
        label: e.label,
        detail: e.detail ?? undefined,
        referrer: carries ? referrer : null,
        utm: carries ? clean.utm : null,
        createdAt: new Date(now - Math.min(e.agoMs, MAX_AGO_MS)),
      }
    }),
  })
  // Retention: the privacy page says logs are short-lived. 120 days, swept
  // lazily so no cron is needed.
  if (Math.random() < 0.01) {
    void prisma.$executeRaw`DELETE FROM visitor_events WHERE created_at < now() - interval '120 days'`.catch(() => {})
  }
  return 'ok'
}

/** The page a chat turn was sent from, as a pathname. */
function surfaceOf(headers: Headers, reqBody: Record<string, unknown>): string {
  if (typeof reqBody.intentLinkSlug === 'string' && reqBody.intentLinkSlug) return `/i/${reqBody.intentLinkSlug.slice(0, 40)}`
  try {
    const ref = headers.get('referer')
    if (ref) return new URL(ref).pathname.slice(0, 160)
  } catch {
    /* fall through */
  }
  return '/chat'
}

/**
 * One finished chat turn → an `ask` row and a `reply` row. Called from the
 * chat route's POST wrapper inside after(), so it costs the visitor nothing.
 * Phase-2 executes and empty messages are not asks. A streamed reply has no
 * JSON body to read, so only the ask is kept.
 */
export async function recordTurn(
  headers: Headers,
  reqBody: Record<string, unknown>,
  resBody: Record<string, unknown> | null,
  turn: { streamed: boolean; startedAt: number; finishedAt: number },
): Promise<void> {
  const { streamed } = turn
  try {
    if (optedOut(headers)) return
    const message = typeof reqBody.message === 'string' ? reqBody.message.trim() : ''
    if (!message || reqBody.phase === 'execute') return
    // The chat embedded on someone else's site is their visitors, not ours:
    // the browser half never runs there, and neither does this one.
    // (embed_turns is that surface's own telemetry.)
    if ((typeof reqBody.embedKey === 'string' && reqBody.embedKey) || (typeof reqBody.embedOrigin === 'string' && reqBody.embedOrigin)) return
    const wallet = typeof reqBody.walletAddress === 'string' && /^0x[0-9a-fA-F]{40}$/.test(reqBody.walletAddress) ? reqBody.walletAddress.toLowerCase() : null
    const base = await baseFor(headers, wallet, { body: reqBody })
    const path = surfaceOf(headers, reqBody)
    const money = moneyShaped(message)
    const rows: Prisma.VisitorEventCreateManyInput[] = [
      {
        ...base,
        kind: 'ask',
        path,
        label: scrub(message, 240),
        detail: { money, apps: Array.isArray(reqBody.activeServers) ? reqBody.activeServers.length : 0 },
        createdAt: new Date(turn.startedAt),
      },
    ]
    if (!streamed) {
      const shape = replyShape(resBody, money)
      const reply = typeof resBody?.reply === 'string' ? resBody.reply : null
      rows.push({
        ...base,
        kind: 'reply',
        path,
        label: shape.title,
        detail: {
          shape: shape.kind,
          ...(typeof resBody?.buildPath === 'string' ? { buildPath: resBody.buildPath.slice(0, 60) } : {}),
          // The words they actually read, only when those words were the wall.
          ...(shape.kind === 'reply-wall' && reply ? { said: scrub(reply, 160) ?? '' } : {}),
        },
        // Strictly after the ask, however fast the turn was.
        createdAt: new Date(Math.max(turn.finishedAt, turn.startedAt + 1)),
      })
    }
    const { default: prisma } = await import('@/lib/db')
    await prisma.visitorEvent.createMany({ data: rows })
  } catch (e) {
    console.warn('[journey] recordTurn failed:', e instanceof Error ? e.message.split('\n')[0] : e)
  }
}
