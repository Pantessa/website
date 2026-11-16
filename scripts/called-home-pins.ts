// Pins for the Called it shelf on the home (2026-11-16): three featured
// records drawn as /x's tiles under THE READ, and /x linked from the home.
//   npx tsx scripts/called-home-pins.ts                    (npm run pins:called-home)
//   BASE=http://localhost:PORT npx tsx scripts/called-home-pins.ts
//
// What is held here:
//   · the featured list: the three records Nate named, in his order, spelled
//     the store's way (handle lowercase, symbol uppercase);
//   · the read never holds the page: capped in time, never a throw, through
//     the public list (readPlotted), so a hidden or internal record never shows;
//   · the seat: under the lead, above the tour; the page hands a SERVER
//     component down (no record read in the client bundle);
//   · /x is linked from the home: the shelf's head and button, and the closing
//     row — always, even when no featured record is on this database;
//   · served: when the shelf renders, every tile opens its chart and nothing
//     but the featured records is on it.
import { readFileSync } from 'node:fs'
import { HOME_CALLED, SHELF_BUDGET_MS } from '../app/x/_lib/home-shelf'
import { chartHref } from '../lib/called-it/spec'

type Check = (name: string, ok: boolean, extra?: string) => void

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

export function calledHomePins(check: Check): void {
  check(
    'called home: the shelf features defi_dad on ETH, wallstreetbets on NEAR, dcinvestor on ETH, in that order',
    JSON.stringify(HOME_CALLED) === JSON.stringify([{ handle: 'defi_dad', symbol: 'ETH' }, { handle: 'wallstreetbets', symbol: 'NEAR' }, { handle: 'dcinvestor', symbol: 'ETH' }]),
  )
  check('called home: every featured row is spelled the store’s way', HOME_CALLED.every((f) => f.handle === f.handle.toLowerCase() && f.symbol === f.symbol.toUpperCase()))
  const shelf = read('app/x/_lib/home-shelf.ts')
  check('called home: the read goes through the public list (readPlotted) and is capped in time', /readPlotted\(/.test(shelf) && /Promise\.race\(/.test(shelf) && SHELF_BUDGET_MS > 0 && SHELF_BUDGET_MS <= 4000)
  const page = read('app/page.tsx')
  check('called home: the page reads the shelf beside its other reads and hands a server component down', /Promise\.all\(\[[^\]]*readCalledShelf\(\)\]\)/.test(page) && /called=\{called\.summaries\.length \? <CalledShelf data=\{called\} \/> : undefined\}/.test(page))
  const surface = read('components/home/HomeSurface.tsx')
  check('called home: the client surface never imports the record reads', !/home-shelf|CalledShelf|called-it\/store/.test(surface.replace(/^\s*\/\/.*$/gm, '')))
  const index = read('components/markets/shell/MarketsIndex.tsx')
  const at = (s: string) => index.indexOf(s)
  check('called home: the seat sits under the lead and above the tour', at('className="mk-lead-seat"') > 0 && at('className="mk-lead-seat"') < at('className="mk-called-seat"') && at('className="mk-called-seat"') < at('className="mk-tour-seat"'))
  const comp = read('components/home/CalledShelf.tsx')
  check('called home: the shelf links /x twice (eyebrow, button) and draws /x’s own Tile', (comp.match(/href="\/x"/g) ?? []).length === 2 && /<Tile summary=\{s\}/.test(comp) && /if \(!data\.summaries\.length\) return null/.test(comp))
  // Read as text: ClosingDoors imports its stylesheet, which Node cannot load.
  check('called home: the closing row links Called it → /x', /CLOSING_QUIET = \[[^\]]*\{ label: 'Called it', href: '\/x' \}/.test(read('components/home/ClosingDoors.tsx')))
}

export async function calledHomePinsServed(check: Check, BASE: string): Promise<void> {
  const res = await fetch(`${BASE}/`)
  const html = await res.text()
  check('called home (served): / answers 200', res.status === 200, String(res.status))
  check('called home (served): the home links /x in its closing row', /<a\b[^>]*href="\/x"[^>]*class="closing__quietlink"|class="closing__quietlink"[^>]*href="\/x"/.test(html))
  const m = /data-called-shelf="(\d+)"/.exec(html)
  if (!m) {
    check('called home (served): no featured record on this database, so no shelf and no empty frame', !html.includes('xrc--shelf'))
    return
  }
  const want = new Set(HOME_CALLED.map((f) => chartHref(f.handle, f.symbol).replace(/&/g, '&amp;')))
  const tiles = [...html.matchAll(/<a\b[^>]*class="xrc-tile"[^>]*>/g)].map((t) => /href="([^"]+)"/.exec(t[0])?.[1] ?? '')
  check('called home (served): the shelf counts its tiles truly', tiles.length === Number(m[1]) && tiles.length > 0 && tiles.length <= HOME_CALLED.length, `${tiles.length} vs ${m[1]}`)
  check('called home (served): every tile opens a featured record’s chart', tiles.every((h) => want.has(h)), tiles.join(','))
  check('called home (served): the shelf’s head links /x', /class="xrc-shelf__go"[^>]*href="\/x"|href="\/x"[^>]*class="xrc-shelf__go"/.test(html))
  const r = await fetch(`${BASE}/x`, { redirect: 'manual' })
  check('called home (served): /x answers', r.status === 200, String(r.status))
}

if (process.argv[1]?.endsWith('called-home-pins.ts')) {
  ;(async () => {
    let failed = 0
    let n = 0
    const check: Check = (name, ok, extra) => {
      n++
      console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
      if (!ok) failed++
    }
    calledHomePins(check)
    if (process.env.BASE) await calledHomePinsServed(check, process.env.BASE)
    console.log(failed ? `\n${failed} of ${n} called home pins failed` : `\nall ${n} called home pins green${process.env.BASE ? '' : ' (pure half only)'}`)
    process.exit(failed ? 1 : 0)
  })()
}
