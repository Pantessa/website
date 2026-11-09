'use client'

// /community's working column: the composer over the feed (squad community,
// lane FEED, 2026-11-09). A post that lands re-reads the list in place.

import { useState } from 'react'
import type { FeedPost } from '@/lib/community/spec'
import Composer from './Composer'
import FeedList from './FeedList'

export default function CommunityFeed({ initial }: { initial: { posts: FeedPost[]; next: string | null } | null }) {
  const [key, setKey] = useState(0)
  return (
    <>
      <Composer onPosted={() => setKey((k) => k + 1)} />
      <FeedList initial={initial} refreshKey={key} />
    </>
  )
}
