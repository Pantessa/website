// Pins for the hero mosaic (2026-11-19): the stranger's hero on `/` is a grid
// of market tiles and dapp tiles around the claim, and one sentence that
// lights the tiles it would use (lib/hero-mosaic, components/home/HeroMosaic).
//   npx tsx scripts/hero-mosaic-pins.ts            (npm run pins:hero-mosaic)
//   BASE=http://localhost:PORT npx tsx scripts/hero-mosaic-pins.ts --served
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { isPublicAppPath } from '../lib/app-entry'
import { arrivalAllowed } from '../lib/arrival-fence'
import { askAppSlugs } from '../lib/ask-apps'
import { moneyShaped } from '../lib/ask-failure-shape'
import { chartHref } from '../lib/called-it/spec'
import { HOME_CALLED } from '../app/x/_lib/home-shelf'
import { EMPTY_HERO_CALLED, heroCalledFrom, heroCalledLine, HERO_BUY, HERO_CALLED, HERO_COLS, HERO_CYCLE, HERO_MOVER_FALLBACK, HERO_ROWS, HERO_TILES, heroAppAsk, heroAppFallbackHref, heroMoverSymbols, heroSay, heroTileSpan, type HeroAppTile } from '../lib/hero-mosaic'
import { isSignedInAppHref } from '../lib/home-doors'
import { marketSections } from '../lib/markets'
import { READ_IDS } from '../lib/read'

type Check = (name: string, ok: boolean, extra?: string) => void

const ROOT = new URL('..', import.meta.url).pathname
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')
const code = (p: string) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
const css = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '')

const ETH = 1800
const apps = HERO_TILES.filter((t): t is HeroAppTile => t.kind === 'app')

