// Pins for the front door (squad front-door, 2026-10-06; SPLASH lane): `/` is
// the app's own splash — the markets index in the shell, opening on a claim
// block — /markets 308s to it, the brochure lives at /story, and every link to
// the index in the product reads lib/markets MARKETS_HREF. Two halves:
//   · pure — the route rules, the words, the source shape (no server);
//   · HTTP — the served HTML of `/`, `/story`, the redirect, the cards, the
//     sitemap, the manifest, against BASE (default http://localhost:3980).
// Runnable alone (the harness cannot run on a machine without a DB; this can):
//   BASE=http://localhost:3980 npx tsx scripts/front-door-pins.ts [--pure]
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import nextConfig from '../next.config'
import manifest from '../app/manifest'
import { isMarketsPath, MARKETS_HREF, STORY_HREF } from '../lib/markets'
import { HERO_LINE, HERO_SUB, HOME_DESCRIPTION, HOME_TITLE, SPLASH } from '../lib/markets-copy'
import { isPublicAppPath, SIGN_IN_LANDING } from '../lib/app-entry'
import { ARRIVAL_SOURCES, arrivalSourceAllowed } from '../lib/arrival-fence'
import { arrivalSourceLabel } from '../lib/arrival-copy'
import { listPageSeo, symbolPageSeo } from '../lib/markets-seo'
import { marketsPost } from '../lib/share-posts'
import { SITE_URL, absoluteUrl } from '../lib/site-url'

type Check = (name: string, ok: boolean, extra?: string) => void

const src = (p: string) => readFileSync(p, 'utf8')
/** Source with comments stripped — a pin on code must not be fooled by prose. */
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')

/** Every .ts/.tsx under a dir (never the API routes, never build output). */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (p === 'app/api' || name === 'node_modules' || name.startsWith('.')) continue
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(name)) out.push(p)
  }
  return out
}

