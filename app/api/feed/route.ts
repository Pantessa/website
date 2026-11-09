import { NextRequest, NextResponse } from 'next/server'
import { isInternalRun } from '@/lib/internal-run'
import { getActor } from '@/lib/community/identity'
import { communityIsInternal, listFeed } from '@/lib/community/store'
import type { FeedKind, FeedSort, FeedWindow } from '@/lib/community/spec'

// GET /api/feed?community=&symbol=&sort=hot|new|top&window=day|week|all&kind=&author=&cursor=&limit=
// Public; `myVote` is filled when the request proves an identity. Internal
// (harness) posts are fenced out, except inside an internal room read by
// slug (the by-slug rule) or for an internal run asking `internal=1`.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KINDS: FeedKind[] = ['idea', 'link', 'video', 'trade']

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const community = q.get('community') || null
  const s = q.get('sort')
  const sort: FeedSort = s === 'new' || s === 'top' ? s : 'hot'
  const w = q.get('window')
  const window: FeedWindow = w === 'day' || w === 'all' ? w : 'week'
  const k = q.get('kind')
  const kind = k && (KINDS as string[]).includes(k) ? (k as FeedKind) : null
  if (k && !kind) return NextResponse.json({ error: "kind must be 'idea', 'link', 'video' or 'trade'." }, { status: 400 })
  const limit = Number(q.get('limit') ?? 25)
  const [actor, roomInternal] = await Promise.all([getActor().catch(() => null), community ? communityIsInternal(community) : Promise.resolve(null)])
  const includeInternal = roomInternal === true || (q.get('internal') === '1' && isInternalRun(req.headers))
  const { posts, next } = await listFeed({
    community,
    symbol: q.get('symbol') || null,
    sort,
    window,
    kind,
    author: q.get('author') || null,
    cursor: q.get('cursor') || null,
    limit: Number.isFinite(limit) ? limit : 25,
    viewer: actor?.key ?? null,
    includeInternal,
  })
  return NextResponse.json({ posts, next }, { headers: { 'cache-control': 'no-store' } })
}
