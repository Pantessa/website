'use client'
// Lane FEED owns this file. The PROPS are the squad contract (lane GROUP
// mounts the card through FeedList; the symbol page's Community tab uses it).
import type { FeedPost } from '@/lib/community/spec'

export interface PostCardProps {
  post: FeedPost
  /** Show the room chip (off inside the room's own feed). */
  showCommunity?: boolean
  /** In-app: send an ask (chip-send). Absent → the chips go through the ask door. */
  onAsk?: (ask: string) => void
}

export default function PostCard({ post }: PostCardProps) {
  return <article data-post={post.id}>{post.title}</article>
}
