// A call, read for its public page and its social card (server only).
// The rules live in lib/chart-calls (pure); this file is the I/O: the post by
// id, the tape around its timestamp, and the author's receipt-verified fills.
// Every read is its own failure domain — a tape that is down leaves a page
// that says "no price read", never a 500 and never a guessed number.

import prisma from '@/lib/db'
import { getPost, type PublicComment, type PublicPost } from '@/lib/chart-posts'
import { chartPairFor, type ChartPair } from '@/lib/charts'
import { loadCandleSeries, loadCandlesBefore } from '@/lib/candles-server'
import type { Candle, ChartFeed } from '@/lib/charts'
import { readVerifiedFills } from '@/lib/viz/fills'
import type { FillMarker } from '@/lib/chart-fills'
import { STAMP_FRAMES, movePct, stampFromBars, type CallStamp } from '@/lib/chart-calls'

export interface CallView {
  post: PublicPost & { commentList: PublicComment[] }
  /** The tape's price at the call, or null when no frame could read it. */
  stamp: CallStamp | null
  /** The live tape: last price and the daily candles the card draws. */
  last: number | null
  feed: ChartFeed | null
  daily: Candle[]
  /** The tape on the frame the lines were drawn on (the card draws these, so a
   *  trend line lands on the bars its author put it on). Falls back to daily. */
  tape: Candle[]
  /** % move from the stamp to the last price. */
  move: number | null
  /** The author's receipt-verified fills on this symbol, oldest first. */
  fills: FillMarker[]
  /** At least one verified fill at or before the stamp. */
  heldAtCall: boolean
  /** The chart pair (source, label) the ticket composes against. */
  pair: ChartPair | null
  /** The author's other live links: what else they are asking people to sign. */
  authorLinks: AuthorLink[]
}

export interface AuthorLink {
  slug: string
  ask: string
  createdAt: number
}

/** The author's live, public links, newest first, this post's own excluded.
 *  Public rows only (#699 class: never internal), never revoked or expired. */
async function readAuthorLinks(author: string, exceptSlug: string | null, take = 6): Promise<AuthorLink[]> {
  try {
    const rows = await prisma.intentLink.findMany({
      where: { creator: author.toLowerCase(), revoked: false, isInternal: false, recipient: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      orderBy: { createdAt: 'desc' },
      take: take + 1,
      select: { id: true, ask: true, createdAt: true },
    })
    return rows
      .filter((r) => r.id !== exceptSlug)
      .slice(0, take)
      .map((r) => ({ slug: r.id, ask: r.ask, createdAt: Math.floor(r.createdAt.getTime() / 1000) }))
  } catch {
    return []
  }
}

/** Finest frame first: the first one whose bars reach the call wins. */
async function readStamp(symbol: string, callT: number): Promise<CallStamp | null> {
  for (const f of STAMP_FRAMES) {
    try {
      // `before` one bar past the call so the bar that closed AT the call is in the page.
      const r = await loadCandlesBefore(symbol, f.tf, callT + f.sec)
      const stamp = r ? stampFromBars(r.page.older, callT, f.tf) : null
      if (stamp) return stamp
    } catch {
      /* this frame's feed missed — the next coarser one may answer */
    }
  }
  return null
}

export async function readCall(id: string): Promise<CallView | null> {
  const post = await getPost(id).catch(() => null)
  if (!post || post.kind !== 'idea') return null
  const tf = post.chartState?.tf ?? '1d'
  const [stamp, live, framed, fillsRead, authorLinks] = await Promise.all([
    readStamp(post.symbol, post.createdAt),
    loadCandleSeries(post.symbol, '1d').catch(() => null),
    tf === '1d' ? Promise.resolve(null) : loadCandleSeries(post.symbol, tf).catch(() => null),
    readVerifiedFills(post.symbol, post.author).catch(() => [] as FillMarker[]),
    post.isInternal ? Promise.resolve([] as AuthorLink[]) : readAuthorLinks(post.author, post.linkSlug),
  ])
  const daily = live?.series.candles ?? []
  const last = daily.length ? daily[daily.length - 1].c : null
  // An internal (harness) author's fills never paint on a public page; the
  // reader already fences internal rows, and an internal POST shows none.
  const fills = post.isInternal ? [] : fillsRead
  return {
    post,
    stamp,
    last,
    feed: live?.series.feed ?? null,
    daily,
    tape: framed?.series.candles.length ? framed.series.candles : daily,
    move: stamp && last !== null ? movePct(stamp.price, last) : null,
    fills,
    heldAtCall: fills.some((f) => f.side === 'buy' && f.t <= post.createdAt),
    pair: chartPairFor(post.symbol),
    authorLinks,
  }
}
