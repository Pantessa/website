// THE ADVANCED CHART — pins (2026-11-11). TradingView's Advanced Charts on the
// symbol page: the library draws, Pantessa feeds it and reads the drawings
// into orders. What is pinned here is OUR half (lib/tv/*), all of it pure:
//
//   frames      our frames ↔ the library's resolution strings
//   bars        seconds → milliseconds, UTC slots, `to` exclusive, ticks never backwards
//   symbol      only the frames a source serves; an index is delayed and says so
//   drawings    the bridge to lib/chart-state, both ways
//   the plan    what a drawing can do — every sentence builds natively
//   memory      the per-symbol drawings store survives the iframe boundary
//   the engine  which chart a page opens on
//   THE FENCE   nothing of the licensed library is in this (public) repository
//
//   npx tsx scripts/tv-pins.ts
//   BASE=http://localhost:3000 npx tsx scripts/tv-pins.ts --live
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { parseChartState, type ChartLine } from '../lib/chart-state'
import { barOpenMs, barsBefore, foldPrint, olderPageCursor, slotOf, ticksSince, toTvBars } from '../lib/tv/bars'
import { advancedChartsBuilt, engineFor, parseEnginePref } from '../lib/tv/config'
import { planAsks, planFor, planItemFor, positionLevels, stopPercent } from '../lib/tv/plan'
import { ALL_TV_RESOLUTIONS, intradayMultipliers, normalizeTvResolution, pageTfOfResolution, resolutionsForSource, tfOfResolution, tvResolution } from '../lib/tv/resolution'
import { cleanLabel, lineFromShape, lineIdFor, linesFromShapes, shapeFromLine, type ShapeSnapshot } from '../lib/tv/shapes'
import { layoutForChart } from '../lib/tv/store'
import { pricescaleFor, searchPairs, symbolInfoFor } from '../lib/tv/symbol'
import { tvCssProperties, tvOverrides, withAlpha } from '../lib/tv/theme'
import { chartPairFor, type Candle, type ChartPair } from '../lib/charts'
import { buildsNatively } from './ask-ladder'

type Check = (name: string, ok: boolean, extra?: string) => void

const candle = (t: number, c = 10, v = 1): Candle => ({ t, o: c, h: c + 1, l: c - 1, c, v })
const shape = (name: string, points: { time?: number; price: number }[], props: Record<string, unknown> = {}, id = 'abc123'): ShapeSnapshot => ({ id, name, points, props })

