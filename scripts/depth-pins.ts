// Pins for the Depth chart (lib/depth): the book model and its deltas, the
// venue wire shapes on verbatim samples, the window and the cumulative
// curve, the hover's numbers, where a print lands, the act at a level, the
// plan per chart, the words, the view's URL, and the wiring. Pure: no
// server, no socket, no DB. Called from scripts/test-api.ts, and runnable
// alone:
//   npx tsx scripts/depth-pins.ts
import { readFileSync } from 'node:fs'
import {
  DEPTH_TAPE_ROWS,
  DEFAULT_DEPTH_UNIT,
  DEFAULT_DEPTH_WINDOW_PCT,
  DEPTH_WINDOWS,
  EMPTY_BOOK,
  PRINT_FADE_MS,
  applyL2Changes,
  axisSteps,
  bookFromLevels,
  bookFromRoute,
  bookWords,
  costToMove,
  cumulate,
  depthPlanFor,
  depthWindow,
  fmtDepthPrice,
  fmtDepthSize,
  fmtDepthUsd,
  levelActsFor,
  levelAt,
  limitAimAt,
  parseCoinbaseL2,
  parseHlL2Book,
  printAlpha,
  printOnBook,
  printRadius,
  printWords,
  wallsIn,
} from '../lib/depth'
import { bookProductFor } from '../lib/depth-feed'
import { fmtLimitPrice } from '../lib/order-ticket'
import { parseViewParam, viewUrl } from '../lib/markets'

type Check = (name: string, ok: boolean, extra?: string) => void

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps

/** A UNI-shaped book: bids under 7.24, asks over, in base units. */
const BOOK = bookFromLevels(
  [
    { px: 7.2418, size: 42.97 },
    { px: 7.2417, size: 11.23 },
    { px: 7.2400, size: 500 },
    { px: 7.1000, size: 1000 },
    { px: 6.5000, size: 20 },
  ],
  [
    { px: 7.246, size: 11.23 },
    { px: 7.25, size: 100 },
    { px: 7.30, size: 2000 },
    { px: 7.40, size: 50 },
    { px: 8.00, size: 10 },
  ],
  1_000,
)

