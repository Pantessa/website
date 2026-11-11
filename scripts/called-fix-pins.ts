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
  } finally {
    const left = await cleanFix(prisma)
    check('fix db: the pins remove every row they made', left === 0, String(left))
    if (prevFake === undefined) delete process.env.XCALLS_FAKE
    else process.env.XCALLS_FAKE = prevFake
  }
}

export async function calledFixPinsServed(check: Check, BASE: string): Promise<void> {
  await calledFixPinsAsync(check)
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
      await calledFixPinsDb(check)
    }
    console.log(failed ? `\n${failed} of ${n} called-it fix pins failed` : `\nall ${n} called-it fix pins green${process.env.BASE ? '' : ' (no server)'}`)
    process.exit(failed ? 1 : 0)
  })()
}
