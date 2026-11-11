// Pins for squad called-it, lane FIX (2026-11-11): one or more per finding in
// squad-called-it-2026-11-11/REVIEW.md that FIXES.md hands this lane. Each
// one was written to fail on the tree before its fix.
//   pure          calledFixPins(check)                 sync, anywhere
//   async + DB    calledFixPinsAsync(check)            doubles; the TEST DB when DATABASE_URL is set (never prod)
//   served        calledFixPinsServed(check, BASE)     the above + what a built server answers
//   npx tsx --env-file=.env.local scripts/called-fix-pins.ts
//   BASE=http://localhost:4506 npx tsx --env-file=.env.local scripts/called-fix-pins.ts
// Rows the pins write use `zz_pin_fix…` handles, internal scans, and are deleted at the end.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chartPairFor } from '@/lib/charts'
import { marketFor, type ResolveFn } from '@/lib/called-it/market'
import { addPost, runScan, type AddDeps, type ScanDeps } from '@/lib/called-it/scan'
import { GUEST_ADDS_PER_DAY, ADDS_PER_MINUTE, TWITTER_EPOCH_MS, type PostRead, type XPost } from '@/lib/called-it/spec'
import type { LabelResult } from '@/lib/called-it/classify'
import { GUEST_LOOKUPS_PER_DAY, X_POST_COST_USD, X_USER_COST_USD, type XSource } from '@/lib/called-it/spec'
import { XApiSource } from '@/lib/called-it/source/x-api'
import { maxScanCostUsd } from '@/lib/called-it/budget'

type Check = (name: string, ok: boolean, extra?: string) => void
const src = (p: string) => readFileSync(join(process.cwd(), p), 'utf8')
/** The house resolver's sync half: no network for a miss (resolveChartPair would warm the venue's live table). */
const syncResolve: ResolveFn = async (s) => chartPairFor(s)

export function calledFixPins(check: Check): void {
  // R5/R2a: every door goes through the one market function
  const scanRoute = src('app/api/x/scan/route.ts')
  const addRoute = src('app/api/x/add/route.ts')
  check('fix R5: the scan, add and handles routes and readRecord, runScan, addPost all call marketFor (no route keeps its own symbol regex)', [scanRoute, addRoute, src('app/api/x/handles/route.ts')].every((s) => s.includes('marketFor(')) && !/SYMBOL_RE\.test/.test(scanRoute + addRoute) && /marketFor\)\(q\.symbol\)/.test(src('lib/called-it/record.ts')) && (src('lib/called-it/scan.ts').match(/marketFor\)\(input\.symbol\)/g) ?? []).length === 2)
}

export async function calledFixPinsAsync(check: Check): Promise<void> {
  // ── R5 + R2a + R20: one door for the market ──
  {
    const m = (s: unknown) => marketFor(s, { resolve: syncResolve })
    const spellings = await Promise.all(['BTC', 'btc', 'WBTC', 'cbBTC', ' BTC '].map(m))
    check('fix R5: BTC, btc, WBTC, cbBTC and " BTC " are ONE market, the symbol page\'s own spelling', spellings.every((d) => d.ok && d.symbol === 'BTC'), JSON.stringify(spellings))
    const bad = await Promise.all(['B.T.C', 'BTC-', '^BTC', '$BTC', 'xyz:SP500', '<script>', '', 'A'.repeat(13), 42].map(m))
    check('fix R5: punctuation, a cashtag, a prefix, markup, nothing and 13 letters are refused 400 by name, never collapsed', bad.every((d) => !d.ok && d.http === 400 && d.reason.length > 0 && d.next.length > 0), JSON.stringify(bad.map((d) => (d.ok ? d.symbol : d.http))))
    const none = await m('ZZINVENTED9')
    check('fix R2a: an invented market is refused 404 before anything is read', !none.ok && none.http === 404 && /no chart/.test(none.reason))
    const named = await m('apple')
    check('fix R5: a name the symbol page redirects (apple) lands on its ticker', named.ok && named.symbol === 'AAPL', JSON.stringify(named))
    const boom = await marketFor('BTC', { resolve: async () => { throw new Error('down') } })
    check('fix R5: a resolver that throws is a named 503, never a throw', !boom.ok && boom.http === 503)
    // R20: a market whose termsFor is empty is refused by name, before the store, the allowance or X
    const touched: string[] = []
    const spy = new Proxy({}, { get: (_t, k) => (touched.push(String(k)), async () => { throw new Error(`touched ${String(k)}`) }) })
    const out = await runScan({ handle: 'zz_pin_fix', symbol: '0G', requester: 'ip:zzpinfix', internal: true }, { store: spy, source: spy, label: spy, allowance: async () => { touched.push('allowance'); throw new Error('allowance') }, now: Date.now, market: (r: unknown) => marketFor(r, { resolve: async () => ({ symbol: '0G' }) }) } as unknown as ScanDeps)
    check('fix R20: a symbol with no search terms (0G) is refused by name and never becomes one query for every post', out.kind === 'refused' && out.http === 422 && /no words to search/.test(out.body.reason) && touched.length === 0, `${JSON.stringify(out)} ${touched.join()}`)
  }
}

