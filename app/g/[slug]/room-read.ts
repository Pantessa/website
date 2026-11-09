import { cache } from 'react'
import { COMMUNITY_SLUG_RE, type PublicCommunity } from '@/lib/community/spec'
import { communityIsInternal, getCommunity } from '@/lib/community/store'

// The room page's one server read (shared by the page, its metadata and its
// card through React's cache). Three answers:
//   room         the room exists
//   null, known  there is no such room: a real 404
//   null, !known the store could not be read (its bodies are not in this
//                tree yet, or the database is away): the page still renders
//                and asks the public API from the browser, never a 500
export interface RoomRead {
  room: PublicCommunity | null
  known: boolean
  /** A harness room (is_internal): rendered for whoever holds the address, never indexed. */
  internal: boolean
}

export const readRoom = cache(async (slug: string): Promise<RoomRead> => {
  if (!COMMUNITY_SLUG_RE.test(slug)) return { room: null, known: true, internal: false }
  try {
    const [room, internal] = await Promise.all([getCommunity(slug), communityIsInternal(slug)])
    return { room, known: true, internal: internal === true }
  } catch {
    return { room: null, known: false, internal: false }
  }
})