export function depthPins(check: Check): void {
  // ── The book model ────────────────────────────────────────────────────
  check('depth: a book from raw levels sorts bids best-first down and asks best-first up, drops zero and negative sizes and prices, keeps the LAST size of a repeated price, and mids the spread',
    (() => {
      const b = bookFromLevels([{ px: 1, size: 5 }, { px: 3, size: 2 }, { px: 2, size: 0 }, { px: -1, size: 4 }, { px: 3, size: 7 }, { px: NaN, size: 1 }], [{ px: 9, size: 1 }, { px: 5, size: 0.5 }, { px: 5, size: 0 }, { px: 7, size: -2 }])
      return b.bids.map((l) => `${l.px}:${l.size}`).join(',') === '3:7,1:5' && b.asks.map((l) => `${l.px}:${l.size}`).join(',') === '9:1' && b.mid === 6
    })())
  check('depth: a crossed snapshot (a bid at or over the best ask) drops the crossing bids, never a negative spread; a one-sided book has no mid',
    (() => {
      const b = bookFromLevels([{ px: 10, size: 1 }, { px: 9, size: 1 }, { px: 8, size: 1 }], [{ px: 9, size: 1 }, { px: 11, size: 1 }])
      const one = bookFromLevels([{ px: 1, size: 1 }], [])
      return b.bids.map((l) => l.px).join(',') === '8' && b.asks.map((l) => l.px).join(',') === '9,11' && b.mid === 8.5 && one.mid === null && one.bids.length === 1
    })())
  check('depth: a venue delta sets a level, zero removes it, an unchanged delta returns the same book object, and the mid follows the best levels',
    (() => {
      const b0 = bookFromLevels([{ px: 10, size: 1 }], [{ px: 12, size: 1 }], 1)
      const b1 = applyL2Changes(b0, [{ side: 'bid', px: 11, size: 3 }], 2)
      const b2 = applyL2Changes(b1, [{ side: 'bid', px: 11, size: 0 }, { side: 'ask', px: 12, size: 0 }, { side: 'ask', px: 13, size: 2 }], 3)
      const same = applyL2Changes(b2, [{ side: 'bid', px: 10, size: 1 }, { side: 'bid', px: 99, size: 0 }], 4)
      return b1.mid === 11.5 && b1.at === 2 && b2.bids.length === 1 && b2.asks[0].px === 13 && b2.mid === 11.5 && same === b2 && applyL2Changes(b2, [], 5) === b2
    })())

  // ── Venue wire shapes, on verbatim samples (measured 2026-10-13) ──────
  check('depth: Coinbase Advanced Trade level2 parses its snapshot and update events (side bid/offer, price_level, new_quantity; 0 removes) and ignores everything else on the socket',
    (() => {
      const snap = { channel: 'l2_data', timestamp: '2026-10-13T12:23:32.48137932Z', sequence_num: 0, events: [{ type: 'snapshot', product_id: 'UNI-USD', updates: [{ side: 'bid', event_time: '2026-10-13T12:23:32.041691Z', price_level: '7.2378', new_quantity: '11.23' }, { side: 'offer', event_time: '2026-10-13T12:23:32.041691Z', price_level: '7.2460', new_quantity: '11.23' }] }] }
      const upd = { channel: 'l2_data', sequence_num: 2, events: [{ type: 'update', product_id: 'UNI-USD', updates: [{ side: 'bid', event_time: 't', price_level: '7.2378', new_quantity: '0' }, { side: 'offer', price_level: 'x', new_quantity: '1' }, { side: 'buy', price_level: '1', new_quantity: '1' }] }] }
      const s = parseCoinbaseL2(snap)
      const u = parseCoinbaseL2(upd)
      return s.length === 1 && s[0].kind === 'snapshot' && s[0].product === 'UNI-USD' && s[0].changes.map((c) => `${c.side}@${c.px}=${c.size}`).join(',') === 'bid@7.2378=11.23,ask@7.246=11.23' &&
        u.length === 1 && u[0].kind === 'update' && u[0].changes.length === 1 && u[0].changes[0].size === 0 &&
        parseCoinbaseL2({ channel: 'subscriptions', events: [{ subscriptions: {} }] }).length === 0 && parseCoinbaseL2({ channel: 'heartbeats' }).length === 0 && parseCoinbaseL2(null).length === 0 && parseCoinbaseL2('{}').length === 0
    })())
  check('depth: a Hyperliquid l2Book push (levels: [bids, asks] of {px, sz, n}) parses from the socket envelope and from the bare info body; a non-book message is null',
    (() => {
      const push = { channel: 'l2Book', data: { coin: 'HYPE', time: 1791894217862, levels: [[{ px: '80.871', sz: '48.94', n: 3 }, { px: '80.866', sz: '100.0', n: 1 }], [{ px: '80.88', sz: '5.33', n: 2 }]] } }
      const b = parseHlL2Book(push, 7)
      const bare = parseHlL2Book(push.data, 8)
      return !!b && b.bids.length === 2 && b.bids[0].px === 80.871 && b.bids[0].size === 48.94 && b.asks[0].px === 80.88 && near(b.mid!, (80.871 + 80.88) / 2) && b.at === 7 && !!bare && bare.at === 8 &&
        parseHlL2Book({ channel: 'subscriptionResponse', data: { method: 'subscribe' } }) === null && parseHlL2Book({ channel: 'pong' }) === null && parseHlL2Book({ data: { levels: [[], []] } }) === null
    })())
  check('depth: the site\'s own book routes carry dollars a level (spot-book, book): size = usd / px; a body with no sides is null',
    (() => {
      const b = bookFromRoute({ bids: [{ px: 2, usd: 10 }], asks: [{ px: 4, usd: 8 }], at: 3 })
      return !!b && b.bids[0].size === 5 && b.asks[0].size === 2 && b.at === 3 && bookFromRoute({ symbol: 'X', missing: 'Coinbase' } as never) === null && bookFromRoute(null) === null
    })())
  check('depth: the venue product spelling — Coinbase\'s product for a coinbase pair, SYMBOL-USD otherwise; Hyperliquid\'s coin for a perp, the symbol otherwise',
    bookProductFor('coinbase', { symbol: 'ETH', source: 'coinbase', pair: 'ETH-USD' }) === 'ETH-USD' && bookProductFor('coinbase', { symbol: 'HYPE', source: 'hyperliquid', pair: 'HYPE' }) === 'HYPE-USD' &&
      bookProductFor('hyperliquid', { symbol: 'HYPE', source: 'hyperliquid', pair: 'HYPE' }) === 'HYPE' && bookProductFor('hyperliquid', { symbol: 'UNI', source: 'coinbase', pair: 'UNI-USD' }) === 'UNI')

  // ── The curve ─────────────────────────────────────────────────────────
  check('depth: cumulate runs from the mid outward, monotone in units and dollars, skipping a zero size',
    (() => {
      const c = cumulate([{ px: 10, size: 1 }, { px: 9, size: 0 }, { px: 8, size: 2 }])
      return c.length === 2 && c[0].cum === 1 && c[0].cumUsd === 10 && c[1].cum === 3 && c[1].cumUsd === 26 && cumulate([]).length === 0
    })())
  check('depth: the window chips are 0.5 · 1 · 2 · 5 · 10 · All, the default ±2%, the size axis opens in dollars, the tape shows six whole rows (four on a phone)',
    DEPTH_WINDOWS.map((w) => w.label).join(',') === '0.5%,1%,2%,5%,10%,All' && DEPTH_WINDOWS[5].pct === null && DEFAULT_DEPTH_WINDOW_PCT === 2 && DEFAULT_DEPTH_UNIT === 'usd' && DEPTH_TAPE_ROWS === 6 && /\.dp__print:nth-child\(n \+ 5\) \{ display: none; \}/.test(readFileSync('components/markets/chart/depth.css', 'utf8')) && !/\.dp__tape \{[^}]*max-height/.test(readFileSync('components/markets/chart/depth.css', 'utf8')))
  check('depth: a ±2% window of the UNI book is symmetric about the mid, cumulated from the mid outward (the edge reads the window\'s own dollars, not the whole book\'s), with the far levels left out',
    (() => {
      const w = depthWindow(BOOK, 2)
      if (!w) return false
      const mid = (7.2418 + 7.246) / 2
      return near(w.mid, mid) && near(w.lo, mid * 0.98) && near(w.hi, mid * 1.02) && w.bids.length === 4 && w.asks.length === 3 && near(w.bids[3].cum, 42.97 + 11.23 + 500 + 1000) && near(w.asks[2].cum, 11.23 + 100 + 2000) &&
        near(w.bidUsd, 42.97 * 7.2418 + 11.23 * 7.2417 + 500 * 7.24 + 1000 * 7.1) && near(w.maxCum, 2111.23) && near(w.maxCumUsd, Math.max(w.bidUsd, w.askUsd))
    })())
  check('depth: the All window spans the whole book on a span symmetric about the mid; a book with no mid or a bad pct has no window',
    (() => {
      const w = depthWindow(BOOK, null)
      const mid = (7.2418 + 7.246) / 2
      return !!w && near(w.hi, 8) && near(w.lo, mid - (8 - mid)) && w.bids.length === 5 && w.asks.length === 5 && depthWindow(EMPTY_BOOK, 2) === null && depthWindow(BOOK, 0) === null && depthWindow(BOOK, -1) === null
    })())
  check('depth: levelAt is a step function — the last level at or nearer the mid than the price, null inside the spread, past the window, or at the mid',
    (() => {
      const w = depthWindow(BOOK, 2)!
      const a = levelAt(w, 7.27)
      const b = levelAt(w, 7.2405)
      return !!a && a.side === 'ask' && a.level.px === 7.25 && a.index === 1 && !!b && b.side === 'bid' && b.level.px === 7.2417 && b.index === 1 && levelAt(w, 7.2435) === null && levelAt(w, w.mid) === null && levelAt(w, 9) !== null && levelAt(w, 9)!.level.px === 7.3
    })())
  check('depth: costToMove sums the dollars resting between the mid and the price on the side the price is on; zero inside the spread or at the mid',
    near(costToMove(BOOK, 7.26), 11.23 * 7.246 + 100 * 7.25) && near(costToMove(BOOK, 7.2), 42.97 * 7.2418 + 11.23 * 7.2417 + 500 * 7.24) && costToMove(BOOK, BOOK.mid!) === 0 && costToMove(BOOK, 7.2435) === 0 && costToMove(EMPTY_BOOK, 5) === 0)
  check('depth: a buy lifts the asks, a sell hits the bids; with no side the price decides, at the mid the asks',
    printOnBook({ price: 1, side: 'buy' }, 10) === 'ask' && printOnBook({ price: 100, side: 'sell' }, 10) === 'bid' && printOnBook({ price: 9 }, 10) === 'bid' && printOnBook({ price: 10 }, 10) === 'ask' && printOnBook({ price: 3 }, null) === 'ask')
  check('depth: the walls are the largest single levels by dollars, per side',
    (() => {
      const w = depthWindow(BOOK, 2)!
      const x = wallsIn(w, 2)
      return x.bids[0].px === 7.1 && x.bids[1].px === 7.24 && x.asks[0].px === 7.3 && x.asks[1].px === 7.25 && wallsIn(w, 0).bids.length === 0
    })())
  check('depth: a print fades 1 → 0 over eight seconds and a dot grows with the square root of its notional, floored and capped',
    PRINT_FADE_MS === 8_000 && printAlpha(1000, 1000) === 1 && near(printAlpha(1000, 5000), 0.5) && printAlpha(1000, 9000) === 0 && printAlpha(2000, 1000) === 1 && printRadius(100) === 3 && printRadius(10_000) === 10 && printRadius(2_500) === 5 && printRadius(1e9) === 18 && printRadius(NaN) === 3)

  // ── The act at a level ────────────────────────────────────────────────
  check('depth: clicking a bid aims a limit BUY at that price, an ask a limit SELL — the two orders that rest (the ticket\'s own rule); a bad price aims nothing; only a Coinbase-sourced coin with a CoW chain has the act',
    limitAimAt('bid', 7.2)?.side === 'buy' && limitAimAt('bid', 7.2)?.limitPrice === 7.2 && limitAimAt('ask', 7.3)?.side === 'sell' && limitAimAt('ask', 0) === null && limitAimAt('bid', NaN) === null &&
      levelActsFor({ source: 'coinbase' }, 2) && !levelActsFor({ source: 'coinbase' }, 0) && !levelActsFor({ source: 'hyperliquid' }, 2) && !levelActsFor({ source: 'robinhood' }, 2))

  check('depth: the ticket SHOWS an aimed limit at the book\'s own precision (a $7.2140 level is not the $7.21 level) while the sentence still carries units × USDC; the grammar\'s rounded defaults read as before',
    fmtLimitPrice(7.214) === '7.214' && fmtLimitPrice(7.2140) === '7.214' && fmtLimitPrice(7.23) === '7.23' && fmtLimitPrice(7) === '7' && fmtLimitPrice(80.8712) === '80.8712' && fmtLimitPrice(113.456) === '113.46' && fmtLimitPrice(0.0042) === '0.0042' && fmtLimitPrice(0) === '0')

  // ── The plan per chart ────────────────────────────────────────────────
  check('depth: a Coinbase coin draws Coinbase\'s book with the Hyperliquid perp offered when listed; a perp draws its own book alone; a tokenized stock has no book and says why',
    (() => {
      const uni = depthPlanFor({ source: 'coinbase', symbol: 'UNI' }, true)
      const aero = depthPlanFor({ source: 'coinbase', symbol: 'AERO' }, false)
      const hype = depthPlanFor({ source: 'hyperliquid', symbol: 'HYPE' }, true)
      const aapl = depthPlanFor({ source: 'robinhood', symbol: 'AAPL' }, false)
      return uni.main === 'coinbase' && uni.other === 'hyperliquid' && aero.other === null && hype.main === 'hyperliquid' && hype.other === null && aapl.main === null && /Uniswap pool/.test(aapl.why ?? '') && /Coinbase does not list it/.test(aapl.why ?? '') && depthPlanFor(null, false).main === null
    })())

  // ── Words and numbers ─────────────────────────────────────────────────
  check('depth: the foot names the book\'s feed and state — live, every Ns on the poll lane, not listed — and the prints as Dune\'s, waiting for the first print until one lands, "relay has no key" when the relay has none',
    bookWords('coinbase', 'live') === 'book · Coinbase level 2 · live' && bookWords('hyperliquid', 'polling') === 'book · Hyperliquid l2Book · every 5s' && bookWords('coinbase', 'missing') === 'book · Coinbase level 2 · not listed' && bookWords(null, 'live') === 'book · none' &&
      printWords('DEX prints', 'live', 0) === 'prints · DEX prints · waiting for the first print' && printWords('DEX prints', 'live', 3) === 'prints · DEX prints · live' && printWords('DEX prints', 'unconfigured', 0) === 'prints · relay has no key' && printWords(null, null, 0) === 'prints · none for this instrument' && printWords('Hyperliquid prints', 'connecting', 0) === 'prints · Hyperliquid prints · connecting')
  check('depth: prices print at the precision their magnitude needs (four decimals on a $7 coin), sizes to three figures, dollars short; the axis steps are round',
    fmtDepthPrice(7.3220) === '7.3220' && fmtDepthPrice(113_250.4) === '113250' && fmtDepthPrice(0.0042) === '0.00420' && fmtDepthPrice(80.871) === '80.8710' && fmtDepthSize(42.969) === '43.0' && fmtDepthSize(2.9412) === '2.94' && fmtDepthSize(0.00594) === '0.00594' && fmtDepthSize(12_400) === '12.4K' &&
      fmtDepthUsd(311) === '$311' && fmtDepthUsd(5_120) === '$5,120' && fmtDepthUsd(340_000) === '$340K' && fmtDepthUsd(1_234_567) === '$1.23M' && fmtDepthUsd(13_400_000) === '$13.4M' && fmtDepthUsd(9_780_000) === '$9.78M' && axisSteps(1000).join(',') === '250,500,750,1000' && axisSteps(0).length === 0 && axisSteps(7.3).join(',') === '2,4,6')

  // ── The URL and the wiring ────────────────────────────────────────────
  check('depth: ?view=depth opens the chart on the Depth view and the switch mirrors it; the Battlefield keeps its deep link; the URL round-trips',
    parseViewParam('?view=depth') === 'depth' && parseViewParam('?view=battlefield') === 'field' && parseViewParam('?view=nope') === 'candles' && viewUrl('depth', null, '/t/UNI', '?tf=1h') === '/t/UNI?tf=1h&view=depth' && viewUrl('depth', 'spot', '/t/UNI', '') === '/t/UNI?view=depth' && viewUrl('candles', null, '/t/UNI', '?view=depth') === '/t/UNI')
  check('depth: the switch reads Candles | Depth — the Battlefield\'s button shows only while its deep link has it open (the code stays); the Depth view mounts over the engine; the limit aim rides ChartMount from the symbol page',
    (() => {
      const chart = readFileSync('components/markets/chart/MarketChart.tsx', 'utf8')
      const mount = readFileSync('components/markets/chart/ChartMount.tsx', 'utf8')
      const page = readFileSync('components/markets/shell/SymbolPage.tsx', 'utf8')
      return /switchView\('depth'\)/.test(chart) && /<span>Depth<\/span>/.test(chart) && /\{view === 'field' && \(/.test(chart) && /<span>Battlefield<\/span>/.test(chart) && !/switchView\('field'\)\}>\s*<Swords[^]*?<span>Battlefield<\/span>[^]*?<\/button>\s*<\/div>\s*\)\}\s*\{!altOn/.test(chart) &&
        /\{depthOn && tokens && <DepthChart/.test(chart) && /\{fieldOn && tokens && <FrontBoard/.test(chart) && /depthPrintRef\.current\?\.\(batch\)/.test(chart) && /tailIsLive\(tf, liveFeed\) \|\| depthOn/.test(chart) &&
        /onLimit=\{onLimit\}/.test(mount) && /battlefield onLimit=\{onLimit\}/.test(page) && /useOrderAim\.getState\(\)\.setAim\(\{ symbol: sym, side, limitPrice: price, at: Date\.now\(\) \}\)/.test(page)
    })())
  check('depth: the books are the browser\'s own sockets — Coinbase Advanced Trade level2 and Hyperliquid l2Book, keyless — with the site\'s book routes as the poll lane, and nothing stored',
    (() => {
      const feed = readFileSync('lib/depth-feed.ts', 'utf8')
      return /wss:\/\/advanced-trade-ws\.coinbase\.com/.test(feed) && /channel: 'level2'/.test(feed) && /type: 'l2Book', coin: product, nSigFigs: 3/.test(feed) && /\/api\/markets\/spot-book\?symbol=/.test(feed) && /\/api\/markets\/book\?symbol=/.test(feed) && !/localStorage|prisma|DUNE/.test(feed)
    })())
  check('depth: the ticket answers an aim — the rail unfolds and picks the side, the phone strip opens on it, the ticket turns into a limit at the price, each stamp once',
    (() => {
      const ticket = readFileSync('components/markets/trade/OrderTicket.tsx', 'utf8')
      const rail = readFileSync('components/markets/trade/RailTicket.tsx', 'utf8')
      const strip = readFileSync('components/markets/trade/ExecStrip.tsx', 'utf8')
      return /aimedRef\.current === aim\.at\) return/.test(ticket) && /patch\(\{ type: 'limit', limitPrice: aim\.limitPrice \}\)/.test(ticket) && /if \(!types\.includes\('limit'\)\) return/.test(ticket) &&
        /setOpen\(true\)\s*onSide\(aim\.side\)/.test(rail) && /if \(!sides\.includes\(aim\.side\)\) return/.test(rail) && /setTicket\(aim\.side\)/.test(strip) && /if \(!sideList\.includes\(aim\.side\)\) return/.test(strip)
    })())
  check('depth: the view\'s canvas reads its inks from the chart tokens (never a color-mix into a fillStyle), draws nothing it has not measured, and the card gives it the Battlefield\'s room',
    (() => {
      const src = readFileSync('components/markets/chart/DepthChart.tsx', 'utf8')
      const css = readFileSync('components/markets/markets.css', 'utf8')
      return !/color-mix\(/.test(src.replace(/\/\/.*$/gm, '').replace(/\/\*[^]*?\*\//g, '')) && /waiting for the first print/.test(src) && /tokens\.up/.test(src) && /tokens\.down/.test(src) && /openBookFeed\(plan\.main, pair/.test(src) &&
        /\.mkt-chart__canvas\.is-depth \{ height: 460px; \}/.test(css) && /:has\(\.mkt-chart__canvas\.is-depth\) \{ height: clamp\(/.test(css)
    })())
}

if (process.argv[1]?.endsWith('depth-pins.ts')) {
  let failed = 0
  depthPins((name, ok, extra) => {
    if (!ok) failed++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
  })
  console.log(failed ? `\n${failed} failed` : '\nall depth pins green')
  process.exit(failed ? 1 : 0)
}
