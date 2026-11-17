// Pins for squad landing, the COORDINATOR's contract (2026-11-10): the
// rules every lane builds inside, as checks. The tour's table (eight sides
// in order, a door into each, no typed number, no word the product cannot
// keep), the seats on the home, the page staying a 60-second static page,
// the posture flag before first paint, and the fences over the landing's
// source and CSS (SpineLink doors, no stream, no chart engine, tokens only).
// Wired into test-api.
//   npx tsx scripts/landing-coord-pins.ts            (npm run pins:landing)
//   BASE=http://localhost:PORT npx tsx scripts/landing-coord-pins.ts --served
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import { CREATOR_FEE_SPLIT, LINK_SWAP_FEE_BPS, feePctLabel } from '../lib/fees'
import { readyPages } from '../lib/docs'
import { HOME_APPS } from '../lib/home-apps'
import { HOME_MODE_ATTR, HOME_MODE_BOOTSTRAP, HOME_RETURN_DAYS, HOME_TOUR_PREF_KEY, HOME_VISITS_KEY, homeModeFrom, noteVisit, parseVisits } from '../lib/home-mode'
import { EMPTY_TOUR, TOUR_ANCHOR, TOUR_IDS, TOUR_SIDES, fillSlots, isTourId, parseTourHash, tourAnchor, tourBody, tourFacts, tourJourney, tourSide, type TourSnapshot } from '../lib/home-tour'
import { staticTourSnapshot, tourFees, tourStaticCounts } from '../lib/home-tour-server'
import { marketSections } from '../lib/markets'
import { isHomeAnchorHref, isSignedInAppHref } from '../lib/home-doors'

type Check = (name: string, ok: boolean, extra?: string) => void

const ROOT = new URL('..', import.meta.url).pathname
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
/** Source with comments removed, so a rule is read from code and never from prose. */
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')

function walk(dir: string, exts: string[]): string[] {
  const abs = join(ROOT, dir)
  if (!existsSync(abs)) return []
  const out: string[] = []
  for (const name of readdirSync(abs)) {
    const rel = `${dir}/${name}`
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...walk(rel, exts))
    else if (exts.some((e) => name.endsWith(e))) out.push(rel)
  }
  return out
}

/** The landing's own source: everything this squad adds to the home. */
const LANDING_TSX = () => [...walk('components/home/tour', ['.tsx', '.ts']), 'components/home/HowItWorks.tsx', 'components/home/ClosingDoors.tsx', 'components/home/HomeModeSync.tsx'].filter((p) => existsSync(join(ROOT, p)))
const LANDING_CSS = () => [...walk('components/home/tour', ['.css']), 'components/home/how.css', 'components/home/closing.css', 'components/home/hero.css'].filter((p) => existsSync(join(ROOT, p)))

/** Anchors the home already owns (the boards) plus the tour's own. */
const PAGE_ANCHORS = new Set(['#earn', '#macro', '#equities', '#crypto', '#perps', `#${TOUR_ANCHOR}`])

