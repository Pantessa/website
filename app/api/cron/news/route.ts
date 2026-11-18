import { NextRequest, NextResponse } from 'next/server'
import { refreshSiteFeeds } from '@/lib/news'
import { indexStats, newsIndexOn, pruneIndex } from '@/lib/news-index'
import { pullDueXSymbols } from '@/lib/news-x'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// The news indexer — Vercel cron (vercel.json), every 10 minutes. Re-reads
// every site feed that is due (lib/news-sources SITE_FEEDS) and files each
// story under the symbols its headline names, so a symbol's page fills
// whether or not anyone is looking and a story outlives the feed's own
// window. Then, only when NEWS_X_DAILY_USD is set above zero, it reads X for
// the cashtags that are due (lib/news-x: reserved against the day's cap
// before a cent is spent). Stories older than the index keeps are dropped.
//
// Same auth doctrine as the other crons: no CRON_SECRET set = disabled,
// never open. Free feeds only unless the X budget says otherwise.
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

async function handle(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  if (!newsIndexOn()) return NextResponse.json({ skipped: 'no database' })
  try {
    const feeds = await refreshSiteFeeds()
    // Pruned before the X step (review F5): a slow X never costs the index its housekeeping.
    const pruned = await pruneIndex()
    const x = await pullDueXSymbols().catch((e) => ({ error: (e as Error).message.split('\n')[0] }))
    return NextResponse.json({ feeds, x, pruned, index: await indexStats() })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message.split('\n')[0] }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
