'use client'
// Lane FEED owns this file. Props are the squad contract: a feed of posts
// with hot / new / top, paged, votes in place. GROUP mounts it with
// `community`; the symbol page with `symbol`; /community with neither.
import type { FeedSort } from '@/lib/community/spec'

export interface FeedListProps {
  community?: string
  symbol?: string
  initialSort?: FeedSort
  /** Bump to re-read (the composer posted). */
  refreshKey?: number
  /** Words for an empty feed (the room page writes its own). */
  emptyLine?: string
}

export default function FeedList(_props: FeedListProps) {
  return <div data-feed-list />
}
