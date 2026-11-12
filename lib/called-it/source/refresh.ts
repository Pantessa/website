// Honesty rule 6: a post X no longer serves is never shown again. A record
// read hands its post ids here (JUDGE calls it from after()); the stalest few
// are re-read by id, keyless, and a `gone` answer marks them. A post that
// reads fine gets its counts refreshed. `unavailable` changes nothing.
import { postsReadBefore, markGone, savePosts } from '../store'
import type { PostRead } from '../spec'
import { readPostByIdWith } from './by-id'

export const REFRESH_MAX = 8
/** One pass marks nothing when this many or more read gone AND they are more than half of it (review R10): that is the endpoint changing, not deletions. */
export const GONE_SPIKE_MIN = 2
export const REFRESH_AFTER_MS = 24 * 60 * 60 * 1000

export async function refreshGone(
  postIds: readonly string[],
  opts: { nowMs?: number; read?: (id: string) => Promise<PostRead> } = {},
): Promise<{ checked: number; gone: string[]; refreshed: number; refusedSpike?: number }> {
  const nowMs = opts.nowMs ?? Date.now()
  const read = opts.read ?? ((id: string) => readPostByIdWith(id))
  const ids = await postsReadBefore(postIds, nowMs - REFRESH_AFTER_MS, REFRESH_MAX)
  const gone: string[] = []
  let refreshed = 0
  const answers = await Promise.all(ids.map(async (id) => ({ id, r: await read(id).catch((): PostRead => ({ ok: false, reason: 'unavailable' })) })))
  const fresh = []
  for (const { id, r } of answers) {
    if (r.ok) fresh.push(r.post)
    else if (r.reason === 'gone') gone.push(id)
  }
  // Gone is forever: a pass where most posts suddenly read gone marks nothing (review R10), and says so in the log.
  const spike = gone.length >= GONE_SPIKE_MIN && gone.length * 2 > ids.length
  if (spike) console.warn(`[called-it] refreshGone: ${gone.length} of ${ids.length} posts read gone in one pass; marking none (the endpoint, not deletions)`)
  else if (gone.length) await markGone(gone)
  if (fresh.length) {
    await savePosts(fresh)
    refreshed = fresh.length
  }
  return { checked: ids.length, gone: spike ? [] : gone, refreshed, ...(spike ? { refusedSpike: gone.length } : {}) }
}
