// Pins for squad landing, lane STAGE (2026-11-10): the tour's shell — the list, the stage, the phone's posture, keyboard, the hash.
// THE LANE OWNS THIS FILE. It is already wired into scripts/test-api.ts and
// package.json by the contract commit — fill the two functions, never edit
// the harness. Pure checks (rules, tables, source) go in the first; checks
// against a running server go in the second.
//   npx tsx scripts/landing-stage-pins.ts            (npm run pins:landing-stage)
//   BASE=http://localhost:PORT npx tsx scripts/landing-stage-pins.ts --served
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { TOUR_IDS, TOUR_SIDES, tourAnchor, tourSide, type TourId } from '../lib/home-tour'
import { parseTourLayout, tourIndexLabel, tourKeyTarget, tourNextId, tourNextLabel, tourOrientation, tourPosition, tourTitle } from '../components/home/tour/stage'

type Check = (name: string, ok: boolean, extra?: string) => void

const ROOT = new URL('..', import.meta.url).pathname
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
/** Source with comments removed, so a rule is read from code and never from prose. */
const code = (p: string) =>
  read(p)
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\s\/\/ .*$/gm, '')
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length
/** One `@container tour (…) { … }` block of tour.css, by its query. */
function block(css: string, query: string): string {
  const at = css.indexOf(`@container tour ${query} {`)
  if (at < 0) return ''
  let depth = 0
  for (let i = css.indexOf('{', at); i < css.length; i++) {
    if (css[i] === '{') depth++
    else if (css[i] === '}' && --depth === 0) return css.slice(at, i + 1)
  }
  return ''
}
/** How React writes a text node into HTML. */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;')

