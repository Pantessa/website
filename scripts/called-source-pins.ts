// Pins for squad called-it, lane SOURCE (2026-11-11). This lane owns this file.
//   pure          calledSourcePins(check)                      sync, anywhere
//   offline + DB  calledSourcePinsAsync(check)                 fake fetches; store fences on the TEST DB when DATABASE_URL is set
//   served        calledSourcePinsServed(check, BASE)          the two above + what a built server ships
//   npx tsx scripts/called-source-pins.ts                    (npm run pins:called-source)
//   BASE=http://localhost:PORT npx tsx scripts/called-source-pins.ts
//
// The sample bodies below were RECORDED from real keyless reads on
// 2026-11-11 (cdn.syndication.twimg.com tweet-result and publish.twitter.com
// oembed for post 1585341984679469056; media fields trimmed). The X API
// bodies are HAND-WRITTEN to X's documented v2 shapes: no bearer existed, so
// nothing here was ever answered by api.x.com.
import { readFileSync } from 'node:fs'
import { TWITTER_EPOCH_MS, X_POST_COST_USD, X_USER_COST_USD, GUEST_SCANS_PER_DAY, PROVEN_SCANS_PER_DAY, type PostRead, type XPost } from '../lib/called-it/spec'
import { mapOembed, mapSyndication, readPostByIdWith, safeAvatarUrl, syndicationToken, syndicationUrl } from '../lib/called-it/source/by-id'
import { XApiError, XApiSource, buildSearchQueries, mapXPost, mapXUser, quoteTerm, searchUrl, xTime, X_QUERY_MAX } from '../lib/called-it/source/x-api'
import { failNote } from '../lib/called-it/scan'
import { FixtureSource, FIXTURE_NO_SUCH_HANDLE } from '../lib/called-it/source/fixture'
import { FIXTURE_HANDLE, fixturePosts } from '../lib/called-it/fixture'
import { allowanceFor, isProven, maxScanCostUsd } from '../lib/called-it/budget'

type Check = (name: string, ok: boolean, extra?: string) => void

const ASCII = /^[\x20-\x7e]*$/
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

// ── Recorded keyless bodies (real, 2026-11-11) ──────────────────────────────

export const REAL_ID = '1585341984679469056'
export const REAL_SYNDICATION_BODY = {
  __typename: 'Tweet',
  favorite_count: 1222872,
  lang: 'en',
  possibly_sensitive: false,
  created_at: '2022-10-26T18:45:58.000Z',
  display_text_range: [0, 39],
  id_str: '1585341984679469056',
  text: 'Entering Twitter HQ – let that sink in! https://t.co/D68z4K2wq7',
  user: {
    id_str: '44196397',
    name: 'Elon Musk',
    screen_name: 'elonmusk',
    is_blue_verified: true,
    profile_image_shape: 'Circle',
    verified: false,
    profile_image_url_https: 'https://pbs.twimg.com/profile_images/2103567689515954176/aR-Kjpp4_normal.jpg',
  },
  conversation_count: 58080,
  news_action_type: 'conversation',
  isEdited: false,
  isStaleEdit: false,
}
export const REAL_OEMBED_BODY = {
  url: 'https://x.com/elonmusk/status/1585341984679469056',
  author_name: 'Elon Musk',
  author_url: 'https://x.com/elonmusk',
  html: '<blockquote class="twitter-tweet" data-dnt="true"><p lang="en" dir="ltr">Entering Twitter HQ – let that sink in! <a href="https://t.co/D68z4K2wq7">pic.twitter.com/D68z4K2wq7</a></p>&mdash; Elon Musk (@elonmusk) <a href="https://x.com/elonmusk/status/1585341984679469056?ref_src=twsrc%5Etfw">October 26, 2022</a></blockquote>\n\n',
  width: 550,
  height: null,
  type: 'rich',
  cache_age: '3153600000',
  provider_name: 'X',
  provider_url: 'https://x.com',
  version: '1.0',
}

// ── Hand-written X API v2 bodies (documented shape, never answered by X) ───

const USER_BODY = { data: { id: '44196397', name: 'Elon Musk', username: 'elonmusk', protected: false, verified: true, profile_image_url: 'https://pbs.twimg.com/profile_images/1/a_normal.jpg', public_metrics: { followers_count: 200_000_000, following_count: 1, tweet_count: 2, listed_count: 3 } } }
const PROTECTED_BODY = { data: { id: '9', name: 'Locked', username: 'locked', protected: true, verified: false, public_metrics: { followers_count: 5 } } }
const NOT_FOUND_BODY = { errors: [{ value: 'nobody', detail: 'Could not find user with username: [nobody].', title: 'Not Found Error', parameter: 'username', resource_type: 'user', type: 'https://api.twitter.com/2/problems/resource-not-found' }] }

/** A snowflake id stamped with `ms`, the way X stamps one. */
function idAt(ms: number, seq: number): string {
  return ((BigInt(ms - TWITTER_EPOCH_MS) << BigInt(22)) | BigInt(seq & 0x3fffff)).toString()
}
const NOWISH = Date.UTC(2026, 10, 1, 12)
function apiTweet(daysAgo: number, seq: number, extra: Record<string, unknown> = {}) {
  const ms = NOWISH - daysAgo * 86_400_000
  return { id: idAt(ms, seq), text: `post ${seq} $BTC`, created_at: new Date(ms).toISOString(), author_id: '44196397', lang: 'en', public_metrics: { like_count: seq * 10, reply_count: seq, retweet_count: seq * 2, quote_count: 0 }, edit_history_tweet_ids: [idAt(ms, seq)], ...extra }
}