/** The ways a file can point at the index by hand (JSX, object, router, URL helper, manifest). */
const HAND_MARKETS_HREF = /href="\/markets[?"]|href=\{['"`]\/markets|href: ['"]\/markets['"]|(?:push|replace|connectAndSignIn|absoluteUrl)\(['"`]\/markets|start_url: ['"]\/markets/
/** Files allowed to keep a literal while another lane owns them (noted in SPLASH.md § For GUIDE). */
const HAND_HREF_ALLOWED = new Set(['components/markets/shell/SymbolPage.tsx'])

/** The mk2 fence, verbatim: a bare <Link> into the signed-in shell. */
const BARE_SHELL_LINK = /<Link\s(?:[^>]*?\s)?href=(?:"\/(?:chat|markets)[?"/]|"\/t\/|\{`\/(?:chat|markets|t\/)|\{(?:chatPrefill|promptHref)\()/

const jsonLdTypes = (html: string): Set<string> => {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => m[1])
  const types = new Set<string>()
  for (const b of blocks) {
    try {
      const parsed = JSON.parse(b) as { '@type'?: string } | { '@type'?: string }[]
      for (const x of Array.isArray(parsed) ? parsed : [parsed]) if (x['@type']) types.add(x['@type'])
    } catch {
      types.add('UNPARSEABLE')
    }
  }
  return types
}

export async function frontDoorPins(check: Check): Promise<void> {
  // ── Route rules ───────────────────────────────────────────────────────
  check(
    'front door: `/` is a markets path and a public app page (looking needs no wallet), a fresh sign-in lands there, MARKETS_HREF is `/` and STORY_HREF is /story; /marketsx, /t, /chat and /story itself are not markets paths',
    isMarketsPath('/') && isPublicAppPath('/') && SIGN_IN_LANDING === '/' && MARKETS_HREF === '/' && STORY_HREF === '/story' &&
      isMarketsPath('/markets') && isMarketsPath('/t/AAPL') && isMarketsPath('/live') &&
      !isMarketsPath('/marketsx') && !isMarketsPath('/t') && !isMarketsPath('/chat') && !isMarketsPath(STORY_HREF) && !isPublicAppPath(STORY_HREF),
  )
  const redirects = (await nextConfig.redirects?.()) ?? []
  const toRoot = redirects.find((r) => r.source === '/markets')
  const cards = redirects.find((r) => r.source === '/markets/:card(opengraph-image|twitter-image)')
  check(
    'front door: next.config 308s /markets → `/` and the old card URLs → the root card (both permanent); /story is never redirected',
    !!toRoot && toRoot.destination === '/' && toRoot.permanent === true &&
      !!cards && cards.destination === '/:card' && cards.permanent === true &&
      !redirects.some((r) => r.source === '/story' || r.source === '/'),
    JSON.stringify({ toRoot, cards }),
  )

  // ── No hand-typed /markets link anywhere in the product ────────────────
  const files = [...walk('app'), ...walk('components'), ...walk('lib')]
  const typed = files.filter((p) => !HAND_HREF_ALLOWED.has(p) && HAND_MARKETS_HREF.test(code(p)))
  check(
    'front door: no file under app/, components/ or lib/ links to /markets by hand — every door to the index reads MARKETS_HREF (the one allow-listed file is another lane\'s, noted in SPLASH.md)',
    typed.length === 0,
    `typed=${typed.join(',') || '-'}`,
  )
  check(
    'front door: the nav\'s two Markets tabs, the footer, the phone CTA bar, the brochure\'s "Open Markets" doors (hero, markets band, map teaser, links hero), /compare, the public list page and the symbol card all read MARKETS_HREF',
    (code('components/Navigation.tsx').match(/<SpineLink href=\{MARKETS_HREF\} className=\{`nav__tab/g) ?? []).length === 2 &&
      /const onMarkets = isMarketsPath\(pathname\)/.test(code('components/Navigation.tsx')) &&
      /href: MARKETS_HREF, app: true/.test(code('components/Footer.tsx')) &&
      /<SpineLink href=\{MARKETS_HREF\} className="btn btn--solid mcta__go"/.test(code('components/MobileCtaBar.tsx')) &&
      ['components/landing/LandingHero.tsx', 'components/MarketsBand.tsx', 'components/landing/MarketMapTeaser.tsx', 'components/LinksHeroView.tsx', 'app/compare/page.tsx', 'app/lists/[slug]/page.tsx', 'components/SharedGone.tsx', 'app/docs/markets/page.tsx']
        .every((p) => /<SpineLink[^>]*href=\{MARKETS_HREF\}/.test(code(p))) &&
      /href=\{`\$\{MARKETS_HREF\}\?import=1`\}/.test(code('app/compare/page.tsx')) &&
      /<Link href=\{MARKETS_HREF\} className="mkt-link">/.test(code('components/markets/shell/SymbolCardSlot.tsx')) &&
      /router\.push\(MARKETS_HREF\) : connectAndSignIn\(MARKETS_HREF\)/.test(code('components/PricingPlans.tsx')),
  )
  check(
    'front door: the share post for the index, the manifest\'s start_url and the symbol / list breadcrumbs all open the splash (the breadcrumb item is the site URL, no trailing slash, never /markets)',
    marketsPost().url === absoluteUrl('/') && manifest().start_url === MARKETS_HREF &&
      (() => {
        const crumbs = (ld: string) => (JSON.parse(ld) as { '@type': string; itemListElement?: { position: number; item: string }[] }[]).find((x) => x['@type'] === 'BreadcrumbList')?.itemListElement?.[0]?.item
        return crumbs(symbolPageSeo('AAPL').jsonLd) === SITE_URL && crumbs(listPageSeo({ slug: 'x', name: 'X', symbols: ['AAPL'] }).jsonLd) === SITE_URL
      })(),
    `${marketsPost().url} ${manifest().start_url}`,
  )

  // ── The words ─────────────────────────────────────────────────────────
  const sentences = (s: string) => (s.match(/[.!?](?=\s|$)/g) ?? []).length
  check(
    'front door: the SPLASH words — the h1 IS HERO_LINE; the sentence under it is ONE sentence whose phrases all come from HERO_SUB / HOME_DESCRIPTION (no new slogan); the door says what it is; /story has its own title and a description that fits a result',
    SPLASH.h1 === HERO_LINE && sentences(SPLASH.sub) === 1 &&
      HERO_SUB.includes('Stocks 24/7, perps, spot and yield in one wallet') && SPLASH.sub.includes('Stocks 24/7, perps, spot and yield in one wallet') &&
      HOME_DESCRIPTION.includes('every chart is the order form') && SPLASH.sub.includes('every chart is the order form') &&
      /you keep the pen/i.test(HERO_SUB) && /you keep the pen/i.test(SPLASH.sub) &&
      SPLASH.door === 'What is this?' &&
      // (as string: the two are distinct literal types, and tsc calls the plain comparison unintentional)
      SPLASH.storyTitle.startsWith('Pantessa') && (SPLASH.storyTitle as string) !== HOME_TITLE && (SPLASH.storyDescription as string) !== HOME_DESCRIPTION &&
      SPLASH.storyDescription.length >= 80 && SPLASH.storyDescription.length <= 220 &&
      SPLASH.storyTopline.length > 0 && SPLASH.storyToplineCta.length > 0,
    `sub=${SPLASH.sub.length}ch story=${SPLASH.storyDescription.length}ch`,
  )

  // ── The splash's source shape ─────────────────────────────────────────
  const home = code('components/home/HomeSurface.tsx')
  const index = code('components/markets/shell/MarketsIndex.tsx')
  const claim = code('components/home/SplashClaim.tsx')
  check(
    'front door: HomeSurface mounts the three seats — claim (SplashClaim), lead (SentHomeNotice + PulseSlot), guide (GuideSeat surface="home") — and MarketsIndex renders the claim FIRST in the main column, standing in for its sr-only "Markets" h1 (one h1 per page)',
    /claim=\{<SplashClaim \/>\}/.test(home) && /<SentHomeNotice \/>\s*<PulseSlot \/>/.test(home) && /guide=\{<GuideSeat surface="home" \/>\}/.test(home) &&
      /\{claim \?\? <h1 className="sr-only">Markets<\/h1>\}/.test(index) &&
      index.indexOf('{claim ?? ') < index.indexOf('className="mkt-frame__bar"') && index.indexOf('className="mkt-frame__bar"') < index.indexOf('className="mk-lead-seat"'),
  )
  check(
    'front door: the claim is the visible h1 (HERO_LINE as one text node — the roster pin reads it), one sentence, and a plain un-prefetched link to /story; the compact (one-line) version is a post-hydration decision, never the server\'s',
    /<h1 className="mk-claim__h1">\{SPLASH\.h1\}<\/h1>/.test(claim) && /<p className="mk-claim__sub">\{SPLASH\.sub\}<\/p>/.test(claim) &&
      /<Link href=\{STORY_HREF\} className="mk-claim__door mono" prefetch=\{false\} data-splash-door>/.test(claim) &&
      /useEffect\(\(\) => \{[\s\S]*?localStorage\.getItem\(SPLASH_SEEN_KEY\)/.test(claim) && /data-compact=\{compact \|\| undefined\}/.test(claim) &&
      !/useLayoutEffect|window\.location/.test(claim),
  )
  const homeFiles = readdirSync('components/home').filter((f) => f.endsWith('.tsx')).map((f) => `components/home/${f}`)
  const bare = homeFiles.filter((p) => BARE_SHELL_LINK.test(src(p)))
  check(
    'front door: no bare <Link> into the signed-in shell from components/home/* — a door there is a SpineLink or the connect-to-act door (the splash is public; /chat is not)',
    homeFiles.length >= 2 && bare.length === 0,
    `bare=${bare.join(',') || '-'}`,
  )
  const css = src('components/markets/markets.css')
  const rule = (sel: string) => (css.match(new RegExp(`^${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`, 'm')) ?? ['', ''])[1]
  const marginsOnly = (body: string) => body.trim().length > 0 && body.split(';').map((d) => d.trim()).filter(Boolean).every((d) => /^margin(-top|-bottom)?:/.test(d))
  check(
    'front door: markets.css carries the claim block (≤72px by construction: 12px + 27px h1 + 3px + 17px sentence + 8px), hides the sentence on a phone and in the compact version, and the two seat classes carry MARGINS ONLY and only when filled (`:not(:empty)` — an empty guide seat leaves no hole; the pulse band and the guide card own their boxes)',
    /padding: 12px 0 8px/.test(rule('.mk-claim')) && /font-size: clamp\(21px, 1\.9vw, 27px\)/.test(rule('.mk-claim__h1')) && /line-height: 1\.02/.test(rule('.mk-claim__h1')) &&
      /font-size: 12\.5px; line-height: 1\.4/.test(rule('.mk-claim__sub')) &&
      /\.mk-claim\[data-compact\] \.mk-claim__sub \{ display: none; \}/.test(css) &&
      /@media \(max-width: 640px\) \{[^}]*\n(?:[^}]*\}\s*)*?\s*\.mk-claim__sub \{ display: none; \}/.test(css) &&
      marginsOnly(rule('.mk-lead-seat:not(:empty)')) && marginsOnly(rule('.mk-guide-seat:not(:empty)')) && !/^\.mk-(?:lead|guide)-seat \{/m.test(css),
  )

  // ── The arrival fence admits the splash ───────────────────────────────
  check(
    'front door: the arrival fence admits the splash as a sender (`/` exactly — never /i, /embed, /chat, nor a `//host` or `/anything` under it), and the arrival banner says "Markets" for it, never a pathname',
    ARRIVAL_SOURCES.includes('/') && arrivalSourceAllowed('/') && arrivalSourceAllowed('/t/AAPL') &&
      !arrivalSourceAllowed('/chat') && !arrivalSourceAllowed('/i/x') && !arrivalSourceAllowed('/embed') && !arrivalSourceAllowed('') && !arrivalSourceAllowed('/story') &&
      // `/` is exact: the prefix rule read `//evil.example` as "under /" (QA S1)
      !arrivalSourceAllowed('//evil.example') && !arrivalSourceAllowed('//') && !arrivalSourceAllowed('/anything') &&
      arrivalSourceLabel('/') === 'Markets',
    ARRIVAL_SOURCES.join(' '),
  )

  // ── /story, the sitemap, the cards, the crawl ────────────────────────
  const story = code('app/story/page.tsx')
  check(
    'front door: /story reads its title + description from SPLASH, keeps the VideoObject and its own canonical, carries the slim top line back to the app (MARKETS_HREF) above the movers tape, and still mounts the brochure in order (hero · venue band · map · honesty · band · share · links · embed) + the phone CTA bar',
    /const TITLE = SPLASH\.storyTitle/.test(story) && /const DESCRIPTION = SPLASH\.storyDescription/.test(story) && /'@type': 'VideoObject'/.test(story) && /const CANONICAL = `\$\{SITE\}\/story`/.test(story) &&
      /data-story-top/.test(story) && /<Link href=\{MARKETS_HREF\}/.test(story) && story.indexOf('data-story-top') < story.indexOf('<MoversStrip />') &&
      ['<LinksHero />', '<VenueBand />', '<MarketMapTeaser />', '<HonestyStrip />', '<MarketsBand />', '<ShareBand />', '<LinkEconomy />', '<EmbedAnywhere />', '<MobileCtaBar />'].every((k, i, all) => story.includes(k) && (i === 0 || story.indexOf(all[i - 1]) < story.indexOf(k))),
  )
  const sitemap = code('app/sitemap.ts')
  check(
    'front door: the sitemap lists `/` (hourly, priority 1) and /story, and never /markets (a crawler is not handed a 308)',
    /\{ url: SITE, changeFrequency: 'hourly', priority: 1 \}/.test(sitemap) && /url: `\$\{SITE\}\/story`/.test(sitemap) && !/\$\{SITE\}\/markets`/.test(sitemap),
  )
  const rootOg = src('app/opengraph-image.tsx')
  const storyOg = src('app/story/opengraph-image.tsx')
  const mirror = (p: string) => /export \{ default, alt, size, contentType \} from '\.\/opengraph-image'/.test(src(p)) && /export const runtime = 'nodejs'/.test(src(p)) && /export const dynamic = 'force-dynamic'/.test(src(p))
  check(
    'front door: the root social card is THE BOARD (self-fetched /api/quotes with a timeout, the dashed board on a miss, the claim beside it, pantessa.com — no /markets), /story\'s card is the brochure\'s rehearsal (live tape + HUD + stamp), both twitter mirrors declare their own runtime + dynamic, both draw the house mark, and nothing is left under app/markets but the trending reader',
    /marketsOgBoard\(\)/.test(rootOg) && /\/api\/quotes\?symbols=/.test(rootOg) && /AbortSignal\.timeout\(/.test(rootOg) && /return NO_QUOTES/.test(rootOg) && /FEED WARMING UP/.test(rootOg) &&
      /that executes\./.test(rootOg) && /YOUR WALLET SIGNS/.test(rootOg) && /gemMarkSvg\(/.test(rootOg) && !/REEL_STAMP|pantessa\.com\/markets/.test(rootOg) && /alt = `Pantessa — \$\{HERO_LINE\} /.test(rootOg) &&
      /REEL_STAMP/.test(storyOg) && /candleSvg\(/.test(storyOg) && /loadSeries\(beat\.symbol\)/.test(storyOg) && /venueLabel\(pair\)/.test(storyOg) && /gemMarkSvg\(/.test(storyOg) &&
      mirror('app/twitter-image.tsx') && mirror('app/story/twitter-image.tsx') &&
      !existsSync('app/markets/opengraph-image.tsx') && !existsSync('app/markets/twitter-image.tsx') && !existsSync('app/markets/page.tsx') && readdirSync('app/markets').join(',') === 'trending.ts',
  )
  const crawl = src('scripts/gtm-crawl.ts')
  check(
    'front door: gtm-crawl visits `/`, /story and /markets (which follows its 308) and fetches both cards raw',
    /'\/', '\/story', '\/markets',/.test(crawl) && /'\/story\/opengraph-image', '\/markets\/opengraph-image'/.test(crawl),
  )
  const harness = src('scripts/test-api.ts')
  const rePins = (harness.match(/RE-PINNED 2026-10-06 \(front-door\)/g) ?? []).length
  check(
    'front door: the homepage checks the flip breaks are re-pinned IN PLACE in scripts/test-api.ts, each marked (≥ 18 marks: roster/onboarding card, markets/msg ×3, the /markets frame h1, nav, isMarketsPath, sign-in sources, shell doors, public app pages, mk2/landing ×3, arrival ×3, markets card, MobileCtaBar, manifest, entity fence, og cards)',
    rePins >= 18 && !/fetch\(`\$\{BASE\}\/markets\/opengraph-image`\)/.test(harness),
    `marks=${rePins}`,
  )
}

/** The served half: needs `next start` at BASE. */
export async function frontDoorHttpPins(check: Check, base: string): Promise<void> {
  const get = (path: string, init?: RequestInit) => fetch(`${base}${path}`, { signal: AbortSignal.timeout(20_000), ...init })
  const text = async (path: string) => (await get(path)).text()
  // React SSR separates adjacent text nodes with `<!-- -->`; a pin reads the words, not the seams.
  const flat = (h: string) => h.replace(/<!--\s*-->/g, '').replace(/\s+/g, ' ')

  const homeRes = await get('/')
  const home = flat(await homeRes.text())
  check(
    'front door (served): `/` is 200 and opens on the claim — HERO_LINE as the ONE visible h1 (one text node), the sentence, the "What is this?" door to /story (no prefetch is a client matter; the href is plain) — above the tool strip, the lead seat and the guide seat; the sr-only "Markets" h1 is gone',
    homeRes.status === 200 && home.includes(`<h1 class="mk-claim__h1">${HERO_LINE}</h1>`) && (home.match(/<h1\b/g) ?? []).length === 1 && !home.includes('<h1 class="sr-only">Markets</h1>') &&
      home.includes(SPLASH.sub) && /<a class="mk-claim__door mono" data-splash-door="true" href="\/story">What is this\?/.test(home) &&
      home.indexOf('class="mk-claim"') < home.indexOf('class="mkt-frame__bar"') && home.indexOf('class="mkt-frame__bar"') < home.indexOf('data-seat="Lead"') && home.indexOf('data-seat="Lead"') < home.indexOf('data-seat="Guide"'),
    `status=${homeRes.status} h1s=${(home.match(/<h1\b/g) ?? []).length}`,
  )
  check(
    'front door (served): `/` keeps HOME_TITLE, the canonical, WebSite + SoftwareApplication JSON-LD (the VideoObject is /story\'s), the root board card as og:image + twitter:image with its alt, the footer, the spine, and not one href="/markets"',
    home.includes(`<title>${HOME_TITLE}</title>`) && /<link rel="canonical" href="https?:\/\/[^"/]+"\/?>/.test(home) &&
      (() => { const t = jsonLdTypes(home); return t.has('WebSite') && t.has('SoftwareApplication') && !t.has('VideoObject') && !t.has('UNPARSEABLE') })() &&
      /<meta property="og:image" content="[^"]*\/opengraph-image/.test(home) && !/<meta property="og:image" content="[^"]*\/story\//.test(home) &&
      /<meta name="twitter:image" content="[^"]*\/twitter-image/.test(home) &&
      /<meta property="og:image:alt" content="Pantessa — The chart that executes\. Stocks 24\/7/.test(home) &&
      /class="mkt-frame__foot"><footer class="footer"/.test(home) && /aria-label="Workspace"/.test(home) &&
      !/href="\/markets"/.test(home) && !/<header class="nav/.test(home),
  )
  const r308 = await get('/markets', { redirect: 'manual' })
  const card308 = await get('/markets/opengraph-image', { redirect: 'manual' })
  const tw308 = await get('/markets/twitter-image', { redirect: 'manual' })
  const loc = (r: Response) => (r.headers.get('location') ?? '').replace(/^https?:\/\/[^/]+/, '')
  check(
    'front door (served): /markets answers 308 → `/`, and the old card URLs 308 → the root card and its twitter mirror',
    r308.status === 308 && loc(r308) === '/' && card308.status === 308 && loc(card308) === '/opengraph-image' && tw308.status === 308 && loc(tw308) === '/twitter-image',
    `${r308.status} ${loc(r308)} · ${card308.status} ${loc(card308)} · ${tw308.status} ${loc(tw308)}`,
  )
  const storyRes = await get('/story')
  const story = flat(await storyRes.text())
  check(
    'front door (served): /story is 200 — the brochure as it shipped (movers strip, hero with HERO_LINE, venue band, map teaser, honesty strip, markets band, share band, the phone CTA bar) under the brochure nav, with the slim top line and every "Open Markets" door pointing at `/`; no href="/markets" anywhere on it',
    storyRes.status === 200 && ['data-movers-strip', 'data-landing-hero', 'data-venue-band', 'data-map-teaser', 'data-honesty-strip', 'data-markets-band', 'data-share-band', 'data-mcta-bar', 'data-story-top'].every((k) => story.includes(k)) &&
      story.replace(/<[^>]+>/g, '').includes(HERO_LINE) && /<header class="nav/.test(story) &&
      /data-story-top="true">[^<]*<span>You are reading the story\. The app is one tap away\.<\/span> ?<a[^>]*href="\/"[^>]*>Open Pantessa/.test(story) &&
      (story.match(/href="\/"[^>]*>Open Markets</g) ?? []).length >= 2 && !/href="\/markets"/.test(story),
    `status=${storyRes.status}`,
  )
  check(
    'front door (served): /story wears its own title + description (SPLASH), its canonical, the VideoObject JSON-LD (and not the WebSite/SoftwareApplication, which stay on `/`), and the rehearsal card as og:image + twitter:image',
    story.includes(`<title>${SPLASH.storyTitle}</title>`) && story.includes(`<meta name="description" content="${SPLASH.storyDescription}"`) &&
      /<link rel="canonical" href="[^"]*\/story"\/?>/.test(story) &&
      (() => { const t = jsonLdTypes(story); return t.has('VideoObject') && !t.has('WebSite') && !t.has('UNPARSEABLE') })() &&
      /<meta property="og:image" content="[^"]*\/story\/opengraph-image/.test(story) && /<meta name="twitter:image" content="[^"]*\/story\/twitter-image/.test(story),
  )
  const png = async (path: string) => {
    const r = await get(path)
    const b = new Uint8Array(await r.arrayBuffer())
    return { status: r.status, type: r.headers.get('content-type') ?? '', bytes: b.length, isPng: b[0] === 0x89 && b[1] === 0x50 }
  }
  const [rootCard, rootTw, storyCard, storyTw] = await Promise.all([png('/opengraph-image'), png('/twitter-image'), png('/story/opengraph-image'), png('/story/twitter-image')])
  check(
    'front door (served): the root card + its mirror render the board (200 PNG, a drawn board ≥ 60KB); the story card + its mirror render the rehearsal (200 PNG > 20KB)',
    [rootCard, rootTw].every((c) => c.status === 200 && /image\/png/.test(c.type) && c.isPng && c.bytes >= 60_000) &&
      [storyCard, storyTw].every((c) => c.status === 200 && /image\/png/.test(c.type) && c.isPng && c.bytes > 20_000),
    JSON.stringify({ root: rootCard.bytes, rootTw: rootTw.bytes, story: storyCard.bytes, storyTw: storyTw.bytes }),
  )
  const smap = await text('/sitemap.xml')
  check(
    'front door (served): the sitemap lists `/` and /story and never /markets (its DB-backed rows fail soft; the static entries are the pin)',
    /<loc>https?:\/\/[^<]+<\/loc>/.test(smap) && /\/story<\/loc>/.test(smap) && !/<loc>https?:\/\/[^/<]+\/markets<\/loc>/.test(smap),
    `story=${/\/story<\/loc>/.test(smap)} markets=${/<loc>https?:\/\/[^/<]+\/markets<\/loc>/.test(smap)}`,
  )
  const aapl = await text('/t/AAPL')
  const mf = await get('/manifest.webmanifest')
  const mfJson = mf.ok ? ((await mf.json()) as { start_url?: string }) : null
  check(
    'front door (served): /t/AAPL\'s BreadcrumbList item 1 is the site (never …/markets) and /manifest.webmanifest starts at `/`',
    /"@type":"BreadcrumbList"/.test(aapl) && !/"item":"[^"]*\/markets"/.test(aapl) && mf.ok && mfJson?.start_url === '/',
    `start_url=${mfJson?.start_url ?? '-'}`,
  )
}

// tsx compiles this as CJS (no top-level await): the runner is a main().
async function main(): Promise<void> {
  const pure = process.argv.includes('--pure')
  const base = (process.env.BASE ?? 'http://localhost:3980').replace(/\/$/, '')
  let failed = 0
  let n = 0
  const check: Check = (name, ok, extra) => {
    n++
    if (!ok) failed++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
  }
  await frontDoorPins(check)
  if (!pure) {
    const up = await fetch(`${base}/api/quotes?symbols=AAPL`, { signal: AbortSignal.timeout(10_000) }).then((r) => r.ok, () => false)
    if (!up) check(`front door (served): a server answers at ${base} (start \`next start -p 3980\`, or BASE=…; pass --pure to skip the served half)`, false)
    else await frontDoorHttpPins(check, base)
  }
  console.log(failed ? `\n${failed} of ${n} failed` : `\nall ${n} front-door pins green${pure ? ' (pure half only)' : ''}`)
  process.exit(failed ? 1 : 0)
}

if (process.argv[1]?.endsWith('front-door-pins.ts')) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
