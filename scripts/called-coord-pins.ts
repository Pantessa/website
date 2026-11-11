// Pins for squad called-it, the CONTRACT (2026-11-11): the pure rules in
// lib/called-it/spec that every lane builds on, the fixture, and the DDL.
// Wired into test-api.
//   npx tsx scripts/called-coord-pins.ts                 (npm run pins:called-coord)
//   BASE=http://localhost:PORT npx tsx scripts/called-coord-pins.ts
import { readFileSync } from 'node:fs'
import type { Candle } from '../lib/charts'
import { FIXTURE_HANDLE, FIXTURE_PROFILE, fixturePosts } from '../lib/called-it/fixture'
import {
  DEAD_BAND,
  JUDGE_DAYS,
  METHOD_LINE,
  PICK_MAX,
  STANDING_NOT_VERIFIED,
  VERDICT_WORDS,
  barIndexAt,
  buildRecord,
  chartHref,
  fmtMove,
  impactOf,
  moveLine,
  movesFor,
  normalizeHandle,
  normalizeSide,
  pickCalls,
  postRefFromUrl,
  postTimeAgrees,
  quoteIsFromPost,
  recordHeadline,
  recordHref,
  snowflakeMs,
  standingVerified,
  tallyOf,
  verdictFor,
  type LabeledPost,
  type RecordResponse,
} from '../lib/called-it/spec'
import { additiveRefusal } from './run-ddl'

type Check = (name: string, ok: boolean, extra?: string) => void

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
const DAY = 86_400
const NOW = Date.UTC(2026, 10, 11, 12)
const ASCII = /^[\x20-\x7e]*$/

/** 400 daily bars ending today; the close follows `f(day index)`. */
function bars(f: (i: number) => number, n = 400): Candle[] {
  const end = Math.floor(NOW / 1000 / DAY) * DAY
  return Array.from({ length: n }, (_, i) => {
    const c = f(i)
    return { t: end - (n - 1 - i) * DAY, o: c, h: c * 1.01, l: c * 0.99, c, v: 1 }
  })
}
const msAgo = (days: number, hour = 12) => Math.floor(NOW / 86_400_000) * 86_400_000 - days * 86_400_000 + hour * 3_600_000

