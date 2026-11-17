// SCENARIOS — pins (2026-11-17). The Bull / Bear / Both buttons on the
// symbol page's chart draw a setup by fixed rules (lib/scenario). What is
// pinned here:
//
//   structure   a swing is the extreme of five bars each side, known only
//               once five bars have printed after it; nothing after the bar
//               a setup is read on is ever used to draw it
//   the setup   stop past the nearest unbroken swing with half an ATR of
//               room; the box aims at the first level that pays at least
//               the risk and names the ones it passes; the bear is the
//               bull's mirror image
//   the record  a bar that reaches the stop and the target counts as a stop;
//               an unresolved recent setup is not counted; the sentence
//               prints the counts whatever they are
//   the chart   the box's ticks read back through the plan (lib/tv/plan) to
//               the same prices, and the order the plan offers builds
//   the fence   coins and their perps only; no stock, no index, no minute
//               frame; no model and no network in the rules; the card says
//               what it is not
//
//   npx tsx scripts/scenario-pins.ts
import { readFileSync } from 'node:fs'
import { chartPairFor, type Candle } from '../lib/charts'
import {
  HORIZON_BARS,
  MIN_REWARD_RISK,
  PIVOT_SPAN,
  SCENARIO_DISCLAIMER,
  STOP_BUFFER_ATR,
  THIN_RECORD,
  atrAt,
  fmtSwingDay,
  judgeSetup,
  pivotFlags,
  recordLine,
  scenarioAt,
  scenarioDrawing,
  scenarioFor,
  scenarioOffered,
  scenarioRecord,
  scenarioTfOk,
  scenarioView,
  type ScenarioRecord,
} from '../lib/scenario'
import { mergeCandles } from '../lib/scenario-read'
import { planAsks, planItemFor, positionLevels } from '../lib/tv/plan'
import { buildsNatively } from './ask-ladder'

type Check = (name: string, ok: boolean, extra?: string) => void

const DAY = 86_400
const T0 = 1_750_000_000 - (1_750_000_000 % DAY)
const WICK = 0.2

/** Closes run in straight lines through the waypoints; every bar has the same small wick. */
function path(points: [number, number][]): Candle[] {
  const out: Candle[] = []
  for (let k = 0; k < points.length - 1; k++) {
    const [i0, p0] = points[k]
    const [i1, p1] = points[k + 1]
    for (let i = i0; i < i1; i++) {
      const o = p0 + ((p1 - p0) * (i - i0)) / (i1 - i0)
      const c = p0 + ((p1 - p0) * (i + 1 - i0)) / (i1 - i0)
      out.push({ t: T0 + i * DAY, o, h: Math.max(o, c) + WICK, l: Math.min(o, c) - WICK, c, v: 1 })
    }
  }
  return out
}
/** The same chart upside down: every high a low. */
const mirror = (cs: readonly Candle[], k: number): Candle[] => cs.map((c) => ({ t: c.t, o: k - c.o, h: k - c.l, l: k - c.h, c: k - c.c, v: c.v }))
const near = (a: number | null | undefined, b: number, eps = 1e-6) => typeof a === 'number' && Math.abs(a - b) < eps

// 100 up to 140, back to 110, up to 150, back to 120, and 138 now: a high at
// 140 that the 150 broke, floors at 110 and 120, one ceiling at 150.
const RANGE = path([[0, 100], [30, 140], [50, 110], [80, 150], [100, 120], [130, 138]])
const END = RANGE.length - 1

