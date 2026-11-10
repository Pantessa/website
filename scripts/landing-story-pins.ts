// Pins for squad landing, lane STORY (2026-11-10): /story carries the tour stacked — all eight sides, one provider, the page still static.
// THE LANE OWNS THIS FILE. It is already wired into scripts/test-api.ts and
// package.json by the contract commit — fill the two functions, never edit
// the harness. Pure checks (rules, tables, source) go in the first; checks
// against a running server go in the second.
//   npx tsx scripts/landing-story-pins.ts            (npm run pins:landing-story)
//   BASE=http://localhost:PORT npx tsx scripts/landing-story-pins.ts --served

import fs from 'node:fs'
import path from 'node:path'
import { TOUR_IDS } from '../lib/home-tour/types'

type Check = (name: string, ok: boolean, extra?: string) => void

const ROOT = path.resolve(__dirname, '..')
const src = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8')
/** Source with comments removed, so a comment that names a pattern cannot satisfy (or trip) a pin. */
const code = (p: string) =>
  src(p)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')

export function landingStoryPins(check: Check): void {
  const page = code('app/story/page.tsx')
  const tour = code('components/story/StoryTour.tsx')
  const css = src('components/story/story-tour.css')

  // The page stays ISR and reads both snapshots through the cached readers.
  check(
    'story: /story stays ISR (revalidate = 300), reads the tour + read snapshots through their cached readers at render, and never reads a request (no searchParams, cookies(), headers(), no-store, force-dynamic)',
    /export const revalidate = 300\b/.test(page) &&
      /import \{ readTourSnapshotForRender \} from '@\/lib\/home-tour-server'/.test(page) &&
      /import \{ readSnapshotForRender \} from '@\/lib\/read-server'/.test(page) &&
      /await Promise\.all\(\[readTourSnapshotForRender\(\), readSnapshotForRender\(\)\]\)/.test(page) &&
      !/searchParams|cookies\(|headers\(|no-store|force-dynamic|dynamic\s*=/.test(page),
  )
  const rs = code('lib/read-server.ts')
  const ts = code('lib/home-tour-server.ts')
  check(
    'story: both readers the page calls go through unstable_cache (what keeps the page static)',
    /unstable_cache/.test(rs) && /export async function readSnapshotForRender/.test(rs) && /unstable_cache/.test(ts) && /export async function readTourSnapshotForRender/.test(ts),
  )
  check(
    'story: the stacked tour mounts after the markets band and before the share band, with both snapshots',
    page.indexOf('<MarketsBand />') > 0 && page.indexOf('<MarketsBand />') < page.indexOf('<StoryTour data={tour} read={read} />') && page.indexOf('<StoryTour') < page.indexOf('<ShareBand />'),
  )

  // The section: one provider, all eight panels in table order, the home's anchors.
  check(
    'story: StoryTour is a client component wrapping the section in ONE TourProvider (one connect door) fed the server snapshots',
    /^'use client'/.test(src('components/story/StoryTour.tsx')) &&
      (tour.match(/<TourProvider\b/g) ?? []).length === 1 &&
      /<TourProvider data=\{data\} read=\{read\}>/.test(tour) &&
      tour.indexOf('<TourProvider') < tour.indexOf('<section') && tour.lastIndexOf('</section>') < tour.lastIndexOf('</TourProvider>'),
  )
  check(
    'story: the section is #tour (TOUR_ANCHOR) with an h2 title and NO h1; a block header is plain text (the panel claim is the h3)',
    /<section className="stour" id=\{TOUR_ANCHOR\} data-story-tour aria-labelledby="stour-title">/.test(tour) &&
      /<h2 className="stour__title" id="stour-title">/.test(tour) && !/<h1\b/.test(tour) && !/<h3\b/.test(tour) && !/<h4\b/.test(tour),
  )
  check(
    'story: every side is mounted from TOUR_PANELS in TOUR_SIDES order (one map, no hand-picked panel, no selected-side state)',
    /TOUR_SIDES\.map\(\(s\) => \{\s*const Panel = TOUR_PANELS\[s\.id\]/.test(tour) &&
      /import \{ TOUR_PANELS \} from '@\/components\/home\/tour\/sides'/.test(tour) &&
      !/useState|useEffect|setInterval|setTimeout/.test(tour) &&
      !/import \w+Side from/.test(tour),
  )
  check(
    'story: each block carries the home\'s anchor (id={tourAnchor(s.id)}) and the index links to the same anchors as plain on-page links with journey labels',
    /<li key=\{s\.id\} className="stour__side" id=\{tourAnchor\(s\.id\)\} data-story-side=\{s\.id\}>/.test(tour) &&
      /<a className="stour__indexlink" href=\{`#\$\{tourAnchor\(s\.id\)\}`\} data-journey=\{tourJourney\(s\.id, 'story index'\)\}>/.test(tour) &&
      !/next\/link|redirectTo|prompt=/.test(tour),
  )
  check(
    'story: TOUR_PANELS covers exactly the eight tour ids (the stack shows all eight)',
    TOUR_IDS.length === 8 && TOUR_IDS.every((id) => new RegExp(`\\b${id}:`).test(code('components/home/tour/sides/index.ts'))),
  )

  // CSS: tokens only, container-sized, reduced motion, nothing sticky.
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, '')
  check(
    'story: story-tour.css is tokens only — no hex/rgb/hsl colour, no px font size, no px radius, nothing sticky or fixed, sized by its own container, and its transitions answer reduced motion',
    !/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/.test(bare) &&
      !/font-size:\s*[\d.]+px/.test(bare) && !/border-radius:\s*[\d.]+px/.test(bare) &&
      !/position:\s*(sticky|fixed)/.test(bare) &&
      /container-type: inline-size/.test(bare) && /@container stour/.test(bare) && !/@media \((max|min)-width/.test(bare) &&
      (!/transition|animation/.test(bare) || /prefers-reduced-motion: reduce/.test(bare)),
  )
}

export async function landingStoryPinsServed(check: Check, base: string): Promise<void> {
  const res = await fetch(`${base}/story`, { headers: { 'x-yf-internal-run': '1' } })
  const html = await res.text()
  const cc = res.headers.get('cache-control') ?? ''
  check('story (served): /story is 200 and cached as ISR (s-maxage=300)', res.status === 200 && /s-maxage=300\b/.test(cc), `status=${res.status} cache-control=${cc}`)
  const ids = TOUR_IDS.map((id) => `id="tour-${id}"`)
  const at = ids.map((k) => html.indexOf(k))
  check(
    'story (served): the section #tour and eight `id="tour-<id>"` blocks, once each, in table order',
    /<section class="stour" id="tour" data-story-tour="true"/.test(html) &&
      ids.every((k) => html.split(k).length === 2) && at.every((n, i) => n > 0 && (i === 0 || at[i - 1] < n)),
    at.join(','),
  )
  check(
    'story (served): eight panels rendered (data-tour-panel), eight index anchors, one h1 on the page, the section title an h2',
    TOUR_IDS.every((id) => html.includes(`data-tour-panel="${id}"`) && html.includes(`href="#tour-${id}"`)) &&
      (html.match(/<h1[\s>]/g) ?? []).length === 1 && /<h2 class="stour__title" id="stour-title">/.test(html),
    `h1=${(html.match(/<h1[\s>]/g) ?? []).length}`,
  )
  check('story (served): the tour sits between the markets band and the share band', html.indexOf('data-markets-band') < html.indexOf('data-story-tour') && html.indexOf('data-story-tour') < html.indexOf('data-share-band'))
}

if (process.argv[1]?.endsWith('landing-story-pins.ts')) {
  let failed = 0
  let n = 0
  const check: Check = (name, ok, extra) => {
    n++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
    if (!ok) failed++
  }
  const served = process.argv.includes('--served')
  Promise.resolve()
    .then(() => landingStoryPins(check))
    .then(() => (served ? landingStoryPinsServed(check, process.env.BASE ?? 'http://localhost:3000') : undefined))
    .then(() => {
      console.log(failed ? `\n${failed} failed` : `\nall green (${n})`)
      process.exit(failed ? 1 : 0)
    })
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