export function calledSourcePins(check: Check): void {
  // The token formula
  check('called-source token: the README formula on post 20 and on a modern id gives the tokens X\'s embed accepted on 2026-11-11', syndicationToken('20') === '6dq1a2xwd93' && syndicationToken(REAL_ID) === '3uchycv2wqc', `${syndicationToken('20')} ${syndicationToken(REAL_ID)}`)
  check('called-source token: the read URL is the tweet-result endpoint with id and token, nothing else', syndicationUrl(REAL_ID) === 'https://cdn.syndication.twimg.com/tweet-result?id=1585341984679469056&token=3uchycv2wqc')

  // The syndication mapper on the recorded body
  const m = mapSyndication(REAL_ID, REAL_SYNDICATION_BODY)
  check(
    'called-source by-id: the recorded tweet-result maps to X\'s own text (byte for byte), time, likes, replies, the author and X\'s paid check as `blue`',
    m.ok && m.post.text === REAL_SYNDICATION_BODY.text && m.post.postedAt === Date.parse('2022-10-26T18:45:58.000Z') && m.post.likes === 1222872 && m.post.replies === 58080 && m.post.reposts === null && m.post.handle === 'elonmusk' && m.post.source === 'syndication' && !m.post.isReply && m.profile.xUserId === '44196397' && m.profile.blue === true && m.profile.name === 'Elon Musk' && m.profile.avatarUrl === REAL_SYNDICATION_BODY.user.profile_image_url_https,
    JSON.stringify(m),
  )
  // RE-PINNED 2026-11-11 (review R10): `200 {}` is what X answers for a request it refuses (measured: id=20 with no or a wrong token), so it is `unavailable`; only the tombstone (or a 404) is `gone`.
  check('called-source by-id: a tombstone is `gone`; an empty body is `unavailable`', (() => { const a = mapSyndication(REAL_ID, { __typename: 'TweetTombstone' }); const b = mapSyndication(REAL_ID, {}); return !a.ok && a.reason === 'gone' && !b.ok && b.reason === 'unavailable' })())
  check('called-source by-id: a body for another id is refused (unavailable), never mapped onto the id asked for', (() => { const r = mapSyndication('1585341984679469057', REAL_SYNDICATION_BODY); return !r.ok && r.reason === 'unavailable' })())
  check('called-source by-id: a post whose created_at disagrees with its id by more than 2 s is refused', (() => { const r = mapSyndication(REAL_ID, { ...REAL_SYNDICATION_BODY, created_at: '2022-10-26T18:46:30.000Z' }); return !r.ok && r.reason === 'unavailable' })())
  check('called-source by-id: an avatar is kept only from pbs.twimg.com / abs.twimg.com over https', safeAvatarUrl('https://pbs.twimg.com/a.jpg') !== null && safeAvatarUrl('https://abs.twimg.com/b.png') !== null && safeAvatarUrl('https://evil.example/a.jpg') === null && safeAvatarUrl('http://pbs.twimg.com/a.jpg') === null && safeAvatarUrl('https://pbs.twimg.com.evil.example/a.jpg') === null && safeAvatarUrl('javascript:alert(1)') === null && mapSyndication(REAL_ID, { ...REAL_SYNDICATION_BODY, user: { ...REAL_SYNDICATION_BODY.user, profile_image_url_https: 'https://169.254.169.254/x.jpg' } }).ok === true && (mapSyndication(REAL_ID, { ...REAL_SYNDICATION_BODY, user: { ...REAL_SYNDICATION_BODY.user, profile_image_url_https: 'https://169.254.169.254/x.jpg' } }) as Extract<PostRead, { ok: true }>).profile.avatarUrl === null)
  check('called-source by-id: a long post\'s note_tweet text wins over the clipped text', (() => { const r = mapSyndication(REAL_ID, { ...REAL_SYNDICATION_BODY, note_tweet: { note_tweet_results: { result: { text: 'the whole long post' } } } }); return r.ok && r.post.text === 'the whole long post' })())
  check('called-source by-id: a reply to someone else is a reply; a reply to yourself (a thread) is not', (() => { const a = mapSyndication(REAL_ID, { ...REAL_SYNDICATION_BODY, in_reply_to_status_id_str: '1', in_reply_to_screen_name: 'jack' }); const b = mapSyndication(REAL_ID, { ...REAL_SYNDICATION_BODY, in_reply_to_status_id_str: '1', in_reply_to_screen_name: 'ElonMusk' }); return a.ok && a.post.isReply && b.ok && !b.post.isReply })())

  // oEmbed
  const o = mapOembed(REAL_ID, REAL_OEMBED_BODY)
  check('called-source oembed: the recorded body maps to the paragraph\'s words (tags removed, entities decoded), the author from author_url, the time from the id, counts null', o.ok && o.post.text === 'Entering Twitter HQ – let that sink in! pic.twitter.com/D68z4K2wq7' && o.post.handle === 'elonmusk' && o.post.postedAt === Date.parse('2022-10-26T18:45:58.034Z') && o.post.likes === null && o.profile.avatarUrl === null, JSON.stringify(o))
  check('called-source oembed: a body for another post, an author off x.com, or an id with no clock is unavailable', !mapOembed('1585341984679469057', REAL_OEMBED_BODY).ok && !mapOembed(REAL_ID, { ...REAL_OEMBED_BODY, author_url: 'https://evil.example/elonmusk' }).ok && !mapOembed('12345', { ...REAL_OEMBED_BODY, url: 'https://x.com/jack/status/12345' }).ok)
  check('called-source oembed: script in a post stays text (tags are removed, nothing is kept as HTML)', (() => { const r = mapOembed(REAL_ID, { ...REAL_OEMBED_BODY, html: '<blockquote><p>buy &lt;script&gt;x&lt;/script&gt; <img src=x onerror=1>now</p></blockquote>' }); return r.ok && r.post.text === 'buy <script>x</script> now' })())

  // The query builder
  check('called-source query: multi-word terms are quoted, quotes and parentheses inside a term are dropped, duplicates (case aside) go, retweets never', (() => {
    const qs = buildSearchQueries('cz_binance', ['$BTC', '#BTC', 'bitcoin', 'all-time high', 'all time high', '$btc', 'say "hi"', '(x)', '  '])
    return qs.length === 1 && qs[0] === 'from:cz_binance -is:retweet ($BTC OR #BTC OR bitcoin OR "all-time high" OR "all time high" OR "say hi" OR x)'
  })(), JSON.stringify(buildSearchQueries('cz_binance', ['$BTC', '#BTC', 'bitcoin', 'all-time high', 'all time high', '$btc', 'say "hi"', '(x)', '  '])))
  check('called-source query: quoteTerm', quoteTerm('a  b') === '"a b"' && quoteTerm('$ETH') === '$ETH' && quoteTerm('""') === null)
  check('called-source query: no terms = one query for every original post', JSON.stringify(buildSearchQueries('a', [])) === JSON.stringify(['from:a -is:retweet']))
  check('called-source query: a long term list splits into queries each under 1,024 characters, every term in exactly one, each query carries from: and -is:retweet', (() => {
    const terms = Array.from({ length: 200 }, (_, i) => `term number ${i}`)
    const qs = buildSearchQueries('somebody_long1', terms)
    const all = qs.flatMap((q) => [...q.matchAll(/"term number (\d+)"/g)].map((x) => x[1]))
    return qs.length > 1 && qs.every((q) => q.length <= X_QUERY_MAX && q.startsWith('from:somebody_long1 -is:retweet (')) && all.length === 200 && new Set(all).size === 200
  })())
  check('called-source query: a term too long for any query alone is dropped, not sent broken', (() => { const qs = buildSearchQueries('a', ['x'.repeat(2000), 'btc']); return qs.length === 1 && qs[0] === 'from:a -is:retweet (btc)' })())
  check('called-source query: the URL sends start_time without since_id, since_id instead of start_time, end_time at least 15 s back, max_results clamped to 10..500, the documented tweet.fields', (() => {
    const now = Date.UTC(2026, 10, 11, 12)
    const a = new URL(searchUrl({ query: 'q', fromMs: now - 86_400_000, toMs: now, maxResults: 9999, nowMs: now }))
    const b = new URL(searchUrl({ query: 'q', fromMs: 0, toMs: now - 3_600_000, maxResults: 3, sinceId: '123456789', nextToken: 'tok', nowMs: now }))
    return a.origin + a.pathname === 'https://api.x.com/2/tweets/search/all' && a.searchParams.get('start_time') === xTime(now - 86_400_000) && !a.searchParams.has('since_id') && a.searchParams.get('end_time') === xTime(now - 15_000) && a.searchParams.get('max_results') === '500' && (a.searchParams.get('tweet.fields') ?? '').split(',').includes('referenced_tweets') &&
      !b.searchParams.has('start_time') && b.searchParams.get('since_id') === '123456789' && b.searchParams.get('max_results') === '10' && b.searchParams.get('next_token') === 'tok' && b.searchParams.get('end_time') === xTime(now - 3_600_000) && /Z$/.test(xTime(now)) && !/\.\d{3}Z$/.test(xTime(now + 123))
  })())

  // The X API mappers
  check('called-source x-api: a user body maps to the profile; X\'s check is `blue`; a protected account, a not-found body and a body for another username are null', (() => {
    const p = mapXUser('ElonMusk', USER_BODY)
    return !!p && p.handle === 'elonmusk' && p.xUserId === '44196397' && p.followers === 200_000_000 && p.blue === true && p.avatarUrl === 'https://pbs.twimg.com/profile_images/1/a_normal.jpg' && mapXUser('locked', PROTECTED_BODY) === null && mapXUser('nobody', NOT_FOUND_BODY) === null && mapXUser('jack', USER_BODY) === null
  })())
  check('called-source x-api: a search row maps; a retweet, a bad id and a time that disagrees with the id are dropped; a self-reply is not a reply; note_tweet text wins', (() => {
    const t = apiTweet(1, 7)
    const p = mapXPost('elonmusk', t, '44196397')
    const rt = mapXPost('elonmusk', { ...t, referenced_tweets: [{ type: 'retweeted', id: '1' }] }, null)
    const off = mapXPost('elonmusk', { ...t, created_at: new Date(Date.parse(t.created_at) + 60_000).toISOString() }, null)
    const reply = mapXPost('elonmusk', { ...t, referenced_tweets: [{ type: 'replied_to', id: '1' }], in_reply_to_user_id: '12' }, '44196397')
    const self = mapXPost('elonmusk', { ...t, referenced_tweets: [{ type: 'replied_to', id: '1' }], in_reply_to_user_id: '44196397' }, '44196397')
    const long = mapXPost('elonmusk', { ...t, note_tweet: { text: 'long words' } }, null)
    return !!p && p.likes === 70 && p.replies === 7 && p.reposts === 14 && p.source === 'x-api' && !p.isReply && rt === null && off === null && mapXPost('a', { ...t, id: 'abc' }, null) === null && !!reply?.isReply && !!self && !self.isReply && long?.text === 'long words'
  })())

  // The allowance arithmetic
  const base = { scansToday: 0, spentTodayUsd: 0, capUsd: 10, postCap: 400 }
  check('called-source budget: a scan at its cap costs 400 x $0.005 + one user read = $2.01', maxScanCostUsd(400) === 2.01 && maxScanCostUsd(10) === Math.round((10 * X_POST_COST_USD + X_USER_COST_USD) * 1e6) / 1e6)
  check('called-source budget: only x: and w: requesters are proven', isProven('x:123') && isProven('w:0xabc') && !isProven('ip:deadbeef') && !isProven('x:') && !isProven('anything'))
  check(`called-source budget: a guest gets ${GUEST_SCANS_PER_DAY} a day, a proven requester ${PROVEN_SCANS_PER_DAY}; the next one is refused with a reason and somewhere to go`, (() => {
    const g1 = allowanceFor({ ...base, requester: 'ip:aa', scansToday: GUEST_SCANS_PER_DAY - 1 })
    const g2 = allowanceFor({ ...base, requester: 'ip:aa', scansToday: GUEST_SCANS_PER_DAY, handle: 'jack', symbol: 'BTC' })
    const p1 = allowanceFor({ ...base, requester: 'x:1', scansToday: PROVEN_SCANS_PER_DAY - 1 })
    const p2 = allowanceFor({ ...base, requester: 'w:0x1', scansToday: PROVEN_SCANS_PER_DAY })
    return g1.ok && g1.scansLeft === 1 && !g2.ok && g2.over === 'requester' && /Verify with X/.test(g2.reason) && g2.next.some((n) => n.href === '/x') && g2.next.some((n) => n.href === '/t/BTC?x=jack') && p1.ok && !p2.ok && /00:00 UTC/.test(p2.reason) && p2.next.length >= 1
  })())
  check('called-source budget: the house rests scans once what is left today could not pay for one whole scan at its cap (the cap is never crossed)', (() => {
    const fits = allowanceFor({ ...base, requester: 'x:1', spentTodayUsd: 10 - 2.01 })
    const over = allowanceFor({ ...base, requester: 'x:1', spentTodayUsd: 10 - 2.0 })
    const zero = allowanceFor({ ...base, requester: 'x:1', capUsd: 0 })
    return fits.ok && !over.ok && over.over === 'house' && !zero.ok && /\$10\.00/.test(over.reason)
  })())
  check('called-source budget: every refusal is ASCII', [allowanceFor({ ...base, requester: 'ip:a', scansToday: 9 }), allowanceFor({ ...base, requester: 'x:a', scansToday: 99 }), allowanceFor({ ...base, requester: 'x:a', capUsd: 1 })].every((a) => !a.ok && ASCII.test(a.reason) && a.next.every((n) => ASCII.test(n.label))))

  // Source wiring (read the source: env decides, fixture never on production)
  const idx = read('lib/called-it/source/index.ts')
  // RE-PINNED 2026-11-11 (review R6): fake mode is the one fence spec fakeModeOn (off on every Vercel deployment), no longer a local env test.
  check('called-source wiring: sourceFor = fixture under XCALLS_FAKE=1 only where the fixture is served, X API only with a bearer, else null; scansAvailable mirrors it', /return fakeModeOn\(\) && fixtureServed\(\)/.test(idx) && /if \(fakeOn\(\)\) return new FixtureSource\(\)/.test(idx) && /return b \? new XApiSource\(\{ bearer: b \}\) : null/.test(idx) && /return fakeOn\(\) \|\| bearer\(\) !== null/.test(idx))
  const xapi = read('lib/called-it/source/x-api.ts')
  check('called-source x-api: the bearer appears in exactly one place (the authorization header) and no console call exists in the source', (xapi.match(/#bearer\b/g) ?? []).length === 3 && /authorization: `Bearer \$\{this\.#bearer\}`/.test(xapi) && !/console\./.test(xapi) && !/console\./.test(read('lib/called-it/source/by-id.ts')))
}

// ── Offline (fake fetch) and the TEST DB ─────────────────────────────────

type FakeRes = { status: number; body?: unknown; headers?: Record<string, string>; throws?: boolean }
function fakeFetch(answer: (url: string, init?: RequestInit) => FakeRes, log: { url: string; auth: string | null }[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const auth = (init?.headers as Record<string, string> | undefined)?.authorization ?? null
    log.push({ url, auth })
    const a = answer(url, init)
    if (a.throws) throw new Error(`network down at ${url} with ${auth}`)
    return new Response(a.body === undefined ? null : JSON.stringify(a.body), { status: a.status, headers: { 'content-type': 'application/json', ...(a.headers ?? {}) } })
  }) as typeof fetch
}

const SECRET = 'AAAAAAAAAAAAAAAAAAAAAPINSECRETBEARER%3Dnever-in-an-error'

async function offlinePins(check: Check): Promise<void> {
  // readPostByIdWith over fake fetches
  {
    const r404 = await readPostByIdWith(REAL_ID, { fetch: fakeFetch(() => ({ status: 404 })) })
    check('called-source by-id (fake fetch): a 404 from the embed endpoint is `gone`', !r404.ok && r404.reason === 'gone')
    const log: { url: string; auth: string | null }[] = []
    const fb = await readPostByIdWith(REAL_ID, { fetch: fakeFetch((u) => (u.includes('syndication') ? { status: 0, throws: true } : { status: 200, body: REAL_OEMBED_BODY }), log) })
    check('called-source by-id (fake fetch): when the embed endpoint fails, oEmbed answers text and author with the id\'s time and null likes; no key is sent to either', fb.ok && fb.post.likes === null && fb.post.postedAt === Date.parse('2022-10-26T18:45:58.034Z') && log.length === 2 && log.every((l) => l.auth === null) && log[1].url.startsWith('https://publish.twitter.com/oembed?'))
    const down = await readPostByIdWith(REAL_ID, { fetch: fakeFetch(() => ({ status: 503 })) })
    check('called-source by-id (fake fetch): both endpoints down is `unavailable`, never `gone`', !down.ok && down.reason === 'unavailable')
    // AbortSignal.timeout's timer is unref'd: hold the loop open while the fake hangs
    const hold = setTimeout(() => {}, 2000)
    const slow = await readPostByIdWith(REAL_ID, { timeoutMs: 50, fetch: (async (_u: RequestInfo | URL, init?: RequestInit) => new Promise((_res, rej) => init?.signal?.addEventListener('abort', () => rej(new Error('aborted'))))) as typeof fetch })
    clearTimeout(hold)
    check('called-source by-id (fake fetch): a read that outlives its timeout is `unavailable`', !slow.ok && slow.reason === 'unavailable')
    const bad = await readPostByIdWith('../etc', { fetch: fakeFetch(() => ({ status: 200, body: REAL_SYNDICATION_BODY })) })
    check('called-source by-id: a non-id never leaves the server', !bad.ok && bad.reason === 'unavailable')
  }

  // XApiSource over fake fetches
  {
    const log: { url: string; auth: string | null }[] = []
    const pages = [
      { data: [apiTweet(1, 1), apiTweet(2, 2), apiTweet(3, 3, { referenced_tweets: [{ type: 'retweeted', id: '9' }] })], meta: { result_count: 3, next_token: 'p2' } },
      { data: [apiTweet(4, 4), apiTweet(5, 5)], meta: { result_count: 2 } },
    ]
    let page = 0
    const src = new XApiSource({ bearer: SECRET, pageGapMs: 0, now: () => NOWISH, fetch: fakeFetch((u) => (u.includes('/users/by/username/') ? { status: 200, body: USER_BODY } : { status: 200, body: pages[page++] }), log) })
    const prof = await src.profile('elonmusk')
    const res = await src.search({ handle: 'elonmusk', terms: ['$BTC', 'bitcoin'], fromMs: NOWISH - 30 * 86_400_000, toMs: NOWISH, cap: 400 })
    check('called-source x-api (fake fetch): pages follow next_token, a retweet is dropped, posts come newest first, every read is billed and the profile read rides the first search', !!prof && res.posts.length === 4 && res.readCount === 5 && res.posts[0].postedAt > res.posts[3].postedAt && Math.abs(res.costUsd - (5 * X_POST_COST_USD + X_USER_COST_USD)) < 1e-9 && !res.truncated && new URL(log[2].url).searchParams.get('next_token') === 'p2' && log.every((l) => l.auth === `Bearer ${SECRET}`), JSON.stringify({ n: res.posts.length, rc: res.readCount, cost: res.costUsd }))
  }
  {
    // the cap: never ask for more than is left, never ask below X's minimum page
    const asked: number[] = []
    const src = new XApiSource({ bearer: SECRET, pageGapMs: 0, now: () => NOWISH, fetch: fakeFetch((u) => { const n = Number(new URL(u).searchParams.get('max_results')); asked.push(n); return { status: 200, body: { data: Array.from({ length: n }, (_, i) => apiTweet(1 + (asked.length * 50 + i) / 100, asked.length * 1000 + i)), meta: { next_token: 'more' } } } }) })
    const res = await src.search({ handle: 'elonmusk', terms: ['$BTC'], fromMs: NOWISH - 365 * 86_400_000, toMs: NOWISH, cap: 25 })
    check('called-source x-api (fake fetch): a cap of 25 asks for 25, then nothing (a page under 10 is never asked for), marks the read truncated, and reads at most the cap', JSON.stringify(asked) === '[25]' && res.readCount === 25 && res.truncated, JSON.stringify(asked))
  }
  {
    // 429: stop, never retry; nothing read = a rate-limited error with the reset time
    let calls = 0
    const src = new XApiSource({ bearer: SECRET, pageGapMs: 0, now: () => NOWISH, fetch: fakeFetch(() => { calls++; return { status: 429, headers: { 'x-rate-limit-reset': String(NOWISH / 1000 + 900) }, body: { title: 'Too Many Requests', detail: `token ${SECRET}` } } }) })
    let err: unknown = null
    try {
      await src.search({ handle: 'elonmusk', terms: ['$BTC'], fromMs: 0, toMs: NOWISH, cap: 400 })
    } catch (e) {
      err = e
    }
    check('called-source x-api (fake fetch): a 429 with nothing read throws rate-limited carrying X\'s reset time, after exactly one request', err instanceof XApiError && err.kind === 'rate-limited' && err.resetAt === NOWISH + 900_000 && calls === 1)
    let page = 0
    const src2 = new XApiSource({ bearer: SECRET, pageGapMs: 0, now: () => NOWISH, fetch: fakeFetch(() => (page++ === 0 ? { status: 200, body: { data: [apiTweet(1, 1)], meta: { next_token: 'n' } } } : { status: 429 })) })
    const part = await src2.search({ handle: 'elonmusk', terms: ['$BTC'], fromMs: 0, toMs: NOWISH, cap: 400 })
    check('called-source x-api (fake fetch): a 429 after a page keeps what was read (billed) and stops truncated, no retry', part.posts.length === 1 && part.truncated && page === 2)
  }
  {
    // 402 "credits depleted" (X's real answer on 2026-11-11 with a valid key and no credits): named, one request, no retry
    {
      let n = 0
      const broke = new XApiSource({ bearer: SECRET, pageGapMs: 0, now: () => NOWISH, fetch: fakeFetch(() => { n++; return { status: 402, body: { detail: 'credits depleted', status: 402, title: 'Payment Required', type: 'https://api.x.com/2/problems/credits-depleted' } } }) })
      let e: unknown = null
      try {
        await broke.search({ handle: 'elonmusk', terms: ['$BTC'], fromMs: 0, toMs: NOWISH, cap: 400 })
      } catch (err) {
        e = err
      }
      check("called-source x-api (fake fetch): X's 402 \"credits depleted\" is its own kind (no-credits), after exactly one request, and the scan words it as spent credits, not as X being down", e instanceof XApiError && e.kind === 'no-credits' && e.status === 402 && n === 1 && /credits/.test(failNote(e)) && !/did not answer/.test(failNote(e)) && failNote(new XApiError('unavailable', 'X did not answer (HTTP 500).', 500)) === 'Stopped: the scan hit an error before it finished.', e instanceof Error ? `${(e as XApiError).kind} · ${failNote(e)}` : 'no throw')
    }

    // the bearer is never in an error, whatever X or the network says
    const errs: string[] = []
    for (const a of [{ status: 401, body: { detail: `bad token ${SECRET}` } }, { status: 403, body: { detail: SECRET } }, { status: 500, body: SECRET }, { status: 400, body: { errors: [{ message: SECRET }] } }, { status: 0, throws: true }, { status: 429, body: SECRET }] as FakeRes[]) {
      const src = new XApiSource({ bearer: SECRET, pageGapMs: 0, now: () => NOWISH, fetch: fakeFetch(() => a) })
      for (const run of [() => src.profile('elonmusk'), () => src.search({ handle: 'elonmusk', terms: ['$BTC'], fromMs: 0, toMs: NOWISH, cap: 400 })]) {
        try {
          await run()
          errs.push('no throw')
        } catch (e) {
          errs.push(`${String(e)}|${(e as Error).stack ?? ''}|${JSON.stringify(e)}|${e instanceof XApiError ? e.kind : 'not-XApiError'}`)
        }
      }
    }
    check('called-source x-api: the bearer is never in an error (401, 403, 500, 400, a network throw that names it, a 429 echoing it), and every failure is an XApiError', errs.length === 12 && errs.every((e) => !e.includes(SECRET) && !e.includes('PINSECRET') && !e.includes('not-XApiError') && e !== 'no throw'), errs.find((e) => e.includes('PINSECRET') || e.includes('not-XApiError') || e === 'no throw'))
  }
  {
    const miss = new XApiSource({ bearer: SECRET, now: () => NOWISH, fetch: fakeFetch((u) => (u.includes('locked') ? { status: 200, body: PROTECTED_BODY } : u.includes('ghost') ? { status: 404, body: NOT_FOUND_BODY } : { status: 200, body: NOT_FOUND_BODY })) })
    const a = await miss.profile('locked')
    const aw = miss.lastProfileMiss
    const b = await miss.profile('ghost')
    const bw = miss.lastProfileMiss
    const c = await miss.profile('nobody')
    check('called-source x-api (fake fetch): a protected account, a 404 and a not-found body are null profiles (a miss is never a throw), and lastProfileMiss says which', a === null && aw === 'protected' && b === null && bw === 'unknown' && c === null && miss.lastProfileMiss === 'unknown')
  }

  // The fixture source
  {
    const now = Date.now()
    const fx = new FixtureSource({ now: () => now })
    const all = await fx.search({ handle: FIXTURE_HANDLE, terms: [], fromMs: now - 400 * 86_400_000, toMs: now, cap: 400 })
    const posts = fixturePosts(now)
    const stripped = all.posts.every((p) => !('label' in p) && !('origin' in p))
    const since = await fx.search({ handle: FIXTURE_HANDLE, terms: [], fromMs: 0, toMs: now, cap: 400, sinceId: posts[7].id })
    const capped = await fx.search({ handle: FIXTURE_HANDLE, terms: [], fromMs: 0, toMs: now, cap: 4 })
    const other = await fx.search({ handle: 'jack', terms: [], fromMs: 0, toMs: now, cap: 400 })
    check('called-source fixture: the fixture handle answers its posts newest first with labels stripped, sinceId and cap honored, cost $0; any other handle answers nothing', all.posts.length === posts.length && stripped && all.posts[0].postedAt > all.posts[1].postedAt && all.costUsd === 0 && since.posts.length === 3 && capped.posts.length === 4 && capped.truncated && other.posts.length === 0 && other.readCount === 0)
    check('called-source fixture: profiles: the fixture desk, null for pantessa_nobody, a bare profile for anyone else (never their real name or avatar)', (await fx.profile(FIXTURE_HANDLE))?.name === 'Fixture Desk' && (await fx.profile(FIXTURE_NO_SUCH_HANDLE)) === null && JSON.stringify(await fx.profile('Jack')) === JSON.stringify({ handle: 'jack', name: 'jack', avatarUrl: null, followers: null, blue: false, xUserId: null }))
  }

  // sourceFor / scansAvailable under each env
  {
    const mod = await import('../lib/called-it/source/index')
    const saved = { fake: process.env.XCALLS_FAKE, bearer: process.env.X_BEARER_TOKEN, vercel: process.env.VERCEL_ENV }
    const set = (k: string, v: string | undefined) => (v === undefined ? delete process.env[k] : (process.env[k] = v))
    try {
      set('XCALLS_FAKE', undefined); set('X_BEARER_TOKEN', undefined); set('VERCEL_ENV', undefined)
      const none = mod.sourceFor() === null && !mod.scansAvailable()
      set('XCALLS_FAKE', '1')
      const fake = mod.sourceFor()?.name === 'fixture' && mod.scansAvailable()
      set('VERCEL_ENV', 'production')
      const prodFake = mod.sourceFor() === null && !mod.scansAvailable()
      set('X_BEARER_TOKEN', SECRET)
      const prodX = mod.sourceFor()?.name === 'x-api' && mod.scansAvailable() && !JSON.stringify(mod.sourceFor()).includes('PINSECRET')
      check('called-source wiring (live env): no env = no source; XCALLS_FAKE=1 = the fixture; XCALLS_FAKE=1 on production = nothing; a bearer = the X API, and the source object does not serialize its bearer', none && fake && prodFake && prodX)
    } finally {
      set('XCALLS_FAKE', saved.fake); set('X_BEARER_TOKEN', saved.bearer); set('VERCEL_ENV', saved.vercel)
    }
  }
}

async function dbPins(check: Check): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.log('ℹ️  called-source store pins skipped: DATABASE_URL is not set (run with the TEST DB inline)')
    return
  }
  const { default: prisma } = await import('../lib/db')
  const store = await import('../lib/called-it/store')
  const { refreshGone } = await import('../lib/called-it/source/refresh')
  const { scanAllowance } = await import('../lib/called-it/budget')
  const tag = Math.random().toString(36).slice(2, 8).padEnd(6, '0')
  const H = `zz_pin_${tag}`
  const H2 = `zz_pin_${tag}x`
  const SYM = 'ZZPIN'
  const now = Date.now()
  const seq = Math.floor(Math.random() * 0x3ff000)
  const post = (daysAgo: number, i: number, source: XPost['source'] = 'fixture', text = `pin post ${i}`): XPost => {
    const ms = now - daysAgo * 86_400_000
    return { id: idAt(ms, seq + i), handle: H, text, postedAt: Math.floor(ms / 1000) * 1000, likes: i, replies: 1, reposts: 2, isReply: false, source }
  }
  const posts = [post(10, 1), post(8, 2), post(6, 3), post(4, 4, 'syndication')]
  const ids = posts.map((p) => p.id)
  try {
    // handles and the claim
    await store.saveProfile({ handle: H.toUpperCase(), name: 'Pin Desk', avatarUrl: null, followers: 3, blue: true, xUserId: '777', isProtected: false })
    const h1 = await store.getHandle(H)
    await store.claimHandle(H, '777', { name: 'Pin Desk 2' })
    const h2 = await store.getHandle(H)
    await store.saveProfile({ handle: H, name: 'Pin Desk 3', avatarUrl: null, followers: 4, blue: false, xUserId: '777' })
    const h3 = await store.getHandle(H)
    await store.claimHandle(H, '777')
    const h4 = await store.getHandle(H)
    check('called-source store: a profile saves under the lowercase handle; a claim sets it; a later profile save never clears it; the same user claiming again keeps the first claim\'s time', h1?.handle === H && h1.blue && h1.claimedXUserId === null && h2?.claimedXUserId === '777' && h2.name === 'Pin Desk 2' && h3?.claimedXUserId === '777' && h3.name === 'Pin Desk 3' && h4?.claimedAt === h2.claimedAt)
    await store.claimHandle(H, '888')
    const taken = await store.getHandle(H)
    await store.claimHandle(H2, '888')
    const left = await store.getHandle(H)
    check('called-source store: a claim by a different user overwrites (handles change hands); the same user claiming a new name drops the old name\'s claim', taken?.claimedXUserId === '888' && left?.claimedXUserId === null && (await store.getHandle(H2))?.claimedXUserId === '888')

    // posts, gone, labels
    await store.savePosts(posts)
    const listed = await store.postsFor(H, now - 30 * 86_400_000)
    check('called-source store: posts save and read back date ascending, as stored', listed.length === 4 && listed.map((p) => p.id).join() === ids.join() && listed[0].text === 'pin post 1' && listed[0].source === 'fixture')
    check('called-source store: the newest SCANNED post is the incremental mark; a pasted (syndication) post never is', (await store.newestPostId(H)) === ids[2])
    await store.saveLabels([
      { postId: ids[0], symbol: SYM.toLowerCase(), stance: 'bull', conviction: 3, quote: 'pin post', model: 'pin', origin: 'scan' },
      { postId: ids[1], symbol: SYM, stance: 'none', conviction: 2 as 0, quote: 'ignored', model: 'pin', origin: 'scan' },
      { postId: ids[2], symbol: SYM, stance: 'bear', conviction: 1, quote: 'pin post', model: 'pin', origin: 'added' },
    ])
    const labels = await store.labelsFor(H, SYM.toLowerCase())
    const none = labels.find((l) => l.postId === ids[1])
    check('called-source store: labels save per post and symbol (uppercase), `none` is kept with conviction 0 and no quote', labels.length === 3 && labels.every((l) => l.symbol === SYM) && none?.stance === 'none' && none.conviction === 0 && none.quote === null && labels.find((l) => l.postId === ids[2])?.origin === 'added')
    await store.markGone([ids[0]])
    await store.savePosts([{ ...posts[0], likes: 999, text: 'edited' }])
    const afterGone = await store.postsFor(H, 0)
    const labelsAfter = await store.labelsFor(H, SYM)
    const row = await prisma.xPost.findUnique({ where: { postId: ids[0] } })
    check('called-source store: a gone post never comes back: not in postsFor, not in labelsFor, and saving it again does not clear goneAt', afterGone.length === 3 && !afterGone.some((p) => p.id === ids[0]) && !labelsAfter.some((l) => l.postId === ids[0]) && !!row?.goneAt && row.likes === 999)
    await store.savePosts([{ ...posts[1], source: 'syndication', text: 'oembed rebuild', likes: null }])
    const kept = await prisma.xPost.findUnique({ where: { postId: ids[1] } })
    check('called-source store: a keyless refresh never changes a scanned post\'s source or words, and a null count never erases a known one', kept?.source === 'fixture' && kept.text === 'pin post 2' && kept.likes === 2)

    // scans
    const win = { windowFrom: now - 365 * 86_400_000, windowTo: now }
    const reqr = `ip:zzpin${tag}`
    const a = await store.startScan({ handle: H, symbol: SYM.toLowerCase(), provider: 'fixture', requestedBy: reqr, isInternal: true, ...win })
    const b = await store.startScan({ handle: H.toUpperCase(), symbol: SYM, provider: 'fixture', requestedBy: 'ip:someoneelse', isInternal: true, ...win })
    check('called-source store: a second ask for the same handle and symbol joins the running scan', !a.joined && b.joined && a.scan.id === b.scan.id && a.scan.status === 'running' && a.scan.symbol === SYM)
    const [ja, jb] = await Promise.all([
      store.startScan({ handle: H2, symbol: SYM, provider: 'fixture', requestedBy: reqr, isInternal: true, ...win }),
      store.startScan({ handle: H2, symbol: SYM, provider: 'fixture', requestedBy: reqr, isInternal: true, ...win }),
    ])
    check('called-source store: two asks at the same instant still share one scan (the advisory lock)', ja.scan.id === jb.scan.id && ja.joined !== jb.joined)
    const before = await store.spentTodayUsd(now)
    await store.updateScan(a.scan.id, { status: 'done', postsRead: 4, callsFound: 2, costUsd: 0.25, note: 'Found 2 calls', finished: true })
    const done = await store.getScan(a.scan.id)
    const latest = await store.latestScan(H, SYM)
    const after = await store.spentTodayUsd(now)
    check('called-source store: a scan finishes with its counts, cost and note; latestScan and getScan read it; spentTodayUsd counts its dollars', done?.status === 'done' && done.finishedAt !== null && done.costUsd === 0.25 && latest?.id === a.scan.id && after - before >= 0.25 - 1e-9 && (await store.getScan('not-an-id')) === null)
    check('called-source store: an internal scan never lists, even finished with calls', !(await store.listPlotted({ limit: 50, handle: H })).length && !(await store.listPlotted({ limit: 200 })).some((r) => r.handle === H))

    // a stale running row is finished, not joined
    const staleId = `xs_zzpin${tag}stale`
    await prisma.xScan.create({ data: { id: staleId, handle: H, symbol: 'ZZOLD', status: 'running', isInternal: true, requestedBy: reqr, startedAt: new Date(now - 5 * 60_000) } })
    const fresh = await store.startScan({ handle: H, symbol: 'ZZOLD', provider: 'fixture', requestedBy: reqr, isInternal: true, ...win })
    const stale = await store.getScan(staleId)
    check('called-source store: a running scan older than two minutes is finished as failed and a new one opens', !fresh.joined && fresh.scan.id !== staleId && stale?.status === 'failed' && stale.finishedAt !== null)
    await store.updateScan(fresh.scan.id, { status: 'done', finished: true })
    await store.updateScan(ja.scan.id, { status: 'refused', finished: true })

    // the requester's count (the stale row above failed with nothing read: the house's failure, not the visitor's scan)
    await prisma.xScan.create({ data: { id: `xs_zzpin${tag}half`, handle: H, symbol: 'ZZHALF', status: 'failed', postsRead: 5, isInternal: true, requestedBy: reqr, startedAt: new Date(now - 60_000), finishedAt: new Date(now) } })
    const count = await store.scansToday(reqr, now)
    const savedFake = process.env.XCALLS_FAKE
    process.env.XCALLS_FAKE = '1'
    const countFake = await store.scansToday(reqr, now)
    const allowFake = await scanAllowance(reqr, now)
    if (savedFake === undefined) delete process.env.XCALLS_FAKE
    else process.env.XCALLS_FAKE = savedFake
    check('called-source store: scansToday counts the requester\'s scans that ran (done, running, or failed AFTER reading posts), never a joined or refused one and never one that failed before it read a post (X down or the credits spent is not the visitor\'s scan); under XCALLS_FAKE internal runs do not count, so the harness can scan run after run', count === 3 && countFake === 0 && (allowFake.ok || (allowFake as { over: string }).over === 'house'), `count=${count} fake=${countFake}`)

    // refreshGone
    await prisma.xPost.updateMany({ where: { postId: { in: [ids[1], ids[2]] } }, data: { readAt: new Date(now - 2 * 86_400_000) } })
    const asked: string[] = []
    const r = await refreshGone([ids[0], ids[1], ids[2], ids[3]], {
      nowMs: now,
      read: async (id) => {
        asked.push(id)
        return id === ids[1] ? { ok: false, reason: 'gone' } : { ok: true, post: { ...posts[2], likes: 4242, source: 'syndication' }, profile: { handle: H, name: 'x', avatarUrl: null, followers: null, blue: false, xUserId: null } }
      },
    })
    const p2 = await prisma.xPost.findUnique({ where: { postId: ids[1] } })
    const p3 = await prisma.xPost.findUnique({ where: { postId: ids[2] } })
    check('called-source refreshGone: only shown posts read more than 24 h ago are re-read (a gone one and a fresh one are not); a gone answer marks it, a good one refreshes its counts and read time', r.checked === 2 && asked.sort().join() === [ids[1], ids[2]].sort().join() && r.gone.join() === ids[1] && !!p2?.goneAt && p3?.likes === 4242 && (p3?.readAt.getTime() ?? 0) > now - 60_000 && !(await store.postsFor(H, 0)).some((p) => p.id === ids[1]))
  } finally {
    await prisma.xCall.deleteMany({ where: { postId: { in: ids } } })
    await prisma.xPost.deleteMany({ where: { postId: { in: ids } } })
    await prisma.xScan.deleteMany({ where: { handle: { in: [H, H2] } } })
    await prisma.xHandle.deleteMany({ where: { handle: { in: [H, H2] } } })
    const leftover = (await prisma.xPost.count({ where: { handle: H } })) + (await prisma.xScan.count({ where: { handle: { in: [H, H2] } } })) + (await prisma.xHandle.count({ where: { handle: { in: [H, H2] } } }))
    check('called-source store: the pins remove every row they made', leftover === 0)
    await prisma.$disconnect()
  }
}

