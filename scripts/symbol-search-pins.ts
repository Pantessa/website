// Pins for the symbol search (2026-11-17; lib/symbol-search,
// components/markets/search). Nate on /t/UNI: "I should be able to search
// for a new asset on the asset page … small like on TradingView that then
// expands bigger when clicked … make sure it works on mobile too." Pure: no
// server, no chain, no DB. Called from scripts/test-api.ts, and runnable alone:
//   npx tsx scripts/symbol-search-pins.ts
import { existsSync, readFileSync } from 'node:fs'
import { primeHlPerps } from '../lib/charts'
import { SEARCH_POPULAR, SEARCH_RECENT_MAX, hitsFor, isSearchKey, matchRange, parseRecent, pushRecent, searchHitFor, searchScore, searchSymbols } from '../lib/symbol-search'

type Check = (name: string, ok: boolean, extra?: string) => void
const rf = (p: string) => readFileSync(p, 'utf8')
const code = (p: string) => rf(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

export function symbolSearchPins(check: Check) {
  const syms = (q: string, filter?: Parameters<typeof searchSymbols>[1]) => searchSymbols(q, filter).map((h) => h.symbol)

  // ── the ranking ─────────────────────────────────────────────────────────
  const aapl = syms('aapl')
  const apple = syms('apple')
  const coin = syms('$COIN')
  check('symbol search (rank): an exact ticker leads, with or without the $; a company name finds its ticker; every hit opens a chart',
    aapl[0] === 'AAPL' && apple.includes('AAPL') && coin[0] === 'COIN' && searchSymbols('a').every((h) => !!h.pair), `${aapl.slice(0, 3)} | ${apple.slice(0, 3)} | ${coin.slice(0, 3)}`)
  const tre = syms('treasury')
  const dow = syms('dow')
  const tenY = syms('10 year')
  check('symbol search (rank): the look-only indexes answer to a desk\'s words ("treasury", "dow", "10 year")',
    tre.includes('US10Y') && dow[0] === 'DJI' && tenY.includes('US10Y'), `${tre} | ${dow} | ${tenY}`)
  check('symbol search (rank): nothing typed finds nothing, a query no chart answers finds nothing, and an over-long one is refused',
    syms('').length === 0 && syms('   ').length === 0 && syms('xyzzyq').length === 0 && syms('a'.repeat(41)).length === 0)
  check('symbol search (score): exact > name > ticker prefix > name word > substring, and a shorter ticker beats a longer one on the same prefix',
    searchScore('SOL', 'Solana', 'sol') === 100 && searchScore('AAPL', 'Apple', 'apple') > searchScore('APP', 'Applovin Corporation', 'ap') &&
      searchScore('APP', 'Applovin Corporation', 'ap') > searchScore('AMAT', 'Applied Materials', 'appl') && searchScore('AMAT', 'Applied Materials', 'appl') > searchScore('AMAT', 'Applied Materials', 'materials') && searchScore('AMAT', 'Applied Materials', 'materials') > searchScore('X', 'Immaterials', 'materials') &&
      searchScore('SOL', 'Solana', 'so') > searchScore('SOFI', 'SoFi Technologies', 'so') && searchScore('UNI', 'Uniswap', 'zz') === 0)
  const stocksOnly = searchSymbols('a', { filter: 'stock' })
  const macroOnly = searchSymbols('index', { filter: 'macro' })
  check('symbol search (filter): a class filter keeps only its class (Stocks: Robinhood Chain tickers; Macro: the indexes)',
    stocksOnly.length > 0 && stocksOnly.every((h) => h.kind === 'stock') && macroOnly.every((h) => h.kind === 'macro') && searchSymbols('btc', { filter: 'stock' }).every((h) => h.symbol !== 'BTC'))

  // ── the live listing ────────────────────────────────────────────────────
  primeHlPerps({ main: ['BTC', 'ETH', 'SOL', 'HYPE', 'ZEC', 'kPEPE', ...Array.from({ length: 60 }, (_, i) => `PIN${i}`)], xyz: ['xyz:GOLD', 'xyz:SP500', 'xyz:TLT', 'xyz:CL', ...Array.from({ length: 30 }, (_, i) => `xyz:PX${i}`)] })
  const gold = searchSymbols('gold')
  const sp = searchSymbols('sp500')
  check('symbol search (live): with the venue\'s listing in hand a builder market leads its own name ("gold" → GOLD before GLD, "sp500" → SP500) and reads as Macro; a main-book perp nobody listed by hand is found',
    gold[0]?.symbol === 'GOLD' && gold[0]?.kind === 'macro' && sp[0]?.symbol === 'SP500' && syms('zec')[0] === 'ZEC', `${gold.map((h) => h.symbol)} | ${sp.map((h) => h.symbol)}`)
  const popular = hitsFor(SEARCH_POPULAR)
  check('symbol search (empty state): the opening list is chartable, has no repeats, honours a filter and skips what an earlier section showed',
    popular.length >= 8 && new Set(popular.map((h) => h.symbol)).size === popular.length && hitsFor(SEARCH_POPULAR, 'coin').every((h) => h.kind === 'coin') &&
      !hitsFor(SEARCH_POPULAR, 'all', new Set(['BTC'])).some((h) => h.symbol === 'BTC') && searchHitFor('NOPE123456789') === null)

  // ── recents, the highlight, the key ─────────────────────────────────────
  const many = Array.from({ length: 12 }, (_, i) => `T${i}`).reduce<string[]>((l, s) => pushRecent(l, s), [])
  check('symbol search (recents): newest first, no repeats, capped; a stored value that is not a ticker list reads as empty',
    pushRecent(['ETH', 'BTC'], 'btc').join() === 'BTC,ETH' && many.length === SEARCH_RECENT_MAX && many[0] === 'T11' && pushRecent(['ETH'], '<x>').join() === 'ETH' &&
      parseRecent('{"a":1}').length === 0 && parseRecent('not json').length === 0 && parseRecent('["ETH","<script>",7]').join() === 'ETH')
  check('symbol search (highlight): the matched run is found case-blind and a leading $ is not part of it',
    String(matchRange('Uniswap', 'UNI')) === '0,3' && String(matchRange('Apple', '$pp')) === '1,3' && matchRange('Apple', 'zz') === null && matchRange('Apple', '') === null)
  check('symbol search (key): "/" opens it from the page, never from a text field or with a modifier (⌘K stays the Ask door\'s)',
    isSearchKey({ key: '/' }, { tagName: 'BODY' }) && isSearchKey({ key: '/' }, null) && !isSearchKey({ key: '/' }, { tagName: 'INPUT' }) && !isSearchKey({ key: '/' }, { tagName: 'TEXTAREA' }) &&
      !isSearchKey({ key: '/' }, { tagName: 'DIV', isContentEditable: true }) && !isSearchKey({ key: '/', metaKey: true }, { tagName: 'BODY' }) && !isSearchKey({ key: 'k', metaKey: true }, { tagName: 'BODY' }))

  // ── wiring ──────────────────────────────────────────────────────────────
  const strip = code('components/markets/shell/MarketsTopStrip.tsx')
  const side = code('components/markets/shell/MarketsSide.tsx')
  const page = code('components/markets/shell/SymbolPage.tsx')
  const comp = code('components/markets/search/SymbolSearch.tsx')
  const css = rf('components/markets/search/search.css')
  // RE-PINNED 2026-11-19 (#1110): the strip takes the page's optional lead
  // (the home's eyebrow) at its left end, before Ask; MarketsSide hands it on.
  check('symbol search (wired): the lens sits in the strip between Ask and the bell (a phone\'s top bar), the pill beside the symbol on /t, and ONE panel is mounted per markets page',
    /\{lead \? <div className="mkt-frame__lead">\{lead\}<\/div> : null\}\s*<AskDoorTrigger variant="rail" \/>\s*<SymbolSearchTrigger variant="strip" \/>\s*<RailAlerts \/>/.test(strip) && /<MarketsTopStrip lead=\{lead\} \/>\s*<SymbolSearch \/>/.test(side) && (side.match(/<SymbolSearch \/>/g) ?? []).length === 1 &&
      /<span className="sym__sym mono">\{sym\}<\/span>\s*<SymbolSearchTrigger variant="head" \/>/.test(page))
  // 2026-11-19 (Nate: "same functionality as when on an asset page … only show
  // the style where it pops up"): the markets tool strip's box is a door to
  // the panel, and the in-place search it replaced is gone.
  const index = code('components/markets/shell/MarketsIndex.tsx')
  const mosaic = rf('components/home/mosaic.css')
  const STRANGER = ":root:not([data-home='return']) .mkt-frame:has(> .mkt-frame__main > .mk-claim)"
  check('symbol search (one style): the markets tool strip opens the pop-up panel (no in-place search is left), and on the stranger\'s landing the search rides the top bar as a field while the strip under the hero neither sticks nor draws a line',
    /<div className="mkt-frame__bar">\s*<SymbolSearchTrigger variant="bar" \/>/.test(index) && !/TickerSearch/.test(index) && !existsSync('components/markets/shell/TickerSearch.tsx') &&
      /className="ssx-field" onClick=\{\(\) => openSearch\(\)\}/.test(comp) && !/mkt-search__/.test(rf('app/x402-design.css') + rf('components/markets/markets.css')) &&
      css.includes(`${STRANGER} .mkt-frame__top .ssx-lens__word { display: block;`) && /^\.ssx-lens__word, \.ssx-lens__kbd \{ display: none; \}$/m.test(css) &&
      mosaic.includes(`${STRANGER} .mkt-frame__bar { position: static; border-bottom-color: transparent; }`) && mosaic.includes(`${STRANGER} .mkt-frame__bar > .mkt-search { display: none; }`))
  check('symbol search (wired): a search only navigates — the panel posts nothing, opens /t/<symbol>, and its one hand-off to the Ask door carries a draft, never a send',
    !/method:\s*'POST'/.test(comp) && !/api\/chat/.test(comp) && comp.includes('router.push(`/t/${hit.symbol}`)') && comp.includes('openDoor(typed)') && !/send:\s*true/.test(comp))
  check('symbol search (phone): under 720px the panel is the whole screen with a Cancel button, the box is 16px (no iOS zoom) and rows are a thumb tall; the header pill leaves a phone to the lens, which grows to 44px',
    /@media \(max-width: 720px\) \{[\s\S]*\.ssx__panel \{[^}]*height: 100dvh;[\s\S]*\.ssx__input \{ font-size: 16px; \}[\s\S]*\.ssx__cancel \{ display: block; \}[\s\S]*\.ssx__row \{[^}]*min-height: 56px;/.test(css) &&
      /@media \(max-width: 1023px\) \{\s*\.sym__titlerow > \.ssx-pill \{ display: none; \}\s*\.mkt-frame__top \.ssx-lens \{ width: 44px; height: 44px; \}/.test(css))
  // The prefix is this sheet's alone (Next's CSS is global once a chunk loads).
  const others = ['components/markets/markets.css', 'components/markets/look.css', 'app/x402-design.css', 'app/globals.css', 'components/markets/chart/tape-view.css']
  check('symbol search (css): no other sheet defines an .ssx class',
    others.every((p) => { try { return !/\.ssx[-_]/.test(rf(p)) } catch { return true } }))
}

if (process.argv[1] && /symbol-search-pins\.ts$/.test(process.argv[1])) {
  let pass = 0
  let fail = 0
  symbolSearchPins((name, ok, extra) => {
    if (ok) pass += 1
    else fail += 1
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? `\n     ${extra}` : ''}`)
  })
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