export function scenarioPins(check: Check): void {
  // ── structure ─────────────────────────────────────────────────────────────
  const flags = pivotFlags(RANGE)
  const highs = flags.high.flatMap((f, i) => (f ? [i] : []))
  const lows = flags.low.flatMap((f, i) => (f ? [i] : []))
  check('scenario structure: a swing high / low is the extreme of five bars each side (the turns of the test chart, and nothing else)',
    PIVOT_SPAN === 5 && highs.every((i) => [29, 30, 79, 80].includes(i)) && highs.length === 2 && lows.length === 2 && lows.every((i) => [49, 50, 99, 100].includes(i)), `highs=${highs} lows=${lows}`)
  check('scenario structure: the last five bars are never a swing (five bars have not printed after them), and two equal highs give ONE swing, the earlier',
    flags.high.slice(-PIVOT_SPAN).every((f) => !f) && flags.low.slice(-PIVOT_SPAN).every((f) => !f) && (() => {
      const flat = path([[0, 10], [10, 20], [11, 20], [12, 20], [30, 5]])
      return pivotFlags(flat).high.filter(Boolean).length === 1
    })())
  check('scenario structure: NO LOOK-AHEAD — a setup read on bar N is the same whether or not the chart holds bars after N',
    [70, 90, 105, 120].every((end) => (['bull', 'bear'] as const).every((bias) => JSON.stringify(scenarioAt(RANGE, end, bias)) === JSON.stringify(scenarioAt(RANGE.slice(0, end + 1), end, bias)))))
  check('scenario structure: under sixty bars nothing is drawn, and a broken chart (a zero close) gives null, never a line at nothing',
    scenarioFor(RANGE.slice(0, 40), 'bull') === null && scenarioFor([], 'bear') === null && scenarioFor(RANGE.map((c, i) => (i === END ? { ...c, c: 0 } : c)), 'bull') === null)

  // ── the setup ─────────────────────────────────────────────────────────────
  const atr = atrAt(RANGE, END) as number
  const bull = scenarioFor(RANGE, 'bull')
  const floor = RANGE[99].l < RANGE[100].l ? RANGE[99].l : RANGE[100].l
  const ceiling = Math.max(RANGE[79].h, RANGE[80].h)
  check('scenario bull: in at the price now; the stop is under the nearest unbroken swing low with half an ATR of room',
    !!bull && near(bull.entry, 138) && STOP_BUFFER_ATR === 0.5 && near(bull.stop, floor - 0.5 * atr) && /^under the .* swing low, with half an ATR of room$/.test(bull.levels[1].why), JSON.stringify(bull?.levels))
  check('scenario bull: the nearest swing high pays less than the stop costs, so the box aims past it (the range\'s height on top) and the card names the level on the way',
    !!bull && MIN_REWARD_RISK === 1 && bull.levels.map((l) => l.role).join() === 'entry,stop,passing,target' && near(bull.levels[2].price, ceiling) && near(bull.target, ceiling + (ceiling - floor)) && bull.rr >= 1 && /pays 0\.7 times the risk, less than the stop costs, so the box aims past it$/.test(bull.levels[2].why) && /range's height added over that high/.test(bull.levels[3].why), JSON.stringify(bull?.levels))
  const bear = scenarioFor(RANGE, 'bear')
  check('scenario bear: the stop is over the swing high; the nearest floor pays more than the risk, so it is the box\'s target and the next floor down is named after it',
    !!bear && near(bear.stop, ceiling + 0.5 * atr) && bear.levels.map((l) => l.role).join() === 'entry,stop,target,beyond' && near(bear.target, floor) && bear.rr >= 1 && near(bear.beyond, Math.min(RANGE[49].l, RANGE[50].l)), JSON.stringify(bear?.levels))
  const flipped = scenarioFor(mirror(RANGE, 300), 'bear')
  check('scenario mirror: turn the chart upside down and the bear setup is the bull setup, level for level',
    !!bull && !!flipped && near(300 - flipped.entry, bull.entry) && near(300 - flipped.stop, bull.stop) && near(300 - flipped.target, bull.target) && near(flipped.rr, bull.rr) && flipped.levels.length === bull.levels.length)
  const twins = scenarioFor(path([[0, 100], [20, 150.4], [30, 130], [45, 150], [60, 120], [130, 138]]), 'bull')
  check('scenario bull: two swing highs less than an ATR apart are ONE level — the second is never offered as "the next one up"',
    !!twins && !twins.levels.some((l) => /the next one up/.test(l.why)) && twins.levels.filter((l) => l.role !== 'entry' && l.role !== 'stop').length === 2 && /range's height added over that high/.test(twins.levels[twins.levels.length - 1].why), JSON.stringify(twins?.levels))
  const ath = scenarioFor(path([[0, 50], [40, 80], [55, 70], [130, 120]]), 'bull')
  check('scenario bull at a new high: with no swing high above, the targets are the last leg projected (1.272, then 1.618), and there is no level to break',
    !!ath && ath.breakout === null && /^1\.272 of the last leg up/.test(ath.levels.find((l) => l.role === 'target' || l.role === 'passing')?.why ?? '') && ath.target > ath.entry && ath.stop < ath.entry, JSON.stringify(ath?.levels))
  check('scenario both: each case names the level that puts it in play (the nearest ceiling / floor) and aims the range\'s height past it; a target under zero is not drawn',
    !!bull?.breakout && near(bull.breakout.trigger, ceiling) && near(bull.breakout.target, ceiling + (ceiling - floor)) && !!bear?.breakout && near(bear.breakout.trigger, floor) && near(bear.breakout.target, floor - (ceiling - floor)) && (() => {
      const deep = scenarioFor(path([[0, 100], [30, 400], [50, 60], [80, 420], [100, 70], [130, 200]]), 'bear')
      return !!deep?.breakout && deep.breakout.target === null
    })())
  check('scenario words: a swing is dated in UTC (2 Nov; with the hour on an intraday frame; with the year when it is not this year\'s)',
    fmtSwingDay(Date.UTC(2026, 10, 2) / 1000, DAY) === '2 Nov' && fmtSwingDay(Date.UTC(2026, 10, 2, 14) / 1000, 3600) === '2 Nov 14:00' && fmtSwingDay(Date.UTC(2025, 7, 14) / 1000, DAY, Date.UTC(2026, 10, 17) / 1000) === '14 Aug 2025')

  // ── the record ────────────────────────────────────────────────────────────
  const setup = { bias: 'bull' as const, stop: 90, target: 120 }
  const flatBars = (n: number): Candle[] => Array.from({ length: n }, (_, i) => ({ t: T0 + i * DAY, o: 100, h: 101, l: 99, c: 100, v: 1 }))
  const withBar = (bar: Partial<Candle>, at: number, n = 80) => flatBars(n).map((c, i) => (i === at ? { ...c, ...bar } : c))
  check('scenario record: the target first is a hit, the stop first is a stop, and a bar that reaches BOTH is a stop (nothing is assumed in the setup\'s favour)',
    judgeSetup(withBar({ h: 121 }, 5), 0, setup) === 'hit' && judgeSetup(withBar({ l: 89 }, 5), 0, setup) === 'stopped' && judgeSetup(withBar({ h: 125, l: 85 }, 5), 0, setup) === 'stopped' && judgeSetup(withBar({ l: 89 }, 3).map((c, i) => (i === 7 ? { ...c, h: 130 } : c)), 0, setup) === 'stopped')
  check('scenario record: a short is judged the other way round, the setup\'s own bar is never judged, and a move after the horizon does not count',
    judgeSetup(withBar({ l: 79 }, 5), 0, { bias: 'bear', stop: 110, target: 80 }) === 'hit' && judgeSetup(withBar({ h: 111 }, 5), 0, { bias: 'bear', stop: 110, target: 80 }) === 'stopped' && judgeSetup(withBar({ h: 130 }, 0), 0, setup) === 'neither' && HORIZON_BARS === 60 && judgeSetup(withBar({ h: 130 }, 61), 0, setup) === 'neither' && judgeSetup(withBar({ h: 130 }, 60), 0, setup) === 'hit')
  check('scenario record: a setup with fewer than sixty bars after it and nothing reached yet is OPEN, and open setups are left out of the count',
    judgeSetup(flatBars(30), 0, setup) === 'open' && (() => {
      const r = scenarioRecord(RANGE, 'bull')
      return r.judged === r.hit + r.stopped + r.neither && r.open > 0 && r.judged > 0 && r.avgR !== null && Number.isFinite(r.avgR)
    })())
  check('scenario record: today\'s bar is the live setup, never a past one — the record of a chart is the same with or without its newest bar\'s outcome',
    (() => {
      const a = scenarioRecord(RANGE, 'bull')
      const b = scenarioRecord([...RANGE.slice(0, -1), { ...RANGE[END], h: 9_999, l: 0.01 }], 'bull')
      // The newest bar can still settle an older setup; what it never does is add one of its own.
      return a.judged + a.open === b.judged + b.open
    })())
  const rec = (over: Partial<ScenarioRecord>): ScenarioRecord => ({ bias: 'bull', judged: 0, hit: 0, stopped: 0, neither: 0, open: 0, avgR: null, since: null, ...over })
  check('scenario record: the sentence prints the counts whatever they are, in R before fees, and a thin record says it is too thin',
    recordLine(rec({ judged: 41, hit: 17, stopped: 21, neither: 3, avgR: -0.12, since: Date.UTC(2022, 5, 10) / 1000 }), 'UNI', '1D') === 'The same rules on UNI 1D since Jun 2022: 41 bull setups, target first 17, stop first 21, neither within 60 bars 3. Average result -0.1 R a setup, before fees (1 R is the distance to the stop).'
      && THIN_RECORD === 8 && /Too few to read as a rate\.$/.test(recordLine(rec({ bias: 'bear', judged: 3, hit: 3, avgR: 2 }), 'HYPE', '4H')) && /^The same rules on HYPE 4H: 3 bear setups, target first 3, stop first 0\. /.test(recordLine(rec({ bias: 'bear', judged: 3, hit: 3, avgR: 2 }), 'HYPE', '4H'))
      && recordLine(rec({}), 'UNI', '1D') === 'No earlier bull setup to judge on UNI 1D in the bars loaded.' && / 1 bull setup, /.test(recordLine(rec({ judged: 1, stopped: 1, avgR: -1 }), 'UNI', '1D')))
  check('scenario bars: reads of the same bar are merged to one, ascending, and a malformed bar never reaches the rules',
    (() => {
      const m = mergeCandles([{ t: 3, o: 1, h: 2, l: 1, c: 2, v: 1 }, { t: 1, o: 1, h: 2, l: 1, c: 1, v: 1 }], [{ t: 3, o: 1, h: 3, l: 1, c: 3, v: 1 }, { t: 2, o: 0, h: 1, l: 1, c: 1, v: 1 }])
      return m.length === 2 && m[0].t === 1 && m[1].c === 3
    })())

  // ── the chart ─────────────────────────────────────────────────────────────
  const view = scenarioView(RANGE, 'bull')
  const drawn = scenarioDrawing(view, 10_000)
  const box = drawn.box
  const back = box ? positionLevels({ id: 'x', name: 'long_position', points: [{ time: box.time, price: box.entry }], props: { stopLevel: box.stopTicks, profitLevel: box.profitTicks } }, 10_000) : null
  check('scenario chart: a bull is ONE Long Position box on the bar it was read on; its ticks read back through the plan to the setup\'s stop and target within a tick',
    !!box && !!bull && box.side === 'long' && box.time === RANGE[END].t && !!back && Math.abs(back.stop - bull.stop) <= 1e-4 && Math.abs(back.target - bull.target) <= 1e-4 && drawn.levels.length === 1 && drawn.levels[0].label === 'Bull: resistance on the way')
  check('scenario chart: a level past the box\'s target is drawn as "target 2"',
    scenarioDrawing(scenarioView(RANGE, 'bear'), 10_000).levels.map((l) => l.label).join() === 'Bear target 2')
  const bearDrawn = scenarioDrawing(scenarioView(RANGE, 'bear'), 10_000)
  check('scenario chart: a bear is a Short Position box; Both draws NO box (two at one price would cover each other), only the deciding levels and where a break aims',
    bearDrawn.box?.side === 'short' && (() => {
      const both = scenarioDrawing(scenarioView(RANGE, 'both'), 10_000)
      return both.box === null && both.levels.map((l) => l.label).join('|') === 'Bull case over this|Bull target|Bear case under this|Bear target'
    })())
  check('scenario chart: every drawn level\'s label opens with its side (the line\'s ink is read from it), and a chart with no tick size draws nothing',
    [...drawn.levels, ...bearDrawn.levels, ...scenarioDrawing(scenarioView(RANGE, 'both'), 100).levels].every((l) => /^(Bull|Bear)\b/.test(l.label)) && scenarioDrawing(view, 0).box === null)
  // The box is an ordinary drawing: the plan reads it into the order it draws.
  const hype = path([[0, 30], [30, 42], [50, 33], [80, 45], [100, 36], [130, 40.5]])
  const hv = scenarioDrawing(scenarioView(hype, 'bull'), 10_000)
  const item = hv.box ? planItemFor({ id: 'b', name: 'long_position', points: [{ time: hv.box.time, price: hv.box.entry }], props: { stopLevel: hv.box.stopTicks, profitLevel: hv.box.profitTicks } }, { symbol: 'HYPE', source: 'hyperliquid', last: 40.5, pricescale: 10_000 }) : null
  const asks = item ? planAsks([item]) : []
  check('scenario chart: on a perp the drawn box is read by the plan as one job (open at market, then the stop at the box\'s distance), and every sentence it offers builds natively',
    !!item?.whole && /^Long \$25 of HYPE on Hyperliquid, then protect my HYPE long with a \d+(\.\d)?% stop$/.test(item.whole.action.ask) && asks.length > 0 && asks.every(buildsNatively), asks.join(' | '))

  // ── the fence ─────────────────────────────────────────────────────────────
  check('scenario fence: offered on a coin and on a main-book perp; NOT on a tokenized stock, a stock or index perp on a builder market, or an index',
    scenarioOffered(chartPairFor('UNI')) && scenarioOffered(chartPairFor('ETH')) && scenarioOffered(chartPairFor('HYPE')) && !scenarioOffered(chartPairFor('AAPL')) && !scenarioOffered({ symbol: 'SP500', source: 'hyperliquid', pair: 'xyz:SP500', label: 'SP500 / USD' }) && !scenarioOffered({ symbol: 'US10Y', source: 'index', pair: 'x', label: 'x' }) && !scenarioOffered(null))
  check('scenario fence: a swing on a ten-second or a minute bar is noise — the frames are 15m, 1H, 4H and 1D',
    !scenarioTfOk('10s') && !scenarioTfOk('1m') && scenarioTfOk('15m') && scenarioTfOk('1h') && scenarioTfOk('4h') && scenarioTfOk('1d'))
  const rules = readFileSync(new URL('../lib/scenario.ts', import.meta.url), 'utf8')
  const code = rules.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  check('scenario fence: the rules are pure — one import (lib/charts), no network, no model, no clock, no randomness',
    (code.match(/^import /gm) ?? []).length === 1 && /from '@\/lib\/charts'/.test(code) && !/fetch\(|anthropic|openai|Math\.random|Date\.now/i.test(code))
  check('scenario fence: the card\'s one line says what this is and is not, in plain ASCII',
    /fixed rules/.test(SCENARIO_DISCLAIMER) && /You pick the side/.test(SCENARIO_DISCLAIMER) && /not a forecast and not advice/.test(SCENARIO_DISCLAIMER) && /^[\x20-\x7e]+$/.test(SCENARIO_DISCLAIMER))
  const chart = readFileSync(new URL('../components/markets/chart/AdvancedChart.tsx', import.meta.url), 'utf8')
  check('scenario fence (wiring): the buttons render only where scenarioOffered says so and never on a look-only market; the card prints the record and the disclaimer; a second press replaces the last scenario',
    /const scenarioOn = scenarioOffered\(pair\) && !lookOnly/.test(chart) && /\{scenarioOn && \(\s*<div className="tvx-scn__pick"/.test(chart) && /disabled=\{!ready \|\| !scenarioFrame \|\| scn\.status === 'loading'\}/.test(chart) && /recordLine\(record, symbol, tfLabel\)/.test(chart) && /\{SCENARIO_DISCLAIMER\}/.test(chart) && /clearScenarioShapes\(\)\s*\n\s*if \(drawing\.box\)/.test(chart))
  check('scenario fence (wiring): the drawing is made by the rules alone — the press reads candles and calls scenarioView; no chat, no model route',
    /loadScenarioCandles\(pair\.symbol, frame, abort\.signal\)/.test(chart) && /scenarioView\(candles, mode, TF_SECONDS\[frame\]\)/.test(chart) && !/api\/chat|markets\/ai/.test(chart.slice(chart.indexOf('const runScenario'), chart.indexOf('const clearScenario'))))
}

export async function scenarioLivePins(check: Check, base: string): Promise<void> {
  const page = async (sym: string) => (await fetch(`${base}/t/${sym}`)).text()
  const [uni, aapl] = await Promise.all([page('UNI'), page('AAPL')])
  if (!uni.includes('data-engine="advanced"')) return
  check('scenario live: /t/UNI serves the Scenario buttons (Bull, Bear, Both) beside the drawing tools; /t/AAPL serves the tools and no Scenario',
    ['bull', 'bear', 'both'].every((m) => uni.includes(`data-scenario-pick="${m}"`)) && aapl.includes('Your drawings') && !aapl.includes('data-scenario-pick'))
}

if (process.argv[1]?.endsWith('scenario-pins.ts')) {
  let failed = 0
  const check: Check = (name, ok, extra) => {
    if (!ok) failed++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
  }
  scenarioPins(check)
  const done = process.argv.includes('--live') ? scenarioLivePins(check, process.env.BASE ?? 'http://localhost:3000') : Promise.resolve()
  done.then(() => {
    console.log(failed ? `\n${failed} failed` : '\nall scenario pins green')
    process.exit(failed ? 1 : 0)
  })
}