export async function calledSourcePinsAsync(check: Check): Promise<void> {
  await offlinePins(check)
  await dbPins(check)
}

export async function calledSourcePinsServed(check: Check, BASE: string): Promise<void> {
  await calledSourcePinsAsync(check)
  // What a built server ships to a browser never carries the X key's name or the API's search path.
  try {
    const html = await (await fetch(`${BASE}/t/BTC`)).text()
    const srcs = [...new Set([...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]))]
    const bodies = await Promise.all(srcs.map(async (s) => (await fetch(`${BASE}${s}`)).text().catch(() => '')))
    const leak = srcs.filter((_, i) => /X_BEARER_TOKEN|tweets\/search\/all|cdn\.syndication\.twimg\.com/.test(bodies[i]))
    check('called-source (served): no script /t/BTC ships names the X bearer, the search endpoint or the keyless read (the sources stay on the server)', srcs.length > 3 && leak.length === 0, leak.join(' ') || `scripts=${srcs.length}`)
  } catch (e) {
    check('called-source (served): /t/BTC answered', false, String(e))
  }
}

if (process.argv[1]?.endsWith('called-source-pins.ts')) {
  ;(async () => {
    let failed = 0
    let n = 0
    const check: Check = (name, ok, extra) => {
      n++
      console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
      if (!ok) failed++
    }
    calledSourcePins(check)
    if (process.env.BASE) await calledSourcePinsServed(check, process.env.BASE)
    else await calledSourcePinsAsync(check)
    console.log(failed ? `\n${failed} of ${n} called-it source pins failed` : `\nall ${n} called-it source pins green${process.env.BASE ? '' : ' (no server: pure, fake-fetch and store halves)'}`)
    process.exit(failed ? 1 : 0)
  })()
}
