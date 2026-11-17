'use client'

// /community's working column: the composer over the feed (squad community,
// lane FEED, 2026-11-09). A post that lands re-reads the list in place.
//
// `/community?sort=new` opens the list on New (lane SHARE: the chart's
// "See it in the community" lands a just-published call where it is on top).
// The server's first page is the Hot one, so another sort reads its own.

import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import type { FeedPost, FeedSort } from '@/lib/community/spec'
import Composer from './Composer'
import FeedList from './FeedList'
import { readFeedSort } from './feed-rules'

export default function CommunityFeed({ initial }: { initial: { posts: FeedPost[]; next: string | null } | null }) {
  const [key, setKey] = useState(0)
  const [sort, setSort] = useState<FeedSort>('hot')
  return (
    <>
      <Suspense fallback={null}>
        <SortQuery onSort={setSort} />
      </Suspense>
      <Composer onPosted={() => setKey((k) => k + 1)} />
      <FeedList key={sort} initialSort={sort} initial={sort === 'hot' ? initial : null} refreshKey={key} />
    </>
  )
}

/** Reads `?sort=` (its own Suspense, so the static page stays static). */
function SortQuery({ onSort }: { onSort: (s: FeedSort) => void }) {
  const raw = useSearchParams()?.toString() ?? ''
  useEffect(() => {
    const s = readFeedSort(raw)
    if (s) onSort(s)
  }, [raw, onSort])
  return null
}