// ── Against the TEST database ───────────────────────────────────────────

const DAY_MS = 86_400_000
export const FIX_TAG = Math.random().toString(36).slice(2, 6).padEnd(4, '0')
/** Every handle these pins write starts with this (and is deleted at the end). */
export const FIX_PREFIX = 'zz_pin_q_'

async function testDb() {
  const url = process.env.DATABASE_URL ?? ''
  if (!url || /ep-wild-credit/.test(url) || process.env.USE_DB === 'false') return null
  const { default: prisma } = await import('@/lib/db')
  return prisma
}

/** A real-shaped post id with `ms` stamped into it. */
export function idAt(ms: number, seq: number): string {
  return ((BigInt(Math.floor(ms) - TWITTER_EPOCH_MS) << BigInt(22)) | BigInt(seq & 0x3fffff)).toString()
}
export function pinPost(handle: string, daysAgo: number, seq: number, text: string): XPost {
  const postedAt = Math.floor((Date.now() - daysAgo * DAY_MS) / 1000) * 1000
  return { id: idAt(postedAt, seq), handle, text, postedAt, likes: seq, replies: 0, reposts: 0, isReply: false, source: 'syndication' }
}

async function cleanFix(prisma: NonNullable<Awaited<ReturnType<typeof testDb>>>): Promise<number> {
  const like = `${FIX_PREFIX}%`
  await prisma.$executeRawUnsafe(`DELETE FROM x_calls WHERE post_id IN (SELECT post_id FROM x_posts WHERE handle LIKE $1) OR added_by LIKE $2`, like, 'ip:zzpinfix%')
  await prisma.$executeRawUnsafe(`DELETE FROM x_posts WHERE handle LIKE $1`, like)
  await prisma.$executeRawUnsafe(`DELETE FROM x_scans WHERE handle LIKE $1`, like)
  await prisma.$executeRawUnsafe(`DELETE FROM x_handles WHERE handle LIKE $1`, like)
  const left = (await prisma.$queryRawUnsafe(`SELECT ((SELECT count(*) FROM x_posts WHERE handle LIKE $1) + (SELECT count(*) FROM x_scans WHERE handle LIKE $1) + (SELECT count(*) FROM x_handles WHERE handle LIKE $1))::int AS n`, like)) as { n: number }[]
  return left[0]?.n ?? -1
}

