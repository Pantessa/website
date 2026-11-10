// Pins for squad landing, lane CLOSE (2026-11-10): the trust section (how a sentence becomes a signed transaction) and the closing doors.
// THE LANE OWNS THIS FILE. It is already wired into scripts/test-api.ts and
// package.json by the contract commit — fill the two functions, never edit
// the harness. Pure checks (rules, tables, source) go in the first; checks
// against a running server go in the second.
//   npx tsx scripts/landing-close-pins.ts            (npm run pins:landing-close)
//   BASE=http://localhost:PORT npx tsx scripts/landing-close-pins.ts --served
//
// The components import their CSS, so a tsx script cannot import them: the
// pure pins read the SOURCE (the order of the stations, how the fee lines
// are read, how the grid is driven, every door) and the served pins read the
// rendered `/` (the fee values equal lib/fees through tourFees, the grid's
// doors equal the table's primary doors in order, every door resolves).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOUR_SIDES } from '../lib/home-tour'

type Check = (name: string, ok: boolean, extra?: string) => void

const ROOT = join(__dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
/** Source without comments (a header naming a word must not satisfy or fail a pin). */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

const STATION_ORDER = ['say', 'quote', 'build', 'guard', 'sign', 'receipt']
const QUIET = ['/leaderboard', '/analytics', '/pricing', '/docs', '/story']

/** A side's primary door, as the closing grid picks it. */
const primaryOf = (doors: { kind: string; href: string; label: string }[]) => doors.find((d) => d.kind === 'primary') ?? doors[0]

export function landingClosePins(check: Check): void {
  const how = code('components/home/HowItWorks.tsx')
  const close = code('components/home/ClosingDoors.tsx')

  // ── HowItWorks: six stations, in the order the runtime walks them ──────
  const ids = [...how.matchAll(/^\s*id: '([a-z]+)',$/gm)].map((m) => m[1])
  check('close: how has six stations in order (say → quote → build → guard → sign → receipt)', JSON.stringify(ids) === JSON.stringify(STATION_ORDER), ids.join(','))
  check('close: how renders the stations from the table (one map, an ordered list)', /<ol className="how__rail"[\s\S]*HOW_STATIONS\.map\(/.test(how))
  check('close: the model is named only as never writing (station three says it never writes calldata or an address)', /never writes calldata, an amount or an address/.test(how))
  check('close: a dry run is claimed only "on some routes" (QA, 2026-11-10: the dry run is ours to run, on the LiFi leg, the refresh route and the jobs runner — not every venue\'s first build)', /on some routes a dry run against the chain/.test(how) && !/always (?:dry|simulat)/i.test(how))

  // ── No typed number: fees from data.fees, counts from data.counts ──────
  // Text a reader sees: JSX text nodes and string literals that are not a class name, an id, a key or a route.
  const visible = [
    ...[...how.matchAll(/>([^<>{}]+)</g)].map((m) => m[1]),
    ...[...how.matchAll(/(?<!className=|id=|href=|key=|data-[a-z-]+=)'([^'\n]*)'/g)].map((m) => m[1]),
    ...[...how.matchAll(/`([^`]*)`/g)].map((m) => m[1].replace(/\$\{[^}]*\}/g, '')),
  ]
  const digits = visible.filter((t) => /\d/.test(t) && !/^\.\/|^@\//.test(t))
  check('close: no digit is typed in the how section (every number is the snapshot or a CSS counter)', digits.length === 0, digits.join(' | '))
  check('close: the fee lines read data.fees (swapPct, linkPct, creatorPct, hlPct)', ['swapPct', 'linkPct', 'creatorPct', 'hlPct'].every((k) => new RegExp(`f\\.${k}`).test(how)))
  check('close: the fee lines exist only when the snapshot has fees (if (f) …)', /const f = data\.fees[\s\S]*if \(f\) \{[\s\S]*f\.swapPct/.test(how))
  check('close: the manifest line reads data.counts and drops when a count is null', /venues == null \|\| pinnedAddresses == null\) return null/.test(how) && /\{manifest && /.test(how))
  check('close: a missing snapshot renders as EMPTY_TOUR (no hole, no throw)', /data \?\? EMPTY_TOUR/.test(how))

  // ── ClosingDoors: the table's primary doors, in order ─────────────────
  check('close: the grid is TOUR_SIDES in order (one map, no hand-typed side)', /TOUR_SIDES\.map\(/.test(close) && !TOUR_SIDES.some((s) => !QUIET.includes(primaryOf(s.doors).href) && close.includes(`'${primaryOf(s.doors).href}'`)))
  check('close: each cell takes the side’s PRIMARY door', /doors\.find\(\(d\) => d\.kind === 'primary'\)/.test(close))
  check('close: every side has a primary door (the grid never drops a side)', TOUR_SIDES.every((s) => s.doors.some((d) => d.kind === 'primary')), TOUR_SIDES.filter((s) => !s.doors.some((d) => d.kind === 'primary')).map((s) => s.id).join(','))
  const quiet = [...close.matchAll(/href: '([^']+)'/g)].map((m) => m[1])
  check('close: the quiet row is Leaderboard · Analytics · Pricing · Docs · The story', JSON.stringify(quiet) === JSON.stringify(QUIET), quiet.join(','))

  // ── Doors (rule 3): LandingLink or a plain on-page anchor, journey-labelled ──
  for (const [name, src, prefix] of [['how', how, 'How: '], ['closing', close, 'Closing: ']] as const) {
    check(`close: ${name} uses no next/link and no redirectTo`, !/from 'next\/link'/.test(src) && !/redirectTo/.test(src))
    const spine = [...src.matchAll(/<LandingLink\b[^>]*>/g)].map((m) => m[0])
    check(`close: every ${name} LandingLink has prefetch={false} and a "${prefix}" journey`, spine.length > 0 && spine.every((t) => /prefetch=\{false\}/.test(t) && (t.includes(`data-journey="${prefix}`) || /data-journey=\{(journey|`Closing: )/.test(t))), `${spine.length} links`)
    const anchors = [...src.matchAll(/<a\b[^>]*>/g)].map((m) => m[0])
    check(`close: every ${name} <a> is an on-page anchor with a journey`, anchors.every((t) => /href=\{door\.href\}/.test(t) && /data-journey=/.test(t)) && (name === 'how' ? anchors.length === 0 : /door\.href\.startsWith\('#'\) \?/.test(src)))
    check(`close: ${name} never prints the old name`, !/yeetful/i.test(read(name === 'how' ? 'components/home/HowItWorks.tsx' : 'components/home/ClosingDoors.tsx')))
  }

  // ── The look: tokens only, counters for numbers, a reduced-motion rule ──
  for (const sheet of ['components/home/how.css', 'components/home/closing.css']) {
    const css = read(sheet).replace(/\/\*[\s\S]*?\*\//g, '')
    check(`close: ${sheet} is tokens only (no hex/rgb/hsl, no px font size or radius)`, !/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(|font-size:\s*\d+px|border-radius:\s*\d+px/i.test(css))
    check(`close: ${sheet} sizes by its own container, never the viewport`, /container-type: inline-size/.test(css) && !/@media[^{]*(min|max)-width/.test(css))
    check(`close: ${sheet} answers reduced motion and gives touch targets 44px`, /prefers-reduced-motion: reduce/.test(css) && /pointer: coarse/.test(css))
  }
  check('close: station and side numbers are CSS counters (decimal-leading-zero)', /counter\(how-step, decimal-leading-zero\)/.test(read('components/home/how.css')) && /counter\(closing-side, decimal-leading-zero\)/.test(read('components/home/closing.css')))
}

/** The `/` HTML between a section's opening tag and the next seat. */
function sectionHtml(html: string, marker: string): string {
  const i = html.indexOf(marker)
  if (i < 0) return ''
  const end = html.indexOf('</section>', html.indexOf(marker === 'data-how' ? 'how__doors' : 'closing__quiet', i))
  return html.slice(i, end < 0 ? undefined : end)
}

export async function landingClosePinsServed(check: Check, base: string): Promise<void> {
  const res = await fetch(`${base}/`)
  const html = await res.text()
  const how = sectionHtml(html, 'data-how')
  const close = sectionHtml(html, 'data-closing')
  check('close (served): / carries the how section and the closing doors', res.ok && how.length > 0 && close.length > 0)
  check('close (served): the how title is an h2 and there is still one h1 on /', /<h2[^>]*id="how-title"[^>]*>How a sentence becomes a signed transaction<\/h2>/.test(how) && (html.match(/<h1\b/g) ?? []).length === 1)
  const stations = [...how.matchAll(/data-station="([a-z]+)"/g)].map((m) => m[1])
  check('close (served): six stations in order', JSON.stringify(stations) === JSON.stringify(STATION_ORDER), stations.join(','))

  // The fee values are lib/fees, through the snapshot.
  const { tourFees, tourStaticCounts } = await import('../lib/home-tour-server')
  const f = tourFees()
  const vals = [...how.matchAll(/class="how__costval mono">([^<]+)</g)].map((m) => m[1])
  check('close (served): the cost column shows lib/fees (swap · link · Hyperliquid) between Free and No fee', JSON.stringify(vals) === JSON.stringify(['Free', f.swapPct, f.linkPct, f.hlPct, 'No fee']), vals.join(','))
  check('close (served): the link line names the creator’s share from lib/fees', how.includes(`${f.creatorPct} of the fill goes to the link`))
  const c = tourStaticCounts()
  if (c.venues != null && c.pinnedAddresses != null) {
    check('close (served): the venue door carries the manifest’s counts', how.includes(`${c.venues} venues · ${c.pinnedAddresses} pinned contract addresses`))
  }
  check('close (served): no inline-element glued to the next word in either section', !/<\/(a|strong|em|code)>[A-Za-z]/.test(how + close))

  // The closing grid: the table's primary doors, in order, journey-labelled.
  const doors = [...close.matchAll(/<a\b[^>]*class="closing__door"[^>]*>/g)].map((m) => ({ href: /href="([^"]+)"/.exec(m[0])?.[1] ?? '', journey: /data-journey="([^"]+)"/.exec(m[0])?.[1] ?? '' }))
  const want = TOUR_SIDES.map((s) => ({ href: primaryOf(s.doors).href.replace(/&/g, '&amp;'), journey: `Closing: ${s.label}` }))
  check('close (served): eight doors = each side’s primary door, in tour order', JSON.stringify(doors) === JSON.stringify(want), doors.map((d) => d.href).join(','))
  const quiet = [...close.matchAll(/class="closing__quietlink"[^>]*href="([^"]+)"|href="([^"]+)"[^>]*class="closing__quietlink"/g)].map((m) => m[1] ?? m[2])
  check('close (served): the quiet row is the five public pages', JSON.stringify(quiet) === JSON.stringify(QUIET), quiet.join(','))

  // Every door resolves (a route answers; an anchor names an id on the page).
  const hrefs = new Set<string>()
  for (const m of (how + close).matchAll(/<a\b[^>]*href="([^"]+)"/g)) hrefs.add(m[1].replace(/&amp;/g, '&'))
  const bad: string[] = []
  for (const h of hrefs) {
    if (h.startsWith('#')) {
      if (!html.includes(`id="${h.slice(1)}"`)) bad.push(h)
      continue
    }
    const r = await fetch(`${base}${h}`, { redirect: 'manual' })
    if (r.status >= 400) bad.push(`${h} ${r.status}`)
  }
  check('close (served): every door in both sections resolves', bad.length === 0 && hrefs.size >= 13, bad.join(', ') || `${hrefs.size} doors`)
}

if (process.argv[1]?.endsWith('landing-close-pins.ts')) {
  let failed = 0
  let n = 0
  const check: Check = (name, ok, extra) => {
    n++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
    if (!ok) failed++
  }
  const served = process.argv.includes('--served')
  Promise.resolve()
    .then(() => landingClosePins(check))
    .then(() => (served ? landingClosePinsServed(check, process.env.BASE ?? 'http://localhost:3000') : undefined))
    .then(() => {
      console.log(failed ? `\n${failed} failed` : `\nall green (${n})`)
      process.exit(failed ? 1 : 0)
    })
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
