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
import { runScan, type ScanDeps } from '@/lib/called-it/scan'

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
    const out = await runScan({ handle: 'zz_pin_fix', symbol: '0G', requester: 'ip:zzpinfix', internal: true }, { store: spy, source: spy, label: spy, allowance: async () => { touched.push('allowance'); throw new Error('allowance') }, now: Date.now, market: (r) => marketFor(r, { resolve: async () => ({ symbol: '0G' }) }) } as unknown as ScanDeps)
    check('fix R20: a symbol with no search terms (0G) is refused by name and never becomes one query for every post', out.kind === 'refused' && out.http === 422 && /no words to search/.test(out.body.reason) && touched.length === 0, `${JSON.stringify(out)} ${touched.join()}`)
  }
}

export async function calledFixPinsServed(check: Check, BASE: string): Promise<void> {
  await calledFixPinsAsync(check)
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
    else await calledFixPinsAsync(check)
    console.log(failed ? `\n${failed} of ${n} called-it fix pins failed` : `\nall ${n} called-it fix pins green${process.env.BASE ? '' : ' (no server)'}`)
    process.exit(failed ? 1 : 0)
  })()
}