export async function calledFixPinsDb(check: Check): Promise<void> {
  const prisma = await testDb()
  if (!prisma) {
    console.log('ℹ️  called-fix db pins skipped (no TEST DATABASE_URL in this process)')
    return
  }
  const Store = await import('@/lib/called-it/store')
  const prevFake = process.env.XCALLS_FAKE
  process.env.XCALLS_FAKE = '1'
  try {
    await cleanFix(prisma)

    // ── R2b: the paste path is metered ──
    {
      const H = `${FIX_PREFIX}a${FIX_TAG}`
      const req = `ip:zzpinfix${FIX_TAG}`
      let modelCalls = 0
      const label: AddDeps['label'] = async (posts): Promise<LabelResult> => {
        modelCalls++
        return { labels: posts.map((p) => ({ postId: p.id, label: /Buying/.test(p.text) ? { stance: 'bull' as const, conviction: 2 as const, quote: 'Buying' } : { stance: 'none' as const, conviction: 0 as const, quote: null } })), unlabeled: [], model: 'injected' }
      }
      const posts = Array.from({ length: 20 }, (_, k) => pinPost(H, 5 + k, 100 + k, k % 2 ? `Buying more ${k}` : `just words ${k}`))
      const read = async (id: string): Promise<PostRead> => {
        const post = posts.find((p) => p.id === id)!
        return { ok: true, post, profile: { handle: H, name: H, avatarUrl: null, followers: null, blue: false, xUserId: '9100' } }
      }
      const deps = (r = req): [string, AddDeps] => [r, { store: Store as unknown as AddDeps['store'], read, label, now: Date.now }]
      const add = (k: number, r = req) => addPost({ handle: H, symbol: 'BTC', url: `https://x.com/${H}/status/${posts[k].id}`, requester: deps(r)[0] }, deps(r)[1])
      const first = []
      for (let k = 0; k < ADDS_PER_MINUTE; k++) first.push(await add(k))
      const fifth = await add(ADDS_PER_MINUTE)
      const rows = await prisma.xCall.findMany({ where: { postId: { in: posts.map((p) => p.id) } } })
      check(`fix R2b: ${ADDS_PER_MINUTE} pastes in a minute, then the next is refused 429 BEFORE the model (none labels count too: they cost a call)`, modelCalls === ADDS_PER_MINUTE && fifth.kind === 'refused' && fifth.http === 429 && /last minute/.test(fifth.body.reason) && fifth.body.next.length > 0 && rows.length === ADDS_PER_MINUTE && rows.every((r) => r.addedBy === req), `calls=${modelCalls} fifth=${JSON.stringify(fifth).slice(0, 120)} rows=${rows.length}`)
      check('fix R2b: added_by is written on every pasted label, the `none` ones included', rows.filter((r) => r.stance === 'none').length >= 1 && rows.every((r) => r.addedBy === req && r.origin === 'added'))
      const again = await add(0)
      check('fix R2b: a post already labeled for the symbol costs nothing and is not counted', again.kind !== 'refused' || again.http === 200 ? modelCalls === ADDS_PER_MINUTE : false, JSON.stringify(again).slice(0, 100))
      // age the minute's rows, and fill the day up to the guest's allowance
      await prisma.xCall.updateMany({ where: { addedBy: req }, data: { labeledAt: new Date(Date.now() - 5 * 60_000) } })
      const fill = posts.slice(10, 10 + (GUEST_ADDS_PER_DAY - ADDS_PER_MINUTE)).map((p) => ({ postId: p.id, symbol: 'ETH', stance: 'none', conviction: 0, model: 'injected', origin: 'added', addedBy: req, labeledAt: new Date(Date.now() - 5 * 60_000) }))
      await prisma.xCall.createMany({ data: fill })
      const over = await add(ADDS_PER_MINUTE + 1)
      check(`fix R2b: a guest who pasted ${GUEST_ADDS_PER_DAY} today is refused, with words and a next, and the model is not called`, over.kind === 'refused' && over.http === 429 && /today/.test(over.body.reason) && modelCalls === ADDS_PER_MINUTE, JSON.stringify(over).slice(0, 160))
      // K at once for a fresh requester: the count and the reservation are one step
      modelCalls = 0
      const burst = `ip:zzpinfix${FIX_TAG}b`
      const outs = await Promise.all([8, 9, 10, 11, 12, 13, 14, 15].map((k) => add(k, burst)))
      const reserved = await prisma.xCall.count({ where: { addedBy: burst } })
      check(`fix R2b: 8 pastes at the same instant from one requester make exactly ${ADDS_PER_MINUTE} model calls (count and reservation under one lock)`, modelCalls === ADDS_PER_MINUTE && reserved === ADDS_PER_MINUTE && outs.filter((o) => o.kind === 'refused' && o.http === 429).length === 8 - ADDS_PER_MINUTE, `calls=${modelCalls} rows=${reserved} ${outs.map((o) => (o.kind === 'refused' ? o.http : 'ok')).join()}`)
    }

    // ── R3: reserve before spending ──
    {
      const before = await Store.spentTodayUsd()
      const reserve = maxScanCostUsd(400)
      const cap = before + 2.5 * reserve
      const seen: number[] = []
      const opens = await Promise.all(Array.from({ length: 6 }, (_, k) =>
        Store.openScan({ handle: `${FIX_PREFIX}r${k}${FIX_TAG}`, symbol: 'BTC', provider: 'x-api', requestedBy: `ip:zzpinfix${FIX_TAG}r${k}`, isInternal: true, windowFrom: 0, windowTo: Date.now(), reserveUsd: reserve, decide: (c) => (seen.push(c.spentTodayUsd), { ok: cap - c.spentTodayUsd >= reserve }) }),
      ))
      const opened = opens.filter((o) => o.kind === 'opened')
      const held = (await prisma.xScan.aggregate({ where: { handle: { startsWith: FIX_PREFIX }, status: 'running' }, _sum: { reservedUsd: true } }))._sum.reservedUsd ?? 0
      check('fix R3: 6 scans starting at the same instant under a cap that fits 2 open exactly 2; each decision saw the ones before it, and what they hold never crosses the cap', opened.length === 2 && opens.filter((o) => o.kind === 'refused').length === 4 && before + held <= cap + 1e-9 && Math.max(...seen) >= before + 2 * reserve - 1e-9, `opened=${opened.length} held=${held} seen=${seen.map((x) => x.toFixed(2)).join()}`)
      for (const o of opened) if (o.kind === 'opened') await Store.updateScan(o.scan.id, { status: 'done', finished: true, costUsd: 0.05 })
      const released = await prisma.xScan.findMany({ where: { id: { in: opened.map((o) => (o.kind === 'opened' ? o.scan.id : '')) } } })
      check('fix R3: finishing a scan releases its reservation (reserved_usd 0, its real cost stays)', released.length === 2 && released.every((r) => r.reservedUsd === 0 && r.costUsd === 0.05))
      const deadId = `xs_zzpinq${FIX_TAG}dead`
      await prisma.xScan.create({ data: { id: deadId, handle: `${FIX_PREFIX}dead${FIX_TAG}`, symbol: 'BTC', status: 'running', isInternal: true, requestedBy: 'ip:zzpinfixdead', startedAt: new Date(Date.now() - 5 * 60_000), reservedUsd: reserve, costUsd: 0.01 } })
      await Store.openScan({ handle: `${FIX_PREFIX}nxt${FIX_TAG}`, symbol: 'BTC', provider: 'x-api', requestedBy: 'ip:zzpinfixnxt', isInternal: true, windowFrom: 0, windowTo: Date.now(), reserveUsd: 0, decide: () => ({ ok: false }) })
      const dead = await prisma.xScan.findUnique({ where: { id: deadId } })
      check('fix R3: a scan whose request died is retired as failed and charged its whole reservation (it may have spent it), then holds nothing', dead?.status === 'failed' && dead.reservedUsd === 0 && Math.abs(dead.costUsd - reserve) < 1e-9, JSON.stringify(dead))
    }

    // ── R4: no spend without a row ──
    {
      const { runScan: run } = await import('@/lib/called-it/scan')
      const { labelPosts } = await import('@/lib/called-it/classify')
      const mk = (src: XSource) => ({ store: Store as unknown as ScanDeps['store'], source: src, label: labelPosts, allowance: async () => ({ ok: true as const, scansLeft: 1, postCap: 400, usdLeft: 10 }), now: Date.now })
      // (a)+(b) a miss: the profile cent is on a refused row, and the miss answers for a day without asking X again
      const MISS = `${FIX_PREFIX}m${FIX_TAG}`
      const xm = fakeX(() => ({ status: 404 }))
      const miss1 = new XApiSource({ bearer: X_SECRET, fetch: fakeX(() => ({ status: 200, body: { errors: [{ title: 'Not Found Error' }] } })).fetch, pageGapMs: 0 })
      const o1 = await run({ handle: MISS, symbol: 'BTC', requester: `ip:zzpinfix${FIX_TAG}m`, internal: true }, mk(miss1))
      const rows1 = await prisma.xScan.findMany({ where: { handle: MISS } })
      const o2 = await run({ handle: MISS, symbol: 'BTC', requester: `ip:zzpinfix${FIX_TAG}m`, internal: true }, mk(new XApiSource({ bearer: X_SECRET, fetch: xm.fetch, pageGapMs: 0 })))
      check('fix R4a: "no such account" is answered AFTER a row opens, so the profile read\'s cost is on a refused row', o1.kind === 'refused' && o1.http === 404 && rows1.length === 1 && rows1[0].status === 'refused' && Math.abs(rows1[0].costUsd - X_USER_COST_USD) < 1e-9 && rows1[0].reservedUsd === 0, JSON.stringify(rows1))
      check('fix R4b: the same miss within a day is answered from x_handles.missing_at, without asking X and without a new row', o2.kind === 'refused' && o2.http === 404 && xm.calls.length === 0 && (await prisma.xScan.count({ where: { handle: MISS } })) === 1 && !!(await prisma.xHandle.findUnique({ where: { handle: MISS } }))?.missingAt)
      const LOCK = `${FIX_PREFIX}p${FIX_TAG}`
      const lockedBody = { data: { id: '9400', name: 'L', username: LOCK, protected: true, verified: false } }
      await run({ handle: LOCK, symbol: 'BTC', requester: `ip:zzpinfix${FIX_TAG}p`, internal: true }, mk(new XApiSource({ bearer: X_SECRET, fetch: fakeX(() => ({ status: 200, body: lockedBody })).fetch, pageGapMs: 0 })))
      const xp = fakeX(() => ({ status: 200, body: lockedBody }))
      const p2 = await run({ handle: LOCK, symbol: 'BTC', requester: `ip:zzpinfix${FIX_TAG}p`, internal: true }, mk(new XApiSource({ bearer: X_SECRET, fetch: xp.fetch, pageGapMs: 0 })))
      await prisma.xHandle.update({ where: { handle: LOCK }, data: { readAt: new Date(Date.now() - 25 * 3_600_000) } })
      const xp3 = fakeX(() => ({ status: 200, body: lockedBody }))
      await run({ handle: LOCK, symbol: 'BTC', requester: `ip:zzpinfix${FIX_TAG}p`, internal: true }, mk(new XApiSource({ bearer: X_SECRET, fetch: xp3.fetch, pageGapMs: 0 })))
      check('fix R4b: a protected account is answered from the store for 24 h, then X is asked again', p2.kind === 'refused' && p2.http === 403 && xp.calls.length === 0 && xp3.calls.length === 1)
      // (c) lookups a requester causes in a day, misses included
      const LREQ = `ip:zzpinfix${FIX_TAG}l`
      await prisma.xScan.createMany({ data: Array.from({ length: GUEST_LOOKUPS_PER_DAY }, (_, k) => ({ id: `xs_zzpinq${FIX_TAG}l${k}`, handle: `${FIX_PREFIX}l${k}${FIX_TAG}`, symbol: 'BTC', status: 'refused', requestedBy: LREQ, isInternal: false, costUsd: 0, startedAt: new Date(Date.now() - 60_000) })) })
      const xl = fakeX(() => ({ status: 200, body: xUser('zz_pin_q_lk') }))
      const { scanAllowance } = await import('@/lib/called-it/budget')
      const ol = await run({ handle: `${FIX_PREFIX}lk${FIX_TAG}`, symbol: 'BTC', requester: LREQ, internal: false }, { ...mk(new XApiSource({ bearer: X_SECRET, fetch: xl.fetch, pageGapMs: 0 })), allowance: scanAllowance })
      check(`fix R4c: a guest who caused ${GUEST_LOOKUPS_PER_DAY} lookups today (refused rows included) is refused before X is asked`, ol.kind === 'refused' && ol.http === 429 && /looked up/.test(ol.body.reason) && xl.calls.length === 0, JSON.stringify(ol).slice(0, 160))
      // (d) a scan whose search fails after a page keeps those posts and says so
      const TR = `${FIX_PREFIX}t${FIX_TAG}`
      let pg = 0
      const xt = fakeX((u) => (u.includes('/users/') ? { status: 200, body: xUser(TR) } : pg++ === 0 ? { status: 200, body: { data: [xTweet(TR, 1, 11, 'Buying $BTC here'), xTweet(TR, 2, 12)], meta: { next_token: 'n' } } } : { status: 503 }))
      const ot = await run({ handle: TR, symbol: 'BTC', requester: `ip:zzpinfix${FIX_TAG}t`, internal: true }, mk(new XApiSource({ bearer: X_SECRET, fetch: xt.fetch, pageGapMs: 0 })))
      const rt = await prisma.xScan.findFirst({ where: { handle: TR } })
      check('fix R4d: a scan whose search fails on page 2 finishes done with page 1\'s posts saved, their cost and the profile read on the row', ot.kind === 'done' && rt?.status === 'done' && rt.postsRead === 2 && Math.abs(rt.costUsd - (2 * X_POST_COST_USD + X_USER_COST_USD)) < 1e-9 && (await prisma.xPost.count({ where: { handle: TR } })) === 2, JSON.stringify(rt))
    }
  } finally {
    const left = await cleanFix(prisma)
    check('fix db: the pins remove every row they made', left === 0, String(left))
    if (prevFake === undefined) delete process.env.XCALLS_FAKE
    else process.env.XCALLS_FAKE = prevFake
  }
}

