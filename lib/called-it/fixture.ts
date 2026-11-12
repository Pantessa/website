// The squad's fixture: an account that does not exist, with posts that were
// never posted, so every lane (and the harness) has a record to draw before
// a single real post is read. Times are relative to today, so the fixture's
// pins always sit inside the daily chart's window and are judged on REAL
// candles for whatever symbol is asked.
//
// Never served on production (app/api/x/record gates it), never linked to X
// (its ids are shaped like post ids but name no post: CalledCall.url is null).
import { TWITTER_EPOCH_MS, type LabeledPost, type XProfile } from './spec'

export const FIXTURE_HANDLE = 'pantessa_test'

export const FIXTURE_PROFILE: XProfile = { handle: FIXTURE_HANDLE, name: 'Fixture Desk', avatarUrl: null, followers: 48_200, blue: false, xUserId: null }

/** The fixture is a development instrument: local servers and previews serve it, production never does. */
export function fixtureServed(): boolean {
  return process.env.VERCEL_ENV !== 'production'
}

const DAY_MS = 86_400_000

interface Row {
  daysAgo: number
  hourUtc: number
  text: string
  stance: 'bull' | 'bear' | 'none'
  conviction: 0 | 1 | 2 | 3
  quote: string | null
  likes: number
}

const ROWS: Row[] = [
  { daysAgo: 340, hourUtc: 14, text: 'Loading up here. This is the bottom, mark this post.', stance: 'bull', conviction: 3, quote: 'This is the bottom', likes: 4200 },
  { daysAgo: 300, hourUtc: 9, text: 'This rally is a trap. Shorting into it.', stance: 'bear', conviction: 2, quote: 'Shorting into it', likes: 1800 },
  { daysAgo: 255, hourUtc: 21, text: 'Higher from here. Dips are for buying.', stance: 'bull', conviction: 2, quote: 'Higher from here', likes: 950 },
  { daysAgo: 210, hourUtc: 16, text: 'New all-time high within a month. Calling it now.', stance: 'bull', conviction: 3, quote: 'New all-time high within a month', likes: 12_000 },
  { daysAgo: 170, hourUtc: 7, text: 'gm. Shipping all week.', stance: 'none', conviction: 0, quote: null, likes: 320 },
  { daysAgo: 150, hourUtc: 18, text: 'Top is in. I sold everything today.', stance: 'bear', conviction: 3, quote: 'Top is in', likes: 7600 },
  { daysAgo: 110, hourUtc: 12, text: 'Feels like accumulation to me.', stance: 'bull', conviction: 2, quote: 'Feels like accumulation', likes: 300 },
  { daysAgo: 75, hourUtc: 15, text: 'One more leg down before anything good happens.', stance: 'bear', conviction: 2, quote: 'One more leg down', likes: 2100 },
  { daysAgo: 40, hourUtc: 20, text: 'Sending. Do not fade this.', stance: 'bull', conviction: 3, quote: 'Do not fade this', likes: 5400 },
  { daysAgo: 12, hourUtc: 13, text: 'Buying this dip with size.', stance: 'bull', conviction: 2, quote: 'Buying this dip', likes: 800 },
  { daysAgo: 3, hourUtc: 10, text: 'Careful here. Looks heavy.', stance: 'bear', conviction: 2, quote: 'Looks heavy', likes: 150 },
]

/** An id with the post's time stamped into it, the way X stamps a real one. */
function idAt(ms: number, seq: number): string {
  return ((BigInt(ms - TWITTER_EPOCH_MS) << BigInt(22)) | BigInt(seq)).toString()
}

/** The fixture's posts as of `nowMs`. Stable within a UTC day. */
export function fixturePosts(nowMs: number): LabeledPost[] {
  const today = Math.floor(nowMs / DAY_MS) * DAY_MS
  return ROWS.map((r, i) => {
    const postedAt = today - r.daysAgo * DAY_MS + r.hourUtc * 3_600_000
    return {
      id: idAt(postedAt, i + 1),
      handle: FIXTURE_HANDLE,
      text: r.text,
      postedAt,
      likes: r.likes,
      replies: Math.round(r.likes / 14),
      reposts: Math.round(r.likes / 6),
      isReply: false,
      source: 'fixture' as const,
      label: { stance: r.stance, conviction: r.conviction, quote: r.quote },
      origin: 'scan' as const,
    }
  })
}
