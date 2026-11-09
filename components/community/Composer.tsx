'use client'
// Lane FEED owns this file. Props are the squad contract: one composer for
// an idea (a chart), a link, a video, or a trade with proof. Posting needs a
// sign-in (the unified door, rule 6); it opens folded.
import type { ChartState } from '@/lib/chart-state'
import type { FeedPost } from '@/lib/community/spec'

export interface ComposerProps {
  /** Post into this room. */
  community?: string
  /** Pre-pick the market (the symbol page). */
  symbol?: string
  /** The page's live chart — "attach my current chart". */
  chartState?: ChartState | null
  onPosted?: (post: FeedPost) => void
}

export default function Composer(_props: ComposerProps) {
  return <div data-composer />
}