// ── X API over fake fetches (no network) ─────────────────────────────────

const X_SECRET = 'PINSECRET-fix-lane-never-sent'
function xTweet(handle: string, daysAgo: number, seq: number, text = `post ${seq} $BTC`) {
  const ms = Math.floor((Date.now() - daysAgo * DAY_MS) / 1000) * 1000
  return { id: idAt(ms, seq), text, created_at: new Date(ms).toISOString(), author_id: '9300', public_metrics: { like_count: seq, reply_count: 0, retweet_count: 0 } }
}
function fakeX(answer: (url: string, n: number) => { status: number; body?: unknown }): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = []
  const f = (async (input: RequestInfo | URL) => {
    const url = String(input)
    calls.push(url)
    const a = answer(url, calls.length)
    return new Response(a.body === undefined ? null : JSON.stringify(a.body), { status: a.status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  return { fetch: f, calls }
}
const xUser = (handle: string) => ({ data: { id: '9300', name: handle, username: handle, protected: false, verified: false, public_metrics: { followers_count: 10 } } })

export async function calledFixPinsXApi(check: Check): Promise<void> {
  // R4d: page 2 fails (500) after page 1 read 3 posts → those 3 come back truncated, billed, and the stop is named
  {
    const H = 'zz_pin_q_xapi'
    let page = 0
    const x = fakeX((u) => (u.includes('/users/') ? { status: 200, body: xUser(H) } : page++ === 0 ? { status: 200, body: { data: [xTweet(H, 1, 1), xTweet(H, 2, 2), xTweet(H, 3, 3)], meta: { next_token: 'p2' } } } : { status: 500 }))
    const src = new XApiSource({ bearer: X_SECRET, fetch: x.fetch, pageGapMs: 0 })
    await src.profile(H)
    const r = await src.search({ handle: H, terms: ['$BTC'], fromMs: Date.now() - 30 * DAY_MS, toMs: Date.now(), cap: 400 })
    check('fix R4d: a search that fails on page 2 returns page 1 as truncated, with page 1\'s cost and the profile read, and says it was X (lastStop error)', r.posts.length === 3 && r.truncated && Math.abs(r.costUsd - (3 * X_POST_COST_USD + X_USER_COST_USD)) < 1e-9 && src.lastStop === 'error' && Math.abs(src.spentUsd - r.costUsd) < 1e-9, JSON.stringify({ n: r.posts.length, c: r.costUsd, stop: src.lastStop }))
  }
  // R4e: a search with its deadline already passed asks X for nothing
  {
    const x = fakeX(() => ({ status: 200, body: { data: [], meta: {} } }))
    const src = new XApiSource({ bearer: X_SECRET, fetch: x.fetch, pageGapMs: 0 })
    const r = await src.search({ handle: 'zz_pin_q_dl', terms: ['$BTC'], fromMs: 0, toMs: Date.now(), cap: 400, deadlineMs: Date.now() - 1 })
    let pages = 0
    const y = fakeX((_u, n) => (pages = n, { status: 200, body: { data: [xTweet('zz_pin_q_dl', 1, n)], meta: { next_token: `t${n}` } } }))
    let clock = Date.now()
    const src2 = new XApiSource({ bearer: X_SECRET, fetch: y.fetch, pageGapMs: 0, now: () => (clock += 400) })
    const r2 = await src2.search({ handle: 'zz_pin_q_dl', terms: ['$BTC'], fromMs: 0, toMs: Date.now(), cap: 400, deadlineMs: clock + 2_000 })
    check('fix R4e: the search stops paging at its deadline (none asked once it has passed; a paging read stops in time, truncated)', x.calls.length === 0 && r.truncated && src.lastStop === 'deadline' && pages > 0 && pages < 6 && r2.truncated && src2.lastStop === 'deadline', `${x.calls.length} ${pages} ${src2.lastStop}`)
  }
}

export async function calledFixPinsServed(check: Check, BASE: string): Promise<void> {
  await calledFixPinsAsync(check)
  await calledFixPinsXApi(check)
  await calledFixPinsDb(check)
  const post = async (p: string, body: unknown) => {
    const r = await fetch(`${BASE}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-yf-internal-run': '1' }, body: JSON.stringify(body) })
    return { status: r.status, body: (await r.json().catch(() => null)) as Record<string, unknown> | null }
  }
  const get = async (p: string) => {
    const r = await fetch(`${BASE}${p}`)
    return { status: r.status, body: (await r.json().catch(() => null)) as Record<string, unknown> | null }
  }
  const dotted = await post('/api/x/scan', { handle: 'zz_pin_fixsrv', sym: 'B.T.C' })
  const addNo = await post('/api/x/add', { handle: 'zz_pin_fixsrv', sym: 'ZZINVENTED9', url: 'https://x.com/zz_pin_fixsrv/status/1349149096909668363' })
  const recW = await get('/api/x/record?handle=pantessa_test&sym=WBTC')
  check('fix R5 (served): B.T.C is refused 400 on the scan, an invented market 404 on the add, and WBTC reads the BTC record', dotted.status === 400 && addNo.status === 404 && recW.status === 200 && (recW.body?.record as { symbol?: string } | undefined)?.symbol === 'BTC', `${dotted.status} ${addNo.status} ${recW.status}`)
  const hs = await get('/api/x/handles?sym=B.T.C')
  check('fix R5 (served): the handles list filter takes the same door', hs.status === 400)
}

if (process.argv[1]?.endsWith('called-fix-pins.ts')) {
  ;(async () => {
    let failed = 0
    let n = 0
    const check: Check = (name, ok, extra) => {
      n++
      console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
      if (!ok) failed++
    }
    calledFixPins(check)
    if (process.env.BASE) await calledFixPinsServed(check, process.env.BASE)
    else {
      await calledFixPinsAsync(check)
      await calledFixPinsXApi(check)
      await calledFixPinsDb(check)
    }
    console.log(failed ? `\n${failed} of ${n} called-it fix pins failed` : `\nall ${n} called-it fix pins green${process.env.BASE ? '' : ' (no server)'}`)
    process.exit(failed ? 1 : 0)
  })()
}
