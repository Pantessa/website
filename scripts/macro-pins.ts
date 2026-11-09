// MACRO pins (2026-11-09) — the look-only index source and the Macro board.
//
// Nate, 2026-11-09: "our system is lacking view of many other stocks and
// indexes like the US10Y". Six indexes got a full chart page with NO order
// on it (/t/US10Y · /t/VIX · /t/DXY · /t/NDX · /t/DJI · /t/RUT) and a Macro
// board lists them beside the Hyperliquid macro markets the app already
// charted. What is pinned here is every RULE that keeps that honest:
//
//   · the table resolves the same cold and warm, and can never take a
//     tradable market's page (no name is a coin, a static perp or a stock);
//   · an index offers NO side anywhere — the grammar, the venue map, the
//     chip gate, a chart level, a verdict, an alert, a starter chip — and a
//     typed order on one is answered with the closest thing that IS listed;
//   · the index host's payload is read correctly (the exchange's own bar
//     grid, the trailing price point folded in, daily bars on their date);
//   · a yield prints in percent and moves in basis points, on the board, in
//     the header, in an alert;
//   · the board's rows are static data and a delisted venue market leaves it.
//
//   npx tsx scripts/macro-pins.ts                              # the pure half
//   npx tsx scripts/macro-pins.ts --live                       # + the index host and the venue, live
//   BASE=http://localhost:4420 npx tsx scripts/macro-pins.ts   # + the served half
//
// The pure half and the served half run inside `npm run test:api`.

import { readFileSync } from 'node:fs'
import {
  CHART_INDEXES,
  chartIndexFor,
  chartPairFor,
  chartSymbolsIn,
  chartUnitOf,
  chartableSymbols,
  hlChartTableFrom,
  indexSymbolForHost,
  isLookOnlyPair,
  isLookOnlySymbol,
  lookOnlyRefusal,
  parseChartAsk,
  primeHlPerps,
  sourceHasTf,
  tfsForSource,
  type Candle,
  type ChartPair,
  type ChartTf,
} from '../lib/charts'
import { resetHlUniverse } from '../lib/hl-universe'
import { ROBINHOOD_TICKER_SET } from '../lib/robinhood-tickers'
import { INDEX_LIVE_WINDOW_MS, indexCandlesOf, indexQuoteOf, type IndexChartPayload } from '../lib/index-data'
import { execAsks, execSidesFor, sidesFor, tradeAsks } from '../lib/trade-asks'
import { cardBuyAsk, cardBuyChain, compoundLegKindsFor, composeCompound, missingVenueNotes, quickActs, venuesFor } from '../lib/symbol-venues'
import { capabilityLegsFor } from '../lib/venue-capability'
import { canTradeAsk, lookOnlyTarget, tradeRefusal } from '../lib/trade-venue-gate'
import { LOOK_ONLY_LEVEL_NOTE, actionKindsFor, composeLineActions, composeZoneActions, missingActionNote } from '../lib/chart-actions'
import { verdictChips, type Rating } from '../lib/technicals'
import { alertActionChips, alertLabel, firedAlertLines, fmtSymbolPrice, searchTickers, symbolName as watchName } from '../lib/watchlists'
import { askChartSuggestions } from '../lib/markets-ai-suggestions'
import { lookOnlyDoor } from '../lib/look-only-door'
import { starterDoor } from '../lib/starter-door'
import { lastSessionStats, sessionState, symbolName, symbolStanding, venueLabel } from '../lib/markets'
import { symbolName as seoName, symbolPageSeo } from '../lib/markets-seo'
import { isLiveTabTitle, liveTabTitle, liveTabTitleOf } from '../lib/markets-quotes'
import { GUIDE_HINTS, GUIDE_LOOK_ONLY_ALERT_BODY, GUIDE_LOOK_ONLY_ALERT_TITLE, GUIDE_LOOK_ONLY_BODY, guideBody, guideTitle } from '../lib/guide'
import { newsLadderFor } from '../lib/news'
import { READ_INDEX_VENUE_LINE, READ_INSTRUMENTS } from '../lib/read'
import {
  LOOK_ONLY_SOURCE_LINE,
  MACRO_ROWS,
  MACRO_SYMBOLS,
  fmtIndexStat,
  fmtIndexValue,
  fmtMacroChange,
  fmtMacroLast,
  lookOnlyBasis,
  lookOnlyNear,
  lookOnlyNoActLine,
  lookOnlySessionLine,
  lookOnlyUnitNote,
  macroBoardRows,
  macroChangeOf,
  macroName,
  macroRow,
  macroRowMatches,
  macroRowTag,
} from '../lib/macro'

type Check = (name: string, ok: boolean, extra?: string) => void

const src = (p: string) => readFileSync(p, 'utf8')
/** A source file with its comments stripped: a pin on what the code DOES never matches what a header says. */
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const SIX = ['US10Y', 'VIX', 'DXY', 'NDX', 'DJI', 'RUT'] as const
const HL_EIGHT = ['SP500', 'TLT', 'EUR', 'JPY', 'GOLD', 'SILVER', 'CL', 'NATGAS'] as const
const ix = (s: string): ChartPair => chartPairFor(s)!

/** Unix seconds for a wall-clock time in New York during standard time (UTC−5): November 2026. */
const ny = (day: number, h: number, m = 0, s = 0) => Math.floor(Date.UTC(2026, 10, day, h + 5, m, s) / 1000)
/** The same for Chicago (UTC−6). */
const chi = (day: number, h: number, m = 0) => Math.floor(Date.UTC(2026, 10, day, h + 6, m) / 1000)

/** A chart payload from rows of [t, o, h, l, c, v] (a null close is a hole). */
function payload(rows: [number, number | null, number | null, number | null, number | null, number | null][], meta: IndexChartPayload['meta'] = {}): IndexChartPayload {
  return {
    meta,
    timestamp: rows.map((r) => r[0]),
    indicators: { quote: [{ open: rows.map((r) => r[1]), high: rows.map((r) => r[2]), low: rows.map((r) => r[3]), close: rows.map((r) => r[4]), volume: rows.map((r) => r[5]) }] },
  }
}