export function tvPins(check: Check): void {
  // ── frames ────────────────────────────────────────────────────────────────
  check('tv frames: each of our frames has one resolution string and it reads back (10s ↔ 10S, 1m ↔ 1, 15m ↔ 15, 1h ↔ 60, 4h ↔ 240, 1d ↔ 1D)',
    (['10s', '1m', '15m', '1h', '4h', '1d'] as const).every((tf) => tfOfResolution(tvResolution(tf)) === tf) && tvResolution('1h') === '60' && tvResolution('4h') === '240' && tvResolution('10s') === '10S' && tvResolution('1d') === '1D')
  check('tv frames: the library is never handed one of our keys ("15m" would read as fifteen MONTHS): no resolution we emit ends in a lowercase letter',
    ALL_TV_RESOLUTIONS.every((r) => /^\d+[SDWM]?$/.test(r)))
  check('tv frames: loose spellings normalise (D → 1D, w → 1W), and a week or a month is drawn from daily bars, so the PAGE stays on the day',
    normalizeTvResolution('D') === '1D' && normalizeTvResolution('w') === '1W' && tfOfResolution('1W') === null && tfOfResolution('5') === null && pageTfOfResolution('1W') === '1d' && pageTfOfResolution('1M') === '1d' && pageTfOfResolution('60') === '1h')
  check('tv frames: a stock and an index are offered no minute bar and no print frame; a coin and a perp get all six; every source gets the week and the month',
    !resolutionsForSource('robinhood').includes('1') && !resolutionsForSource('robinhood').includes('10S') && !resolutionsForSource('index').includes('1') && resolutionsForSource('coinbase').join() === '10S,1,15,60,240,1D,1W,1M' && resolutionsForSource('hyperliquid').includes('10S') && resolutionsForSource('index').join() === '15,60,240,1D,1W,1M')
  check('tv frames: the minute multipliers are digit strings, ascending, and only what the source serves',
    intradayMultipliers('coinbase').join() === '1,15,60,240' && intradayMultipliers('robinhood').join() === '15,60,240')

  // ── bars ──────────────────────────────────────────────────────────────────
  const bars = toTvBars([candle(1_700_003_600), candle(1_700_000_000), candle(1_700_003_600, 12)], '1h')
  check('tv bars: seconds become milliseconds, the order is ascending, and the same candle read twice is ONE bar (the later read wins, nothing counted twice)',
    bars.length === 2 && bars[0].time === slotOf(1_700_000_000, '1h') * 1000 && bars[1].close === 12 && bars[1].volume === 1 && bars[0].time < bars[1].time)
  check('tv bars: a daily bar stamped at a stock\'s open (13:30 UTC) snaps to its UTC midnight',
    toTvBars([candle(1_762_781_400)], '1d')[0].time === Math.floor(1_762_781_400 / 86_400) * 86_400_000)
  const stub = toTvBars([{ t: 1_700_000_400, o: 4, h: 5, l: 3.5, c: 4.5, v: 2 }, { t: 1_700_002_200, o: 4.5, h: 6, l: 4.4, c: 5.5, v: 3 }], '1h')
  check('tv bars: an index\'s bars that start at twenty past the hour snap to the hour, and two DIFFERENT candles in one slot fold into one bar (first open, last close, widest range, volumes added)',
    stub.length === 1 && stub[0].time % 3_600_000 === 0 && stub[0].open === 4 && stub[0].close === 5.5 && stub[0].high === 6 && stub[0].low === 3.5 && stub[0].volume === 5)
  check('tv bars: a malformed candle (a zero, a NaN) never reaches the library',
    toTvBars([{ t: 1_700_000_000, o: 0, h: 1, l: 1, c: 1, v: 1 }, { t: 1_700_003_600, o: 1, h: NaN, l: 1, c: 1, v: 1 }, candle(1_700_007_200)], '1h').length === 1)
  check('tv bars: `to` is exclusive (a bar AT `to` came with the previous answer) and the answer is fresh copies',
    barsBefore(bars, bars[1].time / 1000).length === 1 && barsBefore(bars, bars[1].time / 1000 + 1).length === 2 && barsBefore(bars, 9e9)[0] !== bars[0])
  check('tv bars: the older page is asked for with the oldest bar\'s own open time in seconds',
    olderPageCursor(bars[0].time) === bars[0].time / 1000)
  check('tv bars: a poll pushes only the forming bar and what follows it — never a bar behind the chart\'s last',
    ticksSince(bars, bars[1].time).length === 1 && ticksSince(bars, bars[0].time).length === 2 && ticksSince(bars, bars[1].time + 1).length === 0 && ticksSince(bars, null).length === 1)
  const tail = { time: barOpenMs(1_700_000_000_000, '1m'), open: 10, high: 11, low: 9, close: 10, volume: 5 }
  const inBar = foldPrint(tail, { at: tail.time + 30_000, price: 12, size: 2 }, '1m')
  const next = foldPrint(tail, { at: tail.time + 61_000, price: 8, size: 1 }, '1m')
  check('tv bars: a print inside the forming bar stretches it and moves the close; one past it opens the next bar at its price; one behind it is ignored; a price at zero is noise',
    inBar?.time === tail.time && inBar.high === 12 && inBar.close === 12 && inBar.volume === 7 && next?.time === tail.time + 60_000 && next.open === 8 && foldPrint(tail, { at: tail.time - 1, price: 9, size: 1 }, '1m') === null && foldPrint(tail, { at: tail.time, price: 0, size: 1 }, '1m') === null)

  // ── symbol ────────────────────────────────────────────────────────────────
  const uni = chartPairFor('UNI') as ChartPair
  const aapl = chartPairFor('AAPL') as ChartPair
  const us10y = chartPairFor('US10Y') as ChartPair
  const uniInfo = symbolInfoFor(uni, 6.4)
  const ixInfo = symbolInfoFor(us10y, 4.2)
  check('tv symbol: a coin is described round-the-clock in UTC with every frame it serves, a seconds frame built from prints, and the week/month left to the library',
    uniInfo.ticker === 'UNI' && uniInfo.session === '24x7' && uniInfo.timezone === 'Etc/UTC' && uniInfo.has_seconds && uniInfo.seconds_multipliers?.join() === '10' && uniInfo.has_weekly_and_monthly === false && uniInfo.has_empty_bars === false && uniInfo.supported_resolutions.includes('1W') && uniInfo.data_status === 'streaming')
  check('tv symbol: a stock has no minute bar and no seconds frame; an index is DELAYED and says so (15 minutes), with no volume plot',
    !symbolInfoFor(aapl, 230).intraday_multipliers.includes('1') && symbolInfoFor(aapl, 230).has_seconds === false && ixInfo.data_status === 'delayed_streaming' && ixInfo.delay === 900 && ixInfo.visible_plots_set === 'ohlc' && ixInfo.type === 'index')
  check('tv symbol: the price scale follows the price (cents on $230, four places on $6, more as it shrinks), a yield gets three places, an index level two',
    pricescaleFor(230) === 100 && pricescaleFor(6.4) === 10_000 && pricescaleFor(0.05) === 1_000_000 && pricescaleFor(0.000012) === 10_000_000_000 && pricescaleFor(4.2, 'yield') === 1_000 && pricescaleFor(18, 'level') === 100 && pricescaleFor(null) === 10_000)
  check('tv symbol: search ranks an exact ticker first, then a prefix, then a name',
    searchPairs('uni', [aapl, uni, us10y])[0]?.symbol === 'UNI' && searchPairs('treasury', [aapl, uni, us10y])[0]?.symbol === 'US10Y' && searchPairs('zzzz', [aapl, uni]).length === 0)

  // ── drawings: the bridge ──────────────────────────────────────────────────
  const stored: ChartLine[] = [
    { id: 'a', kind: 'h', price: 6.5, label: 'support' },
    { id: 'b', kind: 'zone', p1: 7, p2: 6 },
    { id: 'c', kind: 'trend', t1: 1_700_000_000, p1: 5, t2: 1_700_086_400, p2: 6, extend: 'right' },
    { id: 'd', kind: 'fib', t1: 1_700_000_000, p1: 5, t2: 1_700_086_400, p2: 8 },
    { id: 'e', kind: 'vline', t: 1_700_000_000 },
    { id: 'f', kind: 'note', t: 1_700_000_000, price: 6, text: 'volume dried up here' },
  ]
  const specs = stored.map((l) => shapeFromLine(l, 1_700_100_000, 3600))
  check('tv drawings: each of the schema\'s six kinds becomes one of the library\'s tools (level → horizontal_line, zone → a rectangle stretched both ways, a ray → ray, fib → fib_retracement, vline → vertical_line, note → note)',
    specs.map((s) => s.options.shape).join() === 'horizontal_line,rectangle,ray,fib_retracement,vertical_line,note' && specs[1].options.overrides?.extendLeft === true && specs[1].options.overrides?.extendRight === true && specs[5].options.text === 'volume dried up here' && specs[0].options.text === 'support')
  const back = specs.map((s, i) => lineFromShape({ id: `e${i}`, name: s.options.shape, points: s.points.map((p) => ({ time: p.time, price: p.price ?? 0 })), props: { text: s.options.text, ...(s.options.overrides ?? {}) } }))
  check('tv drawings: and back — every one of them round-trips into a line the strict schema accepts, same geometry',
    back.every((l) => l !== null) && parseChartState({ v: 1, symbol: 'UNI', tf: '1h', lines: back }) !== null && (back[0] as { price: number }).price === 6.5 && (back[1] as { p1: number; p2: number }).p1 === 7 && (back[2] as { extend?: string }).extend === 'right' && (back[3] as { p2: number }).p2 === 8 && (back[5] as { text: string }).text === 'volume dried up here')
  check('tv drawings: a tool the schema has no word for (a pitchfork, a brush) does not travel as data, and never breaks the list',
    lineFromShape(shape('pitchfork', [{ time: 1, price: 1 }, { time: 2, price: 2 }, { time: 3, price: 3 }])) === null && linesFromShapes([shape('pitchfork', [{ price: 1 }]), shape('horizontal_line', [{ price: 5 }], {}, 'x1')], 64).length === 1)
  check('tv drawings: ids and labels are made safe for the schema (the id alphabet, one line, capped) and the list is capped',
    /^tv_[A-Za-z0-9_-]{1,56}$/.test(lineIdFor('aB3 xY/z')) && cleanLabel('  two\nlines\t here ') === 'two lines here' && cleanLabel('') === undefined && (cleanLabel('x'.repeat(200)) ?? '').length === 80 && linesFromShapes(Array.from({ length: 80 }, (_, i) => shape('horizontal_line', [{ price: i + 1 }], {}, `s${i}`)), 64).length === 64)
  check('tv drawings: a degenerate shape is refused, not drawn wrong (a zone with no height, a level at zero, a note with no words)',
    lineFromShape(shape('rectangle', [{ time: 1, price: 5 }, { time: 2, price: 5 }])) === null && lineFromShape(shape('horizontal_line', [{ price: 0 }])) === null && lineFromShape(shape('note', [{ time: 1, price: 5 }], { text: '   ' })) === null)

  // ── the plan ──────────────────────────────────────────────────────────────
  const spot = { symbol: 'UNI', source: 'coinbase' as const, last: 6.4, pricescale: 10_000 }
  const perp = { symbol: 'HYPE', source: 'hyperliquid' as const, last: 71.7, pricescale: 10_000 }
  const under = planItemFor(shape('horizontal_line', [{ price: 6 }]), spot)
  check('tv plan: a level under the market offers the order that rests there and the stop under it; over the market, the sell that rests there',
    under?.kind === 'level' && under.rows[0].offers.some((o) => /^limit order: buy /.test(o.action.ask)) && under.rows[0].offers.some((o) => o.action.kind === 'stop') && !!planItemFor(shape('horizontal_line', [{ price: 7 }]), spot)?.rows[0].offers.some((o) => /^limit order: sell /.test(o.action.ask)))
  const zone = planItemFor(shape('rectangle', [{ time: 1, price: 5.5 }, { time: 2, price: 6 }]), spot)
  const inside = planItemFor(shape('rectangle', [{ time: 1, price: 6 }, { time: 2, price: 7 }]), spot)
  check('tv plan: a zone under the market buys at its floor and stops under it; a zone the price is INSIDE carries no order and says why',
    zone?.kind === 'zone' && zone.rows[1].name === 'Floor' && zone.rows[1].offers.length >= 1 && zone.rows[0].offers.length === 0 && inside?.rows.every((r) => r.offers.length === 0) === true && /inside this zone/.test(inside?.note ?? ''))
  const fib = planItemFor(shape('fib_retracement', [{ time: 1, price: 4 }, { time: 2, price: 8 }]), spot)
  check('tv plan: a retracement lists its five inner levels, each with at most the one order that rests at it (a level under the market buys, one over it sells)',
    fib?.kind === 'fib' && fib.rows.length === 5 && fib.rows.every((r) => r.offers.length <= 1) && fib.rows.some((r) => r.price < 6.4 && /buy/.test(r.offers[0]?.action.ask ?? '')) && fib.rows.some((r) => r.price > 6.4 && /sell/.test(r.offers[0]?.action.ask ?? '')))
  const box = shape('long_position', [{ time: 1, price: 70 }], { stopLevel: 35_000, profitLevel: 70_000 })
  const lv = positionLevels(box, 10_000)
  check('tv plan: a Long Position box reads as entry, stop and target (the library stores the two as tick counts from the entry); a Short box mirrors it',
    lv?.entry === 70 && lv.stop === 66.5 && lv.target === 77 && positionLevels(shape('short_position', [{ price: 70 }], { stopLevel: 35_000, profitLevel: 70_000 }), 10_000)?.stop === 73.5 && positionLevels(shape('long_position', [{ price: 70 }], {}), 10_000) === null)
  check('tv plan: the stop distance is the percent the job grammar reads (one decimal, no trailing zero), refused outside 0.1%–90%',
    stopPercent(70, 66.5) === '5' && stopPercent(77.92, 74.21) === '4.8' && stopPercent(70, 69.99) === null && stopPercent(70, 1) === null)
  const longPerp = planItemFor(box, perp)
  check('tv plan: on a perp the box is ONE job — open at market, then arm the stop its own distance away — plus the take-profit at the target',
    longPerp?.kind === 'long' && longPerp.whole?.action.ask === 'Long $25 of HYPE on Hyperliquid, then protect my HYPE long with a 5% stop' && longPerp.rows[2].offers[0]?.action.ask === 'Take profit on HYPE at $77' && /Reward to risk 2\.0 : 1/.test(longPerp.note ?? ''))
  const shortPerp = planItemFor(shape('short_position', [{ price: 72 }], { stopLevel: 36_000, profitLevel: 72_000 }), perp)
  check('tv plan: a Short box on a perp is one job too (short, then the stop above); its stop and target carry no one-tap Guardian level (those are written for a long)',
    shortPerp?.whole?.action.ask === 'Short $25 of HYPE on Hyperliquid, then protect my HYPE short with a 5% stop' && shortPerp.rows[1].offers.length === 0 && shortPerp.rows[2].offers.length === 0)
  const longSpot = planItemFor(shape('long_position', [{ price: 6 }], { stopLevel: 5_000, profitLevel: 15_000 }), spot)
  check('tv plan: on spot the box is three orders — a BUY at the entry (resting under the market), the stop, a SELL at the target — never a sell wearing the entry\'s name',
    longSpot?.rows[0].offers.length === 1 && /^limit order: buy /.test(longSpot.rows[0].offers[0].action.ask) && longSpot.rows[1].offers.every((o) => o.action.kind === 'stop') && longSpot.rows[1].offers.length === 1 && /^limit order: sell /.test(longSpot.rows[2].offers[0]?.action.ask ?? '') && planItemFor(shape('long_position', [{ price: 7 }], { stopLevel: 5_000, profitLevel: 15_000 }), spot)?.rows[0].offers[0]?.action.ask === 'Buy $25 of UNI')
  check('tv plan: an index carries no order from any drawing, and a drawing that names no price is not in the plan',
    planFor([shape('horizontal_line', [{ price: 4.1 }]), box], { symbol: 'US10Y', source: 'index', last: 4.2, pricescale: 1_000 }).every((it) => it.rows.every((r) => r.offers.length === 0) && !it.whole) && planItemFor(shape('vertical_line', [{ time: 1, price: 0 }]), spot) === null && planItemFor(shape('trend_line', [{ time: 1, price: 5 }, { time: 2, price: 6 }]), spot) === null)
  const everything = [
    ...planFor([shape('horizontal_line', [{ price: 6 }], {}, 'a'), shape('horizontal_line', [{ price: 7 }], {}, 'b'), shape('rectangle', [{ time: 1, price: 5.5 }, { time: 2, price: 6 }], {}, 'c'), shape('fib_retracement', [{ time: 1, price: 4 }, { time: 2, price: 8 }], {}, 'd'), shape('long_position', [{ price: 6 }], { stopLevel: 5_000, profitLevel: 15_000 }, 'e'), shape('short_position', [{ price: 7 }], { stopLevel: 5_000, profitLevel: 15_000 }, 'f')], spot),
    ...planFor([box, shape('short_position', [{ price: 72 }], { stopLevel: 36_000, profitLevel: 72_000 }, 'g'), shape('horizontal_line', [{ price: 60 }], {}, 'h'), shape('horizontal_line', [{ price: 80 }], {}, 'i')], perp),
    ...planFor([shape('horizontal_line', [{ price: 200 }], {}, 'j'), shape('long_position', [{ price: 220 }], { stopLevel: 1_000, profitLevel: 2_000 }, 'k')], { symbol: 'AAPL', source: 'robinhood', last: 230, pricescale: 100 }),
    ...planFor([shape('long_position', [{ price: 150 }], { stopLevel: 500, profitLevel: 1_500 }, 'l'), shape('horizontal_line', [{ price: 140 }], {}, 'm')], { symbol: 'SOL', source: 'coinbase', last: 160, pricescale: 100 }),
  ]
  const asks = [...new Set(planAsks(everything))]
  const notNative = asks.filter((a) => !buildsNatively(a))
  check(`tv plan: EVERY sentence the plan can offer builds natively (${asks.length} distinct sentences across a coin, a perp, a stock and a coin whose home is another chain) — a chip that lands on the planner is a bug`,
    asks.length >= 14 && notNative.length === 0, notNative.join(' | '))

  // ── memory ────────────────────────────────────────────────────────────────
  // The library's own layout holds the indicators AND every drawing, each
  // bound to its symbol; it also remembers the market and frame it was saved on.
  const saved = { layout: 's', charts: [{ panes: [{ sources: [{ type: 'MainSeries', state: { symbol: 'HYPE', shortName: 'HYPE', interval: '60', style: 1 } }, { type: 'LineToolHorzLine', state: { symbol: 'UNI' } }, { type: 'study_Volume', state: {} }] }] }] }
  const aimed = layoutForChart(saved, 'UNI', '1D') as typeof saved | null
  check('tv memory: a saved layout opens on THIS page\'s symbol and frame (one history load, never the old market first), its drawings and indicators untouched, and the stored copy is not edited',
    aimed?.charts[0].panes[0].sources[0].state.symbol === 'UNI' && aimed.charts[0].panes[0].sources[0].state.interval === '1D' && aimed.charts[0].panes[0].sources[0].state.style === 1 && aimed.charts[0].panes[0].sources[1].state.symbol === 'UNI' && aimed.charts[0].panes[0].sources.length === 3 && saved.charts[0].panes[0].sources[0].state.symbol === 'HYPE')
  check('tv memory: something that is not a layout restores nothing (never a throw, never a half state)',
    layoutForChart(null, 'UNI', '1D') === null && layoutForChart({}, 'UNI', '1D') === null && layoutForChart({ charts: [] }, 'UNI', '1D') === null && layoutForChart({ charts: [{ panes: [{ sources: [{ type: 'study_Volume', state: {} }] }] }] }, 'UNI', '1D') === null && layoutForChart('x', 'UNI', '1D') === null)

  // ── the engine ────────────────────────────────────────────────────────────
  check('tv engine: a build without the library is the built-in chart, whatever is asked; a build with it opens the Advanced chart',
    !advancedChartsBuilt('') && advancedChartsBuilt('33.1.0') && engineFor({ built: false, pref: 'advanced', search: '?chart=advanced', failed: false }) === 'classic' && engineFor({ built: true, pref: null, search: '', failed: false }) === 'advanced')
  check('tv engine: the visitor\'s choice, a `?chart=classic` link, a failed load and a view only the built-in chart draws each open the built-in chart; `?chart=advanced` overrides a stored choice',
    engineFor({ built: true, pref: 'classic', search: '', failed: false }) === 'classic' && engineFor({ built: true, pref: null, search: '?chart=classic', failed: false }) === 'classic' && engineFor({ built: true, pref: null, search: '', failed: true }) === 'classic' && (['depth', 'tape', 'heat', 'battlefield'] as const).every((v) => engineFor({ built: true, pref: null, search: `?view=${v}`, failed: false }) === 'classic') && engineFor({ built: true, pref: 'classic', search: '?chart=advanced', failed: false }) === 'advanced' && parseEnginePref('nope') === null)

  // ── theme ─────────────────────────────────────────────────────────────────
  const tok = { up: '#22c55e', down: '#ef4444', fg: '#ffffff', bg: '#000000', surf: '#111111', line: '#222222', muted: '#999999', muted2: '#666666', accent: '#3ecf8e', grid: 'rgba(255,255,255,0.07)', crosshair: 'rgba(255,255,255,0.3)' }
  check('tv theme: the candles, the pane and the toolbar wear the site\'s tokens',
    tvOverrides(tok)['mainSeriesProperties.candleStyle.upColor'] === '#22c55e' && tvOverrides(tok)['paneProperties.background'] === '#000000' && tvCssProperties(tok)['--tv-color-pane-background'] === '#000000' && withAlpha('#22c55e', 0.5) === 'rgba(34, 197, 94, 0.5)' && withAlpha('oklch(1 0 0)', 0.5) === 'oklch(1 0 0)')

  // ── THE FENCE ─────────────────────────────────────────────────────────────
  // "It is prohibited to use any part of the library in public repositories."
  const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\n')
  const leaked = tracked.filter((f) => /(^|\/)charting_library(\/|\.d\.ts$|\.standalone)|(^|\/)datafeed-api\.d\.ts$|(^|\/)datafeeds\/udf\//.test(f))
  const ignore = readFileSync('.gitignore', 'utf8')
  check('tv FENCE: nothing of the licensed library is tracked in this repository — no bundle, no typings, no sample datafeed — and git ignores where the build puts it',
    leaked.length === 0 && ignore.includes('/public/charting_library/') && ignore.includes('charting_library.d.ts'), leaked.slice(0, 5).join(', '))
  const types = readFileSync('lib/tv/types.ts', 'utf8')
  const pin = JSON.parse(readFileSync('tv-library.json', 'utf8')) as { repo: string; ref: string; version: string }
  check('tv FENCE: our typings of the library are hand-written and small (not a copy of its .d.ts), and the release is named by a pinned commit',
    types.split('\n').length < 400 && !/Nominal<|@deprecated|ChartingLibraryFeatureset/.test(types) && /^[0-9a-f]{7,40}$/.test(pin.ref) && /^\d+\.\d+\.\d+$/.test(pin.version) && /^[\w.-]+\/[\w.-]+$/.test(pin.repo))
  const install = readFileSync('scripts/tv-library.mjs', 'utf8')
  const pkg = readFileSync('package.json', 'utf8')
  const vercel = readFileSync('vercel.json', 'utf8')
  check('tv FENCE: the build fetches the library before `next build` (package.json and vercel.json), a miss is never a failed build, and the token is read from the environment only',
    pkg.includes('node scripts/tv-library.mjs && next build') && vercel.includes('node scripts/tv-library.mjs && next build') && install.includes("process.exit(strict ? 1 : 0)") && install.includes('process.env.TV_LIBRARY_TOKEN') && !/gh[pous]_[A-Za-z0-9]{20,}/.test(install + pkg + vercel))

  // ── wiring ────────────────────────────────────────────────────────────────
  const mount = readFileSync('components/markets/chart/ChartMount.tsx', 'utf8')
  const adv = readFileSync('components/markets/chart/AdvancedChart.tsx', 'utf8')
  const page = readFileSync('components/markets/shell/SymbolPage.tsx', 'utf8')
  check('tv wiring: only the symbol page offers the Advanced chart; the chat overlay, a call page and the story hero keep the built-in one',
    /<ChartMount [^>]*\badvanced\b/.test(page) && !readFileSync('components/landing/LandingHero.tsx', 'utf8').includes(' advanced') && !readFileSync('components/ChartOverlay.tsx', 'utf8').includes('AdvancedChart') && !readFileSync('components/markets/call/CallChart.tsx', 'utf8').includes('AdvancedChart'))
  check('tv wiring: the library is not asked for until the engine choice is settled, a failed load hands the page to the built-in chart for the rest of the tab, and the visitor can switch either way',
    /if \(!armed \|\| !host \|\| !pair\) return/.test(adv) && /advancedFailed = true\s+setEngine\('classic'\)/.test(mount) && mount.includes("'Classic chart' : 'Pro chart'") && /onFailRef\.current\(/.test(adv))
  check('tv wiring: the TradingView attribution stays visible — the library\'s own logo is never switched off and the foot names TradingView with a link',
    adv.includes('data-tv-attribution') && adv.includes('https://www.tradingview.com/') && !/hide_.*logo|adaptive_logo|move_logo/.test(adv))
  check('tv wiring: the "+" on the price axis drops a level, a drawing event re-reads the plan, and a chip is gated by the same sell and venue gates as every other chip',
    adv.includes("w.subscribe('onPlusClick'") && adv.includes("w.subscribe('drawing_event'") && /canSellAsk\(o\.action\.ask, held\) && canTradeAsk\(o\.action\.ask, tradable\)/.test(adv))
}

export async function tvLivePins(check: Check, base: string): Promise<void> {
  const res = await fetch(`${base}/t/UNI`)
  const html = await res.text()
  const advanced = html.includes('data-engine="advanced"')
  const lib = await fetch(`${base}/charting_library/charting_library.standalone.js`, { method: 'HEAD' }).catch(() => null)
  check('tv live: the page and the build agree — the Advanced chart\'s shell is served exactly when the library\'s script is',
    res.status === 200 && advanced === (lib?.status === 200), `engine=${advanced ? 'advanced' : 'classic'} library=${lib?.status ?? 'unreachable'}`)
  check('tv live: whichever engine is served, the page credits TradingView with a link, and the view switch offers Candles and Depth',
    /class="mkt-attrib" href="https:\/\/www\.tradingview\.com\/"/.test(html) && html.includes('<span>Candles</span>') && html.includes('<span>Depth</span>'))
  if (advanced) {
    check('tv live: the Advanced shell server-renders the plan\'s five quick tools and no library markup of its own (the widget mounts in the browser)',
      ['Level', 'Zone', 'Fib', 'Long', 'Short'].every((t) => html.includes(`${t}</button>`)) && html.includes('Your drawings') && !html.includes('<iframe'))
  }
}

if (process.argv[1]?.endsWith('tv-pins.ts')) {
  let failed = 0
  const check: Check = (name, ok, extra) => {
    if (!ok) failed++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
  }
  tvPins(check)
  const done = process.argv.includes('--live') ? tvLivePins(check, process.env.BASE ?? 'http://localhost:3000') : Promise.resolve()
  done.then(() => {
    console.log(failed ? `\n${failed} failed` : '\nall tv pins green')
    process.exit(failed ? 1 : 0)
  })
}