export function calledCoordPins(check: Check): void {
  check(
    'called-it handle: @Name, name and a pasted profile link are one lowercase handle; a post link, another site, an x.com path that is not an account, 16 characters and punctuation are not handles',
    normalizeHandle('@CZ_Binance') === 'cz_binance' && normalizeHandle(' cz_binance ') === 'cz_binance' && normalizeHandle('https://x.com/CZ_Binance') === 'cz_binance' && normalizeHandle('twitter.com/jack/') === 'jack' &&
      normalizeHandle('https://x.com/jack/status/20') === null && normalizeHandle('https://evil.example/jack') === null && normalizeHandle('https://x.com.evil.example/jack') === null &&
      normalizeHandle('x.com/home') === null && normalizeHandle('i') === null && normalizeHandle('a'.repeat(16)) === null && normalizeHandle('jack; drop') === null && normalizeHandle('') === null && normalizeHandle(7) === null,
  )
  check(
    'called-it post link: x.com, twitter.com and mobile links (status or statuses, with a trailing path or query) and a bare id give the id; /i/status and /i/web/status carry no handle; any other host, a profile link and javascript: give nothing',
    postRefFromUrl('https://x.com/jack/status/20000')?.id === '20000' && postRefFromUrl('https://x.com/Jack/status/20000')?.handle === 'jack' &&
      postRefFromUrl('https://twitter.com/jack/statuses/1349149096909668363?s=20')?.id === '1349149096909668363' && postRefFromUrl('mobile.twitter.com/jack/status/1349149096909668363/photo/1')?.id === '1349149096909668363' &&
      postRefFromUrl('https://x.com/i/status/1349149096909668363')?.handle === null && postRefFromUrl('https://x.com/i/web/status/1349149096909668363')?.id === '1349149096909668363' && postRefFromUrl('1349149096909668363')?.handle === null &&
      postRefFromUrl('https://x.com.evil.example/jack/status/20000') === null && postRefFromUrl('https://evil.example/x.com/jack/status/20000') === null && postRefFromUrl('https://x.com/jack') === null && postRefFromUrl('javascript:alert(1)') === null && postRefFromUrl(null) === null,
  )
  check(
    "called-it id clock: a post id carries its own time (1349149096909668363 = 2021-01-13T00:19:45.338Z, measured); an id from before November 2010 carries none; X's time must agree with the id's within two seconds or the post is not plotted",
    new Date(snowflakeMs('1349149096909668363') ?? 0).toISOString() === '2021-01-13T00:19:45.338Z' && snowflakeMs('20') === null && snowflakeMs('20000') === null && snowflakeMs('nope') === null &&
      postTimeAgrees('1349149096909668363', Date.UTC(2021, 0, 13, 0, 19, 45)) && !postTimeAgrees('1349149096909668363', Date.UTC(2021, 0, 14)) && postTimeAgrees('20000', 0),
  )

  // A market that doubles in a straight line over the window, then one that halves.
  const up = bars((i) => 100 + i)
  const flat = bars(() => 100)
  const m = movesFor(up, msAgo(100), NOW)
  check(
    `called-it arithmetic: the price when posted is that day's daily close; ${JUDGE_DAYS} days later is the close of the bar that had opened by then; a horizon that has not elapsed is null, never a guess; a post older than the first bar has no moves at all`,
    !!m && m.priceAt === 100 + 299 && m.barTime === up[299].t && Math.abs((m.d30 ?? 0) - 30 / 399) < 1e-9 && Math.abs((m.d7 ?? 0) - 7 / 399) < 1e-9 && Math.abs((m.d90 ?? 0) - 90 / 399) < 1e-9 && Math.abs(m.now - 100 / 399) < 1e-9 &&
      movesFor(up, msAgo(20), NOW)?.d30 === null && movesFor(up, msAgo(20), NOW)?.d7 !== null && movesFor(up, msAgo(500), NOW) === null && movesFor([], NOW, NOW) === null &&
      barIndexAt(up, up[0].t * 1000 - 1) === -1 && barIndexAt(up, up[5].t * 1000) === 5 && barIndexAt(up, NOW + 1e9) === up.length - 1,
  )
  check(
    `called-it verdict: judged on the ${JUDGE_DAYS}-day move alone. A bull call is right from +${DEAD_BAND * 100}%, wrong from -${DEAD_BAND * 100}%, "no real move" between; a bear call mirrors it; under ${JUDGE_DAYS} days old it is open and shows the move so far`,
    verdictFor('bull', { d30: 0.031, now: -0.5 }).verdict === 'right' && verdictFor('bull', { d30: -0.03, now: 0.5 }).verdict === 'wrong' && verdictFor('bull', { d30: 0.029, now: 0 }).verdict === 'flat' &&
      verdictFor('bear', { d30: -0.2, now: 0.9 }).verdict === 'right' && verdictFor('bear', { d30: 0.2, now: -0.9 }).verdict === 'wrong' && verdictFor('bear', { d30: 0.2, now: -0.9 }).judgedPct === 0.2 &&
      verdictFor('bull', { d30: null, now: 0.4 }).verdict === 'open' && verdictFor('bull', { d30: null, now: 0.4 }).judgedPct === 0.4,
  )
  const imp = (conviction: 1 | 2 | 3, likes: number | null, judgedPct: number, verdict: 'right' | 'wrong' | 'flat' | 'open') => impactOf({ conviction, likes, judgedPct, verdict })
  check(
    'called-it impact: a hit and a miss of the same size weigh the same; surer words, more likes and a bigger move each weigh more; an open call weighs less than a judged one, a flat one least; a move past 100% is capped',
    imp(2, 500, 0.2, 'right') === imp(2, 500, -0.2, 'wrong') && imp(3, 500, 0.2, 'right') > imp(2, 500, 0.2, 'right') && imp(2, 50_000, 0.2, 'right') > imp(2, 500, 0.2, 'right') && imp(2, 500, 0.4, 'right') > imp(2, 500, 0.2, 'right') &&
      imp(2, 500, 0.2, 'open') < imp(2, 500, 0.2, 'right') && imp(2, 500, 0.2, 'flat') < imp(2, 500, 0.2, 'open') && imp(2, 500, 3, 'right') === imp(2, 500, 1, 'right') && imp(2, null, 0.2, 'right') > 0,
  )
  const c = (postId: string, day: number, impact: number, verdict: 'right' | 'wrong' | 'flat' | 'open') => ({ postId, barTime: day * DAY, impact, verdict })
  const wins = [c('1', 10, 9, 'right'), c('2', 40, 8, 'right'), c('3', 70, 7, 'right'), c('4', 100, 6, 'right'), c('5', 130, 5, 'right'), c('6', 160, 4, 'right'), c('7', 190, 3, 'right'), c('8', 220, 0.1, 'wrong')]
  check(
    `called-it picks: at most ${PICK_MAX} pins; the worst miss is on the plot even when ${PICK_MAX} hits outrank it (and the best hit when misses outrank it); two calls closer than the gap never both pin, the stronger one does; ids come back date ascending; the same input gives the same pins`,
    pickCalls(wins).length === PICK_MAX && pickCalls(wins).includes('8') && pickCalls(wins).includes('1') && !pickCalls(wins).includes('7') &&
      pickCalls(wins.map((w) => ({ ...w, verdict: w.verdict === 'right' ? ('wrong' as const) : ('right' as const) }))).includes('8') &&
      pickCalls([c('1', 10, 5, 'right'), c('2', 11, 9, 'right'), c('3', 60, 2, 'open')], { minGapSec: 5 * DAY }).join() === '2,3' &&
      pickCalls(wins).join() === [...pickCalls(wins)].sort((a, b) => Number(a) - Number(b)).join() && pickCalls(wins).join() === pickCalls([...wins].reverse()).join() && pickCalls([]).length === 0 && pickCalls(wins, { max: 2 }).join() === '1,8',
  )

  // The fixture through the one assembler, on a market that only rises.
  const posts = fixturePosts(NOW)
  const rec = buildRecord({ handle: FIXTURE_HANDLE, symbol: 'btc', side: 'all', profile: FIXTURE_PROFILE, verified: null, posts, candles: up, nowMs: NOW, scannedAt: NOW, postsRead: posts.length })
  const bullOnly = buildRecord({ handle: FIXTURE_HANDLE, symbol: 'BTC', side: 'bull', profile: FIXTURE_PROFILE, verified: { at: NOW }, posts, candles: up, nowMs: NOW, scannedAt: NOW, postsRead: posts.length })
  check(
    'called-it record: the fixture has ten calls (the post that takes no side is not one), date ascending, six bull and four bear; on a market that only rises every judged bull call is right and every judged bear call is wrong; the two posts under 30 days old are open; the tally counts every call, the plot pins at most six and holds a hit and a miss',
    rec.symbol === 'BTC' && rec.calls.length === 10 && rec.tally.total === 10 && rec.bySide.bull.total === 6 && rec.bySide.bear.total === 4 && rec.calls.every((x, i, a) => i === 0 || a[i - 1].postedAt <= x.postedAt) &&
      rec.calls.filter((x) => x.verdict !== 'open').every((x) => (x.stance === 'bull' ? x.verdict === 'right' : x.verdict === 'wrong')) && rec.tally.open === 2 && rec.tally.right === 5 && rec.tally.wrong === 3 &&
      rec.calls.filter((x) => x.picked).length === PICK_MAX && rec.calls.some((x) => x.picked && x.verdict === 'right') && rec.calls.some((x) => x.picked && x.verdict === 'wrong') &&
      rec.calls.every((x) => x.url === null && x.priceAt > 0 && posts.find((p) => p.id === x.postId)?.text === x.text),
    JSON.stringify({ n: rec.calls.length, tally: rec.tally, bySide: rec.bySide }),
  )
  const tampered: LabeledPost[] = posts.map((p, i) => (i === 0 ? { ...p, label: { ...p.label, quote: 'words the post never said' } } : i === 1 ? { ...p, handle: 'somebody_else' } : i === 2 ? { ...p, postedAt: p.postedAt + 86_400_000 } : p))
  const guarded = buildRecord({ handle: FIXTURE_HANDLE, symbol: 'BTC', side: 'all', profile: FIXTURE_PROFILE, verified: null, posts: [...tampered, tampered[5]], candles: up, nowMs: NOW, scannedAt: NOW, postsRead: 11 })
  check(
    "called-it record guards: a label whose quote is not in the post is dropped; a post by another handle is dropped; a post whose time disagrees with its own id is dropped; the same post twice counts once; whitespace alone never fails a quote",
    guarded.calls.length === 7 && !guarded.calls.some((x) => [posts[0].id, posts[1].id, posts[2].id].includes(x.postId)) && quoteIsFromPost('Top  is\nin', 'Top is in. I sold everything today.') && !quoteIsFromPost('', 'x') && !quoteIsFromPost('to', 'Top is in') && !quoteIsFromPost(null, 'x'),
    String(guarded.calls.length),
  )
  const flatRec = buildRecord({ handle: FIXTURE_HANDLE, symbol: 'BTC', side: 'bear', profile: FIXTURE_PROFILE, verified: null, posts, candles: flat, nowMs: NOW, scannedAt: NOW, postsRead: 11, pins: [posts[5].id, 'junk', posts[0].id, posts[5].id] })
  check(
    "called-it side and pins: the toggle filters the calls and the tally to one side while both sides' counts stay on the record; a URL's own pins replace the rule's (unknown ids, repeats and the other side's ids are ignored); on a market that never moves every judged call reads \"no real move\"",
    bullOnly.calls.every((x) => x.stance === 'bull') && bullOnly.tally.total === 6 && bullOnly.bySide.bear.total === 4 && flatRec.calls.length === 4 && flatRec.calls.filter((x) => x.picked).map((x) => x.postId).join() === posts[5].id &&
      flatRec.calls.filter((x) => x.verdict !== 'open').every((x) => x.verdict === 'flat') && normalizeSide('bull') === 'bull' && normalizeSide('BULL') === 'all' && normalizeSide(undefined) === 'all',
  )
  check(
    'called-it words: the headline counts every call in plain words and names the side when one is chosen; a plot of somebody else is "Not verified", the account itself "Verified"; moves print with an ASCII sign; every line is ASCII',
    rec.words.headline === '@pantessa_test on BTC: 10 calls, 5 called it, 3 missed, 2 too early to say.' && bullOnly.words.headline.startsWith('@pantessa_test, bullish on BTC: 6 calls, 5 called it') &&
      recordHeadline('a', 'ETH', 'bear', tallyOf([])) === '@a, bearish on ETH: no calls found in this window.' && recordHeadline('a', 'ETH', 'all', { total: 1, right: 0, wrong: 1, flat: 0, open: 0 }) === '@a on ETH: 1 call, 1 missed.' &&
      rec.words.standing === STANDING_NOT_VERIFIED && bullOnly.words.standing === standingVerified(FIXTURE_HANDLE) && fmtMove(0.2344) === '+23.4%' && fmtMove(-0.291) === '-29.1%' && fmtMove(0) === '0.0%' &&
      moveLine({ verdict: 'wrong', judgedPct: -0.291 }) === '-29.1% in 30 days' && moveLine({ verdict: 'open', judgedPct: 0.04 }) === '+4.0% so far' &&
      [rec.words.headline, rec.words.standing, METHOD_LINE, standingVerified('a'), ...Object.values(VERDICT_WORDS)].every((s) => ASCII.test(s)),
    rec.words.headline,
  )
  check(
    'called-it fixture: its handle is one the handle rule accepts (15 characters at most), so the endpoint, the pages and the harness can all ask for it by name',
    normalizeHandle(FIXTURE_HANDLE) === FIXTURE_HANDLE && normalizeHandle(`@${FIXTURE_HANDLE}`) === FIXTURE_HANDLE && FIXTURE_PROFILE.handle === FIXTURE_HANDLE,
    FIXTURE_HANDLE,
  )
  check(
    'called-it links: the share landing is /x/<handle>/<SYMBOL> and the live chart is /t/<SYMBOL>?x=<handle>; the default side is left out of both',
    recordHref('cz_binance', 'btc') === '/x/cz_binance/BTC' && recordHref('cz_binance', 'BTC', 'bear') === '/x/cz_binance/BTC?side=bear' && chartHref('cz_binance', 'btc') === '/t/BTC?x=cz_binance' && chartHref('cz_binance', 'BTC', 'bull') === '/t/BTC?x=cz_binance&side=bull',
  )
  const ddl = read('prisma/ddl/2026-11-11-called-it.sql')
  const statements = ddl.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').split(';').map((s) => s.trim()).filter(Boolean)
  const schema = read('prisma/schema.prisma')
  check(
    'called-it DDL: eight statements, every one additive by the runner\'s own fence; the four tables are the four the schema maps',
    statements.length === 8 && statements.every((s) => additiveRefusal(s) === null) && ['x_handles', 'x_posts', 'x_calls', 'x_scans'].every((t) => ddl.includes(`CREATE TABLE IF NOT EXISTS ${t} (`) && schema.includes(`@@map("${t}")`)),
    statements.map((s) => additiveRefusal(s)).filter(Boolean).join(' | '),
  )
}