/** Does a door's path exist as a route? `/docs/<slug>` must be a READY docs page. */
function routeExists(href: string): boolean {
  const path = href.split(/[?#]/)[0]
  if (path === '/') return true
  const segs = path.split('/').filter(Boolean)
  if (segs[0] === 'docs' && segs.length === 2) return readyPages().some((p) => p.slug === segs[1])
  return existsSync(join(ROOT, 'app', segs[0]))
}

const FULL: TourSnapshot = {
  ...EMPTY_TOUR,
  asOf: 1,
  counts: { stocks: 199, crypto: 36, macro: 14, apps: 11, chains: 6, venues: 13, pinnedAddresses: 49, earnWays: 36 },
  fees: { swapPct: '0.20%', linkPct: '0.50%', creatorPct: '0.25%', hlPct: '0.1%', swapBps: 20, linkBps: 50, creatorSplit: 0.5 },
}

export function landingCoordPins(check: Check): void {
  // ── The table ──
  const ids = TOUR_SIDES.map((s) => s.id)
  check(
    'tour table: eight sides in the order a stranger should meet them (where you look, how you ask, how it spreads, what runs while you are away, who else is here, what idle money earns, where it sits, how to build on it); the table follows TOUR_IDS; ids are unique and tourSide() finds each',
    TOUR_IDS.join() === 'charts,ask,links,autopilots,community,earn,wallet,build' && ids.join() === TOUR_IDS.join() && new Set(ids).size === 8 && TOUR_IDS.every((id) => tourSide(id).id === id && isTourId(id)) && !isTourId('markets') && !isTourId(null),
    ids.join(','),
  )
  const shapeBad = TOUR_SIDES.filter(
    (s) =>
      !s.label ||
      s.label.length > 12 ||
      !s.claim ||
      s.claim.length > 64 ||
      !/[.?!]$/.test(s.claim) ||
      !s.line ||
      s.line.length > 64 ||
      !s.body ||
      s.body.length > 300 ||
      (s.body.match(/[.?!](\s|$)/g) ?? []).length > 3 ||
      s.facts.length > 3 ||
      s.facts.some((f) => f.length > 90) ||
      s.asks.length > 5,
  )
  check(
    "tour table: every side's words fit their seats — a label of one or two words (12 characters), a claim that is one short sentence (64), one line for the list (64), a body of three sentences at most (300), three facts at most (90 each), five sentences at most",
    shapeBad.length === 0,
    shapeBad.map((s) => s.id).join(',') || 'all fit',
  )
  const doorBad = TOUR_SIDES.filter((s) => s.doors.length < 1 || s.doors.length > 3 || s.doors[0].kind !== 'primary' || s.doors.filter((d) => d.kind === 'primary').length !== 1 || s.doors.some((d) => !d.label || d.label.split(/\s+/).length > 5))
  check('tour table: every side has ONE primary door, first, and at most two quiet ones; a door says a verb and its object in five words at most', doorBad.length === 0, doorBad.map((s) => s.id).join(',') || 'all good')
  const hrefs = TOUR_SIDES.flatMap((s) => s.doors.map((d) => ({ id: s.id, href: d.href })))
  const hrefBad = hrefs.filter(({ href }) => {
    if (href.startsWith('#')) return !PAGE_ANCHORS.has(href)
    if (isHomeAnchorHref(href)) return !PAGE_ANCHORS.has(href.slice(1))
    if (!href.startsWith('/') || href.startsWith('//') || /https?:|\\|\?prompt=|[<>"'\s]/.test(href)) return true
    return !routeExists(href)
  })
  check(
    'tour table: every door is a STATIC in-site path that exists as a route (a /docs door is a ready docs page), or an anchor the home owns (#earn, #macro, #equities, #crypto, #perps, #tour) — never another origin, never a `?prompt=` link',
    hrefBad.length === 0,
    hrefBad.map((h) => `${h.id}:${h.href}`).join(' ') || `${hrefs.length} doors`,
  )
  const bare = hrefs.filter(({ href }) => href.startsWith('#'))
  check('tour table: no door is a BARE page anchor — the tour is also shown on /story, where `#earn` points at nothing; a door to a board on the home is written from the root (`/#earn`)', bare.length === 0, bare.map((h) => `${h.id}:${h.href}`).join(' ') || 'none bare')
  check(
    'tour table: every side opens a different primary door (eight sides, eight ways in)',
    new Set(TOUR_SIDES.map((s) => s.doors[0].href)).size === 8,
    TOUR_SIDES.map((s) => s.doors[0].href).join(' '),
  )
  // ── No typed number, no word the product cannot keep ──
  const words = (s: (typeof TOUR_SIDES)[number]) => [s.label, s.claim, s.line, s.body, ...s.facts, ...s.doors.map((d) => d.label)]
  const typed = TOUR_SIDES.flatMap((s) => words(s).filter((w) => /\d/.test(w.replace(/24\/7/g, '').replace(/\{[a-zA-Z]+\}/g, ''))).map((w) => `${s.id}: ${w}`))
  check(
    "tour table: a number in a side's words is ALWAYS a {slot} filled from the snapshot or a registry — no count, fee or rate is typed (\"24/7\" is a word; a sentence the visitor can run keeps its own amounts)",
    typed.length === 0,
    typed.join(' | ') || 'none typed',
  )
  const FENCE = /yeetful|\bdune\b|telegram|discord|prime broker|guarantee|risk[- ]free|\bpassive income\b|get rich|to the moon|financial advice/i
  const fenced = TOUR_SIDES.flatMap((s) => [...words(s), ...s.asks.flatMap((a) => [a.ask, a.label, a.via])].filter((w) => FENCE.test(w)).map((w) => `${s.id}: ${w}`))
  check(
    'tour table: the words promise nothing the product cannot keep today — no Telegram or Discord (no bot is live), no partner name, no old brand, no guarantee, no advice',
    fenced.length === 0,
    fenced.join(' | ') || 'clean',
  )
  const asks = TOUR_SIDES.flatMap((s) => s.asks.map((a) => ({ id: s.id, ...a })))
  const askBad = asks.filter((a) => !a.ask || a.ask.length > 120 || !a.label || a.label.length > 28 || !a.via || a.via.length > 20 || /[‘’“”—]/.test(a.ask))
  check('tour table: a sentence is plain ASCII as a person would type it (120 characters), its chip label is short (28) and it names what catches it (20)', askBad.length === 0, askBad.map((a) => `${a.id}: ${a.label}`).join(' | ') || `${asks.length} sentences`)

  // ── Anchors, hash, slots ──
  const anchors = TOUR_IDS.map(tourAnchor)
  check(
    'tour anchors: a side is `#tour-<id>` (never a bare `#earn`, which is the Earn board); the hash reader takes exactly those and nothing else — a side is never selected from a query string',
    anchors.every((a) => a.startsWith('tour-') && !PAGE_ANCHORS.has(`#${a}`)) &&
      TOUR_IDS.every((id) => parseTourHash(`#${tourAnchor(id)}`) === id && parseTourHash(tourAnchor(id)) === id) &&
      [null, undefined, '', '#', '#tour', '#earn', '#tour-', '#tour-evil', '#tour-links?x=1', '#tour-links/', '#tour-LINKS', '#tour-links#tour-ask', 'tour-<script>'].every((h) => parseTourHash(h) === null),
  )
  check(
    'tour slots: a {slot} fills from the snapshot; a line with a missing value is NULL (the caller drops a fact — a number is never a hole); a body with a missing value reads as plain words with no brace left',
    fillSlots('{stocks} stocks, {linkPct} fee', FULL) === '199 stocks, 0.50% fee' &&
      fillSlots('{stocks} stocks', EMPTY_TOUR) === null &&
      fillSlots('{nonsense} x', FULL) === null &&
      fillSlots('no slot', EMPTY_TOUR) === 'no slot' &&
      TOUR_SIDES.every((s) => tourFacts(s, FULL).length === s.facts.length && tourFacts(s, FULL).every((f) => !/[{}]/.test(f))) &&
      TOUR_SIDES.every((s) => tourFacts(s, EMPTY_TOUR).every((f) => !/[{}]/.test(f)) && !/[{}]/.test(tourBody(s, EMPTY_TOUR)) && !/[{}]/.test(tourBody(s, FULL)) && !/\s{2,}/.test(tourBody(s, EMPTY_TOUR))),
  )
  check('tour journey: one spelling for every door and chip — "Tour <Side>: <what>" — so the flows page can say which side pulled a visitor in', tourJourney('links', 'Mint a link') === `Tour ${tourSide('links').label}: Mint a link`)

  // ── Which door a landing link is (lib/home-doors, components/home/LandingLink) ──
  const plain = ['/', '/t/AAPL', '/live', '/chat', '/chat?tab=links', '/chat?tab=mcps&mcps=aave', '/community', '/community?compose=trade', '/g/new', '/leaderboard', '/analytics', '/docs', '/docs/embed', '/pricing', '/story', '/links', '//evil.example/wallet', 'https://example.com/wallet', 'wallet']
  const gatedDoors = TOUR_SIDES.flatMap((s) => s.doors.map((d) => d.href)).filter(isSignedInAppHref)
  const landingLink = code('components/home/LandingLink.tsx')
  check(
    'landing doors: only a page of the SIGNED-IN app gets the sign-in door (the wallet, the dashboard, an open chat); a chart, the chat and its tabs, the community, a docs page, pricing, the story and the links board are plain links — a stranger who taps "Read the docs" goes to the docs. On the tour that is exactly one door: the wallet',
    ['/wallet', '/wallet?x=1', '/dashboard', '/dashboard/links', '/chat/abc123', '/inbox'].every(isSignedInAppHref) && plain.every((h) => !isSignedInAppHref(h)) && gatedDoors.join() === '/wallet' && /isSignedInAppHref\(href\) \? <SpineLink href=\{href\} \{\.\.\.rest\} \/> : <Link href=\{href\} \{\.\.\.rest\} \/>/.test(landingLink) &&
      // …and a home anchor written from the root is a plain <a>: a fragment jump on `/`, the way back to the board from /story.
      isHomeAnchorHref('/#earn') && !isHomeAnchorHref('#earn') && !isHomeAnchorHref('/#') && !isHomeAnchorHref('/docs#x') && !isHomeAnchorHref('//#earn') && !isHomeAnchorHref('/#earn?x=1') && /if \(isHomeAnchorHref\(href\)\) \{[\s\S]*?return <a href=\{href\}/.test(landingLink),
    gatedDoors.join(' ') || 'none gated',
  )

  // ── The static part of the snapshot comes from the registries ──
  const counts = tourStaticCounts()
  const sections = marketSections()
  const fees = tourFees()
  check(
    "tour snapshot (static): counts are the registries' own — the equities and crypto boards, the apps row, and a manifest with venues and pinned addresses; the creator's line is the link fee times the creator split, from lib/fees",
    counts.stocks === sections.find((s) => s.id === 'equities')?.rows.length &&
      counts.crypto === sections.find((s) => s.id === 'crypto')?.rows.length &&
      counts.apps === HOME_APPS.length &&
      (counts.chains ?? 0) >= 5 &&
      (counts.venues ?? 0) >= 10 &&
      (counts.pinnedAddresses ?? 0) >= 20 &&
      fees.creatorPct === feePctLabel(LINK_SWAP_FEE_BPS * CREATOR_FEE_SPLIT) &&
      fees.linkBps >= fees.swapBps &&
      staticTourSnapshot().chains.length === counts.chains,
    JSON.stringify(counts),
  )
  const server = code('lib/home-tour-server.ts')
  check(
    'tour snapshot (server): the read keeps `/` a static page — no `no-store` fetch, and any database or network read goes through unstable_cache',
    !/no-store/.test(server) && (!/prisma\.|fetch\(|listFeed|listCommunities/.test(server) || /unstable_cache/.test(server)),
  )

  // ── The seats ──
  const index = code('components/markets/shell/MarketsIndex.tsx')
  const pos = (s: string) => index.indexOf(s)
  const order = ['mk-lead-seat', 'mk-tour-seat', 'mkt-frame__data', '<Board key={s.id}', 'mk-guide-seat', '<EarnBoard', 'mk-how-seat', 'mk-close-seat', 'mk-keys']
  check(
    'landing seats: in the markets index the tour sits under the lead and above the market data; the how seat replaces the small card under Earn; the close seat is last; the keyboard line stays',
    order.every((s) => pos(s) >= 0) && order.every((s, i) => i === 0 || pos(order[i - 1]) < pos(s)) && /data-seat="Tour"/.test(index) && /data-seat="How"/.test(index) && /data-seat="Close"/.test(index),
    order.map((s) => `${s}@${pos(s)}`).join(' '),
  )
  const surface = code('components/home/HomeSurface.tsx')
  check(
    'landing seats: the home surface fills them — the tour with the server snapshot and the read, the trust section, the closing doors — and mounts the posture sync; the read still leads',
    /tour=\{<Tour data=\{tour\} read=\{read\} \/>\}/.test(surface) && /how=\{<HowItWorks data=\{tour\} \/>\}/.test(surface) && /close=\{<ClosingDoors data=\{tour\} \/>\}/.test(surface) && /<HomeModeSync \/>/.test(surface) && /<TheRead initial=\{read\} \/>/.test(surface),
  )
  const page = code('app/page.tsx')
  check(
    'landing page: `/` stays a 60-second static page — it reads the tour snapshot beside the read, takes no searchParams, cookies or headers, and mounts the posture script BEFORE the shell',
    /export const revalidate = 60/.test(page) &&
      /readTourSnapshotForRender\(\)/.test(page) &&
      !/searchParams|cookies\(\)|headers\(\)|force-dynamic/.test(page) &&
      page.indexOf('HOME_MODE_BOOTSTRAP }') >= 0 &&
      page.indexOf('__html: HOME_MODE_BOOTSTRAP') < page.indexOf('<MarketsShell>'),
  )

  check(
    "landing page: the home hands the venue's live perp table to the browser the way the symbol page does — an inline script at parse time and HlPerpsPrime around the shell. The Macro board lists builder markets only the live table knows; a warm server drew their Long / Short chips and a cold browser drew none, so React threw #418 on `/` and re-rendered the page (found on prod and locally by the phone drive, 2026-11-10)",
    /const hlPerps = liveHlPerpNames\(\)/.test(page) &&
      /window\.\$\{HL_PERPS_HANDOFF_GLOBAL\}=/.test(page) &&
      /\{hlHandoff && <script dangerouslySetInnerHTML=\{\{ __html: hlHandoff \}\} \/>\}/.test(page) &&
      /<HlPerpsPrime hlPerps=\{hlPerps\}>\s*<MarketsShell>/.test(page) &&
      page.indexOf('{hlHandoff &&') < page.indexOf('<MarketsShell>'),
  )

  // ── The posture ──
  const cases: Array<{ pref: string | null; n: number; day: string; wallet: 'on' | 'off' | 'gone' }> = []
  for (const pref of [null, 'open', 'closed', 'junk']) for (const n of [0, 1, HOME_RETURN_DAYS - 1, HOME_RETURN_DAYS, 40]) for (const day of ['', 'today', '2020-01-01']) for (const wallet of ['on', 'off', 'gone'] as const) cases.push({ pref, n, day, wallet })
  const today = new Date().toISOString().slice(0, 10)
  const disagree: string[] = []
  for (const c of cases) {
    const store = new Map<string, string>()
    if (c.pref) store.set(HOME_TOUR_PREF_KEY, c.pref)
    if (c.n || c.day) store.set(HOME_VISITS_KEY, JSON.stringify({ n: c.n, day: c.day === 'today' ? today : c.day }))
    if (c.wallet !== 'gone') store.set('wagmi.recentConnectorId', JSON.stringify('injected'))
    if (c.wallet === 'off') store.set('wagmi.injected.disconnected', 'true')
    const attrs = new Map<string, string>()
    const sandbox = {
      document: { documentElement: { setAttribute: (k: string, v: string) => attrs.set(k, v) } },
      localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
    }
    const before = parseVisits(c.n || c.day ? JSON.stringify({ n: c.n, day: c.day === 'today' ? today : c.day }) : null)
    const want = homeModeFrom({ pref: c.pref, visitDays: noteVisit(before, today).n, walletRemembered: c.wallet === 'on' })
    vm.runInNewContext(HOME_MODE_BOOTSTRAP, sandbox)
    if (attrs.get(HOME_MODE_ATTR) !== want || parseVisits(store.get(HOME_VISITS_KEY) ?? null).n !== noteVisit(before, today).n) disagree.push(JSON.stringify(c))
  }
  const throwing = { document: { documentElement: { setAttribute() {} } }, localStorage: { getItem() { throw new Error('denied') }, setItem() { throw new Error('denied') } } }
  let survived = true
  try {
    vm.runInNewContext(HOME_MODE_BOOTSTRAP, throwing)
  } catch {
    survived = false
  }
  check(
    "home posture: the rule — the visitor's own choice wins, a browser that connected a wallet is a user, a third day on the home is a user, anyone else is new (one visit does not make a returning user) — and the inline script that runs before first paint agrees with it on every case, counts a day once, and survives storage that refuses",
    homeModeFrom({ pref: null, visitDays: 1, walletRemembered: false }) === 'new' &&
      homeModeFrom({ pref: null, visitDays: 2, walletRemembered: false }) === 'new' &&
      homeModeFrom({ pref: null, visitDays: HOME_RETURN_DAYS, walletRemembered: false }) === 'return' &&
      homeModeFrom({ pref: null, visitDays: 1, walletRemembered: true }) === 'return' &&
      homeModeFrom({ pref: 'open', visitDays: 99, walletRemembered: true }) === 'new' &&
      homeModeFrom({ pref: 'closed', visitDays: 1, walletRemembered: false }) === 'return' &&
      noteVisit({ n: 2, day: today }, today).n === 2 &&
      noteVisit({ n: 2, day: '2020-01-01' }, today).n === 3 &&
      parseVisits('{').n === 0 &&
      parseVisits('{"n":"9","day":1}').n === 0 &&
      disagree.length === 0 &&
      survived,
    disagree.length ? `${disagree.length}/${cases.length} disagree, first ${disagree[0]}` : `${cases.length} cases agree`,
  )

  // ── Fences over the landing's source ──
  const tsx = LANDING_TSX()
  const src = tsx.map((p) => ({ p, c: code(p) }))
  const hit = (re: RegExp, except: string[] = []) => src.filter(({ p, c }) => !except.includes(p) && re.test(c)).map(({ p }) => p)
  const stream = hit(/\bWebSocket\b|\bEventSource\b|connectTape|openDuneTape|openHlTape|from ['"]three['"]|from ['"]lightweight-charts['"]|\/api\/chat\b/)
  check('landing fence: the landing opens no stream and loads no chart engine — no WebSocket, no EventSource, no tape feed, no three, no lightweight-charts, no chat call (a miniature is SVG and a polled read)', stream.length === 0, stream.join(' ') || `${tsx.length} files`)
  const links = hit(/from ['"]next\/link['"]|<Link[\s>]|from ['"]@\/components\/SpineLink['"]|<SpineLink[\s>]/)
  check("landing fence: every link the landing writes is the ONE LandingLink (components/home/LandingLink: the sign-in door only for a page of the signed-in app, a plain link otherwise) — no bare next/link and no direct SpineLink in the landing's files", links.length === 0, links.join(' ') || 'all LandingLink')
  const prompts = hit(/\?prompt=/, ['components/home/tour/context.tsx'])
  check('landing fence: a sentence runs through act() (connect-to-act into the Ask door) — no `/chat?prompt=` link is written into the page; only the shared context names that fallback', prompts.length === 0, prompts.join(' ') || 'none')
  const unsafe = hit(/dangerouslySetInnerHTML|location\.search|useSearchParams|document\.cookie|\beval\(|new Function\(/)
  check('landing fence: nothing in the landing writes raw HTML, reads a query string (a side comes from the hash), or touches a cookie', unsafe.length === 0, unsafe.join(' ') || 'none')
  const storage = hit(/localStorage|sessionStorage/, ['components/home/HomeModeSync.tsx'])
  check("landing fence: the landing's only memory is the posture (lib/home-mode through HomeModeSync) — a panel keeps nothing in the browser", storage.length === 0, storage.join(' ') || 'none')
  const redirects = hit(/redirectTo=/)
  check('landing fence: a door on the landing passes NO redirectTo (standing rule 6: a working page keeps you on it; SpineLink aims the door at its own target)', redirects.length === 0, redirects.join(' ') || 'none')
  const ctx = code('components/home/tour/context.tsx')
  check(
    'landing act: ONE connect door for the whole tour — the provider wires useConnectToAct into the Ask door with send, gates a sentence on the measured venue verdicts, and renders the door once',
    /useConnectToAct\(\{ run, redirectFor: promptHref \}\)/.test(ctx) && /openDoor\(ask, \{ send: true, mcps: askAppSlugs\(ask\) \}\)/.test(ctx) && /canTradeAsk\(ask, tradable\)/.test(ctx) && (ctx.match(/\{door\}/g) ?? []).length === 1 && src.filter(({ p, c }) => p !== 'components/home/tour/context.tsx' && /useConnectToAct\(/.test(c)).length === 0,
  )
  const panels = TOUR_IDS.map((id) => `components/home/tour/sides/${id[0].toUpperCase()}${id.slice(1)}.tsx`)
  const map = code('components/home/tour/sides/index.ts')
  check(
    "landing panels: every side has its own file and the map names all eight; a side's file reads its words from lib/home-tour/<id>",
    panels.every((p) => existsSync(join(ROOT, p))) && TOUR_IDS.every((id) => new RegExp(`\\b${id}: \\w+Side\\b`).test(map)) && TOUR_IDS.every((id, i) => new RegExp(`from '@/lib/home-tour/${id}'`).test(code(panels[i]))),
  )

  // ── Fences over the landing's CSS ──
  const css = LANDING_CSS().map((p) => ({ p, c: read(p).replace(/\/\*[\s\S]*?\*\//g, '') }))
  const literal = css.filter(({ c }) => /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|font-size:\s*[\d.]+px|border-radius:\s*[1-9][\d.]*px/.test(c)).map(({ p }) => p)
  check('landing CSS: tokens only — no literal colour, no px font size, no px radius in any of the landing\'s stylesheets (the one scale: --fs-*, --r-*, --sp-*, the --mk-* look), so light mode comes free', literal.length === 0, literal.join(' ') || `${css.length} sheets`)
  const motion = css.filter(({ c }) => /\b(transition|animation)\s*:/.test(c) && !/prefers-reduced-motion/.test(c)).map(({ p }) => p)
  check('landing CSS: a sheet that moves anything says what happens under prefers-reduced-motion', motion.length === 0, motion.join(' ') || 'all answer')
  // The landing's class names must be its own. `tp` was the panel prefix until it met
  // components/markets/chart/tape-view.css (`.tp { position: absolute; inset: 0 }`, loaded
  // lazily with a chart's tape view), which collapsed every panel on /story to 0 px.
  const tape = read('components/markets/chart/tape-view.css')
  const taken = new Set([...tape.matchAll(/\.([a-z][a-z0-9]*)(?:__|--|[\s,{:.>\[])/g)].map((m) => m[1]))
  const clash = css.filter(({ c }) => [...c.matchAll(/\.([a-z][a-z0-9]*)(?:__|--|[\s,{:.>\[])/g)].some((m) => taken.has(m[1]))).map(({ p }) => p)
  check("landing CSS: no class prefix shared with the chart's tape view sheet (the panel prefix is `tpn`; `.tp` is the tape view's and would collapse a panel to nothing)", taken.has('tp') && clash.length === 0 && /\.tpn-seat \{/.test(read('components/home/tour/panel.css')), clash.join(' ') || 'no clash')
  const sticky = css.filter(({ c }) => /position:\s*(sticky|fixed)/.test(c)).map(({ p }) => p)
  check('landing CSS: nothing in the landing is sticky or fixed (the tool strip and the phone bar own those layers)', sticky.length === 0, sticky.join(' ') || 'none')
}

export async function landingCoordPinsServed(check: Check, base: string): Promise<void> {
  const HDR = { 'x-yf-internal-run': '1' }
  const res = await fetch(`${base}/`, { headers: HDR })
  const html = await res.text()
  const at = (s: string) => html.indexOf(s)
  check(
    'landing (served): `/` answers 200 from the static cache (s-maxage=60) with ONE h1, the posture script ahead of the page, and the seats in order — the read, the tour, the boards and apps, the trust section, the closing doors',
    res.status === 200 &&
      /s-maxage=60/.test(res.headers.get('cache-control') ?? '') &&
      (html.match(/<h1[\s>]/g) ?? []).length === 1 &&
      at(HOME_TOUR_PREF_KEY) > 0 &&
      at(HOME_TOUR_PREF_KEY) < at('class="mkt-frame__main"') &&
      ['data-seat="Lead"', 'data-seat="Tour"', 'data-seat="Guide"', 'data-seat="How"', 'data-seat="Close"'].every((s, i, a) => at(s) > 0 && (i === 0 || at(a[i - 1]) < at(s))),
    `status ${res.status} · cache ${res.headers.get('cache-control')}`,
  )
  // The tour's own slice of the page (the footer wears the old name on purpose: "Formerly Yeetful", t.me/yeetful).
  const tourHtml = html.slice(Math.max(0, at('data-seat="Tour"')), at('class="mkt-frame__data"') > 0 ? at('class="mkt-frame__data"') : undefined)
  check(
    'landing (served): the tour is in the server HTML — the section at #tour and every side named with its own anchor — the page writes no `/chat?prompt=` link, and the tour never says the old brand',
    /id="tour"/.test(html) && TOUR_IDS.every((id) => html.includes(`id="${tourAnchor(id)}"`) || html.includes(`data-tour-tab="${id}"`) || html.includes(`data-tour-side="${id}"`)) && TOUR_SIDES.every((s) => tourHtml.includes(s.label)) && !/\/chat\?prompt=/.test(html) && !/yeetful/i.test(tourHtml),
    TOUR_IDS.filter((id) => !html.includes(tourAnchor(id))).join(',') || 'all eight',
  )
  const doors = [...new Set(TOUR_SIDES.flatMap((s) => s.doors.map((d) => d.href)).filter((h) => h.startsWith('/')))]
  const dead: string[] = []
  await Promise.all(
    doors.map(async (href) => {
      try {
        const r = await fetch(`${base}${href}`, { headers: HDR, redirect: 'manual' })
        if (r.status !== 200 && r.status !== 307 && r.status !== 308) dead.push(`${href} ${r.status}`)
      } catch (e) {
        dead.push(`${href} ${(e as Error).message}`)
      }
    }),
  )
  check("landing (served): every door on the tour opens — each side's links answer 200 (or a known forward), none a 404", dead.length === 0, dead.join(' | ') || `${doors.length} doors`)
}

if (process.argv[1]?.endsWith('landing-coord-pins.ts')) {
  let failed = 0
  let n = 0
  const check: Check = (name, ok, extra) => {
    n++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
    if (!ok) failed++
  }
  const served = process.argv.includes('--served')
  Promise.resolve()
    .then(() => landingCoordPins(check))
    .then(() => (served ? landingCoordPinsServed(check, process.env.BASE ?? 'http://localhost:3000') : undefined))
    .then(() => {
      console.log(failed ? `\n${failed} failed` : `\nall green (${n})`)
      process.exit(failed ? 1 : 0)
    })
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
