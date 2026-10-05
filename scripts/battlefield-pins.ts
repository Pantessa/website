// Pins for the chart's Battlefield view (lib/battlefield): the projection, the
// calendar, who is winning, and a bar's battle report. Pure: no server, no
// chain, no DB. Called from scripts/test-api.ts, and runnable alone:
//   npx tsx scripts/battlefield-pins.ts
import { readFileSync } from 'node:fs'
import type { Candle } from '../lib/charts'
import { ROAD_V, battleReport, fieldDate, fieldHash, fieldProjector, fieldRecords, fieldScale, fieldTicks, pressureAt, pressureLine, seasonOf, timeBands, troopCounts } from '../lib/battlefield'

type Check = (name: string, ok: boolean, extra?: string) => void

const DAY = 86_400
const at = (y: number, m: number, d: number, h = 0) => Date.UTC(y, m - 1, d, h) / 1000
const bar = (t: number, o: number, h: number, l: number, c: number, v = 100): Candle => ({ t, o, h, l, c, v })

export function battlefieldPins(check: Check): void {
  const box = { left: 12, top: 6, width: 900, height: 420 }
  const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps

  const flat = fieldProjector(box, 0)
  const f0 = flat.project(0, ROAD_V)
  const f1 = flat.project(1, 1)
  check('battlefield: at tilt 0 the field IS the flat chart (time spans the box, price runs bottom to top, every depth at scale 1)',
    near(f0.x, 12) && near(f0.y, 426) && near(f1.x, 912) && near(f1.y, 6) && f1.s === 1 && near(flat.project(0.5, 0.4).x, 462))

  const tilted = fieldProjector(box, 1)
  const nearEdge = tilted.project(0, ROAD_V)
  const farEdge = tilted.project(0, 1)
  check('battlefield: tipped over, the near edge keeps its width, the far edge narrows toward the middle and stops below the top (the sky)',
    near(nearEdge.x, 12) && farEdge.x > 150 && farEdge.x < 462 && farEdge.y > 6 + 420 * 0.25 && farEdge.s < 0.7 && near(tilted.project(0.5, 0.3).x, 462))
  let roundTrip = true
  for (const tilt of [0, 0.37, 1]) {
    const pr = fieldProjector(box, tilt)
    for (const [u, v] of [[0, 0], [1, 1], [0.25, 0.8], [0.9, ROAD_V], [0.5, 0.5]]) {
      const p = pr.project(u, v)
      const g = pr.unproject(p.x, p.y)
      if (!near(g.u, u, 1e-9) || !near(g.v, v, 1e-9)) roundTrip = false
    }
  }
  check('battlefield: a pixel maps back to the ground point that drew it at any tilt (the hover reads the bar under the cursor)', roundTrip)
  // A true projection keeps a ground line straight: three points on one line stay collinear.
  const a = tilted.project(0.1, 0.1)
  const b = tilted.project(0.5, 0.5)
  const c = tilted.project(0.9, 0.9)
  check('battlefield: a straight line on the ground (a trend line, a month edge) stays straight on screen', Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) < 1e-6)

  const bars: Candle[] = [bar(0, 10, 12, 9, 11), bar(DAY, 11, 20, 10, 18), bar(2 * DAY, 18, 19, 4, 5)]
  const sc = fieldScale(bars)
  check('battlefield: the scale holds every wick with a margin, never dips below zero, and maps floor → 0, ceiling → 1',
    sc.lo < 4 && sc.lo >= 0 && sc.hi > 20 && near(sc.vOf(sc.lo), 0) && near(sc.vOf(sc.hi), 1) && fieldScale([bar(0, 0.01, 0.02, 0.001, 0.01)]).lo >= 0)
  const ticks = fieldTicks(2.72, 11.56)
  check('battlefield: price ticks are round numbers inside the scale', ticks.length >= 3 && ticks.length <= 7 && ticks.every((t) => t > 2.72 && t < 11.56 && Number.isInteger(t)), ticks.join(','))

  check('battlefield: the forest follows the calendar (Dec–Feb winter, Mar–May spring, Jun–Aug summer, Sep–Nov autumn, UTC)',
    seasonOf(at(2025, 12, 1)) === 'winter' && seasonOf(at(2026, 2, 28)) === 'winter' && seasonOf(at(2026, 3, 1)) === 'spring' && seasonOf(at(2026, 6, 1)) === 'summer' && seasonOf(at(2026, 8, 31)) === 'summer' && seasonOf(at(2026, 9, 1)) === 'autumn' && seasonOf(at(2026, 11, 30)) === 'autumn')

  const daily: Candle[] = []
  for (let t = at(2025, 11, 20); t <= at(2026, 2, 3); t += DAY) daily.push(bar(t, 5, 6, 4, 5.5))
  const months = timeBands(daily, '1d')
  check('battlefield: daily bars get one road sign per month, the first and each January carrying the year, the bands covering every bar once',
    months.map((m) => m.label).join('|') === 'NOV 2025|DEC|JAN 2026|FEB' && months[0].from === 0 && months[months.length - 1].to === daily.length - 1 && months.every((m, i) => i === 0 || m.from === months[i - 1].to + 1) && months[1].season === 'winter' && months[0].season === 'autumn')
  const hourly: Candle[] = []
  for (let t = at(2026, 10, 4, 20); t < at(2026, 10, 6, 3); t += 3600) hourly.push(bar(t, 5, 6, 4, 5.5))
  check('battlefield: intraday bars get one sign per day instead', timeBands(hourly, '1h').map((m) => m.label).join('|') === 'SUN 4|MON 5|TUE 6')
  const d1 = fieldDate(at(2026, 10, 5), '1d')
  const d2 = fieldDate(at(2026, 10, 5, 14), '1h')
  check('battlefield: the calendar card reads the bar\'s UTC date, and its hour on intraday frames only', d1.month === 'OCT' && d1.day === '5' && d1.year === '2026' && d1.time === null && d2.time === '14:00 UTC')

  const rally: Candle[] = Array.from({ length: 30 }, (_, i) => bar(i * DAY, 10 + i, 11.5 + i, 9.8 + i, 11 + i, i % 5 === 4 ? 40 : 100))
  const pr = pressureAt(rally, 29)!
  check('battlefield: pressure reads the trailing 20 bars: a rally is the bulls\', its move is last close minus the stretch\'s first open, its share is volume on up bars',
    pr.side === 'bulls' && pr.bars === 20 && near(pr.move, 40 - 20) && near(pr.movePct, 100) && near(pr.bullShare, 1) && pressureAt(rally, 3)!.bars === 4)
  const slide: Candle[] = rally.map((b, i) => bar(b.t, 50 - i, 50.2 - i, 48.5 - i, 49 - i, 100))
  const chop: Candle[] = rally.map((b, i) => (i % 2 ? bar(b.t, 10, 11, 9, 10.6) : bar(b.t, 10.6, 11, 9, 10)))
  check('battlefield: a slide is the bears\', and chop that ends where it began is a stalemate whatever the volume',
    pressureAt(slide, 29)!.side === 'bears' && pressureAt(slide, 29)!.bullShare === 0 && pressureAt(chop, 29)!.side === 'stalemate' && pressureAt([], 0) === null)
  const quiet = rally.map((b) => ({ ...b, v: 0 }))
  check('battlefield: a tape with no volume weighs bars by their bodies instead of reading 0/0', near(pressureAt(quiet, 29)!.bullShare, 1) && near(pressureAt(chop.map((b) => ({ ...b, v: 0 })), 29)!.bullShare, 0.5))
  check('battlefield: pressure\'s one line names the side, the dollars and the percent', pressureLine(pr) === 'Bulls took $20.00 (+100.0%) over 20 bars' && /^Bears took \$\d/.test(pressureLine(pressureAt(slide, 29)!)) && /^Dug in: /.test(pressureLine(pressureAt(chop, 29)!)))
  const t1 = troopCounts(1, 30)
  const t2 = troopCounts(0.5, 30)
  check('battlefield: units split by the force share, and a rout still leaves two on the losing side', t1.bulls === 28 && t1.bears === 2 && t2.bulls === 15 && t2.bears === 15 && troopCounts(0, 3).bears === 2)
  const rec = fieldRecords(bars)!
  check('battlefield: the two flags stand on the highest high and the lowest low reached so far (a replay moves them)', rec.high === 1 && rec.low === 2 && fieldRecords(bars, 1)!.low === 0 && fieldRecords([]) === null)

  const win = battleReport(bar(0, 8, 9.24, 7.9, 8.89, 4_100_000), 'UNI')
  check('battlefield: an up bar\'s report is the bar\'s own numbers (ground = close − open, the range, volume × close)',
    win.outcome === 'bulls' && win.headline === 'Bulls took $0.89 of ground (+11.13%)' && win.lines[0] === 'Line moved $8.00 → $8.89' && win.lines[1] === 'Fighting ranged $7.90 to $9.24' && win.lines[2] === 'Force committed: 4.10M UNI (~$36,449,000)', JSON.stringify(win))
  const loss = battleReport(bar(0, 10, 10.1, 9, 9.5, 0), 'UNI')
  check('battlefield: a down bar is the bears\', and a bar with no volume says nothing about force', loss.outcome === 'bears' && loss.headline === 'Bears took back $0.50 (−5.00%)' && loss.lines.length === 2)
  const raid = battleReport(bar(0, 10, 14, 9.9, 10.5), 'UNI')
  const breach = battleReport(bar(0, 10, 10.1, 6, 9.6), 'UNI')
  const doji = battleReport(bar(0, 10, 11, 9, 10.05), 'UNI')
  check('battlefield: a long upper wick is a raid thrown back, a long lower wick a breach lost again, and a body under a tenth of the range a stalemate',
    raid.lines[1] === 'Bulls raided to $14.00 and were thrown back' && breach.lines[1] === 'Bears broke through to $6.00 and lost it again' && doji.outcome === 'stalemate' && doji.headline === 'Stalemate. The line held at $10.05')

  const hs = Array.from({ length: 200 }, (_, i) => fieldHash(i, 1))
  check('battlefield: the scenery hash is stable and spread (the forest stands in the same place every frame)', hs.every((h) => h >= 0 && h < 1) && fieldHash(7, 1) === fieldHash(7, 1) && fieldHash(7, 1) !== fieldHash(7, 2) && new Set(hs.map((h) => Math.floor(h * 10))).size === 10)

  // Wiring: the candles are the view a chart opens on, and only the symbol page offers the switch.
  const chart = readFileSync('components/markets/chart/MarketChart.tsx', 'utf8')
  const page = readFileSync('components/markets/shell/SymbolPage.tsx', 'utf8')
  check('battlefield: MarketChart opens on candles (the view is never remembered), offers the switch only when asked, and hides the drawing tools on the field',
    /useState<'candles' \| 'field'>\('candles'\)/.test(chart) && /battlefield = false/.test(chart) && /\{battlefield && \(\s*<div className="mkt-view"/.test(chart) && /tools && !fieldOn &&/.test(chart) && !/localStorage/.test(chart) && /<ChartMount[^>]*\bbattlefield\b/.test(page))
}

if (process.argv[1]?.endsWith('battlefield-pins.ts')) {
  let failed = 0
  battlefieldPins((name, ok, extra) => {
    if (!ok) failed++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
  })
  console.log(failed ? `\n${failed} failed` : '\nall battlefield pins green')
  process.exit(failed ? 1 : 0)
}
