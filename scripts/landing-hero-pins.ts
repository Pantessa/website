// Pins for squad landing, lane HERO (2026-11-10): the stranger's hero and the returning visitor's one-line claim.
// THE LANE OWNS THIS FILE. It is already wired into scripts/test-api.ts and
// package.json by the contract commit — fill the two functions, never edit
// the harness. Pure checks (rules, tables, source) go in the first; checks
// against a running server go in the second.
//   npx tsx scripts/landing-hero-pins.ts            (npm run pins:landing-hero)
//   BASE=http://localhost:PORT npx tsx scripts/landing-hero-pins.ts --served
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { walletRemembered } from '../lib/app-entry'
import { chartPairFor } from '../lib/charts'
import {
  HOME_MODE_ATTR,
  HOME_MODE_BOOTSTRAP,
  HOME_RETURN_DAYS,
  HOME_TOUR_PREF_KEY,
  HOME_USER_KEY,
  HOME_USER_MARK,
  HOME_VISITS_KEY,
  homeModeForPref,
  homeModeFrom,
  noteVisit,
  parseVisits,
  sessionMemo,
} from '../lib/home-mode'
import { TOUR_ANCHOR } from '../lib/home-tour'
import { STORY_HREF, marketSections } from '../lib/markets'
import { HERO_LINE, SPLASH } from '../lib/markets-copy'

type Check = (name: string, ok: boolean, extra?: string) => void

const ROOT = new URL('..', import.meta.url).pathname
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
/** Source with comments removed: a rule is read from code, never from prose. */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
const css = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '')
/** The declarations of the FIRST top-level rule whose selector is exactly `sel`. */
const rule = (sheet: string, sel: string) => (sheet.match(new RegExp(`^${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`, 'm')) ?? ['', ''])[1]
/** The body of the LAST `@container hero (max-width: Npx) { … }` block (rules inside are indented two spaces). */
const block = (sheet: string, head: string) => {
  const at = sheet.lastIndexOf(head)
  if (at < 0) return ''
  const end = sheet.indexOf('\n}', at)
  return sheet.slice(at, end < 0 ? undefined : end)
}

const CLAIM = 'components/home/SplashClaim.tsx'
const SHEET = 'components/home/hero.css'
const SYNC = 'components/home/HomeModeSync.tsx'

/** What a stranger is folded out of in the returning visitor's line. */
const STRANGER_ONLY = ['.mk-claim__eyebrow', '.mk-claim__sub', '.mk-claim__doors', '.mk-claim__proofs']

