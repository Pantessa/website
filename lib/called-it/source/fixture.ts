// The fixture as a scan source (squad called-it, lane SOURCE): the harness and
// the UI lanes scan without X. It serves the fixture's posts for the fixture
// handle, with their labels STRIPPED (labeling is JUDGE's step, the same one
// a real scan takes), and an empty result for every other handle.
//
// Profiles: the fixture handle answers FIXTURE_PROFILE; `pantessa_nobody`
// answers null (the "no such account" path); any other handle answers a bare
// profile named after the handle, so the "scanned, no calls found" path can
// be exercised. Served only where fixtureServed() is true (never production).
import { FIXTURE_HANDLE, FIXTURE_PROFILE, fixturePosts } from '../fixture'
import type { XPost, XProfile, XSearchQuery, XSearchResult, XSource } from '../spec'

/** A handle the fixture source treats as an account that does not exist. */
export const FIXTURE_NO_SUCH_HANDLE = 'pantessa_nobody'

export class FixtureSource implements XSource {
  readonly name = 'fixture' as const
  readonly #now: () => number
  constructor(opts: { now?: () => number } = {}) {
    this.#now = opts.now ?? Date.now
  }

  async profile(handle: string): Promise<XProfile | null> {
    const h = handle.toLowerCase()
    if (h === FIXTURE_HANDLE) return { ...FIXTURE_PROFILE }
    if (h === FIXTURE_NO_SUCH_HANDLE) return null
    return { handle: h, name: h, avatarUrl: null, followers: null, blue: false, xUserId: null }
  }

  async search(q: XSearchQuery): Promise<XSearchResult> {
    if (q.handle.toLowerCase() !== FIXTURE_HANDLE) return { posts: [], readCount: 0, costUsd: 0, truncated: false }
    const since = q.sinceId ? BigInt(q.sinceId) : null
    const all: XPost[] = fixturePosts(this.#now())
      .map(({ label: _label, origin: _origin, ...post }) => post)
      .filter((p) => p.postedAt >= q.fromMs && p.postedAt <= q.toMs && (since === null || BigInt(p.id) > since))
      .sort((a, b) => b.postedAt - a.postedAt)
    const cap = Math.max(0, Math.floor(q.cap))
    const posts = all.slice(0, cap)
    return { posts, readCount: posts.length, costUsd: 0, truncated: all.length > posts.length }
  }
}
