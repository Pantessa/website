// FAN-OUT — a new community post is announced to the room's linked chats.
// Best-effort by contract: never throws, never delays the write that called
// it (callers `void fanoutPost(...)` or `after()` it), never for an internal
// (harness) row, never for a post outside a community.
//
// The two deliverers are the Telegram and Discord lanes' files; this module
// is the coordinator's and only wires them.

import type { FeedPost, PublicCommunity } from './spec'
import { channelsToAnnounce, type DeliveryChannel } from './store'
import { deliverTelegram } from './deliver-telegram'
import { deliverDiscord } from './deliver-discord'

export interface Announcement {
  post: FeedPost
  community: PublicCommunity
}

/** S8: deliveries in flight at once. */
export const FANOUT_CONCURRENCY = 3

export type Deliverer = (channel: DeliveryChannel, a: Announcement) => Promise<boolean>

export interface FanoutResult {
  attempted: number
  delivered: number
}

export async function fanoutPost(post: FeedPost, community: PublicCommunity | null): Promise<FanoutResult> {
  const out: FanoutResult = { attempted: 0, delivered: 0 }
  if (!community || post.isInternal) return out
  try {
    const channels = await channelsToAnnounce(community.slug)
    out.attempted = channels.length
    // S8: three at a time, never all of a room's chats at once.
    for (let i = 0; i < channels.length; i += FANOUT_CONCURRENCY) {
      const results = await Promise.allSettled(
        channels.slice(i, i + FANOUT_CONCURRENCY).map((c) => (c.platform === 'telegram' ? deliverTelegram : deliverDiscord)(c, { post, community })),
      )
      out.delivered += results.filter((r) => r.status === 'fulfilled' && r.value === true).length
    }
  } catch (e) {
    console.warn('[community fanout]', e instanceof Error ? e.message : e)
  }
  return out
}