export function macroPins(check: Check): void {
  // The static table must answer identically cold: every pure check below runs with no venue universe held.
  resetHlUniverse()

  // ── The table ─────────────────────────────────────────────────────────
  check(
    'macro (table): six look-only indexes, each under the symbol a trader types and each on its own data symbol — US10Y → ^TNX (a yield), VIX → ^VIX, DXY → DX-Y.NYB, NDX → ^NDX, DJI → ^DJI, RUT → ^RUT — resolving COLD (no venue universe held) to a pair whose label is the index\'s name, never "X / USD"',
    CHART_INDEXES.map((i) => `${i.symbol}:${i.host}:${i.unit}`).join() === 'US10Y:^TNX:yield,VIX:^VIX:level,DXY:DX-Y.NYB:level,NDX:^NDX:level,DJI:^DJI:level,RUT:^RUT:level' &&
      SIX.every((s) => { const p = chartPairFor(s); const row = chartIndexFor(s)!; return p?.source === 'index' && p.symbol === s && p.pair === row.host && p.label === row.name && !/USD/.test(p.label) && isLookOnlyPair(p) && isLookOnlySymbol(s) }) &&
      SIX.every((s) => indexSymbolForHost(chartIndexFor(s)!.host) === s) && indexSymbolForHost('^GSPC') === null &&
      !isLookOnlyPair(chartPairFor('ETH')) && !isLookOnlyPair(chartPairFor('AAPL')) && !isLookOnlyPair(chartPairFor('HYPE')) && !isLookOnlyPair(null) && !isLookOnlySymbol('SPY') && !isLookOnlySymbol(''),
    JSON.stringify(SIX.map((s) => chartPairFor(s))),
  )
  check(
    'macro (table): the spellings a visitor types land on the same page — the data symbols themselves (^TNX, DX-Y.NYB), tnx / 10y, djia / dow / us30, nasdaq100 / nas100, russell2000 / rty — in any case, and a name the table does not carry stays unknown',
    chartPairFor('^TNX')?.symbol === 'US10Y' && chartPairFor('tnx')?.symbol === 'US10Y' && chartPairFor('10y')?.symbol === 'US10Y' && chartPairFor('DX-Y.NYB')?.symbol === 'DXY' && chartPairFor('dxy')?.symbol === 'DXY' &&
      chartPairFor('djia')?.symbol === 'DJI' && chartPairFor('Dow')?.symbol === 'DJI' && chartPairFor('us30')?.symbol === 'DJI' && chartPairFor('nasdaq100')?.symbol === 'NDX' && chartPairFor('NAS100')?.symbol === 'NDX' &&
      chartPairFor('russell2000')?.symbol === 'RUT' && chartPairFor('rty')?.symbol === 'RUT' && chartPairFor('^vix')?.symbol === 'VIX' &&
      chartPairFor('GSPC') === null && chartPairFor('US2Y') === null && chartPairFor('IXIC') === null,
  )
  const names = CHART_INDEXES.flatMap((i) => [i.symbol, ...i.aliases])
  const staticCoinsAndPerps = new Set(chartableSymbols().filter((s) => { const src0 = chartPairFor(s)?.source; return src0 === 'coinbase' || src0 === 'hyperliquid' }))
  check(
    'macro (table): no index name or alias is a Coinbase product, a static perp or a Robinhood Chain listing, and none repeats — so the table can never take a tradable market\'s page, and a stock that lists under one of these tickers later fails this gate instead of vanishing behind an index',
    names.length === new Set(names).size && names.every((n) => /^[A-Z0-9]{2,12}$/.test(n) && !ROBINHOOD_TICKER_SET.has(n) && !staticCoinsAndPerps.has(n)) &&
      ['SPY', 'QQQ', 'SHY', 'GLD', 'USO', 'ETH', 'HYPE'].every((s) => !names.includes(s)),
    names.filter((n) => ROBINHOOD_TICKER_SET.has(n) || staticCoinsAndPerps.has(n)).join(','),
  )
  const table = hlChartTableFrom(['VIX', 'DOW', 'ZK', 'US30'], ['xyz:NDX', 'xyz:GOLD', 'xyz:RUT', 'xyz:TNX'])
  primeHlPerps({ main: ['VIX', 'DOW', 'ZK', ...Array.from({ length: 20 }, (_, i) => `FIXT${i}`)], xyz: ['xyz:NDX', 'xyz:GOLD', ...Array.from({ length: 20 }, (_, i) => `xyz:FIXT${i}`)] })
  const warm = { vix: chartPairFor('VIX'), dow: chartPairFor('DOW'), ndx: chartPairFor('NDX'), zk: chartPairFor('ZK'), gold: chartPairFor('GOLD') }
  resetHlUniverse()
  check(
    'macro (table): an index keeps its name against the venue — a perp the venue lists as VIX, DOW or NDX never enters the live pair table, and with such a universe held /t/VIX is still the index (the same answer warm as cold) while ZK and GOLD chart as the perps they are',
    !table.has('VIX') && !table.has('DOW') && !table.has('DJI') && !table.has('US30') && !table.has('NDX') && !table.has('RUT') && !table.has('TNX') && table.get('ZK') === 'ZK' && table.get('GOLD') === 'xyz:GOLD' &&
      warm.vix?.source === 'index' && warm.dow?.symbol === 'DJI' && warm.ndx?.source === 'index' && warm.zk?.source === 'hyperliquid' && warm.gold?.pair === 'xyz:GOLD',
    JSON.stringify([...table]),
  )
  check(
    'macro (frames): an index draws 15m · 1H · 4H · 1D — no minute bar and no print frame, the same four as a stock — and a coin or a perp keeps all six',
    tfsForSource('index').map((t) => t.key).join() === '15m,1h,4h,1d' && tfsForSource('robinhood').map((t) => t.key).join() === '15m,1h,4h,1d' && tfsForSource('coinbase').length === 6 && tfsForSource('hyperliquid').length === 6 &&
      !sourceHasTf('index', '1m') && !sourceHasTf('index', '10s') && sourceHasTf('index', '4h') && sourceHasTf('coinbase', '10s') && !sourceHasTf('robinhood', '1m'),
  )
  const sp500: ChartPair = { symbol: 'SP500', source: 'hyperliquid', pair: 'xyz:SP500', label: 'SP500 / USD' }
  const gold: ChartPair = { symbol: 'GOLD', source: 'hyperliquid', pair: 'xyz:GOLD', label: 'GOLD / USD' }
  const eur: ChartPair = { symbol: 'EUR', source: 'hyperliquid', pair: 'xyz:EUR', label: 'EUR / USD' }
  check(
    'macro (units): the 10-year is a yield, the other five are levels; a builder market quoted in points or as an FX rate (SP500 · EUR · JPY) is a level and one quoted in dollars (GOLD) is not; a coin, a stock, a main-book perp and no pair at all are dollars',
    chartUnitOf(ix('US10Y')) === 'yield' && ['VIX', 'DXY', 'NDX', 'DJI', 'RUT'].every((s) => chartUnitOf(ix(s)) === 'level') &&
      chartUnitOf(sp500) === 'level' && chartUnitOf(eur) === 'level' && chartUnitOf(gold) === 'usd' && chartUnitOf({ symbol: 'EUR', source: 'hyperliquid', pair: 'EUR', label: 'EUR / USD' }) === 'usd' &&
      chartUnitOf(chartPairFor('ETH')) === 'usd' && chartUnitOf(chartPairFor('AAPL')) === 'usd' && chartUnitOf(chartPairFor('HYPE')) === 'usd' && chartUnitOf(null) === 'usd',
  )

  // ── No side, anywhere ─────────────────────────────────────────────────
  const ratings: Rating[] = ['strong_sell', 'sell', 'neutral', 'buy', 'strong_buy']
  const sideless = SIX.filter((s) => {
    const p = ix(s)
    return !(
      sidesFor(p).length === 0 && execSidesFor(p).length === 0 && tradeAsks(p).length === 0 && execAsks(p, { usd: 25, last: 100 }).length === 0 &&
      venuesFor(s, p, { last: 100, card: true }).length === 0 && quickActs(s, p).length === 0 && compoundLegKindsFor(s, p).length === 0 &&
      composeCompound(s, p, ['fund', 'buy', 'stake', 'supply', 'deposit', 'long', 'short', 'protect'], { usd: 50 }).legs.length === 0 && composeCompound(s, p, ['buy']).ask === '' &&
      cardBuyAsk(s, p, 50) === null && cardBuyChain(s, p) === null && capabilityLegsFor(s, p).length === 0 &&
      actionKindsFor(s, 'index').size === 0 && composeLineActions({ symbol: s, source: 'index', price: 90, last: 100 }).length === 0 && composeLineActions({ symbol: s, source: 'index', price: 110, last: 100 }).length === 0 &&
      composeZoneActions({ symbol: s, source: 'index', p1: 80, p2: 90, last: 100 }).length === 0 && missingActionNote(s, 'index') === LOOK_ONLY_LEVEL_NOTE &&
      ratings.every((rating) => verdictChips({ symbol: s, source: 'index', rating, support: 90, resistance: 110, alerts: true }).length === 0) &&
      alertActionChips({ symbol: s, condition: 'below', value: 90 }, p).length === 0 && alertActionChips({ symbol: s, condition: 'above', value: 110 }, p).length === 0 && alertActionChips({ symbol: s, condition: 'pct_move', value: 5, basePrice: 100 }, p).length === 0 &&
      askChartSuggestions(s, p).length === 3 && askChartSuggestions(s, p).every((x) => x.kind === 'question')
    )
  })
  check(
    'macro (no side): an index offers NOTHING to sign — no trade side, no strip chip, no venue row (a card buy included), no quick chip, no chain leg, no listing to measure, no order on a drawn level or a zone, no verdict chip at any rating, no chip on an alert in either direction, and Ask the chart suggests only questions',
    sideless.length === 0,
    sideless.join(','),
  )
  check(
    'macro (no side): the page SAYS why, in one sentence that every surface shares — the venue map\'s note, the chip gate\'s refusal and a level\'s note name the index and say it is here to read — and the tradable families keep every side they had',
    SIX.every((s) => missingVenueNotes(s, ix(s)).length === 1 && missingVenueNotes(s, ix(s))[0] === lookOnlyRefusal(s) && /is an index/.test(lookOnlyRefusal(s))) && lookOnlyRefusal('tnx').startsWith('US10Y ') && !/\$|Buy|Long/.test(LOOK_ONLY_LEVEL_NOTE) &&
      sidesFor(chartPairFor('AAPL')!).join() === 'buy,sell' && execSidesFor(chartPairFor('HYPE')!).join() === 'long,short,protect' && execSidesFor(chartPairFor('ETH')!).includes('stake') &&
      venuesFor('AAPL', chartPairFor('AAPL')!).length === 2 && quickActs('ETH', chartPairFor('ETH')!).length >= 1 && actionKindsFor('ETH', 'coinbase').has('limit') &&
      verdictChips({ symbol: 'AAPL', source: 'robinhood', rating: 'buy' }).length >= 1 && alertActionChips({ symbol: 'ETH', condition: 'below', value: 2000 }, chartPairFor('ETH')).length >= 3,
  )

  // ── The chip gate + the door ──────────────────────────────────────────
  const orders = ['Buy $25 of NDX', 'Sell $50 of VIX', 'Sell all my DXY', 'Buy 2 RUT', 'Buy DJI', 'Buy $25 of DOW', 'Buy $10 of tnx with a card', 'Long $25 of VIX on Hyperliquid', '2x Short $50 of DXY on Hyperliquid', 'Protect my US10Y long with a 5% stop', 'Supply $50 of DJI to Aave', 'Fund Robinhood Chain with 20 USDC from Base, then buy $20 of NDX']
  const leftAlone = ['Buy $25 of SPY', 'Buy $25 of SPY when the VIX is over 20', 'Long $25 of HYPE on Hyperliquid', 'Supply $50 of LINK to Aave', 'limit order: buy 1 ETH for at most 2000 USDC on Base', 'Stake 0.05 ETH on Lido', 'Why is the VIX moving?', 'Show me the NDX chart']
  check(
    'macro (chip gate): an order that names an index is refused STRUCTURALLY — a buy, a sell, a card buy, a perp, a stop on a perp, a supply, the buy clause of a compound, by symbol or by alias — with or without a measured verdict, and the refusal is the index\'s own sentence; a sentence that only mentions an index (or names none) is left to the measured gates',
    orders.every((a) => lookOnlyTarget(a) !== null && !canTradeAsk(a, null) && !canTradeAsk(a, {}) && tradeRefusal(a, null) === lookOnlyRefusal(lookOnlyTarget(a)!)) &&
      leftAlone.every((a) => lookOnlyTarget(a) === null && canTradeAsk(a, null)) && tradeRefusal('Buy $25 of SPY', null) === null,
    orders.filter((a) => lookOnlyTarget(a) === null || canTradeAsk(a, null)).concat(leftAlone.filter((a) => lookOnlyTarget(a) !== null)).join(' | '),
  )
  const ndxDoor = lookOnlyDoor('Buy $25 of NDX')
  const vixDoor = lookOnlyDoor('long $50 of VIX on hyperliquid')
  const dowDoor = lookOnlyDoor('buy $100 of dow')
  const dxyDoor = lookOnlyDoor('Sell $40 of DXY')
  const tnxDoor = lookOnlyDoor('buy $30 of us10y')
  check(
    'macro (door): a typed order on an index is answered with no model and no build — it says the thing is an index and offers the closest thing listed, at the order\'s own size: NDX → "Buy $25 of QQQ", the Dow → SPY, the 10-year → SHY (and TLT as a chart); the VIX, which nothing here stands in for, gets its chart alone; the dollar index gets charts, never a guessed order; and every door ends on the index\'s own chart',
    ndxDoor?.buildPath === 'native-look-only' && ndxDoor.symbol === 'NDX' && /NDX is an index/.test(ndxDoor.reply) && /\*\*QQQ\*\*/.test(ndxDoor.reply) && ndxDoor.clarify.options[0].resume === 'Buy $25 of QQQ' && ndxDoor.clarify.options.at(-1)!.resume === 'Show me the NDX chart' &&
      vixDoor?.symbol === 'VIX' && vixDoor.clarify.options.length === 1 && vixDoor.clarify.options[0].resume === 'Show me the VIX chart' && /Nothing listed here trades the VIX/.test(vixDoor.reply) &&
      dowDoor?.symbol === 'DJI' && dowDoor.clarify.options[0].resume === 'Buy $100 of SPY' &&
      dxyDoor?.symbol === 'DXY' && dxyDoor.clarify.options.every((o) => o.resume.startsWith('Show me the ')) && dxyDoor.clarify.options.at(-1)!.resume === 'Show me the DXY chart' &&
      tnxDoor?.symbol === 'US10Y' && tnxDoor.clarify.options[0].resume === 'Buy $30 of SHY' && tnxDoor.clarify.options.some((o) => o.resume === 'Show me the TLT chart') &&
      [ndxDoor, vixDoor, dowDoor, dxyDoor, tnxDoor].every((d) => d!.clarify.options.every((o) => !/\b(?:NDX|VIX|DXY|DJI|RUT|US10Y)\b/.test(o.resume) || o.resume.startsWith('Show me the '))) &&
      lookOnlyDoor('Buy $25 of SPY') === null && lookOnlyDoor('Buy $25 of SPY when the VIX is over 20') === null && lookOnlyDoor('show me the vix chart') === null && lookOnlyDoor('why is the dollar index up?') === null && lookOnlyDoor('') === null,
    JSON.stringify([ndxDoor?.clarify.options, vixDoor?.clarify.options, dxyDoor?.clarify.options]).slice(0, 300),
  )
  const route = code('app/api/chat/route.ts')
  check(
    'macro (door): the chat route asks the door BEFORE the swap layer, the perp layer and the planner (right after the chart-ask gate), so an order on an index never reaches "unknown token" or "not a Hyperliquid perp"',
    route.includes('const indexDoor = lookOnlyDoor(message)') && route.indexOf('const indexDoor = lookOnlyDoor(message)') > route.indexOf('const chartAsk = parseChartAsk(') &&
      route.indexOf('const indexDoor = lookOnlyDoor(message)') < route.indexOf('const marketRead = marketReadAsk(message)') && route.indexOf('const indexDoor = lookOnlyDoor(message)') < route.indexOf('const starter = starterDoor(message)') &&
      /pair\.source === 'index'[\s\S]{0,400}here to read/.test(route),
  )

  // ── Free text ─────────────────────────────────────────────────────────
  const ask = (m: string) => parseChartAsk(m)?.pair ?? null
  check(
    'macro (chart ask): a chart ask in plain words opens the index — "show me the vix chart", "chart the 10 year", "10-year treasury yield chart", "dollar index chart", "nasdaq 100 chart", "dow jones chart", "russell 2000 chart", "chart tnx" — while "nasdaq" and "s&p" alone still mean the funds a visitor can buy (QQQ, SPY)',
    ask('show me the vix chart')?.symbol === 'VIX' && ask('chart the 10 year')?.symbol === 'US10Y' && ask('show me the 10-year treasury yield chart')?.symbol === 'US10Y' && ask('pull up the dollar index chart')?.symbol === 'DXY' &&
      ask('nasdaq 100 chart')?.symbol === 'NDX' && ask('show me the dow jones chart')?.symbol === 'DJI' && ask('russell 2000 chart')?.symbol === 'RUT' && ask('chart tnx')?.symbol === 'US10Y' && ask('show me the dow chart')?.symbol === 'DJI' &&
      ask('show me the nasdaq chart')?.symbol === 'QQQ' && ask('show me the S&P 500 chart')?.symbol === 'SPY' && ask('show me the ETH chart')?.source === 'coinbase',
    JSON.stringify(['show me the vix chart', 'chart the 10 year', 'russell 2000 chart', 'show me the nasdaq chart'].map((m) => ask(m)?.symbol ?? null)),
  )
  check(
    'macro (chart ask): "rut" is an English word — prose never pops the Russell 2000 ("stuck in a rut, show me a chart"), the ticker typed as one does ("show me the RUT chart", "$RUT chart"); and a trade never tags an index as a symbol it moved ("buy $25 of SPY when VIX is over 20" moved SPY)',
    parseChartAsk('i am stuck in a rut, show me a chart')?.pair == null && ask('show me the RUT chart')?.symbol === 'RUT' && ask('$RUT chart')?.symbol === 'RUT' &&
      JSON.stringify(chartSymbolsIn('buy $25 of SPY when VIX is over 20').map((s) => s.symbol)) === '["SPY"]' && chartSymbolsIn('long NDX and DXY').length === 0 && chartSymbolsIn('Buy $25 of ETH').map((s) => s.symbol).join() === 'ETH',
  )
  const vixStarter = starterDoor('vix')
  const ethStarter = starterDoor('eth')
  check(
    'macro (starter): a bare index word ("vix", "dxy chart") is answered with its chart and no buy chip; a bare coin keeps its buys',
    vixStarter?.kind === 'asset' && vixStarter.clarify.options.length === 1 && vixStarter.clarify.options[0].resume === 'Show me the VIX chart' && /index/.test(vixStarter.reply) && !/buy/i.test(vixStarter.reply) &&
      starterDoor('dxy chart')?.clarify.options.every((o) => !/^Buy/.test(o.resume)) === true && ethStarter?.clarify.options.some((o) => o.resume === 'Buy $10 of ETH') === true,
  )
  const hits = searchTickers('vix')
  check(
    'macro (watchlist): an index is watchable — the add-ticker search finds it by symbol or by name ("vix", "dow", "treasury") as kind `index`, named as the page names it',
    hits[0]?.symbol === 'VIX' && hits[0].kind === 'index' && searchTickers('dow')[0]?.symbol === 'DJI' && searchTickers('treasury').some((h) => h.symbol === 'US10Y') && searchTickers('aapl')[0]?.kind === 'stock' &&
      watchName('US10Y') === 'US 10-year Treasury yield' && watchName('ETH') === 'Ethereum',
  )

  // ── Names, SEO, words ─────────────────────────────────────────────────
  const seo = symbolPageSeo('US10Y')
  const seoAlias = symbolPageSeo('tnx')
  check(
    'macro (names): one name per index on every surface (the page, the watchlist, the social card) and it is the home read\'s own name for the four it shows; a Hyperliquid macro market is named too (SP500 → S&P 500, CL → Crude oil)',
    SIX.every((s) => symbolName(s) === chartIndexFor(s)!.name && watchName(s) === chartIndexFor(s)!.name && seoName(s) === chartIndexFor(s)!.name && macroName(s) === chartIndexFor(s)!.name) &&
      READ_INSTRUMENTS.filter((i) => i.source === 'index').every((i) => CHART_INDEXES.find((c) => c.host === i.symbol)?.name === i.name && CHART_INDEXES.find((c) => c.host === i.symbol)?.unit === i.unit) &&
      macroName('SP500') === 'S&P 500' && macroName('CL') === 'Crude oil (WTI)' && seoName('SP500') === 'S&P 500' && macroName('AAPL') === null && symbolName('AAPL') !== 'AAPL' && SIX.every((s) => symbolStanding(s) === 'charted'),
  )
  check(
    'macro (seo): an index page is titled as a chart and described as delayed data nothing here trades — no "trade", no "live", no "24/7" — canonical under its own symbol (an alias canonicalizes onto it), indexed, with a breadcrumb and NO Dataset (the series is someone else\'s index); the sitemap set carries the six and still no venue-listed perp',
    seo.title === 'US10Y chart — US 10-year Treasury yield | Pantessa Markets' && /delayed/.test(seo.description) && /here to read/.test(seo.description) && !/\b(?:trade|buy|sell|live|24\/7)\b/i.test(seo.title) && !/\b(?:buy|sell|swap|long|short)\b/i.test(seo.description) &&
      seo.canonical.endsWith('/t/US10Y') && seoAlias.symbol === 'US10Y' && seoAlias.canonical === seo.canonical && seo.pair?.source === 'index' && !/Dataset/.test(seo.jsonLd) && /BreadcrumbList/.test(seo.jsonLd) && /Dataset/.test(symbolPageSeo('ETH').jsonLd) &&
      SIX.every((s) => chartableSymbols().includes(s)) && HL_EIGHT.every((s) => !chartableSymbols().includes(s)) && chartableSymbols().length === new Set(chartableSymbols()).size,
    seo.title,
  )
  check(
    'macro (words): the venue chip says whose number it is (index data), the clock says nothing about an index\'s session (each keeps its own exchange\'s hours — the session is read off the quote), and the quote\'s session words name trading-and-delayed or closed-on-its-last-session; the change is measured since the last close, or over the last session once closed',
    SIX.every((s) => venueLabel(ix(s)) === 'Index data' && sessionState(ix(s)).tape === null && sessionState(ix(s)).line === lookOnlySessionLine(null)) && venueLabel(chartPairFor('AAPL')) === 'Robinhood Chain · 24/7' &&
      /closed/.test(lookOnlySessionLine('closed')) && /delayed/.test(lookOnlySessionLine('open')) && /delayed/.test(lookOnlySessionLine(null)) && !/closed|trading/.test(lookOnlySessionLine(null)) &&
      lookOnlyBasis('closed') === 'in its last session' && lookOnlyBasis('open') === 'since the last close' && LOOK_ONLY_SOURCE_LINE === READ_INDEX_VENUE_LINE && /delayed up to 15 minutes/.test(LOOK_ONLY_SOURCE_LINE),
  )
  check(
    'macro (closest thing): the page names the same neighbours the home\'s read names for the four they share (NDX → QQQ, US10Y → SHY then TLT, DXY → EUR and JPY, VIX → none), the Dow and the Russell 2000 name the broad US fund as what it is, every neighbour offered as an ORDER is a stock listed here, and an index with no neighbour is said to be here to read',
    READ_INSTRUMENTS.filter((i) => i.source === 'index').every((i) => JSON.stringify(lookOnlyNear(indexSymbolForHost(i.symbol)!)) === JSON.stringify(i.near)) &&
      lookOnlyNear('NDX')[0].symbol === 'QQQ' && lookOnlyNear('US10Y').map((n) => n.symbol).join() === 'SHY,TLT' && lookOnlyNear('VIX').length === 0 && lookOnlyNear('DJI')[0].symbol === 'SPY' && lookOnlyNear('RUT')[0].symbol === 'SPY' && /not small/.test(lookOnlyNear('RUT')[0].as) && lookOnlyNear('ETH').length === 0 &&
      ['SPY', 'QQQ', 'SHY'].every((s) => chartPairFor(s)?.source === 'robinhood' && quickActs(s, chartPairFor(s)!)[0]?.ask === `Buy $25 of ${s}`) &&
      lookOnlyNoActLine('VIX') === 'Nothing listed here trades the VIX. It is here to read.' && lookOnlyNoActLine('NDX') === 'Nothing here trades the Nasdaq 100 directly.',
  )
  const chartHint = GUIDE_HINTS.find((h) => h.id === 'chart')!
  const alertHint = GUIDE_HINTS.find((h) => h.id === 'alerts')!
  check(
    'macro (guide): on an index page the chart hint teaches the question and says nothing here places an order, and the alerts hint says an alert TELLS you — neither promises a chip that "does the trade"; an ordinary page keeps both as they were',
    guideBody(chartHint, { symbol: 'VIX', lookOnly: true }) === GUIDE_LOOK_ONLY_BODY && !/\$|Buy|Long|ticket/.test(GUIDE_LOOK_ONLY_BODY) &&
      guideTitle(alertHint, { symbol: 'VIX', lookOnly: true }) === GUIDE_LOOK_ONLY_ALERT_TITLE && guideBody(alertHint, { symbol: 'VIX', lookOnly: true }) === GUIDE_LOOK_ONLY_ALERT_BODY.replace('{SYM}', 'VIX') && !/does the trade|hands you/.test(guideBody(alertHint, { symbol: 'VIX', lookOnly: true })) &&
      guideTitle(alertHint, { symbol: 'AAPL' }) === alertHint.title && guideBody(alertHint, { symbol: 'AAPL' }) === alertHint.body && guideBody(chartHint, { symbol: 'AAPL', ask: 'Buy $25 of AAPL' }).includes('“Buy $25 of AAPL”') && guideTitle(chartHint, { lookOnly: true }) === chartHint.title,
  )
  const news = newsLadderFor(ix('US10Y'))
  check(
    'macro (news + model): an index\'s headlines are searched by the phrase a markets desk uses, never as "crypto" or as a stock ticker; and a model reading an index\'s bare numbers is told the unit (a yield in percent, moved in basis points — never a dollar price)',
    news.length === 1 && news[0].feed === 'google-news' && /Treasury/.test(decodeURIComponent(news[0].url)) && !/crypto|stock/.test(decodeURIComponent(news[0].url)) && SIX.every((s) => !/crypto/.test(decodeURIComponent(newsLadderFor(ix(s))[0].url))) &&
      /basis points/.test(lookOnlyUnitNote(ix('US10Y')) ?? '') && /index points/.test(lookOnlyUnitNote(ix('NDX')) ?? '') && /never a dollar price/.test(lookOnlyUnitNote(ix('VIX')) ?? '') && lookOnlyUnitNote(chartPairFor('ETH')) === null && lookOnlyUnitNote(null) === null,
  )

  // ── The index host's payload ──────────────────────────────────────────
  // Hourly bars of the Nasdaq 100 on the exchange's own grid (:30 past), a hole, and the host's trailing price point.
  const liveHour = payload(
    [
      [ny(6, 14, 30), 100, 102, 99, 101, 5],
      [ny(6, 15, 30), 101, 103, 100, 102, 7],
      [ny(9, 9, 30), 104, 106, 103, 105, 9],
      [ny(9, 10, 30), null, null, null, null, null],
      [ny(9, 10, 30) + 1, 105, 108, 104, 107, 4],
      [ny(9, 10, 43, 6), 109, 109, 109, 109, 0],
    ],
    { exchangeTimezoneName: 'America/New_York' },
  )
  const hour = indexCandlesOf(liveHour, 3600)
  check(
    'macro (bars): a slot with no trade is dropped, and the host\'s trailing price POINT (open = high = low = close, no volume, stamped off the grid at the last print) is folded into the bar before it — that bar closes at the latest price and its range stretches to hold it — so the series ends on a real bar and no stray candle moves from poll to poll',
    hour.length === 4 && hour.map((c) => c.t).join() === [ny(6, 14, 30), ny(6, 15, 30), ny(9, 9, 30), ny(9, 10, 30) + 1].join() && hour[3].c === 109 && hour[3].h === 109 && hour[3].l === 104 && hour[3].o === 105 && hour[3].v === 4 && hour[1].c === 102,
    JSON.stringify(hour.slice(-2)),
  )
  // After the close: the same point carries the official close at the session's end.
  const closed = indexCandlesOf(payload([[ny(6, 15, 30), 50, 52, 49, 51, 3], [ny(6, 15, 45), 51, 53, 50, 52, 2], [ny(6, 16, 0), 52.5, 52.5, 52.5, 52.5, 0]], { exchangeTimezoneName: 'America/New_York' }), 900)
  // A new session's first print, before its first bar exists: its own bar, snapped onto the grid the bars before it keep.
  const firstPrint = indexCandlesOf(payload([[ny(6, 15, 30), 50, 52, 49, 51, 3], [ny(9, 9, 31, 20), 55, 55, 55, 55, 0]], { exchangeTimezoneName: 'America/New_York' }), 3600)
  const junk = [indexCandlesOf(null, 900), indexCandlesOf({}, 900), indexCandlesOf({ timestamp: [1, 2] }, 900), indexCandlesOf(payload([[ny(6, 10), null, null, null, null, null]]), 900)]
  check(
    'macro (bars): the closing print is folded into the session\'s last bar (the 15:45 bar closes at the official close; no doji at 16:00); a new session\'s first print before its first bar exists is a bar of its own on the same grid (09:30, not 09:31:20); a real zero-range bar that is NOT last is kept; and a malformed or empty payload is no bars, never a throw',
    closed.length === 2 && closed[1].t === ny(6, 15, 45) && closed[1].c === 52.5 && closed[1].h === 53 &&
      firstPrint.length === 2 && firstPrint[1].t === ny(9, 9, 30) && firstPrint[1].c === 55 &&
      indexCandlesOf(payload([[ny(6, 10), 7, 7, 7, 7, 0], [ny(6, 11), 7, 8, 6, 7.5, 0]], { exchangeTimezoneName: 'America/New_York' }), 3600).length === 2 &&
      junk.every((j) => Array.isArray(j) && j.length === 0),
    JSON.stringify(firstPrint),
  )
  // Daily bars are stamped at the session's open: 14:30Z in New York, 13:20Z for the 10-year in Chicago.
  const dailyNy = indexCandlesOf(payload([[ny(5, 9, 30), 1, 2, 0.5, 1.5, 9], [ny(6, 9, 30), 1.5, 2.5, 1, 2, 9], [ny(9, 9, 30), 2, 3, 1.5, 2.5, 4]], { exchangeTimezoneName: 'America/New_York' }), 86_400)
  const dailyChi = indexCandlesOf(payload([[chi(6, 7, 20), 4.85, 4.86, 4.84, 4.859, 0], [chi(9, 7, 20), 4.839, 4.851, 4.831, 4.837, 0]], { exchangeTimezoneName: 'America/Chicago' }), 86_400)
  check(
    'macro (bars): a daily bar is re-stamped to midnight UTC of its session\'s own date on the EXCHANGE\'s calendar (New York or Chicago) — the convention the coin and stock feeds use, so a daily compare line shares its days — and keeps its open, range and close',
    dailyNy.map((c) => c.t).join() === [5, 6, 9].map((d) => Date.UTC(2026, 10, d) / 1000).join() && dailyNy[2].c === 2.5 && dailyNy[0].o === 1 &&
      dailyChi.map((c) => c.t).join() === [6, 9].map((d) => Date.UTC(2026, 10, d) / 1000).join() && dailyChi[1].c === 4.837 && dailyChi[1].h === 4.851,
    JSON.stringify(dailyNy.map((c) => new Date(c.t * 1000).toISOString().slice(0, 13))),
  )

  // ── The quote ─────────────────────────────────────────────────────────
  const NOW = ny(9, 10, 43, 6) * 1000 + 30_000
  const week: [number, number | null, number | null, number | null, number | null, number | null][] = [
    [chi(3, 7, 20), 4.9, 4.96, 4.9, 4.952, 0],
    [chi(4, 7, 20), 4.95, 4.95, 4.88, 4.894, 0],
    [chi(5, 7, 20), 4.89, 4.9, 4.83, 4.837, 0],
    [chi(6, 7, 20), 4.84, 4.862, 4.84, 4.859, 0],
    [chi(9, 7, 20), 4.839, 4.851, 4.831, 4.837, 0],
  ]
  const tnxMeta = { regularMarketPrice: 4.837, regularMarketTime: Math.floor(NOW / 1000) - 900, exchangeTimezoneName: 'America/Chicago', regularMarketDayHigh: 4.851, regularMarketDayLow: 4.831 }
  const tnx = indexQuoteOf(payload(week, tnxMeta), NOW)
  // The Russell 2000 on a Monday morning, 15 minutes behind its open: today's bar has no close yet, the price is still Friday's.
  const rutRows: typeof week = [[ny(4, 9, 30), 2800, 2860, 2790, 2856.95, 0], [ny(5, 9, 30), 2850, 2855, 2720, 2729.89, 0], [ny(6, 9, 30), 2730, 2761.58, 2721, 2754.11, 0], [ny(9, 9, 30), null, null, null, null, null]]
  const rut = indexQuoteOf(payload(rutRows, { regularMarketPrice: 2754.105, regularMarketTime: ny(6, 16, 30), exchangeTimezoneName: 'America/New_York' }), NOW)
  check(
    'macro (quote): the change is measured from the close of the session BEFORE the one the price printed in, on the exchange\'s own calendar — the 10-year at 4.837 against Friday\'s 4.859, not against the range\'s first bar — and it holds while today\'s bar has no close yet (an index 15 minutes behind its open quotes Friday against Thursday) ; a print inside the live window is trading, an older one is closed',
    tnx?.last === 4.837 && tnx.prev === 4.859 && tnx.live === true && tnx.dayHigh === 4.851 && tnx.dayLow === 4.831 && tnx.asOf === tnxMeta.regularMarketTime * 1000 &&
      rut?.last === 2754.105 && rut.prev === 2729.89 && rut.live === false && rut.dayHigh === null &&
      indexQuoteOf(payload(week, { ...tnxMeta, regularMarketTime: Math.floor((NOW - INDEX_LIVE_WINDOW_MS - 60_000) / 1000) }), NOW)?.live === false,
    JSON.stringify([tnx, rut]),
  )
  check(
    'macro (quote): no earlier session in the bars is a quote with no previous close (never a change shown as flat); a day range that does not bracket the price is not printed; a payload with no price is no quote',
    indexQuoteOf(payload([week[4]], tnxMeta), NOW)?.prev === null && indexQuoteOf(payload(week, { ...tnxMeta, regularMarketDayHigh: 4.2, regularMarketDayLow: 4.1 }), NOW)?.dayHigh === null &&
      indexQuoteOf(payload([], {}), NOW) === null && indexQuoteOf(null, NOW) === null && indexQuoteOf(payload(week, { exchangeTimezoneName: 'America/Chicago' }), NOW)?.last === 4.837,
  )
  const tnxRow = macroRow('US10Y')!
  const ndxRow = macroRow('NDX')!
  const q = (last: number, prev: number) => ({ last, chg: last - prev, chgPct: ((last - prev) / prev) * 100 })
  check(
    'macro (numbers): a yield prints in percent and moves in BASIS POINTS (4.837 from 4.859 is −2.2 bp, not −0.45%); an index level wears no dollar sign and moves in percent; an FX rate keeps four places; a dollar market keeps its sign; no quote is a dash; a true minus sign so a column aligns',
    fmtMacroLast(tnxRow, 4.837) === '4.84%' && fmtMacroChange(tnxRow, q(4.837, 4.859)) === '−2.2 bp' && Math.abs(macroChangeOf(tnxRow, q(4.837, 4.859))! + 2.2) < 1e-6 && fmtMacroChange(tnxRow, q(5.0, 4.85)) === '+15 bp' &&
      fmtMacroLast(ndxRow, 27495.246) === '27,495' && fmtMacroChange(ndxRow, q(27495.246, 26989.99)) === '+1.87%' && fmtMacroLast(macroRow('VIX')!, 23.22) === '23.22' && fmtMacroLast(macroRow('DXY')!, 101.858) === '101.86' &&
      fmtMacroLast(macroRow('EUR')!, 1.12) === '1.1200' && fmtMacroLast(macroRow('JPY')!, 158) === '158.00' && fmtMacroLast(macroRow('SP500')!, 7488.8) === '7,489' && fmtMacroLast(macroRow('GOLD')!, 4123.1) === '$4,123' && fmtMacroLast(macroRow('NATGAS')!, 3.2899) === '$3.290' && fmtMacroLast(macroRow('CL')!, 86.859) === '$86.86' &&
      fmtMacroLast(tnxRow, null) === '—' && fmtMacroChange(ndxRow, null) === '—' && fmtMacroChange(ndxRow, q(100, 101)).startsWith('−') &&
      fmtIndexValue(ix('US10Y'), 4.837) === '4.837%' && fmtIndexValue(ix('NDX'), 27495.246) === '27,495.25' && fmtIndexValue(ix('VIX'), 23.22) === '23.22' && fmtIndexStat(ix('US10Y'), 4.859) === '4.86%' && fmtIndexStat(ix('DJI'), 51977.94) === '51,978',
    [fmtMacroLast(tnxRow, 4.837), fmtMacroChange(tnxRow, q(4.837, 4.859)), fmtMacroLast(ndxRow, 27495.246), fmtMacroChange(ndxRow, q(27495.246, 26989.99))].join(' · '),
  )
  check(
    'macro (numbers): an alert and its fired line state a price in the symbol\'s own unit — "US10Y above 4.50%", "NDX below 27,000.00", "AAPL above $330.00" — and the tab title reads the value as the header prints it ("4.837% · US10Y · Pantessa"), told apart from the page\'s SEO title either way',
    alertLabel({ symbol: 'US10Y', condition: 'above', value: 4.5 }) === 'US10Y above 4.50%' && alertLabel({ symbol: 'NDX', condition: 'below', value: 27000 }) === 'NDX below 27,000.00' && alertLabel({ symbol: 'AAPL', condition: 'above', value: 330 }) === 'AAPL above $330.00' &&
      alertLabel({ symbol: 'VIX', condition: 'pct_move', value: 5, basePrice: 23.22 }) === 'VIX moves 5% from 23.22' && fmtSymbolPrice('ETH', 2365.12) === '$2,365.12' &&
      firedAlertLines({ title: 'US10Y above 4.50% — hit 4.51%', price: 4.51, createdAt: new Date(NOW - 5 * 60_000).toISOString(), symbol: 'US10Y' }, 4.52, NOW).headline === 'US10Y above 4.50%' &&
      firedAlertLines({ title: 'US10Y above 4.50% — hit 4.51%', price: 4.51, createdAt: new Date(NOW - 5 * 60_000).toISOString(), symbol: 'US10Y' }, 4.52, NOW).meta === 'hit 4.51% 5m ago · now 4.52%' &&
      firedAlertLines({ title: 'AAPL above $330.00 — hit $331.20', price: 331.2, createdAt: new Date(NOW - 5 * 60_000).toISOString() }, null, NOW).headline === 'AAPL above $330.00' &&
      liveTabTitleOf('US10Y', '4.837%') === '4.837% · US10Y · Pantessa' && liveTabTitleOf('NDX', '27,495.25') === '27,495.25 · NDX · Pantessa' && liveTabTitleOf('NDX', '—') === null && liveTabTitleOf('NDX', null) === null &&
      isLiveTabTitle('4.837% · US10Y · Pantessa') && isLiveTabTitle(liveTabTitle('UNI', 7.1329)) && !isLiveTabTitle('US10Y chart — US 10-year Treasury yield | Pantessa Markets'),
  )
  const bars = (ts: number[]): Candle[] => ts.map((t, i) => ({ t, o: 10 + i, h: 11 + i, l: 9 + i, c: 10.5 + i, v: 0 }))
  const fri = [ny(6, 14, 30), ny(6, 15, 30)]
  const thu = [ny(5, 13, 30), ny(5, 14, 30), ny(5, 15, 30)]
  check(
    'macro (session): an index\'s key stats are its LATEST SESSION (the bars inside the 20 hours that end on its last bar) — on a weekend it is still Friday\'s range, never blank and never reaching into Thursday; fewer than two bars is no range',
    JSON.stringify(lastSessionStats(bars([...thu, ...fri]))) === JSON.stringify({ high: 15, low: 12 }) && lastSessionStats(bars([ny(6, 15, 30)])) === null && lastSessionStats([]) === null,
    JSON.stringify(lastSessionStats(bars([...thu, ...fri]))),
  )

  // ── The board ─────────────────────────────────────────────────────────
  check(
    'macro (board): fourteen rows grouped the way a desk reads them — stocks (SP500 · NDX · DJI · RUT · VIX), rates (US10Y · TLT), the dollar (DXY · EUR · JPY), commodities (GOLD · SILVER · CL · NATGAS) — six look-only indexes that carry the table\'s own name and unit, and eight Hyperliquid markets; the rows are STATIC data (the same fourteen with no venue universe held, so the server and the browser render one board)',
    MACRO_SYMBOLS.join() === 'SP500,NDX,DJI,RUT,VIX,US10Y,TLT,DXY,EUR,JPY,GOLD,SILVER,CL,NATGAS' && MACRO_ROWS.map((r) => r.group).join() === 'stocks,stocks,stocks,stocks,stocks,rates,rates,dollar,dollar,dollar,commodities,commodities,commodities,commodities' &&
      MACRO_ROWS.filter((r) => r.source === 'index').map((r) => r.symbol).sort().join() === [...SIX].sort().join() && MACRO_ROWS.filter((r) => r.source === 'hyperliquid').map((r) => r.symbol).sort().join() === [...HL_EIGHT].sort().join() &&
      MACRO_ROWS.filter((r) => r.source === 'index').every((r) => r.name === chartIndexFor(r.symbol)!.name && r.unit === chartIndexFor(r.symbol)!.unit && chartPairFor(r.symbol)?.source === 'index') &&
      MACRO_ROWS.every((r) => r.name.length > 0 && r.keywords === r.keywords.toLowerCase() && macroRow(r.symbol) === r) && macroRow('aapl') === null && macroRow(null) === null,
    MACRO_SYMBOLS.join(),
  )
  check(
    'macro (board): a Hyperliquid market the venue stops listing leaves the board once the quotes read says so (never a row of dashes), an index row never leaves (its page is static), and a row whose feed merely did not answer stays; a row is tagged by what kind of number it is — 24/7 for a market that never closes, delayed for an index that is trading, closed outside its session',
    macroBoardRows(['GOLD', 'vix', 'NOPE']).length === 13 && !macroBoardRows(['GOLD']).some((r) => r.symbol === 'GOLD') && macroBoardRows(['VIX', 'US10Y']).length === 14 && macroBoardRows().length === 14 && macroBoardRows([]).map((r) => r.symbol).join() === MACRO_SYMBOLS.join() &&
      macroRowTag(macroRow('GOLD')!, '24/7').text === '24/7' && macroRowTag(macroRow('GOLD')!, null).tone === 'always' && macroRowTag(macroRow('VIX')!, 'open').text === 'delayed' && macroRowTag(macroRow('VIX')!, 'closed').text === 'closed' && macroRowTag(macroRow('VIX')!, null).text === 'delayed',
  )
  check(
    'macro (search): a macro row is found by the words a desk uses for it, not only its symbol — "10 year" and "treasury" find the 10-year (and long Treasuries), "dow" the Dow, "crude" and "oil" crude, "yen" the yen, "s&p" the S&P 500, "sp" by prefix — and an unrelated word finds nothing',
    macroRowMatches(macroRow('US10Y')!, '10 year') && macroRowMatches(macroRow('US10Y')!, '10-Year') && macroRowMatches(macroRow('US10Y')!, 'treasury') && macroRowMatches(macroRow('TLT')!, 'treasury') && macroRowMatches(macroRow('DJI')!, 'dow') &&
      macroRowMatches(macroRow('CL')!, 'crude') && macroRowMatches(macroRow('CL')!, 'oil') && macroRowMatches(macroRow('JPY')!, 'yen') && macroRowMatches(macroRow('SP500')!, 's&p') && macroRowMatches(macroRow('SP500')!, 'sp') && macroRowMatches(macroRow('VIX')!, '$vix') &&
      !macroRowMatches(macroRow('VIX')!, 'apple') && !macroRowMatches(macroRow('GOLD')!, '') && !macroRowMatches(macroRow('NDX')!, 'dow'),
  )

  // ── Source fences ─────────────────────────────────────────────────────
  const page = code('components/markets/shell/SymbolPage.tsx')
  const rail = code('components/markets/trade/RailTicket.tsx')
  const engine = code('components/markets/chart/MarketChart.tsx')
  const overview = code('components/markets/tabs/OverviewTab.tsx')
  check(
    'macro (page): the symbol page reads an index as look-only — its header is the QUOTE (the quotes route, in the index\'s unit, against the previous close) and not the chart\'s 24h number, the Trade tab is not offered and its address opens Overview, the look-only card takes the order ticket\'s seat in the rail (and under the tabs on a phone), the guide is told, and the 24-hour stats read is skipped',
    page.includes('const lookOnly = isLookOnlyPair(pair)') && page.includes('useQuotes(lookOnly ? [sym] : [])') && page.includes("MARKET_TABS.filter((t) => !(lookOnly && t.tab === 'trade'))") && page.includes("lookOnly && t === 'trade' ? DEFAULT_MARKET_TAB : t") &&
      page.includes('<LookOnlyCard pair={pair} seat="page" onAsk={buildHere} />') && page.includes('lookOnly={lookOnly}') && page.includes('useDayStats(pair && !lookOnly ? pair.symbol : null)') && page.includes('fmtIndexValue(pair, ix.last)') && page.includes('lookOnlyBasis(ix.session)') &&
      rail.includes('if (isLookOnlyPair(pair)) return <LookOnlyCard pair={pair} seat="rail" onAsk={onBuild} onSay={onSay} />') && rail.indexOf('if (isLookOnlyPair(pair)) return <LookOnlyCard') < rail.indexOf('className="mkt-railticket"'),
  )
  check(
    'macro (page): the chart engine mounts no book, no tape, no Wall, no positioning map and no executions strip for an index (whatever the page asks), falls a minute or print frame back to 15m, and its foot says delayed index data; the Overview drops the money-flow panel and the venue table and states the latest session without a volume',
    engine.includes('const battlefield = battlefieldProp && !lookOnly') && engine.includes('battlefield: battlefieldProp = false') && engine.includes("if (pair?.source === 'index' && !sourceHasTf('index', tf)) setTf('15m')") && /feed · index data · delayed/.test(engine) &&
      overview.includes('lookOnly ? lastSessionStats(hourly) : stats24h(hourly)') && /\{!lookOnly && \(\s*<div className="mk-overview__flow">/.test(overview) && /\{!lookOnly && \(\s*<div className="mk-overview__routes">/.test(overview),
  )
  const index = code('components/markets/shell/MarketsIndex.tsx')
  check(
    'macro (home): the Macro board sits under the tradable boards and OUTSIDE the list view\'s gate (it renders in the Map view too — the map sizes by liquidity and an index has none), above the apps row and Earn; its tab counts its rows; the search box is handed the macro rows; and the board\'s own quotes read drops what the venue delisted',
    index.includes('<MacroBoard onAsk={indexAct} />') && !/showList && <MacroBoard/.test(index) && index.indexOf('{showList && sections.map(') < index.indexOf('<MacroBoard onAsk={indexAct} />') && index.indexOf('<MacroBoard onAsk={indexAct} />') < index.indexOf('data-seat="Guide"') &&
      index.indexOf('<MacroBoard onAsk={indexAct} />') < index.indexOf('<EarnBoard') && index.includes('href="#macro"') && index.includes('data-tab="macro"') && index.includes('{MACRO_ROWS.length}') && index.includes("[...ids, 'macro', 'earn']") &&
      index.includes('[...sections.flatMap((s) => s.rows), ...MACRO_ROWS]') && index.includes('macroBoardRows(unlisted)') && index.includes('useQuotes(MACRO_SYMBOLS)'),
  )
  const cssFiles = ['components/markets/shell/look-only.css', 'components/markets/shell/macro.css']
  const rawSizes = cssFiles.flatMap((f) => (src(f).replace(/\/\*[\s\S]*?\*\//g, '').match(/(?:font-size|border-radius|gap|margin[a-z-]*|padding[a-z-]*)\s*:[^;]*\b\d+(?:\.\d+)?px/g) ?? []).map((m) => `${f.split('/').pop()}: ${m}`))
  check(
    'macro (styles): the two new stylesheets size type, radii and spacing from the shared scale tokens (--fs-*, --r-*, --sp-*) — no raw pixel font size, radius, gap, margin or padding',
    rawSizes.length === 0 && cssFiles.every((f) => /var\(--fs-/.test(src(f)) && /var\(--sp-/.test(src(f))),
    rawSizes.slice(0, 4).join(' | '),
  )
  const candles = code('lib/candles-server.ts')
  const quotes = code('lib/quotes.ts')
  check(
    'macro (fail soft): the index host is unofficial, so both readers back off after a failure instead of asking on every poll, serve the last good series or quote while it errors (a stand-in is never re-stamped as fresh), cache longer than the live feeds, and the candle route refuses a minute bar for an index by name',
    candles.includes("if (source === 'index') return deep ? INDEX_DEEP_TTL_MS : INDEX_TTL_MS") && candles.includes('INDEX_FAIL_BACKOFF_MS') && candles.includes('if (stale) return stale') && candles.includes("pair.source === 'robinhood' || pair.source === 'index'") &&
      quotes.includes('INDEX_QUOTE_BACKOFF_MS') && quotes.includes('if (q && keep()) cache.set(') && quotes.includes('INDEX_QUOTE_TTL_MS') && code('app/api/charts/candles/route.ts').includes("error: 'no 1m bars for an index'"),
  )
}

/** The index host and the venue, LIVE (network). Run with --live, or inside test:api. */
export async function macroLivePins(check: Check): Promise<void> {
  const { loadCandleSeries, loadCandlesBefore } = await import('../lib/candles-server')
  const { readQuotes, resetQuoteCache } = await import('../lib/quotes')
  const { hlPerpUniverseFresh } = await import('../lib/hl-universe')
  const SEC: Record<string, number> = { '15m': 900, '1h': 3600, '4h': 14400, '1d': 86400 }
  const MIN: Record<string, number> = { '15m': 100, '1h': 100, '4h': 40, '1d': 200 }
  const bad: string[] = []
  const counts: string[] = []
  for (const s of SIX) {
    for (const tf of ['15m', '1h', '4h', '1d'] as ChartTf[]) {
      try {
        const loaded = await loadCandleSeries(s, tf)
        const c = loaded?.series.candles ?? []
        const sec = SEC[tf]
        const ascending = c.every((b, i) => i === 0 || b.t > c[i - 1].t)
        const sane = c.every((b) => b.h >= Math.max(b.o, b.c) - 1e-9 && b.l <= Math.min(b.o, b.c) + 1e-9 && b.c > 0)
        // Bars sit on the exchange's grid: within one session every gap is a whole number of bars (a stray point would break
        // it). The grid is the exchange's LOCAL clock, so the week the clocks change shifts a round-the-clock index's bars by
        // an hour in UTC once — two off-grid gaps a series are allowed for that, and never the last one.
        const offGrid = tf === '1d' ? c.filter((b) => b.t % 86400 !== 0).length : c.filter((b, i) => i > 0 && b.t - c[i - 1].t <= 18 * 3600 && (b.t - c[i - 1].t) % sec !== 0).length
        const onGrid = offGrid <= (tf === '1d' ? 0 : 2)
        const lastGap = c.length < 2 ? sec : c[c.length - 1].t - c[c.length - 2].t
        const tailIsBar = tf === '1d' || lastGap > 18 * 3600 || (lastGap >= sec && lastGap % sec === 0)
        counts.push(`${s} ${tf}=${c.length}`)
        if (!(loaded?.pair.source === 'index' && loaded.series.feed === 'index' && c.length >= MIN[tf] && ascending && sane && onGrid && tailIsBar)) bad.push(`${s} ${tf}: n=${c.length} asc=${ascending} sane=${sane} grid=${onGrid} tail=${tailIsBar}`)
      } catch (err) {
        bad.push(`${s} ${tf}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  }
  check(
    'macro (live): every index draws candles on 15m · 1H · 4H · 1D from the index host — enough bars to fill the chart, ascending, a sane range on each, every bar on the exchange\'s own grid and the series ending on a real bar (the host\'s trailing price point folded in)',
    bad.length === 0,
    bad.length ? bad.slice(0, 6).join(' | ') : counts.join(' · '),
  )
  try {
    const win = await loadCandleSeries('NDX', '1d')
    const deep = await loadCandleSeries('NDX', '1d', { deep: true })
    const first = win!.series.candles[0].t
    const older = await loadCandlesBefore('NDX', '1d', first)
    check(
      'macro (live): a zoom-out has history to page into — the deep daily series reaches years back, and the older page is the bars strictly before the chart\'s first, from the same feed',
      deep!.series.candles.length > win!.series.candles.length + 500 && older!.page.feed === 'index' && older!.page.older.length > 100 && older!.page.older.every((c) => c.t < first),
      `window=${win!.series.candles.length} deep=${deep!.series.candles.length} older=${older!.page.older.length}`,
    )
  } catch (err) {
    check('macro (live): a zoom-out has history to page into', false, err instanceof Error ? err.message : String(err))
  }
  resetQuoteCache()
  const read = await readQuotes([...MACRO_SYMBOLS, 'NOPE'])
  const ixBad = SIX.filter((s) => { const qq = read.quotes[s]; return !(qq && qq.last > 0 && qq.feed === 'index' && (qq.session === 'open' || qq.session === 'closed') && Number.isFinite(qq.chgPct) && Math.abs(qq.chgPct) < 40 && (qq.prevClose ?? 0) > 0 && Math.abs(qq.chg - (qq.last - qq.prevClose!)) < 1e-9) })
  check(
    'macro (live): the six indexes quote — a positive last, a change against a previous close the quote carries, a session read off the print (open or closed, never 24/7), fed by index data',
    ixBad.length === 0,
    ixBad.length ? `no quote: ${ixBad.join(',')}` : SIX.map((s) => `${s} ${fmtMacroLast(macroRow(s)!, read.quotes[s]!.last)} ${fmtMacroChange(macroRow(s)!, read.quotes[s]!)} ${read.quotes[s]!.session}`).join(' · '),
  )
  const fresh = hlPerpUniverseFresh('main') && hlPerpUniverseFresh('xyz')
  const hlState = HL_EIGHT.map((s) => (read.quotes[s] ? 'quoted' : read.unlisted.includes(s) ? 'unlisted' : 'missed'))
  check(
    'macro (live): each Hyperliquid macro row either quotes as a round-the-clock market or is reported UNLISTED by the read (so the board drops it) — while the venue lists it, it quotes; `unlisted` is a subset of `missing`, names a symbol no market answers to, and never names an index',
    fresh && hlState.every((st) => st !== 'missed') && HL_EIGHT.filter((s) => read.quotes[s]).every((s) => read.quotes[s]!.session === '24/7' && read.quotes[s]!.feed === 'hyperliquid') &&
      read.unlisted.every((s) => read.missing.includes(s)) && read.unlisted.includes('NOPE') && SIX.every((s) => !read.unlisted.includes(s)),
    `fresh=${fresh} ${HL_EIGHT.map((s, i) => `${s}:${hlState[i]}`).join(' ')} unlisted=${read.unlisted.join(',')}`,
  )
}

/** Against a running server (BASE): the pages, the routes, the board, the door. */
export async function macroServedPins(check: Check, BASE: string): Promise<void> {
  const get = (path: string, init?: RequestInit) => fetch(`${BASE}${path}`, { ...init, headers: { 'x-yf-internal-run': '1', ...(init?.headers ?? {}) } })
  const json = async (path: string) => { const res = await get(path); return { status: res.status, body: (await res.json()) as Record<string, unknown> } }
  try {
    const pages = await Promise.all(SIX.map(async (s) => ({ s, res: await get(`/t/${s}`) })))
    const htmls = await Promise.all(pages.map(async (p) => ({ s: p.s, status: p.res.status, html: await p.res.text() })))
    const badPages = htmls.filter(({ s, status, html }) => {
      const name = chartIndexFor(s)!.name
      return !(
        status === 200 && html.includes(`data-symbol="${s}"`) && html.includes(name) && /data-look-only=""/.test(html) && html.includes('Index data') &&
        (html.match(/data-slot="look-only"/g) ?? []).length === 2 && !/data-slot="order-ticket"/.test(html) && !/sym__act-chip/.test(html) && !/class="mkt-ticket/.test(html) &&
        !new RegExp(`href="/t/${s}\\?tab=trade"`).test(html) && /data-tab="technicals"/.test(html) && /class="tchart sym__chart/.test(html) &&
        new RegExp(`<title>${s} chart — `).test(html.replace(/&amp;/g, '&')) && !/noindex/.test(html) && !/"@type":"Dataset"/.test(html) && /BreadcrumbList/.test(html) &&
        !/Buy \$\d+ of (?:US10Y|VIX|DXY|NDX|DJI|RUT)\b/.test(html) && !/Long \$\d+ of (?:US10Y|VIX|DXY|NDX|DJI|RUT)\b/.test(html)
      )
    })
    check(
      'macro (served): /t/US10Y · /t/VIX · /t/DXY · /t/NDX · /t/DJI · /t/RUT each render the chart frame under the index\'s own name with NO order control — no act chip, no ticket, no Trade tab — the look-only card in both seats, a chart title, an indexable page with a breadcrumb and no Dataset, and no sentence anywhere that would buy or long the index',
      badPages.length === 0,
      badPages.map((p) => `${p.s}:${p.status}`).join(','),
    )
    const ndx = htmls.find((h) => h.s === 'NDX')!.html
    const vix = htmls.find((h) => h.s === 'VIX')!.html
    check(
      'macro (served): the card names the closest thing listed the way the home\'s read does — the Nasdaq 100\'s page offers "Buy $25 of QQQ" and a door to /t/QQQ; the VIX, which nothing here stands in for, says it is here to read and offers no chip',
      /data-ask="Buy \$25 of QQQ"/.test(ndx) && /href="\/t\/QQQ"/.test(ndx) && /The closest thing listed here/.test(ndx) && /Nothing here trades the Nasdaq 100 directly\./.test(ndx) &&
        /Nothing listed here trades the VIX\. It is here to read\./.test(vix) && !/data-ask="/.test(vix) && /data-near="0"/.test(vix),
    )
    const alias = await get('/t/tnx')
    const aliasHtml = await alias.text()
    const trade = await (await get('/t/NDX?tab=trade')).text()
    check(
      'macro (served): an alias lands on the index\'s page with the canonical on its own symbol (/t/tnx → US10Y); an address that names the Trade tab opens Overview; a stock page is untouched (its act strip and ticket seats still render)',
      alias.status === 200 && aliasHtml.includes('data-symbol="US10Y"') && /rel="canonical" href="[^"]*\/t\/US10Y"/.test(aliasHtml) && /<main class="sym sym--cockpit" data-symbol="NDX"[^>]*data-tab="overview"/.test(trade) &&
        /data-seat="ExecStrip"/.test(await (await get('/t/AAPL')).text()),
      `${alias.status}`,
    )
    const c4h = await json('/api/charts/candles?symbol=VIX&tf=4h&warmup=1')
    const c1m = await json('/api/charts/candles?symbol=VIX&tf=1m')
    const tr = await json('/api/charts/trades?symbol=VIX')
    const book = await json('/api/markets/book?symbol=VIX')
    const spot = await json('/api/markets/spot-book?symbol=VIX')
    const der = await json('/api/markets/derivs?symbol=VIX&tf=1d')
    const routes = await json('/api/markets/routes?symbol=VIX')
    const pos = await json('/api/markets/position?symbol=VIX&address=0x000000000000000000000000000000000000dEaD')
    const candles = (c4h.body.candles as Candle[] | undefined) ?? []
    check(
      'macro (served): the candle route serves an index as source `index` (bars, a warm-up, or a retryable "feed unavailable" — never a 500) and refuses a minute bar by name; the routes that have nothing to say about an index say so without asking a venue — no print frame, no order book, no perp market, an empty venue map with its one note, an empty position',
      c4h.status === 200 && c4h.body.source === 'index' && c4h.body.symbol === 'VIX' && (candles.length > 20 ? c4h.body.feed === 'index' && Array.isArray(c4h.body.warmup) : c4h.body.error === 'feed unavailable') &&
        c1m.status === 400 && c1m.body.error === 'no 1m bars for an index' && tr.status === 400 && /index/.test(String(tr.body.error)) && book.status === 400 && spot.status === 400 && /An index has no perpetual market/.test(String(der.body.reason)) &&
        routes.status === 200 && Array.isArray(routes.body.routes) && (routes.body.routes as unknown[]).length === 0 && (routes.body.notes as string[])[0] === lookOnlyRefusal('VIX') && routes.body.source === 'index' &&
        pos.status === 200 && (pos.body.spot as unknown[]).length === 0 && pos.body.perp === null && pos.body.totalUsd === 0 && (pos.body.exits as unknown[]).length === 0,
      `4h=${candles.length} 1m=${c1m.status} trades=${tr.status} book=${book.status}/${spot.status} routes=${(routes.body.routes as unknown[] | undefined)?.length}`,
    )
    const qs = await json(`/api/quotes?symbols=${[...MACRO_SYMBOLS, 'NOPE'].join(',')}`)
    const quoted = Object.keys((qs.body.quotes as Record<string, unknown>) ?? {})
    const unlisted = (qs.body.unlisted as string[] | undefined) ?? []
    check(
      'macro (served): one quotes read answers the whole board — index rows as open or closed with the previous close they are measured from, Hyperliquid rows as 24/7 — and names what no market answers to in `unlisted` (never an index, never a row that quoted)',
      qs.status === 200 && Array.isArray(qs.body.unlisted) && unlisted.every((s) => (qs.body.missing as string[]).includes(s) && !quoted.includes(s)) && SIX.every((s) => !unlisted.includes(s)) &&
        SIX.filter((s) => quoted.includes(s)).every((s) => { const qq = (qs.body.quotes as Record<string, { session: string; feed: string; prevClose?: number }>)[s]; return qq.feed === 'index' && qq.session !== '24/7' && (qq.prevClose ?? 0) > 0 }) &&
        HL_EIGHT.filter((s) => quoted.includes(s)).every((s) => (qs.body.quotes as Record<string, { session: string }>)[s].session === '24/7'),
      `quoted=${quoted.length} unlisted=${unlisted.join(',')}`,
    )
    const home = await (await get('/')).text()
    const board = home.match(/<section class="mkt-sec" id="macro"[\s\S]*?<\/section>/)?.[0] ?? ''
    const rows = [...board.matchAll(/<tr class="mk-table__row" data-symbol="([A-Z0-9]+)"/g)].map((m) => m[1])
    check(
      'macro (served): `/` server-renders the Macro board — its tab with the row count, the fourteen rows in board order, each a link to its own chart page, the index rows tagged, the legend that says what "Change" is measured over — and the read\'s index tiles lead to their full charts',
      /href="#macro"[^>]*data-tab="macro"/.test(home) && /data-tab="macro"[\s\S]{0,200}?>14</.test(home) && rows.join() === MACRO_SYMBOLS.join() && MACRO_SYMBOLS.every((s) => board.includes(`href="/t/${s}"`)) &&
        (board.match(/class="mk-table__tag /g) ?? []).length === 14 && /data-unit="yield"/.test(board) && /basis points/.test(board) && /data-section="macro"/.test(board),
      `rows=${rows.length} ${rows.join(',')}`,
    )
    const sitemap = await (await get('/sitemap.xml')).text()
    check(
      'macro (served): the sitemap lists the six index pages (and still no venue-listed perp such as SP500)',
      SIX.every((s) => sitemap.includes(`/t/${s}</loc>`)) && !sitemap.includes('/t/SP500</loc>'),
    )
    const turn = async (message: string) => (await (await get('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message, activeServers: [] }) })).json()) as { reply?: string; buildPath?: string; clarify?: { options?: { resume: string }[] }; chart?: { symbol: string; source: string; url: string } }
    const order = await turn('Buy $25 of NDX')
    const chart = await turn('show me the vix chart')
    check(
      'macro (served): a typed order on an index is answered by the look-only door (no model, no build, no signable artifact) with the closest thing listed as its chip; a chart ask for an index opens its chart with a reply that promises no order',
      order.buildPath === 'native-look-only' && order.clarify?.options?.[0]?.resume === 'Buy $25 of QQQ' && /is an index/.test(order.reply ?? '') &&
        chart.buildPath === 'native-chart' && chart.chart?.symbol === 'VIX' && chart.chart.source === 'index' && chart.chart.url === '/t/VIX' && /here to read/.test(chart.reply ?? '') && !/Tap an order/.test(chart.reply ?? ''),
      JSON.stringify({ order: order.buildPath, chart: chart.buildPath }),
    )
  } catch (err) {
    check('macro (served): the server answered', false, err instanceof Error ? err.message : String(err))
  }
}

if (process.argv[1]?.endsWith('macro-pins.ts')) {
  ;(async () => {
    let failed = 0
    let n = 0
    const check: Check = (name, ok, extra) => {
      n++
      console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
      if (!ok) failed++
    }
    macroPins(check)
    if (process.argv.includes('--live')) await macroLivePins(check)
    if (process.env.BASE) await macroServedPins(check, process.env.BASE)
    console.log(failed ? `\n${failed} of ${n} macro pins failed` : `\nall ${n} macro pins green${process.env.BASE ? '' : process.argv.includes('--live') ? ' (pure + live)' : ' (pure half only)'}`)
    process.exit(failed ? 1 : 0)
  })()
}