export function landingStagePins(check: Check): void {
  const first = TOUR_IDS[0]
  const last = TOUR_IDS[TOUR_IDS.length - 1]
  const second = TOUR_IDS[1]
  const label = (id: TourId) => tourSide(id).label

  // ── The rules (components/home/tour/stage.ts) ──
  check(
    "tour keys: a tablist's arrows follow its orientation (down/up when the list runs down the page, right/left when it is a row of tabs), they wrap at both ends, Home and End jump, and every other key is not the list's (Enter and Space stay the button's own; the cross-axis arrows do nothing)",
    tourKeyTarget(first, 'ArrowDown', 'vertical') === second &&
      tourKeyTarget(second, 'ArrowUp', 'vertical') === first &&
      tourKeyTarget(first, 'ArrowUp', 'vertical') === last &&
      tourKeyTarget(last, 'ArrowDown', 'vertical') === first &&
      tourKeyTarget(first, 'ArrowRight', 'horizontal') === second &&
      tourKeyTarget(first, 'ArrowLeft', 'horizontal') === last &&
      tourKeyTarget(last, 'ArrowRight', 'horizontal') === first &&
      tourKeyTarget(second, 'Home', 'vertical') === first &&
      tourKeyTarget(second, 'End', 'horizontal') === last &&
      tourKeyTarget(first, 'ArrowRight', 'vertical') === null &&
      tourKeyTarget(first, 'ArrowLeft', 'vertical') === null &&
      tourKeyTarget(first, 'ArrowDown', 'horizontal') === null &&
      tourKeyTarget(first, 'ArrowUp', 'horizontal') === null &&
      ['Enter', ' ', 'Tab', 'Escape', 'j', 'k', 'PageDown', ''].every((k) => tourKeyTarget(second, k, 'vertical') === null && tourKeyTarget(second, k, 'horizontal') === null) &&
      TOUR_IDS.every((id) => TOUR_IDS.includes(tourKeyTarget(id, 'ArrowDown', 'vertical') as TourId)),
  )
  check(
    'tour layout: the shell takes the layout the stylesheet names (wide · mid · phone) and anything unreadable is the server\'s layout, wide; only a row of tabs is horizontal',
    parseTourLayout('phone') === 'phone' &&
      parseTourLayout(' mid ') === 'mid' &&
      parseTourLayout('"phone"') === 'phone' &&
      parseTourLayout('wide') === 'wide' &&
      parseTourLayout('') === 'wide' &&
      parseTourLayout(null) === 'wide' &&
      parseTourLayout('tablet') === 'wide' &&
      tourOrientation('wide') === 'vertical' &&
      tourOrientation('mid') === 'horizontal' &&
      tourOrientation('phone') === 'vertical',
  )
  const walk: string[] = []
  let step: TourId = first
  for (let i = 0; i < TOUR_IDS.length; i++, step = tourNextId(step)) walk.push(step)
  check(
    "tour foot: Next walks every side once in the table's order and then starts again; the place is counted from the table (`01 / 08`, spoken \"Side 1 of 8\"), and the button names the side it opens",
    walk.join() === TOUR_IDS.join() &&
      tourNextId(last) === first &&
      tourPosition(first).label === `01 / ${String(TOUR_IDS.length).padStart(2, '0')}` &&
      tourPosition(last).n === TOUR_IDS.length &&
      tourPosition(last).of === TOUR_IDS.length &&
      tourPosition(second).spoken === `Side 2 of ${TOUR_IDS.length}` &&
      tourNextLabel(first, label) === `Next: ${label(second)}` &&
      tourNextLabel(last, label) === `Start again: ${label(first)}` &&
      tourIndexLabel(0) === '01' &&
      tourIndexLabel(TOUR_IDS.length - 1) === String(TOUR_IDS.length).padStart(2, '0'),
    `${tourPosition(first).label} · ${tourNextLabel(first, label)} · ${tourNextLabel(last, label)}`,
  )
  check(
    "tour head: the heading counts the table's own sides in words (eight sides say \"Eight\"; a ninth would say \"Nine\"), so the number is never typed apart from the table",
    tourTitle() === 'One wallet. Eight ways in.' && TOUR_SIDES.length === 8 && tourTitle(9) === 'One wallet. Nine ways in.' && tourTitle(40) === 'One wallet. 40 ways in.',
    tourTitle(),
  )

  // ── The shell's source (components/home/tour/Tour.tsx) ──
  const tour = code('components/home/tour/Tour.tsx')
  check(
    'tour roles: wide or mid the list is a REAL tablist (role=tablist with its orientation, each row role=tab with aria-selected, aria-controls and a roving tabindex, the stage a tabpanel labelled by its tab); on a phone the rows are buttons with aria-expanded and the stage is a region',
    /role=\{phone \? 'group' : 'tablist'\}/.test(tour) &&
      /aria-orientation=\{phone \? undefined : tourOrientation\(layout\)\}/.test(tour) &&
      /\{ role: 'tab' as const, 'aria-selected': on, 'aria-controls': 'tour-stage', tabIndex: on \? 0 : -1 \}/.test(tour) &&
      /\{ 'aria-expanded': on && sel\.open, 'aria-controls': on && showStage \? 'tour-stage' : undefined \}/.test(tour) &&
      /role=\{phone \? 'region' : 'tabpanel'\}/.test(tour) &&
      /aria-labelledby=\{tourAnchor\(sel\.id\)\}/.test(tour) &&
      /id="tour-stage"/.test(tour) &&
      /<button\s+type="button"\s+\{\.\.\.role\}\s+id=\{tourAnchor\(s\.id\)\}/.test(tour),
  )
  const keys = tour.slice(tour.indexOf('const onListKey'), tour.indexOf('const side = tourSide'))
  check(
    "tour keyboard: the list's keys come from the pinned rule by the layout's orientation; a handled key is prevented and STOPPED (the markets index walks its rows with the same arrows on window), selects the side and moves focus to its tab; a phone's rows take no arrow keys",
    /onKeyDown=\{onListKey\}/.test(tour) &&
      /if \(phone \|\| e\.metaKey \|\| e\.ctrlKey \|\| e\.altKey\) return/.test(keys) &&
      /tourKeyTarget\(sel\.id, e\.key, tourOrientation\(layout\)\)/.test(keys) &&
      /if \(!to\) return/.test(keys) &&
      keys.indexOf('e.preventDefault()') > 0 &&
      keys.indexOf('e.stopPropagation()') > keys.indexOf('e.preventDefault()') &&
      /select\(to, 'key'\)/.test(keys) &&
      /tabRefs\.current\[to\]\?\.focus\(\)/.test(keys),
  )
  check(
    'tour stillness: NOTHING changes the side by itself — the shell holds no timer and no animation frame, the side is set in exactly two places (the visitor\'s own selection and the hash), and the selection is called only from a tap, a key and the foot\'s Next',
    !/setInterval|setTimeout|requestAnimationFrame|requestIdleCallback/.test(tour) &&
      count(tour, /\bsetSel\(/g) === 2 &&
      count(tour, /\bselect\((?!id: TourId)/g) === 3 &&
      /onClick=\{\(\) => select\(s\.id, 'tap'\)\}/.test(tour) &&
      /onClick=\{\(\) => select\(nextId, 'next'\)\}/.test(tour) &&
      !/infinite/.test(read('components/home/tour/tour.css')),
    `setSel ×${count(tour, /\bsetSel\(/g)} · select ×${count(tour, /\bselect\((?!id: TourId)/g)}`,
  )
  const writes = tour.match(/replaceState\([^\n]*/g) ?? []
  check(
    "tour address: a visitor's own selection writes the HASH with history.replaceState, keeping the router's state — never a navigation (no router, no pushState, no location write) and never a query string; hiding the tour puts the section's own anchor back so a reload does not re-open it",
    writes.length === 2 &&
      writes.every((w) => /^replaceState\(window\.history\.state, '', `#\$\{/.test(w)) &&
      /replaceState\(window\.history\.state, '', `#\$\{tourAnchor\(id\)\}`\)/.test(tour) &&
      /replaceState\(window\.history\.state, '', `#\$\{TOUR_ANCHOR\}`\)/.test(tour) &&
      !/useRouter|next\/navigation|pushState|location\.assign|location\.replace|location\.href\s*=|location\.hash\s*=|\?\$\{|['"`]\?[a-z]+=/.test(tour),
    writes.join(' | '),
  )
  check(
    'tour hash: `/#tour-<id>` is read in the browser after mount and on every hashchange through the pinned reader; it selects that side, opens the whole tour for this page view (a deep link shows what it names, whatever the posture) and brings it into view with scrollIntoView (never window.scrollTo)',
    /const id = parseTourHash\(window\.location\.hash\)/.test(tour) &&
      /window\.addEventListener\('hashchange', sync\)/.test(tour) &&
      /window\.removeEventListener\('hashchange', sync\)/.test(tour) &&
      /after\.current = \{ kind: 'land', id \}\s+setForced\(true\)\s+setSel\(\{ id, open: true \}\)/.test(tour) &&
      /scrollIntoView\(\{ block: 'start' \}\)/.test(tour) &&
      !/window\.scrollTo|scrollTo\(0/.test(tour),
  )
  check(
    'tour stage: ONE panel is mounted at a time — the selected side\'s, from the map — and none at all in the return posture or while a phone\'s row is folded; on a phone the same stage sits under its row',
    count(tour, /<Panel \/>/g) === 1 &&
      /const Panel = TOUR_PANELS\[sel\.id\]/.test(tour) &&
      /const showStage = !strip && sel\.open/.test(tour) &&
      /const stage = showStage \? \(/.test(tour) &&
      /\{phone && on && stage\}/.test(tour) &&
      /\{!phone && stage\}/.test(tour) &&
      count(tour, /<TourProvider /g) === 1 &&
      /key=\{sel\.id\}/.test(tour),
  )
  check(
    "tour posture: the shell reads the posture from <html> after mount (the server's is the stranger's), follows the home-mode event and the attribute itself, keeps nothing in storage of its own, and its two controls write the visitor's choice — Hide folds the tour to the strip, Show the tour brings it back",
    /useSyncExternalStore\(subscribeHomeMode, homeModeNow, homeModeOnServer\)/.test(tour) &&
      /document\.documentElement\.getAttribute\(HOME_MODE_ATTR\) === 'return' \? 'return' : 'new'/.test(tour) &&
      /const homeModeOnServer = \(\): HomeMode => 'new'/.test(tour) &&
      /window\.addEventListener\(HOME_MODE_EVENT, onChange\)/.test(tour) &&
      /attributeFilter: \[HOME_MODE_ATTR\]/.test(tour) &&
      /const strip = mode === 'return' && !forced/.test(tour) &&
      /setTourPref\('closed'\)/.test(tour) &&
      /setTourPref\('open'\)/.test(tour) &&
      /onClick=\{hide\}/.test(tour) &&
      /onClick=\{show\}/.test(tour) &&
      !/localStorage|sessionStorage/.test(tour),
  )
  const door = tour.slice(tour.indexOf('function StripDoor'), tour.indexOf('export default function Tour'))
  check(
    "tour strip: the returning visitor's eight doors come from the TABLE — each side's PRIMARY door (doors[0]), in the table's order — an on-page anchor as a plain link and every other door a LandingLink with no redirectTo; nothing on the strip is typed",
    /const door = side\.doors\[0\]/.test(door) &&
      /door\.href\.startsWith\('#'\) \? \(\s*<a href=\{door\.href\}/.test(door) &&
      /<LandingLink href=\{door\.href\} prefetch=\{false\}/.test(door) &&
      /'data-tour-door': side\.id/.test(door) &&
      /\{TOUR_SIDES\.map\(\(s\) => \(\s*<li key=\{s\.id\}>\s*<StripDoor side=\{s\} \/>/.test(tour) &&
      TOUR_SIDES.every((s) => s.doors[0].kind === 'primary') &&
      !/redirectTo|next\/link|href="\//.test(tour),
  )
  check(
    'tour journeys: every tab, the Next button, every strip door and both posture controls carry a journey label, so the flows page can say which side pulled a visitor in',
    /data-journey=\{tourJourney\(s\.id, 'tab'\)\}/.test(tour) && /data-journey=\{tourJourney\(nextId, 'next'\)\}/.test(tour) && /'data-journey': tourJourney\(side\.id, 'strip door'\)/.test(door) && /data-journey="Tour: hide the tour"/.test(tour) && /data-journey="Tour: show the tour"/.test(tour),
  )
  const icons = code('components/home/tour/icons.ts')
  check('tour icons: every side wears one icon, and the map names exactly the eight', TOUR_IDS.every((id) => new RegExp(`^\\s*${id}: [A-Z]\\w+,$`, 'm').test(icons)) && count(icons, /^\s*[a-z]+: [A-Z]\w+,$/gm) === TOUR_IDS.length)

  // ── The stylesheet (components/home/tour/tour.css) ──
  const css = read('components/home/tour/tour.css').replace(/\/\*[\s\S]*?\*\//g, '')
  const wide = block(css, '(min-width: 860px)')
  const mid = block(css, '(min-width: 560px) and (max-width: 859.98px)')
  const phone = block(css, '(max-width: 559.98px)')
  check(
    "tour layouts: three container queries on the tour's OWN width tile it with no gap (wide from 860px, mid 560–860, phone under 560) and each NAMES itself in --tour-layout for the shell to read back — the breakpoints are written once",
    /--tour-layout: wide;/.test(wide) &&
      /--tour-layout: mid;/.test(mid) &&
      /--tour-layout: phone;/.test(phone) &&
      count(css, /--tour-layout:/g) === 3 &&
      /container-type: inline-size; container-name: tour;/.test(css) &&
      /getPropertyValue\(TOUR_LAYOUT_PROP\)/.test(tour) &&
      /TOUR_LAYOUT_PROP = '--tour-layout'/.test(code('components/home/tour/stage.ts')),
  )
  check(
    "tour phone: the eight rows stay a LIST (each a full row at least 56px tall, its line and its index shown) and the open side sits under its own row before any script runs — the list dissolves into the column and `order` seats the stage by the selected row's index",
    /\.tour__list \{ display: contents; \}/.test(phone) &&
      /\.tour__tab \{ order: calc\(var\(--i, 0\) \* 2\);/.test(phone) &&
      /\.tour__stage \{ order: calc\(var\(--tour-at, 0\) \* 2 \+ 1\);/.test(phone) &&
      Number(/\.tour__tab \{[^}]*min-height: (\d+)px/.exec(phone)?.[1] ?? 0) >= 56 &&
      !/\.tour__tabline[^{]*\{[^}]*display: none/.test(phone) &&
      /style=\{\{ '--tour-at': at \} as CSSProperties\}/.test(tour) &&
      /style=\{\{ '--i': i \} as CSSProperties\}/.test(tour),
  )
  check(
    'tour mid: the list is ONE row of tabs that scrolls sideways (the row, never the page) with the selected tab kept in view and only an edge that hides something faded',
    /\.tour__list \{[^}]*overflow-x: auto;/.test(mid) && /\.tour__tabline \{ display: none; \}|\.tour__idx, \.tour__tabline \{ display: none; \}/.test(mid) && /row\.scrollTo\(\{ left:/.test(tour) && /\.tour__list\[data-more='both'\]/.test(css) && /row\.dataset\.more =/.test(tour),
  )
  check(
    "tour posture (CSS): ONE server HTML folds both ways before first paint — the stranger never sees the strip, the returning visitor never sees the full tour (unless a deep link forced it open) — on :root[data-home], with no React state in the fold",
    /:root:not\(\[data-home='return'\]\) \.tour__strip, \.tour\[data-tour-forced\] \.tour__strip \{ display: none; \}/.test(css) && /:root\[data-home='return'\] \.tour:not\(\[data-tour-forced\]\) \.tour__full \{ display: none; \}/.test(css),
  )
  check(
    'tour motion: a panel change is one short fade (the state duration, 160ms) that plays only after the visitor changed the side, and none under reduced motion; the stage holds a floor per layout so the boards below do not jump',
    /\.tour__panel\.is-in \{ animation: tour-in var\(--dur-1\) ease both; \}/.test(css) &&
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.tour__panel\.is-in \{ animation: none; \}/.test(css) &&
      /className=\{`tour__panel\$\{fade \? ' is-in' : ''\}`\}/.test(tour) &&
      /const \[fade, setFade\] = useState\(false\)/.test(tour) &&
      /min-height: max\(var\(--tour-floor-base, 0px\), var\(--tour-floor, 0px\)\)/.test(css) &&
      /--tour-floor-base:/.test(wide) &&
      /--tour-floor-base:/.test(mid),
  )
  check(
    'tour touch: under a coarse pointer every control of the shell is at least 44px on its short side (strip doors, show, hide, next, a row of tabs)',
    /@media \(pointer: coarse\) \{\s*\.tour__door, \.tour__show, \.tour__hide, \.tour__next \{ min-height: 44px; \}/.test(css) && /@media \(pointer: coarse\) \{[\s\S]*@container tour \(min-width: 560px\) and \(max-width: 859\.98px\) \{\s*\.tour__tab \{ min-height: 44px; \}/.test(css),
  )

  // ── The primitives the SIDES lanes build against (Panel.tsx / panel.css) ──
  const panel = code('components/home/tour/Panel.tsx')
  const pcss = read('components/home/tour/panel.css').replace(/\/\*[\s\S]*?\*\//g, '')
  const exportsKept = ['TourPanel', 'TourCopy', 'TourFacts', 'TourAskChip', 'TourAsks', 'TourDoors', 'TourDemo', 'TourDemoStub'].filter((n) => !new RegExp(`export function ${n}\\(`).test(panel))
  const classesKept = ['tpn-seat', 'tpn', 'tpn__copy', 'tpn__claim', 'tpn__body', 'tpn__facts', 'tpn__fact', 'tpn__asks', 'tpn__askslab', 'tpn__chips', 'tpn__chip', 'tpn__chip--accent', 'tpn__chiplabel', 'tpn__chipvia', 'tpn__doors', 'tpn__door', 'tpn__door--primary', 'tpn__door--quiet', 'tpn__arrow', 'tpn__demo', 'tpn__stub'].filter((c) => !new RegExp(`\\.${c}(?![\\w-])`).test(pcss))
  check('tour primitives: every export and every class name the panels are built against is still there (the looks are STAGE\'s; the names are a contract with the SIDES lanes)', exportsKept.length === 0 && classesKept.length === 0, [...exportsKept, ...classesKept].join(' ') || 'all kept')
  check(
    'tour primitives: a panel is a size container and goes to two columns from 600px of ITS OWN seat (the stage beside the list is narrower than a tablet), a chip is offered only when its venue can run it, and a door is a LandingLink or an on-page anchor',
    /\.tpn-seat \{ container-type: inline-size; container-name: tpn;/.test(pcss) && /@container tpn \(min-width: 600px\) \{\s*\.tpn \{ grid-template-columns: minmax\(0, 5fr\) minmax\(0, 6fr\);/.test(pcss) && /if \(!canAct\(ask\.ask\)\) return null/.test(panel) && /d\.href\.startsWith\('#'\) \? \(\s*<a /.test(panel) && /<LandingLink key=\{d\.href\} href=\{d\.href\}/.test(panel),
  )
}

export async function landingStagePinsServed(check: Check, base: string): Promise<void> {
  const res = await fetch(`${base}/`, { headers: { 'x-yf-internal-run': '1' } })
  const html = await res.text()
  const from = html.indexOf('id="tour"')
  const tourHtml = html.slice(Math.max(0, html.lastIndexOf('<section', from)), html.indexOf('class="mkt-frame__data"') > 0 ? html.indexOf('class="mkt-frame__data"') : undefined)
  const tabs = tourHtml.match(/<button[^>]*data-tour-tab="[a-z]+"[^>]*>/g) ?? []
  const idOf = (tag: string) => /data-tour-tab="([a-z]+)"/.exec(tag)?.[1] ?? ''
  check(
    "tour (served): the section is in the server HTML with all EIGHT rows in the table's order — each a real tab carrying its own anchor id, its label and its one line — inside one tablist, the first selected and the only one in the tab order",
    res.status === 200 &&
      from > 0 &&
      tabs.map(idOf).join() === TOUR_IDS.join() &&
      tabs.every((t) => t.includes(`id="${tourAnchor(idOf(t) as TourId)}"`) && /role="tab"/.test(t) && /aria-controls="tour-stage"/.test(t)) &&
      tabs.filter((t) => /aria-selected="true"/.test(t)).map(idOf).join() === TOUR_IDS[0] &&
      tabs.filter((t) => /tabindex="0"/.test(t)).map(idOf).join() === TOUR_IDS[0] &&
      // The tour's OWN tablist, once. A panel may hold a tablist of its own (Charts switches three markets, Build three snippets): that is a nested widget inside the tabpanel, not a second list of sides. (Coordinator, after SIDES-A merged.)
      (tourHtml.match(/class="tour__list" role="tablist"/g) ?? []).length === 1 &&
      TOUR_SIDES.every((s) => tourHtml.includes(`>${esc(s.label)}</span>`) && tourHtml.includes(esc(s.line))),
    tabs.map(idOf).join(',') || `status ${res.status}`,
  )
  check(
    "tour (served): the stage is in the server HTML as the first side's tabpanel with exactly ONE panel mounted, and its foot offers the next side",
    /<div[^>]*id="tour-stage"[^>]*>/.test(tourHtml) &&
      /role="tabpanel"/.test(/<div[^>]*id="tour-stage"[^>]*>/.exec(tourHtml)?.[0] ?? '') &&
      new RegExp(`data-tour-stage="${TOUR_IDS[0]}"`).test(tourHtml) &&
      (tourHtml.match(/data-tour-panel="/g) ?? []).length === 1 &&
      tourHtml.includes(`data-tour-panel="${TOUR_IDS[0]}"`) &&
      tourHtml.includes(`data-tour-next="${TOUR_IDS[1]}"`) &&
      tourHtml.includes(tourPosition(TOUR_IDS[0]).label),
  )
  const doors = tourHtml.match(/<a[^>]*data-tour-door="[a-z]+"[^>]*>/g) ?? []
  const doorId = (tag: string) => /data-tour-door="([a-z]+)"/.exec(tag)?.[1] ?? ''
  check(
    "tour (served): the returning visitor's strip is in the SAME HTML — eight doors in the table's order, each opening its side's primary door — with the controls that fold and unfold the tour, so the posture is a CSS fold and nothing jumps",
    /data-tour-strip/.test(tourHtml) &&
      doors.map(doorId).join() === TOUR_IDS.join() &&
      doors.every((d) => d.includes(`href="${esc(tourSide(doorId(d) as TourId).doors[0].href)}"`) && /data-journey="Tour [^"]+: strip door"/.test(d)) &&
      /data-tour-show/.test(tourHtml) &&
      /data-tour-hide/.test(tourHtml) &&
      /data-tour-full/.test(tourHtml),
    doors.map((d) => /href="([^"]*)"/.exec(d)?.[1]).join(' '),
  )
  check(
    'tour (served): the head is one h2 that counts the table (the page keeps its single h1), and the tour writes no query-string link to a side',
    tourHtml.includes(`>${esc(tourTitle())}</h2>`) && (tourHtml.match(/<h2[\s>]/g) ?? []).length === 1 && (tourHtml.match(/<h1[\s>]/g) ?? []).length === 0 && !/\?tour=|\?side=/.test(tourHtml),
  )
}

if (process.argv[1]?.endsWith('landing-stage-pins.ts')) {
  let failed = 0
  let n = 0
  const check: Check = (name, ok, extra) => {
    n++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
    if (!ok) failed++
  }
  const served = process.argv.includes('--served')
  Promise.resolve()
    .then(() => landingStagePins(check))
    .then(() => (served ? landingStagePinsServed(check, process.env.BASE ?? 'http://localhost:3000') : undefined))
    .then(() => {
      console.log(failed ? `\n${failed} failed` : `\nall green (${n})`)
      process.exit(failed ? 1 : 0)
    })
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