export function heroMosaicPins(check: Check): void {
  // ── The table ──
  const cells = HERO_TILES.reduce((n, t) => n + heroTileSpan(t), 0)
  const markets = HERO_TILES.filter((t) => t.kind === 'market').map((t) => (t as { id: string }).id)
  check(
    'hero mosaic: the tiles fill the grid around the claim exactly (8 × 4, the claim holds the middle 4 × 2), every instrument of the read is a tile once, two stock tiles, nine dapps once each, one stock buy and one Called it record',
    cells === HERO_COLS * HERO_ROWS - 8 &&
      markets.length === READ_IDS.length &&
      READ_IDS.every((id) => markets.includes(id)) &&
      HERO_TILES.filter((t) => t.kind === 'mover').length === 2 &&
      apps.length === 9 &&
      new Set(apps.map((a) => a.id)).size === 9 &&
      HERO_TILES.filter((t) => t.kind === 'buy').length === 1 &&
      HERO_TILES.filter((t) => t.kind === 'called').length === 1,
    `${cells} cells`,
  )

  // ── The sentences ──
  const asks = apps.map((a) => ({ a, ask: heroAppAsk(a.id, ETH) }))
  const bad = asks.filter(({ a, ask }) => !ask || !askAppSlugs(ask).some((s) => s === a.slug || s.startsWith(a.slug.replace(/-free$/, ''))) || !arrivalAllowed({ v: 1, text: ask, from: '/', at: Date.now(), mcps: askAppSlugs(ask) }, Date.now()).ok)
  check(
    "hero mosaic: every dapp tile says a sentence that composes ITS OWN app and passes the arrival fence from `/` (the press is the send; the ask travels out of band); the buy tile's sentence composes Robinhood Chain; nothing recurring, no leverage above 2x, no amount above $25",
    bad.length === 0 &&
      askAppSlugs(HERO_BUY.ask).includes('robinhood-free') &&
      moneyShaped(HERO_BUY.ask) &&
      [...asks.map((x) => x.ask ?? ''), HERO_BUY.ask].every((s) => !/every (day|week|month)|recurring|\bdca\b|weekly|daily/i.test(s) && !/\b([3-9]|\d{2,})x\b/i.test(s) && [...s.matchAll(/\$(\d+(?:\.\d+)?)/g)].every((m) => Number(m[1]) <= 25)),
    bad.map((b) => b.a.id).join(',') || asks.map((x) => x.ask).join(' | '),
  )
  check(
    'hero mosaic: the stake sentence is the one Nate asked for, in the Lido grammar\'s own "$N worth of" slot; the CoW limit is priced off the read\'s ether quote and says NOTHING without one (never a made-up price), and its tile then opens the app with CoW on',
    heroAppAsk('lido', ETH) === 'Stake $20 worth of ETH on Lido' &&
      /^limit order: buy [\d.]+ ETH for at most [\d.]+ USDC on Base$/.test(heroAppAsk('cow', ETH) ?? '') &&
      heroAppAsk('cow', null) === null &&
      heroAppAsk('cow', 0) === null &&
      heroSay('cow', null) === null &&
      heroAppFallbackHref(apps.find((a) => a.id === 'cow')!) === '/chat?tab=mcps&mcps=cow-free',
  )
  const tileIds = new Set<string>([...markets, ...apps.map((a) => a.id), 'aapl'])
  const says = HERO_CYCLE.map((f) => heroSay(f, ETH))
  check(
    'hero mosaic: the middle cycles through five sentences that are always available (none needs a live price), each lights its own tile first and only tiles that exist; a dapp lights the market its sentence names',
    HERO_CYCLE.length === 5 &&
      !HERO_CYCLE.includes('cow') &&
      says.every((s, i) => !!s && s.lit[0] === HERO_CYCLE[i] && s.lit.every((id) => tileIds.has(id))) &&
      HERO_CYCLE.every((f) => !!heroSay(f, null)) &&
      heroSay('lido', ETH)!.lit.join() === 'lido,eth' &&
      heroSay('hyperliquid', ETH)!.lit.join() === 'hyperliquid,btc' &&
      heroSay('aapl', ETH)!.lit.join() === 'aapl,robinhood',
  )
  const listed = new Set(marketSections().flatMap((s) => s.rows.map((r) => r.symbol)))
  check(
    'hero mosaic: the buy tile wears Nate\'s words and sends the builder\'s sentence; its stock and both fallback movers are listed here; the mover tiles never repeat the buy tile\'s stock or each other',
    HERO_BUY.label === 'Buy $25 worth of AAPL shares' &&
      HERO_BUY.ask === 'Buy $25 of AAPL' &&
      listed.has(HERO_BUY.symbol) &&
      HERO_MOVER_FALLBACK.every((s) => listed.has(s)) &&
      heroMoverSymbols([]).join() === HERO_MOVER_FALLBACK.join() &&
      heroMoverSymbols([{ symbol: 'AAPL' }, { symbol: 'intc' }, { symbol: 'INTC' }, { symbol: 'MU' }]).join() === 'INTC,MU' &&
      heroMoverSymbols([{ symbol: 'NVDA' }]).join() === 'NVDA,TSLA',
  )
  const shelf = { summaries: [{ handle: 'defi_dad', symbol: 'ETH', tally: { total: 4, right: 1 } }, { handle: 'dcinvestor', symbol: 'ETH', tally: { total: 12, right: 7 } }], avatars: [null, 'data:image/jpeg;base64,AAAA'] }
  check(
    "hero mosaic: the Called it tile opens the ASSET's chart with the account's calls pinned (the spec's own chartHref, a public page: a plain link, never a door), not the profile; the record is one the home shelf features",
    HERO_CALLED.href === chartHref(HERO_CALLED.handle, HERO_CALLED.symbol) &&
      !HERO_CALLED.href.startsWith('/x/') &&
      isPublicAppPath(HERO_CALLED.href) &&
      !isSignedInAppHref(HERO_CALLED.href) &&
      HOME_CALLED.some((f) => f.handle === HERO_CALLED.handle && f.symbol === HERO_CALLED.symbol),
    HERO_CALLED.href,
  )
  check(
    "hero mosaic: the tile wears the record's OWN photo and count, read by the server with the shelf (the photo is a data URI, never X's URL); a record that is not on this database leaves an initial and the plain line, never an invented number",
    heroCalledFrom(shelf).avatar === 'data:image/jpeg;base64,AAAA' &&
      heroCalledFrom(shelf).tally?.total === 12 &&
      heroCalledLine(heroCalledFrom(shelf)) === '12 ETH calls on the chart, 7 called it.' &&
      heroCalledFrom({ summaries: shelf.summaries.slice(0, 1), avatars: [null] }) === EMPTY_HERO_CALLED &&
      heroCalledLine(EMPTY_HERO_CALLED) === HERO_CALLED.line &&
      heroCalledFrom({ summaries: [{ handle: 'dcinvestor', symbol: 'ETH', tally: { total: 0, right: 0 } }], avatars: ['x'] }).tally === null &&
      /<HeroCalledSeed value=\{heroCalledFrom\(called\)\}>/.test(code('app/page.tsx')),
  )

  // ── The component ──
  const comp = code('components/home/HeroMosaic.tsx')
  check(
    'hero mosaic (component): an ask goes to the APP out of band (writeArrivalIntent + ARRIVAL_APP_HREF, the prefill URL only as the fallback) through the connect-to-act door; a dapp tile draws the mark only (its name is the accessible label); links are LandingLinks; nothing reads the posture, storage or the session',
    /writeArrivalIntent\(\{ text: ask, from: pathname \?\? ''/.test(comp) &&
      /router\.push\(handed \? ARRIVAL_APP_HREF : promptHref\(ask\)\)/.test(comp) &&
      /useConnectToAct\(\{ run: handOff, redirectFor: promptHref \}\)/.test(comp) &&
      /aria-label=\{`\$\{tile\.name\}: \$\{ask\}`\}/.test(comp) &&
      !/\{tile\.name\}<\/|>\{tile\.name\}</.test(comp.replace(/tile\.name\.slice\(0, 1\)/g, '')) &&
      !/<Link\b|<SpineLink\b|openConnectModal|localStorage|sessionStorage|useSession|dataset\.home|data-home/.test(comp) &&
      /prefers-reduced-motion: reduce/.test(comp) &&
      /document\.hidden/.test(comp),
  )
  const claim = code('components/home/SplashClaim.tsx')
  check(
    'hero mosaic (claim): the claim block is wrapped in the mosaic and the sentence sits between the claim\'s line and its doors; HomeSurface seeds the read\'s snapshot so the tiles are in the server HTML',
    /<header className="mk-claim" data-splash-claim>\s*(?:\{\}\s*)?<HeroMosaic>/.test(claim) &&
      claim.indexOf('mk-claim__sub') < claim.indexOf('<HeroComposer />') &&
      claim.indexOf('<HeroComposer />') < claim.indexOf('"mk-claim__doors"') &&
      /<HeroReadSeed value=\{read\}>/.test(code('components/home/HomeSurface.tsx')),
  )

  // ── The sheet ──
  const sheet = css('components/home/mosaic.css')
  const HOME_STRANGER = ":root:not([data-home='return']) .mkt-frame:has(> .mkt-frame__main > .mk-claim)"
  const others = ['components/markets/chart/tape-view.css', 'app/x402-design.css', 'components/markets/markets.css', 'components/home/hero.css', 'components/home/read.css']
  check(
    "hero mosaic (sheet): tokens only; the mosaic is laid out for a stranger only (every rule that moves the claim keys on `:root:not([data-home='return'])`) and the returning line hides the tiles and the sentence; sized by the claim's own container; the motion (a line growing, the sentence changing) is off under reduced motion; the `hm` prefix is in no other sheet",
    !/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(|font-size:\s*[\d.]+px/.test(sheet) &&
      /@container hero \(min-width: 900px\) \{/.test(sheet) &&
      (sheet.match(/@media \((?:max|min)-width[^)]*\)/g) ?? []).join() === '@media (min-width: 1024px)' &&
      /* RE-PINNED 2026-11-19 (#1110, the eyebrow rides the Ask bar's row): a
         rule that moves the claim keys on the stranger's posture inside the
         mosaic, or on the stranger's HOME FRAME (the bar's copy of the
         eyebrow, and the claim's own copy stepping aside for it). */
      sheet.split('\n').filter((l) => l.includes('.mk-claim__')).every((l) => l.trimStart().startsWith(":root:not([data-home='return']) .hm ") || l.trimStart().startsWith(`${HOME_STRANGER} `)) &&
      /^:root\[data-home='return'\] \.hm__tiles, :root\[data-home='return'\] \.hm-say \{ display: none; \}$/m.test(sheet) /* two selectors, never `:is(…)`: the landing's served pin reads the FIRST `:root[data-home=return] :is(…){display:none` in the page's CSS as hero.css's fold */ && !/:root\[data-home='return'\] :is\(/.test(sheet) &&
      /@keyframes hm-grow \{/.test(sheet) &&
      /@media \(prefers-reduced-motion: reduce\) \{\s*\.hm__spark, \.hm__tile\.is-lit \.hm__spark, \.hm-say__text \{ animation: none; \}/.test(sheet) &&
      !/position:\s*(sticky|fixed)/.test(sheet) &&
      others.every((p) => !/\.hm(__|-say|\s|\{|\.|:)/.test(css(p))),
  )
  // ── No rail for a stranger ──
  const railBlock = sheet.slice(sheet.indexOf('@media (min-width: 1024px) {'), sheet.indexOf('\n}', sheet.indexOf('@media (min-width: 1024px) {')))
  const railRules = railBlock.split('\n').slice(1).filter((l) => l.trim())
  check(
    "hero mosaic (no rail): on the home, in the stranger's posture, the frame is one column (the ask + account strip a bar across the top, the docked watchlist not drawn); every rule keys on the posture AND on the claim block being in the main column, so a returning visitor and every other page on the frame keep the rail",
    /* RE-PINNED 2026-11-19 (#1110): 6 → 10 rules. The bar draws the home's
       eyebrow at its left end (`.mkt-frame__lead`, hidden everywhere else),
       the claim's own eyebrow steps aside and the mosaic drops the strip it
       kept for it; all four key on the home frame like the rail rules.
       RE-PINNED 2026-11-19 (room to breathe): 10 → 11, THE READ's seat
       starts 40px under the search bar on the stranger's desktop home.
       RE-PINNED 2026-11-19 (search at the top): 11 → 12. The tool strip under
       the hero no longer sticks or draws a line, and gives up its search (the
       top bar's lens opens out into the field, search.css). */
    railRules.length === 12 &&
      railRules.some((l) => l.includes(`${HOME_STRANGER} > .mkt-frame__main > .mk-lead-seat { margin-top: 40px; }`)) &&
      railRules.every((l) => l.trimStart().startsWith(HOME_STRANGER)) &&
      /\.mkt-frame__lead \{ display: flex;/.test(railBlock) &&
      railRules.some((l) => l.includes(`${HOME_STRANGER} > .mkt-frame__main .hm .mk-claim__eyebrow { display: none; }`)) &&
      /^\.mkt-frame__lead \{ display: none; \}$/m.test(sheet) &&
      /grid-template-columns: minmax\(0, 1fr\); grid-template-areas: "top" "main" "foot";/.test(railBlock) &&
      /\.mkt-frame__side \{ display: contents; \}/.test(railBlock) &&
      /\.mkt-frame__top \{ grid-area: top;/.test(railBlock) &&
      /\.mkt-frame__bar \{ position: static; border-bottom-color: transparent; \}/.test(railBlock) && /\.mkt-frame__bar > \.mkt-search \{ display: none; \}/.test(railBlock) &&
      /\.mkt-frame__rail \{ display: none; \}/.test(railBlock) &&
      /\{claim \?\? <h1 className="sr-only">Markets<\/h1>\}/.test(code('components/markets/shell/MarketsIndex.tsx')),
    `${railRules.length} rules`,
  )
}

export async function heroMosaicPinsServed(check: Check, base: string): Promise<void> {
  const res = await fetch(`${base}/`, { headers: { 'x-yf-internal-run': '1' } })
  const html = (await res.text()).replace(/<!--\s*-->/g, '')
  const from = html.indexOf('data-hero-mosaic')
  const hero = from < 0 ? '' : html.slice(from, html.indexOf('class="mkt-frame__bar"', from))
  const tiles = hero.match(/data-hero-tile="[^"]+"/g) ?? []
  const appTiles = tiles.filter((t) => t.includes('"app:'))
  check(
    'hero mosaic (served): `/` renders the mosaic in the server HTML above the tool strip: 22 tiles (9 markets, 2 stocks, 9 dapps, the buy, the record), the first sentence of the cycle in the middle with its two tiles lit, and the buy tile and the record with their words',
    res.status === 200 &&
      tiles.length === HERO_TILES.length &&
      appTiles.length === 9 &&
      tiles.filter((t) => t.includes('"market:')).length === READ_IDS.length &&
      tiles.filter((t) => t.includes('"stock:')).length === 2 &&
      /data-hero-say="lido"/.test(hero) &&
      hero.includes('Stake $20 worth of ETH on Lido') &&
      /data-lit="lido eth"/.test(hero) &&
      (hero.match(/class="hm__tile[^"]* is-lit"/g) ?? []).length === 2 &&
      hero.includes(HERO_BUY.label) &&
      hero.includes(`href="${HERO_CALLED.href}"`) &&
      hero.includes(HERO_CALLED.name),
    `${tiles.length} tiles, ${appTiles.length} dapps`,
  )
  // What each dapp tile DRAWS: its inner HTML with the tags (the mark's svg) removed.
  const drawn = [...hero.matchAll(/<(button|a)\b[^>]*data-hero-tile="app:[a-z]+"[^>]*>([\s\S]*?)<\/\1>/g)].map((m) => m[2].replace(/<[^>]+>/g, '').trim())
  check(
    'hero mosaic (served): a dapp tile shows its mark and NO name (the name is only its accessible label), and every dapp tile that has a sentence is a button carrying it',
    drawn.length === 9 && drawn.every((t) => t === '') && appTiles.length === 9 && (hero.match(/<button[^>]*data-hero-tile="app:[a-z]+"[^>]*data-ask="[^"]+"/g) ?? []).length + (hero.match(/<a[^>]*data-hero-tile="app:[a-z]+"/g) ?? []).length === 9,
  )
}

// Run alone.
if (import.meta.url === `file://${process.argv[1]}`) {
  let failed = 0
  let n = 0
  const check: Check = (name, ok, extra) => {
    n++
    if (!ok) failed++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
  }
  heroMosaicPins(check)
  const served = process.argv.includes('--served') || !!process.env.BASE
  const done = served ? heroMosaicPinsServed(check, process.env.BASE ?? 'http://localhost:3000') : Promise.resolve()
  done.then(() => {
    console.log(failed ? `${failed} of ${n} failed` : `all green (${n})`)
    process.exit(failed ? 1 : 0)
  })
}