export async function calledCoordPinsServed(check: Check, BASE: string): Promise<void> {
  try {
    const get = async (qs: string) => {
      const r = await fetch(`${BASE}/api/x/record?${qs}`, { headers: { 'x-yf-internal-run': '1' } })
      return { status: r.status, body: (await r.json()) as RecordResponse }
    }
    const ok = await get(`handle=@${FIXTURE_HANDLE}&sym=btc`)
    const bear = await get(`handle=${FIXTURE_HANDLE}&sym=BTC&side=bear`)
    const bad = await get('handle=not%20a%20handle&sym=BTC')
    const rec = ok.body.status === 'ready' ? ok.body.record : null
    check(
      'called-it (served): the fixture handle answers a ready record on BTC judged on the real daily chart (ten calls, real prices, no link out to X, not verified); the bear toggle answers only bear calls; a string that is not a handle is refused by name with somewhere to go',
      ok.status === 200 && !!rec && rec.symbol === 'BTC' && rec.calls.length === 10 && rec.calls.every((c) => c.priceAt > 1000 && c.url === null) && rec.verified === null && rec.priceNow > 1000 &&
        bear.body.status === 'ready' && bear.body.record.calls.length === 4 && bear.body.record.calls.every((c) => c.stance === 'bear') && bad.status === 400 && bad.body.status === 'refused' && bad.body.next.length > 0,
      `${ok.status} ${ok.body.status} ${rec?.calls.length ?? '-'} · ${bad.status} ${bad.body.status}`,
    )
  } catch (err) {
    check('called-it (served): the server answered', false, err instanceof Error ? err.message : String(err))
  }
}

if (process.argv[1]?.endsWith('called-coord-pins.ts')) {
  ;(async () => {
    let failed = 0
    let n = 0
    const check: Check = (name, ok, extra) => {
      n++
      console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
      if (!ok) failed++
    }
    calledCoordPins(check)
    if (process.env.BASE) await calledCoordPinsServed(check, process.env.BASE)
    console.log(failed ? `\n${failed} of ${n} called-it contract pins failed` : `\nall ${n} called-it contract pins green${process.env.BASE ? '' : ' (pure half only)'}`)
    process.exit(failed ? 1 : 0)
  })()
}
