// Pins for the symbol search (2026-11-17; lib/symbol-search,
// components/markets/search). Nate on /t/UNI: "I should be able to search
// for a new asset on the asset page … small like on TradingView that then
// expands bigger when clicked … make sure it works on mobile too." Pure: no
// server, no chain, no DB. Called from scripts/test-api.ts, and runnable alone:
//   npx tsx scripts/symbol-search-pins.ts
import { existsSync, readFileSync } from 'node:fs'
import { chartPairFor, isChartOnlyPair, isHip3Pair, isLiveOnlyHlPair, isPerpTwinPair, pairTicker, perpTwinOf, primeHlPerps, stockTwinOf } from '../lib/charts'
import { perpTwinStem, resolveHlCoin } from '../lib/hl-dex'
import { parseHlIntent } from '../lib/hyperliquid-exec'
import { composeTicketAsk, freshTicket, ticketSidesFor } from '../lib/order-ticket'
import { execAsks } from '../lib/trade-asks'
import { robinhoodRegistryTokens } from '../lib/token-list'
import { symbolName } from '../lib/watchlists'
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
  // 2026-11-19: the listing also carries what the perp-twin pins below read —
  // xyz perps on two charted stocks (ANT, NVDA), one on a feedless listing
  // (SATS), and a MAIN-book coin that shares a stock's ticker (NOW) with no
  // xyz market beside it.
  primeHlPerps({ main: ['BTC', 'ETH', 'SOL', 'HYPE', 'ZEC', 'kPEPE', 'NOW', ...Array.from({ length: 60 }, (_, i) => `PIN${i}`)], xyz: ['xyz:GOLD', 'xyz:SP500', 'xyz:TLT', 'xyz:CL', 'xyz:ANT', 'xyz:NVDA', 'xyz:SATS', ...Array.from({ length: 30 }, (_, i) => `xyz:PX${i}`)] })
  const gold = searchSymbols('gold')
  const sp = searchSymbols('sp500')
  check('symbol search (live): with the venue\'s listing in hand a builder market leads its own name ("gold" → GOLD before GLD, "sp500" → SP500) and reads as Macro; a main-book perp nobody listed by hand is found',
    gold[0]?.symbol === 'GOLD' && gold[0]?.kind === 'macro' && sp[0]?.symbol === 'SP500' && syms('zec')[0] === 'ZEC', `${gold.map((h) => h.symbol)} | ${sp.map((h) => h.symbol)}`)
  const popular = hitsFor(SEARCH_POPULAR)
  check('symbol search (empty state): the opening list is chartable, has no repeats, honours a filter and skips what an earlier section showed',
    popular.length >= 8 && new Set(popular.map((h) => h.symbol)).size === popular.length && hitsFor(SEARCH_POPULAR, 'coin').every((h) => h.kind === 'coin') &&
      !hitsFor(SEARCH_POPULAR, 'all', new Set(['BTC'])).some((h) => h.symbol === 'BTC') && searchHitFor('NOPE123456789') === null)

  // ── one share, two instruments (2026-11-19, the Anthropic listing) ──────
  {
    // Nate, on ANT going live on Robinhood while /t/ANT charted the Hyperliquid
    // perp: "show ANT like this one for perps and one for robinhood and let
    // the user decide". A stock with an xyz perp is two chart symbols: the
    // stock keeps the ticker, the perp is the ticker + PERP.
    const stock = chartPairFor('ANT')
    const twin = chartPairFor('ANTPERP')
    check('perp twin (chart): the stock keeps the ticker and its xyz perp charts as ticker + PERP (typed with a hyphen too) — a builder market the order layer builds on, labelled by the share',
      stock?.source === 'robinhood' && twin?.source === 'hyperliquid' && twin.pair === 'xyz:ANT' && twin.symbol === 'ANTPERP' && twin.label === 'ANT / USD' &&
        chartPairFor('ant-perp')?.symbol === 'ANTPERP' && isHip3Pair(twin) && !isChartOnlyPair(twin) && isLiveOnlyHlPair(twin) && isPerpTwinPair(twin) && !isPerpTwinPair(stock) && !isPerpTwinPair(chartPairFor('SP500')),
      JSON.stringify(twin))
    check('perp twin (chart): each side names the other (ANT ↔ ANTPERP), both read as the share\'s ticker and company, and a stock the venue lists no perp for has no twin',
      perpTwinOf('ANT') === 'ANTPERP' && perpTwinOf('ant') === 'ANTPERP' && stockTwinOf(twin) === 'ANT' && stockTwinOf(stock) === null && pairTicker(twin!) === 'ANT' && pairTicker(stock!) === 'ANT' &&
        symbolName('ANTPERP') === symbolName('ANT') && symbolName('ANT') === 'Anthropic' && perpTwinOf('F') === null && chartPairFor('FPERP') === null && perpTwinOf('BTC') === null && perpTwinOf('SP500') === null)
    check('perp twin (chart): only the xyz dex grows one — a MAIN-book coin that shares a stock\'s ticker never does (NOW the coin is not ServiceNow), and a feedless listing stays chartless both ways',
      chartPairFor('NOW')?.source === 'robinhood' && perpTwinOf('NOW') === null && chartPairFor('NOWPERP') === null && chartPairFor('SATS') === null && perpTwinOf('SATS') === null && chartPairFor('SATSPERP') === null)
    const ant = searchSymbols('ANT')
    const anthropic = searchSymbols('anthropic')
    check('perp twin (search): a stock the venue also lists is TWO rows, the stock token then its perp right under it, both shown by the share\'s ticker with their own class; the Stocks and Perps filters keep one each',
      ant[0]?.symbol === 'ANT' && ant[0].kind === 'stock' && ant[1]?.symbol === 'ANTPERP' && ant[1].kind === 'perp' && ant[0].ticker === 'ANT' && ant[1].ticker === 'ANT' && ant[1].name === 'Anthropic' &&
        anthropic[0]?.symbol === 'ANT' && anthropic[1]?.symbol === 'ANTPERP' && syms('ANT', { filter: 'stock' }).includes('ANT') && !syms('ANT', { filter: 'stock' }).includes('ANTPERP') &&
        syms('ANT', { filter: 'perp' })[0] === 'ANTPERP' && !syms('ANT', { filter: 'perp' }).includes('ANT'),
      `${ant.slice(0, 3).map((h) => `${h.symbol}:${h.kind}`)} | ${anthropic.slice(0, 2).map((h) => h.symbol)}`)
    check('perp twin (search): typed as the perp (ANT-PERP, antperp) the perp leads; a loose match on a stock (a few letters inside its name) stays one row; a stock with no perp is one row',
      syms('ANT-PERP')[0] === 'ANTPERP' && syms('antperp')[0] === 'ANTPERP' && syms('vidia').includes('NVDA') && !syms('vidia').includes('NVDAPERP') && syms('nvda').slice(0, 2).join() === 'NVDA,NVDAPERP' &&
        syms('ford').includes('F') && !syms('ford').some((s) => s.endsWith('PERP')),
      `${syms('ANT-PERP').slice(0, 2)} | ${syms('vidia').slice(0, 3)} | ${syms('nvda').slice(0, 3)}`)
    const sides = twin ? ticketSidesFor(twin) : []
    const long = twin ? composeTicketAsk(twin, freshTicket(twin, 'long', { usd: 25 }), 100) : null
    const strip = twin ? execAsks(twin, { usd: 50, last: 100 }) : []
    check('perp twin (order): its page offers Long and Short only; the SENTENCE keeps the twin\'s spelling and the button names the share; the stock page still offers Buy and Sell',
      sides.join() === 'long,short' && !!long && long.ok && long.ask === 'Long $25 of ANTPERP on Hyperliquid' && long.label === 'Long $25 of ANT' &&
        strip.map((a) => a.label).join() === 'Long ANT,Short ANT' && strip[0].ask === 'Long $50 of ANTPERP on Hyperliquid' && (stock ? ticketSidesFor(stock).join() : '') === 'buy,sell',
      `${sides} | ${long && long.ok ? `${long.ask} / ${long.label}` : ''} | ${strip.map((a) => a.ask)}`)
    const open = parseHlIntent('Long $25 of ANTPERP on Hyperliquid')
    const lev = parseHlIntent('2x Short $50 of ant-perp on hyperliquid')
    const close = parseHlIntent('Close my ANTPERP long on Hyperliquid')
    const bare = parseHlIntent('Long $25 of ANT on Hyperliquid')
    check('perp twin (order): the twin\'s spelling is read as the xyz market and no other (open, leveraged, hyphenated, close); a bare ticker, a non-stock "…PERP" and the grammar\'s own "syrup perp" read as before',
      open?.kind === 'open' && open.coin === 'xyz:ANT' && lev?.kind === 'open' && lev.coin === 'xyz:ANT' && lev.leverage === 2 && !lev.isBuy && close?.kind === 'close' && close.coin === 'xyz:ANT' &&
        bare?.kind === 'open' && bare.coin === 'ANT' && (parseHlIntent('Long $10 of BTCPERP on Hyperliquid') as { coin?: string } | null)?.coin === 'BTCPERP' &&
        (parseHlIntent('buy 10 syrup perp on hyperliquid') as { coin?: string } | null)?.coin === 'SYRUP' && (parseHlIntent('Long $25 of xyz:SP500 on Hyperliquid') as { coin?: string } | null)?.coin === 'xyz:SP500',
      `${JSON.stringify(open)} | ${JSON.stringify(close)} | ${JSON.stringify(bare)}`)
    const books = { main: ['BTC', 'NOW', 'kPEPE'], dexes: { xyz: ['xyz:ANT', 'xyz:NOW', 'xyz:SP500'] } }
    check('perp twin (venue): the resolver the venue gate reads takes the spelling to the twin dex ALONE — NOWPERP is xyz:NOW while a bare NOW is still the main book\'s coin; a stem the dex does not list resolves to nothing',
      resolveHlCoin('ANTPERP', books)?.coin === 'xyz:ANT' && resolveHlCoin('ant-perp', books)?.coin === 'xyz:ANT' && resolveHlCoin('NOWPERP', books)?.coin === 'xyz:NOW' && resolveHlCoin('NOW', books)?.coin === 'NOW' &&
        resolveHlCoin('BTCPERP', books) === null && resolveHlCoin('ANTPERP', { main: ['BTC'], dexes: {} }) === null && perpTwinStem('ANTPERP') === 'ANT' && perpTwinStem('ant-perp') === 'ANT' && perpTwinStem('PERP') === null && perpTwinStem('ANT') === null)
    // The registry that listed ANT on day one (lib/token-list): the issuer's
    // own document, read behind the Uniswap list. The converter is pure and
    // fails closed row by row.
    const ok = { tokenSymbol: 'ANT', tokenName: 'Anthropic, PBC Class A Common Stock • Robinhood Token', tokenDecimals: 18, status: 'ASSET_STATUS_ACTIVE', deployments: [{ contractAddress: '0xbbB6c29bCc3a1028A2B54310DF73F4F7A3bcB373', chainId: 4663 }] }
    const rows = robinhoodRegistryTokens({ assets: [
      ok,
      { ...ok, tokenSymbol: 'OFF', status: 'ASSET_STATUS_INACTIVE' },
      { ...ok, tokenSymbol: 'ELSE', deployments: [{ contractAddress: ok.deployments[0].contractAddress, chainId: 1 }] },
      { ...ok, tokenSymbol: 'TWO', deployments: [ok.deployments[0], ok.deployments[0]] },
      { ...ok, tokenSymbol: 'BADADDR', deployments: [{ contractAddress: '0x1234', chainId: 4663 }] },
      { ...ok, tokenSymbol: 'BADDEC', tokenDecimals: '18' },
      { ...ok, tokenSymbol: 'bad symbol!' },
      null,
    ] })
    const tl = code('lib/token-list.ts')
    check('stock registry: Robinhood\'s own token registry becomes list rows only for an ACTIVE asset with one well-formed deployment on the chain (the name loses its "• Robinhood Token" tail); it is read AFTER the Uniswap list, so it only ever adds a symbol',
      rows.length === 1 && rows[0].symbol === 'ANT' && rows[0].chainId === 4663 && rows[0].decimals === 18 && rows[0].address === ok.deployments[0].contractAddress && rows[0].name === 'Anthropic, PBC Class A Common Stock' &&
        robinhoodRegistryTokens(null).length === 0 && robinhoodRegistryTokens({ assets: 'x' }).length === 0 &&
        /const sources: ListSource\[\] = \[\{ url: UNISWAP_LIST \}\][\s\S]*if \(chainId === ROBINHOOD_REGISTRY_CHAIN_ID\) sources\.push\(\{ url: ROBINHOOD_REGISTRY_URL/.test(tl) && /const partial = lists\.length < sources\.length/.test(tl),
      JSON.stringify(rows))
    // The page: a link a warm server draws and a cold browser does not is a
    // hydration error, so a stock page warms the venue's table and hands it down.
    const route = code('app/t/[symbol]/page.tsx')
    const shell = code('components/markets/shell/SymbolPage.tsx')
    check('perp twin (page): the header carries the Stock / Perp switch (the page you are on is marked, the other is a link), and a stock page warms the venue\'s table and hands it to the browser so both renders agree',
      /if \(pair\?\.source === 'robinhood'\) await warmHlPerps\(\)/.test(route) && /isLiveOnlyHlPair\(pair\) \|\| \(pair\?\.source === 'robinhood' && perpTwinOf\(pair\.symbol\)\) \? liveHlPerpNames\(\) : null/.test(route) &&
        /<nav className="sym__twin mono"/.test(shell) && /href=\{`\/t\/\$\{twinStock\}`\}/.test(shell) && /href=\{`\/t\/\$\{twinPerp\}`\}/.test(shell) && (shell.match(/aria-current="page"/g) ?? []).length >= 2 &&
        /\.sym__twin-opt\[aria-current='page'\]/.test(rf('components/markets/markets.css')))

  }

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
      // RE-PINNED 2026-11-19: the header shows the share's ticker (a perp twin's `ANTPERP` reads ANT); for every other symbol it IS the symbol.
      /<span className="sym__sym mono">\{ticker\}<\/span>\s*<SymbolSearchTrigger variant="head" \/>/.test(page))
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
