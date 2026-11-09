'use client'
// Lane FEED owns this file. Props are the squad contract: a feed of posts
// with hot / new / top, paged, votes in place. GROUP mounts it with
// `community`; the symbol page with `symbol`; /community with neither.
//
// Reads GET /api/feed (public; `myVote` rides when the request proved an
// identity). Hot is the default; Top takes a window (today / this week / all
// time). "Load more" follows the server's cursor. A page server-rendered by
// its route (`initial`) paints at once and is re-read quietly, so a signed-in
// reader's own votes light without a blank frame.
//
// ONE act door for the whole list (lib/use-connect-to-act): a chip on any
// card runs in the ask door's sheet for a connected wallet, and holds behind
// the connect-only door for a stranger.

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useAskDoor } from '@/lib/ask-door'
import { askAppSlugs } from '@/lib/ask-apps'
import { useConnectToAct } from '@/lib/use-connect-to-act'
import { FEED_PAGE, FEED_SORTS, type FeedPost, type FeedSort, type FeedWindow } from '@/lib/community/spec'
import { FEED_SORT_LABEL, FEED_WINDOWS, FEED_WINDOW_LABEL, feedHref } from './feed-rules'
import PostCard from './PostCard'
import './community.css'

export interface FeedListProps {
  community?: string
  symbol?: string
  initialSort?: FeedSort
  /** Bump to re-read (the composer posted). */
  refreshKey?: number
  /** Words for an empty feed (the room page writes its own). */
  emptyLine?: string
  /** The first page, read on the server for `initialSort` (optional; the list reads it itself without one). */
  initial?: { posts: FeedPost[]; next: string | null } | null
  /** In-app: send an ask (chip-send). Absent → the chips go through the ask door. */
  onAsk?: (ask: string) => void
}

type Page = { posts: FeedPost[]; next: string | null }