export function landingHeroPins(check: Check): void {
  // ── The words ──
  const words = [SPLASH.eyebrow[0], SPLASH.eyebrow[1], SPLASH.sub, SPLASH.tourDoor, SPLASH.chartDoor, SPLASH.returnTour, SPLASH.door, ...SPLASH.proofs.flatMap((p) => [p.lead, p.rest])]
  const FENCE = /yeetful|\bdune\b|telegram|discord|prime broker|guarantee|risk[- ]free|\bpassive income\b|get rich|to the moon|financial advice|fully automatic/i
  const typed = words.filter((w) => /\d/.test(w.replace(/24\/7/g, '')))
  check(
    "hero words: the h1 is HERO_LINE; the eyebrow says whose page this is first; three proofs, each a bold lead and the rest of its sentence (no custody, no sign-up to look, free to look); no count, fee or rate is typed (\"24/7\" is a word); nothing the product cannot keep (no bot, no partner, no guarantee, no advice, never the old brand)",
    SPLASH.h1 === HERO_LINE &&
      SPLASH.eyebrow.length === 2 &&
      SPLASH.eyebrow[0] === 'Pantessa' &&
      SPLASH.eyebrow[1].length > 0 &&
      SPLASH.eyebrow[1].length <= 40 &&
      SPLASH.proofs.length === 3 &&
      SPLASH.proofs.every((p) => p.lead.length > 0 && p.rest.length > 0 && `${p.lead} ${p.rest}`.length <= 44 && /[.]$/.test(p.rest)) &&
      /custody/i.test(SPLASH.proofs[0].lead) &&
      /wallet signs/i.test(SPLASH.proofs[0].rest) &&
      /sign-up/i.test(SPLASH.proofs[1].lead) &&
      /free/i.test(SPLASH.proofs[2].lead) &&
      /charts, watchlists and alerts/.test(SPLASH.proofs[2].rest) &&
      typed.length === 0 &&
      words.every((w) => !FENCE.test(w)),
    typed.join(' | ') || `${words.length} strings`,
  )
  const equities = marketSections().find((s) => s.id === 'equities')?.rows.map((r) => r.symbol) ?? []
  check(
    "hero doors (words): the primary door says where it goes in five words at most; the second names a chart that EXISTS — a listed equity with a chart pair — and stays short enough to share a phone's row; the returning visitor's door is one word",
    SPLASH.tourDoor.split(/\s+/).length <= 5 &&
      /everything/i.test(SPLASH.tourDoor) &&
      SPLASH.chartDoor.length <= 14 &&
      /chart/i.test(SPLASH.chartDoor) &&
      equities.includes(SPLASH.chartSymbol) &&
      !!chartPairFor(SPLASH.chartSymbol) &&
      SPLASH.returnTour.split(/\s+/).length === 1,
    `${SPLASH.tourDoor} · ${SPLASH.chartDoor} ${SPLASH.chartSymbol} · ${SPLASH.returnTour}`,
  )

  // ── One HTML, no React state: the posture is the attribute ──
  const claim = code(CLAIM)
  check(
    'hero posture: the block holds NO state and reads nothing about the visitor — no useState, effect, session, wallet, guide record or storage — so the server HTML is the final HTML and the block cannot change height after it is drawn (the old post-hydration `data-compact` is gone)',
    !/useState|useEffect|useLayoutEffect|useReducer|useSyncExternalStore|useSession|useAccount|getGuideState|useGuideState|localStorage|sessionStorage|data-compact|window\.location|dataset\.home/.test(claim) &&
      /<header className="mk-claim" data-splash-claim>/.test(claim) &&
      /import '\.\/hero\.css'/.test(claim),
  )
  check(
    'hero markup: ONE h1 (HERO_LINE as one text node, the class the harness reads), the sentence, the eyebrow before it and the proofs after — every piece of both postures is in the one render',
    (claim.match(/<h1\b/g) ?? []).length === 1 &&
      /<h1 className="mk-claim__h1">\{SPLASH\.h1\}<\/h1>/.test(claim) &&
      /<p className="mk-claim__sub">\{SPLASH\.sub\}<\/p>/.test(claim) &&
      /\{SPLASH\.proofs\.map\(/.test(claim) &&
      ['mk-claim__eyebrow', 'mk-claim__h1', 'mk-claim__sub', 'mk-claim__doors', 'mk-claim__acts', 'mk-claim__tour', 'mk-claim__door mono', 'mk-claim__proofs'].every((c, i, a) => claim.indexOf(`"${c}`) >= 0 && (i === 0 || claim.indexOf(`"${a[i - 1]}`) < claim.indexOf(`"${c}`))),
  )

  // ── The fold, both ways, in CSS ──
  const sheet = css(SHEET)
  const homeSelectors = sheet.match(/:root\[data-home[^\]]*\]/g) ?? []
  const fold = new RegExp(`^:root\\[data-home='return'\\] :is\\(${STRANGER_ONLY.map((s) => s.replace('.', '\\.')).join(', ')}\\) \\{ display: none; \\}$`, 'm')
  check(
    "hero fold: the stranger's hero is the DEFAULT (the server HTML carries no attribute, and a browser with scripts off reads the full hero); every posture rule keys on `:root[data-home='return']` and nothing keys on 'new'; the returning line hides the eyebrow, the sentence, both doors and the proofs in one rule",
    homeSelectors.length >= 4 && homeSelectors.every((s) => s === ":root[data-home='return']") && fold.test(sheet) && !/data-compact/.test(sheet),
    `${homeSelectors.length} posture selectors`,
  )
  check(
    "hero fold: the door back to the tour is the mirror — hidden for a stranger, shown only in the returning line — and that line is one row (the claim, then the quiet doors) with the h1 at the list size, not the display size",
    /^\.mk-claim \.mk-claim__tour \{ display: none; \}$/m.test(sheet) &&
      /^:root\[data-home='return'\] \.mk-claim \.mk-claim__tour \{ display: inline-flex; \}$/m.test(sheet) &&
      /grid-template-areas: "main acts";/.test(rule(sheet, ":root[data-home='return'] .mk-claim__in")) &&
      /row-gap: 0;/.test(rule(sheet, ":root[data-home='return'] .mk-claim__in")) &&
      /font-size: var\(--fs-xl\);/.test(rule(sheet, ":root[data-home='return'] .mk-claim__h1")),
  )
  const markets = css('components/markets/markets.css')
  check(
    'hero sheet: every rule for the block lives in ONE sheet beside the component (markets.css styles no `.mk-claim`), so two sheets never argue about order',
    !/\.mk-claim/.test(markets) && /^\.mk-claim \{/m.test(sheet),
  )

  // ── Budgets, as rules ──
  const phone = block(sheet, '@container hero (max-width: 559px) {\n  .mk-claim__in')
  const phoneReturn = block(sheet, "@container hero (max-width: 559px) {\n  :root[data-home='return']")
  check(
    "hero budgets: the block sizes by ITS OWN width (a size container; no viewport query, no vw) — the h1 is one clamp from a phone's line set across the column to the display size; the sentence is at reading size",
    /container-type: inline-size;/.test(rule(sheet, '.mk-claim')) &&
      /container-name: hero;/.test(rule(sheet, '.mk-claim')) &&
      !/@media \((?:max|min)-width/.test(sheet) &&
      !/\d(?:vw|vh|dvh)\b/.test(sheet) &&
      /font-size: clamp\(1\.75rem, 9\.3cqi, 3\.25rem\);/.test(rule(sheet, '.mk-claim__h1')) &&
      /font-size: var\(--fs-lg\);/.test(rule(sheet, '.mk-claim__sub')) &&
      /text-wrap: balance;/.test(rule(sheet, '.mk-claim__sub')),
  )
  check(
    "hero budgets (phone): in a phone's column the eyebrow, the share and the symbol chip give up their room, both doors hold ONE row (no wrap) at 44px, and the returning line there is the claim and the door back to the tour only",
    /\.mk-claim__eyebrow \{ display: none; \}/.test(phone) &&
      /\.mk-claim__share \{ display: none; \}/.test(phone) &&
      /\.mk-claim__sym \{ display: none; \}/.test(phone) &&
      /\.mk-claim__doors \{ flex-wrap: nowrap;/.test(phone) &&
      /\.mk-claim__go \{ min-height: 44px;/.test(phone) &&
      /\.mk-claim__try \{ min-height: 44px;/.test(phone) &&
      /\.mk-claim \.mk-claim__door, \.mk-claim \.mk-claim__tour \{ min-height: 44px;/.test(phone) &&
      /\.mk-claim \.mk-claim__tour \{ min-width: 44px;/.test(phone) &&
      /:root\[data-home='return'\] \.mk-claim \.mk-claim__door \{ display: none; \}/.test(phoneReturn),
  )
  check(
    'hero look: tokens only (no literal colour, no px type, no px radius), the one signature is the proofs\' rule cut in the five gem steps, a thumb gets 44px on any coarse pointer, nothing is sticky or fixed, and the sheet answers reduced motion',
    !/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|font-size:\s*[\d.]+px|border-radius:\s*[1-9][\d.]*px/.test(sheet) &&
      [1, 2, 3, 4, 5].every((n) => rule(sheet, '.mk-claim__proofs::before').includes(`var(--gem-${n})`)) &&
      /@media \(pointer: coarse\) \{\s*\.mk-claim__go, \.mk-claim__try, \.mk-claim \.mk-claim__door, \.mk-claim \.mk-claim__tour \{ min-height: 44px; \}/.test(sheet) &&
      !/position:\s*(sticky|fixed)/.test(sheet) &&
      /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*transition: none;/.test(sheet) &&
      !/animation\s*:/.test(sheet),
  )

  // ── Doors ──
  const journeys = claim.match(/data-journey=\{`Hero: /g) ?? []
  check(
    "hero doors: the tour is an anchor on this page (`#tour`, from the tour's own constant); the chart is a SpineLink to /t/<symbol> (a public page: a plain link); /story is a plain un-prefetched link (a brochure page — a SpineLink would hold a stranger at the sign-in door); no redirectTo, no `?prompt=`, no bare <Link> into the shell; every door of the hero carries a `Hero: …` journey label",
    /const TOUR_HREF = `#\$\{TOUR_ANCHOR\}`/.test(claim) &&
      TOUR_ANCHOR === 'tour' &&
      /<a href=\{TOUR_HREF\} className="mk-claim__go" onClick=\{toTour\} data-hero-door="tour"/.test(claim) &&
      /<SpineLink href=\{`\/t\/\$\{SPLASH\.chartSymbol\}`\} className="mk-claim__try" prefetch=\{false\} data-hero-door="chart"/.test(claim) &&
      /<a href=\{TOUR_HREF\} className="mk-claim__tour mono" onClick=\{reopenTour\} data-hero-door="reopen"/.test(claim) &&
      /<Link href=\{STORY_HREF\} className="mk-claim__door mono" prefetch=\{false\} data-splash-door>/.test(claim) &&
      STORY_HREF === '/story' &&
      (claim.match(/<Link\b/g) ?? []).length === 1 &&
      !/redirectTo|\?prompt=|openConnectModal/.test(claim) &&
      journeys.length === 3,
    `${journeys.length} journey labels`,
  )
  check(
    "hero doors (behaviour): a pointer click glides to the tour with scrollIntoView (the phone frame scrolls inside an element — never window.scrollTo), instantly under reduced motion; a keyboard press or a modified click keeps the browser's own anchor jump; the returning visitor's door writes their choice FIRST (setTourPref('open')), then goes — and nothing writes the hash or calls the router",
    /e\.detail > 0 && e\.button === 0 && !e\.metaKey && !e\.ctrlKey && !e\.shiftKey && !e\.altKey/.test(claim) &&
      /scrollIntoView\(\{ block: 'start', behavior: calm \? 'auto' : 'smooth' \}\)/.test(claim) &&
      /prefers-reduced-motion: reduce/.test(claim) &&
      !/window\.scrollTo|scrollTop\s*=|useRouter|router\.|history\.|location\.hash/.test(claim) &&
      /const reopenTour = \(e: MouseEvent<HTMLAnchorElement>\) => \{\s*setTourPref\('open'\)\s*if \(!glides\(e\)\) return/.test(claim),
  )

  // ── The rule, with the remembered session ──
  const today = new Date().toISOString().slice(0, 10)
  const cases: Array<{ pref: string | null; n: number; day: string; wallet: 'on' | 'off' | 'gone'; user: string | null }> = []
  for (const pref of [null, 'open', 'closed', 'junk']) for (const n of [0, 1, HOME_RETURN_DAYS - 1, HOME_RETURN_DAYS]) for (const day of ['', 'today', '2020-01-01']) for (const wallet of ['on', 'off', 'gone'] as const) for (const user of [null, HOME_USER_MARK, 'true', '0']) cases.push({ pref, n, day, wallet, user })
  const disagree: string[] = []
  for (const c of cases) {
    const store = new Map<string, string>()
    if (c.pref) store.set(HOME_TOUR_PREF_KEY, c.pref)
    const visits = c.n || c.day ? JSON.stringify({ n: c.n, day: c.day === 'today' ? today : c.day }) : null
    if (visits) store.set(HOME_VISITS_KEY, visits)
    if (c.wallet !== 'gone') store.set('wagmi.recentConnectorId', JSON.stringify('injected'))
    if (c.wallet === 'off') store.set('wagmi.injected.disconnected', 'true')
    if (c.user) store.set(HOME_USER_KEY, c.user)
    const want = homeModeFrom({
      pref: c.pref,
      visitDays: noteVisit(parseVisits(visits), today).n,
      walletRemembered: walletRemembered((k) => store.get(k) ?? null),
      sessionRemembered: c.user === HOME_USER_MARK,
    })
    const attrs = new Map<string, string>()
    vm.runInNewContext(HOME_MODE_BOOTSTRAP, {
      document: { documentElement: { setAttribute: (k: string, v: string) => attrs.set(k, v) } },
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    })
    if (attrs.get(HOME_MODE_ATTR) !== want) disagree.push(JSON.stringify(c))
  }
  check(
    "hero posture rule: a browser that held a signed-in session the last time the home looked is a user (the session is an httpOnly cookie, so the home REMEMBERS it); only the exact mark counts; the visitor's own choice still wins over it; and the inline script that runs before first paint agrees with the rule on every case",
    homeModeFrom({ pref: null, visitDays: 1, walletRemembered: false, sessionRemembered: true }) === 'return' &&
      homeModeFrom({ pref: null, visitDays: 1, walletRemembered: false, sessionRemembered: false }) === 'new' &&
      homeModeFrom({ pref: null, visitDays: 1, walletRemembered: false }) === 'new' &&
      homeModeFrom({ pref: 'open', visitDays: 9, walletRemembered: true, sessionRemembered: true }) === 'new' &&
      homeModeFrom({ pref: 'closed', visitDays: 1, walletRemembered: false, sessionRemembered: false }) === 'return' &&
      HOME_USER_KEY.startsWith('pantessa.home.') &&
      HOME_MODE_BOOTSTRAP.includes(HOME_USER_KEY) &&
      disagree.length === 0,
    disagree.length ? `${disagree.length}/${cases.length} disagree, first ${disagree[0]}` : `${cases.length} cases agree`,
  )
  check(
    "hero posture rule: the session's record follows what is KNOWN — a signed-in session sets it, a guest clears it, a session still loading leaves it alone (a slow answer never forgets a user); a control's choice maps straight to the posture it puts on the page",
    sessionMemo('authed') === 'set' && sessionMemo('guest') === 'clear' && sessionMemo('loading') === null && homeModeForPref('open') === 'new' && homeModeForPref('closed') === 'return',
  )
  const sync = code(SYNC)
  const sessionEffect = sync.slice(sync.indexOf('useEffect(() => {'))
  const layoutEffect = sync.slice(sync.indexOf('useLayoutEffect(() => {'), sync.indexOf('useEffect(() => {'))
  check(
    "hero no-jump: a drawn page never changes posture by itself — the session's effect only WRITES the record (no attribute, no event), the posture is applied in a layout effect before the first paint of a soft navigation (a session already known there folds it at once) and again only for another tab's choice; the visitor's own controls go through setTourPref, which writes the choice, sets the attribute and tells the listeners",
    sessionEffect.length > 0 &&
      /const memo = sessionMemo\(status\)/.test(sessionEffect) &&
      /setItem\(HOME_USER_KEY, HOME_USER_MARK\)/.test(sessionEffect) &&
      /removeItem\(HOME_USER_KEY\)/.test(sessionEffect) &&
      !/setAttribute|applyMode|dispatchEvent|setTourPref/.test(sessionEffect) &&
      /const atMount = useRef\(status\)/.test(sync) &&
      /applyMode\(readMode\(atMount\.current === 'authed'\)\)/.test(layoutEffect) &&
      /e\.key === null \|\| e\.key === HOME_TOUR_PREF_KEY/.test(layoutEffect) &&
      /\}, \[\]\)/.test(layoutEffect) &&
      /export function setTourPref\(pref: 'open' \| 'closed'\): void \{[\s\S]*?setItem\(HOME_TOUR_PREF_KEY, pref\)[\s\S]*?setAttribute\(HOME_MODE_ATTR, homeModeForPref\(pref\)\)[\s\S]*?dispatchEvent\(new Event\(HOME_MODE_EVENT\)\)/.test(sync) &&
      /export const HOME_MODE_EVENT = 'pantessa:home-mode'/.test(sync),
  )
}

export async function landingHeroPinsServed(check: Check, base: string): Promise<void> {
  const HDR = { 'x-yf-internal-run': '1' }
  const res = await fetch(`${base}/`, { headers: HDR })
  // React SSR separates adjacent text nodes with `<!-- -->`; a pin reads the words, not the seams.
  const html = (await res.text()).replace(/<!--\s*-->/g, '')
  const from = html.indexOf('class="mk-claim"')
  const hero = from < 0 ? '' : html.slice(from, html.indexOf('class="mkt-frame__bar"', from))
  const at = (s: string) => hero.indexOf(s)
  const order = ['class="mk-claim__eyebrow', `<h1 class="mk-claim__h1">${HERO_LINE}</h1>`, 'class="mk-claim__sub"', 'data-hero-door="tour"', 'data-hero-door="chart"', 'data-hero-door="reopen"', 'data-splash-door="true"', 'class="mk-claim__proofs"']
  check(
    "hero (served): `/` opens on the hero in the stranger's posture — the header keeps `mk-claim` + data-splash-claim, HERO_LINE is the page's ONE h1 (one text node), and the eyebrow, the sentence, both doors, the door back to the tour, the story door and the proofs are all in the server HTML in reading order, above the tool strip; no post-hydration flag is rendered",
    res.status === 200 &&
      hero.length > 0 &&
      /<header class="mk-claim" data-splash-claim="true">/.test(html) &&
      (html.match(/<h1[\s>]/g) ?? []).length === 1 &&
      order.every((s, i) => at(s) >= 0 && (i === 0 || at(order[i - 1]) < at(s))) &&
      hero.includes(SPLASH.sub) &&
      hero.includes(SPLASH.eyebrow[0]) &&
      hero.includes(SPLASH.eyebrow[1]) &&
      !/data-compact/.test(hero),
    `status ${res.status} · missing ${order.filter((s) => at(s) < 0).join(' | ') || 'none'}`,
  )
  const tag = (marker: string) => (hero.match(new RegExp(`<a\\b[^>]*${marker}[^>]*>`)) ?? [''])[0]
  check(
    "hero (served): the doors are real links a crawler and a script-less browser can follow — the primary one to `#tour` (and the page HAS that section), the chart to /t/<symbol>, the way back to `#tour`, the story to /story — each with its `Hero:` journey label; the hero writes no `/chat?prompt=` link",
    /href="#tour"/.test(tag('data-hero-door="tour"')) &&
      tag('data-hero-door="tour"').includes(`data-journey="Hero: ${SPLASH.tourDoor}"`) &&
      new RegExp(`href="/t/${SPLASH.chartSymbol}"`).test(tag('data-hero-door="chart"')) &&
      /data-journey="Hero: /.test(tag('data-hero-door="chart"')) &&
      /href="#tour"/.test(tag('data-hero-door="reopen"')) &&
      /data-journey="Hero: /.test(tag('data-hero-door="reopen"')) &&
      /<a class="mk-claim__door mono" data-splash-door="true" href="\/story">What is this\?/.test(hero) &&
      /id="tour"/.test(html) &&
      !/\/chat\?prompt=/.test(hero),
    tag('data-hero-door="tour"').slice(0, 120),
  )
  check(
    'hero (served): the three proofs read as written, a bold lead and the rest of its sentence, with the space between them kept',
    SPLASH.proofs.every((p) => hero.includes(`<b>${p.lead}</b> <span>${p.rest}</span>`)),
    SPLASH.proofs.map((p) => p.lead).join(' '),
  )
  // The fold ships: some stylesheet the page links carries the return rule and the mirror for the tour door.
  const sheets = [...new Set([...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+\.css[^"]*)"/g), ...html.matchAll(/<link[^>]+href="([^"]+\.css[^"]*)"[^>]*rel="stylesheet"/g)].map((m) => m[1]))]
  const bodies = await Promise.all(
    sheets.map(async (href) => {
      try {
        return await (await fetch(new URL(href, base), { headers: HDR })).text()
      } catch {
        return ''
      }
    }),
  )
  const all = bodies.join('\n')
  const foldRule = (all.match(/:root\[data-home=["']?return["']?\] :is\(([^)]*)\)\{display:none/) ?? ['', ''])[1]
  check(
    "hero (served): the CSS the page links folds the hero for a returning visitor — one rule on `:root[data-home=return]` hides the eyebrow, the sentence, the doors and the proofs — and shows the door back to the tour only there",
    sheets.length > 0 &&
      STRANGER_ONLY.every((s) => foldRule.includes(s)) &&
      /\.mk-claim \.mk-claim__tour\{display:none\}/.test(all) &&
      /:root\[data-home=["']?return["']?\] \.mk-claim \.mk-claim__tour\{display:inline-flex\}/.test(all),
    `${sheets.length} sheets · fold: ${foldRule || 'not found'}`,
  )
  const opens = await Promise.all(
    [`/t/${SPLASH.chartSymbol}`, STORY_HREF].map(async (href) => {
      try {
        return `${href} ${(await fetch(`${base}${href}`, { headers: HDR, redirect: 'manual' })).status}`
      } catch (e) {
        return `${href} ${(e as Error).message}`
      }
    }),
  )
  check("hero (served): the chart the second door names and the story both answer 200", opens.every((o) => o.endsWith(' 200')), opens.join(' · '))
}

if (process.argv[1]?.endsWith('landing-hero-pins.ts')) {
  let failed = 0
  let n = 0
  const check: Check = (name, ok, extra) => {
    n++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
    if (!ok) failed++
  }
  const served = process.argv.includes('--served')
  Promise.resolve()
    .then(() => landingHeroPins(check))
    .then(() => (served ? landingHeroPinsServed(check, process.env.BASE ?? 'http://localhost:3000') : undefined))
    .then(() => {
      console.log(failed ? `\n${failed} failed` : `\nall green (${n})`)
      process.exit(failed ? 1 : 0)
    })
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