export default function FeedList({ community, symbol, initialSort = 'hot', refreshKey = 0, emptyLine, initial = null, onAsk }: FeedListProps) {
  const [sort, setSort] = useState<FeedSort>(initialSort)
  const [win, setWin] = useState<FeedWindow>('week')
  const [page, setPage] = useState<Page | null>(initial)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [more, setMore] = useState(false)
  // A newer read always wins over an older one still in flight.
  const seq = useRef(0)
  const firstRead = useRef(true)
  const shown = useRef<string | null>(null)
  const pageRef = useRef<Page | null>(initial)
  useEffect(() => {
    pageRef.current = page
  })

  const read = useCallback(
    async (quiet: boolean) => {
      const mine = ++seq.current
      if (!quiet) setLoading(true)
      setErr(null)
      try {
        const r = await fetch(feedHref({ community, symbol, sort, window: win, limit: FEED_PAGE }), { cache: 'no-store' })
        const d = (await r.json().catch(() => ({}))) as { posts?: FeedPost[]; next?: string | null; error?: string }
        if (mine !== seq.current) return
        if (!r.ok || !Array.isArray(d.posts)) throw new Error('feed')
        setPage({ posts: d.posts, next: d.next ?? null })
      } catch {
        if (mine !== seq.current) return
        // A quiet re-read that fails keeps what is on screen.
        if (!quiet || pageRef.current === null) setErr('The feed is not answering right now. Nothing was lost.')
      } finally {
        if (mine === seq.current) setLoading(false)
      }
    },
    [community, symbol, sort, win],
  )

  useEffect(() => {
    // The server's page is for `initialSort` with no window: re-read it
    // quietly once (votes, freshness); any other sort or window is a real load.
    const quiet = firstRead.current && !!initial && sort === initialSort
    firstRead.current = false
    // Another sort, window or scope blanks the list (skeleton rows); a refresh
    // of the same list (the composer posted) keeps it up while it re-reads.
    const key = `${community ?? ''}|${symbol ?? ''}|${sort}|${win}`
    const sameList = shown.current === key
    shown.current = key
    if (!quiet && !sameList) setPage(null)
    void read(quiet || sameList)
    // `initial` and `initialSort` are the mount's inputs, not triggers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [read, refreshKey])

  const loadMore = async () => {
    if (!page?.next || more) return
    setMore(true)
    const mine = seq.current
    try {
      const r = await fetch(feedHref({ community, symbol, sort, window: win, cursor: page.next, limit: FEED_PAGE }), { cache: 'no-store' })
      const d = (await r.json().catch(() => ({}))) as { posts?: FeedPost[]; next?: string | null }
      if (mine !== seq.current) return
      if (!r.ok || !Array.isArray(d.posts)) throw new Error('feed')
      const seen = new Set(page.posts.map((p) => p.id))
      setPage({ posts: [...page.posts, ...d.posts.filter((p) => !seen.has(p.id))], next: d.next ?? null })
    } catch {
      if (mine === seq.current) setErr('The next page did not load. Try again.')
    } finally {
      setMore(false)
    }
  }

  // One act door for every chip in the list (PostCard's own door is for a card standing alone).
  const openDoor = useAskDoor((s) => s.openDoor)
  const run = useCallback((ask: string) => openDoor(ask, { send: true, mcps: askAppSlugs(ask) }), [openDoor])
  const redirectFor = useCallback((ask: string) => `/chat?prompt=${encodeURIComponent(ask)}`, [])
  const { act, door } = useConnectToAct({ run, redirectFor })
  const chipAct = onAsk ?? act

  const posts = page?.posts ?? null
  const where = community ? 'this room' : symbol ? symbol : 'the community'

  return (
    <section className="cmy-feed" data-feed-list="" data-sort={sort} aria-label={`Posts in ${where}`}>
      <div className="cmy-feed__bar">
        <div className="cmy-tabs" role="tablist" aria-label="Sort posts">
          {FEED_SORTS.map((s) => (
            <button key={s} type="button" role="tab" aria-selected={sort === s} className="cmy-tabs__tab" onClick={() => setSort(s)} data-journey={`Sort ${s}`}>
              {FEED_SORT_LABEL[s]}
            </button>
          ))}
        </div>
        {sort === 'top' && (
          <div className="cmy-tabs cmy-tabs--sub" role="tablist" aria-label="Top posts over">
            {FEED_WINDOWS.map((w) => (
              <button key={w} type="button" role="tab" aria-selected={win === w} className="cmy-tabs__tab" onClick={() => setWin(w)}>
                {FEED_WINDOW_LABEL[w]}
              </button>
            ))}
          </div>
        )}
      </div>

      {err && (
        <p className="cmy-feed__err" role="alert">
          {err}{' '}
          <button type="button" onClick={() => void read(false)}>
            Try again
          </button>
        </p>
      )}

      {posts === null && !err && (
        <div className="cmy-feed__list" aria-busy="true" aria-label="Loading posts">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="cmy-card cmy-card--skel" aria-hidden>
              <span className="cmy-skel cmy-skel--vote" />
              <div className="cmy-card__main">
                <span className="cmy-skel cmy-skel--meta" />
                <span className="cmy-skel cmy-skel--title" />
                <span className="cmy-skel cmy-skel--body" />
              </div>
            </div>
          ))}
        </div>
      )}

      {posts && posts.length === 0 && !err && (
        <div className="cmy-feed__empty" data-feed-empty="">
          <p>{emptyLine ?? (sort === 'top' && win !== 'all' ? `Nothing was posted in ${where} ${win === 'day' ? 'today' : 'this week'}.` : `Nobody has posted in ${where} yet.`)}</p>
          <p className="cmy-feed__emptydo">
            {community || symbol ? (
              <a href="#share-here">Post the first one</a>
            ) : (
              <>
                <a href="#share-here">Post the first one</a>
                <span aria-hidden> · </span>
                <Link href="/g/new">Start a room</Link>
              </>
            )}
          </p>
        </div>
      )}

      {posts && posts.length > 0 && (
        <div className="cmy-feed__list" aria-busy={loading || undefined}>
          {posts.map((p) => (
            <PostCard key={p.id} post={p} showCommunity={!community} onAsk={chipAct} />
          ))}
        </div>
      )}

      {page?.next && (
        <button type="button" className="cmy-feed__more" onClick={() => void loadMore()} disabled={more} data-journey="Load more posts">
          {more ? 'Loading' : 'Load more'}
        </button>
      )}
      {!onAsk && door}
    </section>
  )
}
