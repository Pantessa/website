// Pins for the chart's Battlefield view (lib/battlefield): the projection, the
// calendar, who is winning, and a bar's battle report. Pure: no server, no
// chain, no DB. Called from scripts/test-api.ts, and runnable alone:
//   npx tsx scripts/battlefield-pins.ts
import { existsSync, readFileSync } from 'node:fs'
import type { Candle } from '../lib/charts'
import { crowdRead, fuelBeforePlayer, fuelWithin, fundingLine, liqBuckets, liquidationMap, oiAtBars, parsePlayer, playerLiqPrice, playerState, bookRows, bookWalls, heatCells, heatMedian, heatSummary, heatTone, spotRead, unitUsd, unitsFor, DAY_SEC, HEAT_WEEKS, type OiPoint } from '../lib/derivs'
import { fieldAhead } from '../lib/battlefield'
import { marginBarsFor, wallHits, wallRungAt, wallRungs, wallSummary, wallWidthPx } from '../lib/wall'
import { composeExecAsk } from '../lib/trade-asks'
import { chartPairFor } from '../lib/charts'
import { parseBoardParam, parseViewParam, viewUrl } from '../lib/markets'
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

  // ── Positioning (lib/derivs) ────────────────────────────────────────────
  check('battlefield: the scale stretches to hold a cluster or a player line off the tape, and the ground ahead is a fifth of the bars (eight at least)',
    fieldScale(bars, [40]).hi > 40 && fieldScale(bars, [1, NaN, -3]).lo < 1 && fieldAhead(180) === 40 && fieldAhead(20) === 8)
  // Four flat bars at $100; open interest steps 1000 → 1500 on bar 1, then falls to 750 on bar 2.
  const flatBars: Candle[] = [bar(0, 100, 101, 99, 100), bar(DAY, 100, 101, 99, 100), bar(2 * DAY, 100, 101, 99, 100), bar(3 * DAY, 100, 101, 99, 100)]
  const oi: OiPoint[] = [{ t: 0, oi: 1000 }, { t: DAY, oi: 1000 }, { t: 2 * DAY, oi: 1500 }, { t: 3 * DAY, oi: 750 }]
  const atBars = oiAtBars(flatBars, oi)
  check('battlefield: open interest is read at each bar\'s open (carried from the last reading), null before the first one', atBars[0] === 1000 && atBars[2] === 1500 && atBars[3] === 750 && oiAtBars(flatBars, [{ t: 2 * DAY, oi: 5 }])[1] === null)
  const m1 = liquidationMap(flatBars, oi, 'coin', 1)
  const usd1 = m1.alive.reduce((a, l) => a + l.usd, 0)
  const tenX = m1.alive.filter((l) => Math.abs(l.price - 90.5) < 1e-9 || Math.abs(l.price - 109.5) < 1e-9)
  check('battlefield: open interest that APPEARS on a bar becomes liquidation levels on both sides of its price (500 contracts at $100 = $50k a side; the 10x tier breaks 9.5% away)',
    m1.alive.length === 8 && near(usd1, 100_000, 1e-6) && tenX.length === 2 && tenX.every((l) => near(l.usd, 50_000 * 0.35, 1e-6)) && m1.alive.filter((l) => l.side === 'long').every((l) => l.price < 100) && m1.alive.filter((l) => l.side === 'short').every((l) => l.price > 100) && m1.hits.length === 0)
  const m2 = liquidationMap(flatBars, oi, 'coin', 2)
  check('battlefield: open interest that LEAVES thins every level still standing by the share that left (1500 → 750 halves them)', near(m2.alive.reduce((a, l) => a + l.usd, 0), 50_000, 1e-6))
  const flush: Candle[] = [...flatBars.slice(0, 2), bar(2 * DAY, 100, 101, 79, 95)]
  const m3 = liquidationMap(flush, [{ t: 0, oi: 1000 }, { t: DAY, oi: 1000 }, { t: 2 * DAY, oi: 1500 }, { t: 3 * DAY, oi: 1500 }], 'coin')
  check('battlefield: a later bar whose range reaches a level sets it off and removes it (a wick to $79 takes the 50x, 25x, 10x and 5x longs; the shorts stand)',
    m3.hits.length === 4 && m3.hits.every((h) => h.side === 'long' && h.at === 2) && m3.alive.every((l) => l.side === 'short') && m3.alive.length === 4 && liquidationMap(flatBars, [], 'coin').alive.length === 0)
  const bk = liqBuckets(m1.alive, 100)
  const fuel = fuelWithin(m1.alive, 100, 10)
  check('battlefield: levels gather into price buckets that keep every dollar, and fuel within 10% counts shorts above and longs below only',
    near(bk.reduce((a, b) => a + b.usd, 0), 100_000, 1e-6) && bk.every((b, i) => i === 0 || b.price >= bk[i - 1].price) && near(fuel.above, 50_000 * 0.75, 1e-6) && near(fuel.below, 50_000 * 0.75, 1e-6))

  const base = { longShare: 0.5, funding8h: 0, oiChangePct: null, priceChangePct: null, fuelAbove: 0, fuelBelow: 0 }
  check('battlefield: the read names the exposed side: a crowd past 60% with the fuel on its side of the price, or paying funding; fuel alone leans; nothing leans as even',
    crowdRead({ ...base, longShare: 0.68, fuelBelow: 9, fuelAbove: 2 }).lean === 'down' && crowdRead({ ...base, longShare: 0.3, fuelAbove: 9, fuelBelow: 2 }).lean === 'up' && crowdRead({ ...base, longShare: 0.65, funding8h: 0.0001 }).headline === 'Longs are crowded and paying to stay' && crowdRead({ ...base, fuelAbove: 10, fuelBelow: 1 }).lean === 'up' && crowdRead(base).headline === 'Evenly matched' && crowdRead({ ...base, longShare: 0.65 }).lean === 'even')
  check('battlefield: open interest against price reads the four textbook cases, and says nothing when neither moved 1%',
    /new money/.test(crowdRead({ ...base, oiChangePct: 5, priceChangePct: 5 }).flow ?? '') && /shorts are closing/.test(crowdRead({ ...base, oiChangePct: -5, priceChangePct: 5 }).flow ?? '') && /new shorts/.test(crowdRead({ ...base, oiChangePct: 5, priceChangePct: -5 }).flow ?? '') && /longs are leaving/.test(crowdRead({ ...base, oiChangePct: -5, priceChangePct: -5 }).flow ?? '') && crowdRead({ ...base, oiChangePct: 0.2, priceChangePct: 0.5 }).flow === null)
  check('battlefield: funding prints per 8 hours with who pays', fundingLine(0.0001) === '+0.0100% / 8h · longs pay shorts' && fundingLine(-0.00025) === '\u22120.0250% / 8h · shorts pay longs')

  const long3 = { side: 'long' as const, entry: 100, leverage: 3, usd: 300 }
  const st = playerState(long3, 110, 10)
  check('battlefield: a player\'s numbers are the position\'s own (3x long $300 from $100 at $110: +$30 on $100 of margin = +30%; it breaks near $70, further at lower leverage, on the other side for a short)',
    near(st.pnlUsd, 30) && near(st.marginUsd, 100) && near(st.roePct, 30) && near(st.liq, (100 * (1 - 1 / 3)) / (1 - 0.05)) && !st.liquidated && playerLiqPrice({ ...long3, leverage: 2 }, 10) < st.liq && playerLiqPrice({ ...long3, side: 'short' }, 10) > 100 && playerState(long3, 60, 10).liquidated && near(playerState({ ...long3, side: 'short' }, 110, 10).pnlUsd, -30))
  check('battlefield: "others break first" counts only the player\'s own side between the price and the player\'s line',
    near(fuelBeforePlayer([{ side: 'long', price: 95, usd: 7 }, { side: 'long', price: 60, usd: 100 }, { side: 'short', price: 105, usd: 50 }], long3, 100, 70), 7))
  check('battlefield: a stored player is re-validated (a bad side, a NaN, a 500x leverage is no player)',
    parsePlayer(long3)?.usd === 300 && parsePlayer({ ...long3, side: 'up' }) === null && parsePlayer({ ...long3, entry: NaN }) === null && parsePlayer({ ...long3, leverage: 500 }) === null && parsePlayer(null) === null)
  const uni = chartPairFor('UNI')!
  check('battlefield: the player\'s Open button sends the leveraged-perp sentence the Hyperliquid layer reads', composeExecAsk(uni, 'long', { usd: 25, leverage: 3 }) === '3x Long $25 of UNI on Hyperliquid' && composeExecAsk(uni, 'short', { usd: 10, leverage: 5 }) === '5x Short $10 of UNI on Hyperliquid')
  const field = readFileSync('components/markets/chart/FrontBoard.tsx', 'utf8')
  const route = readFileSync('app/api/markets/derivs/route.ts', 'utf8')
  check('battlefield: the Open button exists only for an at-market what-if on a listed perp within the venue\'s leverage and the chart\'s venue gate, on the perps board; a tokenized stock reads no positioning',
    /stored\.entry !== null \|\| !perpOk \|\| stored\.leverage > maxLev \|\| mode !== 'perps'/.test(field) && /canAsk \? canAsk\(ask\) : true/.test(field) && /noMarket = pair\.source === 'robinhood'/.test(field) && /pair\.source === 'robinhood'/.test(route) && /canAsk=\{\(ask\) => canTradeAsk\(ask, tradable\)\}/.test(readFileSync('components/markets/chart/MarketChart.tsx', 'utf8')))

  // ── The front ───────────────────────────────────────────────────────────
  check('battlefield: a tank is the smallest round dollar step that keeps the biggest cluster to 14 tanks; a cluster under half a tank stands no one, anything from there at least one',
    unitUsd(1_100_000) === 100_000 && unitUsd(14_000_000) === 1_000_000 && unitUsd(14_000_001) === 2_500_000 && unitsFor(40_000, 100_000) === 0 && unitsFor(60_000, 100_000) === 1 && unitsFor(1_100_000, 100_000) === 11)
  const bookShape = { mid: 100, bids: [{ px: 99.9, usd: 5 }, { px: 98.5, usd: 7 }, { px: 97, usd: 100 }], asks: [{ px: 100.1, usd: 3 }, { px: 101.9, usd: 4 }, { px: 103, usd: 100 }] }
  const w = bookWalls(bookShape)
  check('battlefield: the ramparts count orders resting within 2% of the mid on each side, and nothing without a mid', w.bidUsd === 12 && w.askUsd === 7 && bookWalls({ ...bookShape, mid: null }).bidUsd === 0)
  const fieldSrc = readFileSync('components/markets/chart/FrontBoard.tsx', 'utf8')
  check('battlefield: the board carries no candles and no decoration: every tank is a row\'s dollars over the unit (unitsFor), the walls are the book (bookWalls), spot rows are the resting book (bookRows), and the old candle field is gone',
    !/fieldHash/.test(fieldSrc) && !/troopCounts/.test(fieldSrc) && !/CandlestickSeries|timeBands|battleReport/.test(fieldSrc) && /unitsFor\(b\.usd, unit\)/.test(fieldSrc) && /bookWalls\(hlBook\)/.test(fieldSrc) && /bookRows\(spotBook, RANGE_PCT\.spot, SPOT_STEP_PCT\)/.test(fieldSrc) && !existsSync('components/markets/chart/BattleField.tsx'))
  const spotBook = { mid: 100, bids: [{ px: 99.9, usd: 50 }, { px: 99.2, usd: 20 }, { px: 97.5, usd: 30 }, { px: 85, usd: 999 }], asks: [{ px: 100.2, usd: 10 }, { px: 101.5, usd: 40 }, { px: 115, usd: 999 }] }
  const sr = bookRows(spotBook, 10, 1)
  check('battlefield: spot rows gather the resting book into 1% rungs within the range (bids are the buyers\' rows, asks the sellers\', the far tail left out), ascending by price',
    sr.length === 4 && sr.every((r, i) => i === 0 || r.price >= sr[i - 1].price) && sr.filter((r) => r.side === 'long').reduce((a, r) => a + r.usd, 0) === 100 && sr.filter((r) => r.side === 'short').reduce((a, r) => a + r.usd, 0) === 50 && sr.find((r) => r.side === 'long' && r.usd === 70)?.lo === 99, JSON.stringify(sr))
  const read = spotRead(spotBook)
  check('battlefield: the spot read says which side holds the deeper book within 5% and the spread', read.lean === 'up' && read.headline === 'Buyers hold the deeper book' && near(read.bidShare, 100 / 150) && near(read.spreadPct!, 0.3) && spotRead({ ...spotBook, bids: [] }).lean === 'down')

  // ── The shared link ─────────────────────────────────────────────────────
  check('battlefield: ?view=battlefield opens the Battlefield (with ?board= picking its board), anything else the candles, and the mirror keeps every other param',
    parseViewParam('?view=battlefield') === 'field' && parseViewParam('?view=candles') === 'candles' && parseViewParam('') === 'candles' && parseBoardParam('?board=spot') === 'spot' && parseBoardParam('?board=x') === null && viewUrl('field', 'spot', '/t/UNI', '?tf=1h') === '/t/UNI?tf=1h&view=battlefield&board=spot' && viewUrl('candles', 'spot', '/t/UNI', '?view=battlefield&board=spot&vs=ETH') === '/t/UNI?vs=ETH' && viewUrl('field', null, '/t/UNI', '') === '/t/UNI?view=battlefield')
  check('battlefield: a share taken from the Battlefield links back to it', /viewUrl\(view \?\? 'candles', board \?\? null, `\/t\/\$\{symbol\}`/.test(readFileSync('components/markets/chart/ChartShare.tsx', 'utf8')) && /parseViewParam\(window\.location\.search\)/.test(readFileSync('components/markets/chart/MarketChart.tsx', 'utf8')))

  // ── The heatmap ─────────────────────────────────────────────────────────
  const nowT = at(2026, 10, 6, 10) // a Tuesday
  const hc = heatCells([{ t: at(2026, 10, 5, 8), long: 0.62 }, { t: at(2026, 10, 5, 20), long: 0.7 }, { t: at(2026, 10, 6), long: 0.3 }], [{ t: at(2026, 10, 5), oi: 1000 }], [bar(at(2026, 10, 5), 10, 11, 9, 10.5)], nowT)
  const sun = at(2026, 10, 4)
  check('battlefield: the heatmap is one cell per UTC day for 53 weeks ending this week (Sunday first), the day\'s newest reading winning, with the day\'s open interest and price move beside it',
    hc.length === HEAT_WEEKS * 7 && hc[hc.length - 1].day === sun + 6 * DAY_SEC && hc[0].day === sun - 52 * 7 * DAY_SEC && new Date(hc[0].day * 1000).getUTCDay() === 0 && hc.find((c) => c.day === at(2026, 10, 5))?.long === 0.7 && hc.find((c) => c.day === at(2026, 10, 5))?.oi === 1000 && near(hc.find((c) => c.day === at(2026, 10, 5))?.pricePct ?? 0, 5) && hc.find((c) => c.day === at(2026, 10, 6))?.long === 0.3 && hc.find((c) => c.day === at(2026, 10, 3))?.long === null)
  check('battlefield: a cell\'s ink is the share\'s distance from the year\'s typical day (the median), full at 8 points, nothing without a reading', heatTone(0.5) === 0 && near(heatTone(0.58)!, 1) && near(heatTone(0.42)!, -1) && heatTone(0.95) === 1 && heatTone(null) === null && near(heatTone(0.68, 0.64)!, 0.5) && heatMedian([{ long: 0.7 }, { long: null }, { long: 0.6 }, { long: 0.65 }]) === 0.65 && heatMedian([]) === null)
  const runCells = heatCells(Array.from({ length: 10 }, (_, i) => ({ t: at(2026, 9, 27) + i * DAY_SEC, long: i < 4 ? 0.6 : 0.66 })), [], [], nowT)
  const hsum = heatSummary(runCells)
  check('battlefield: the year\'s headline reads against the typical day: the run ending today, else each side\'s unusual days', hsum.read === 10 && hsum.median === 0.66 && hsum.longDays === 0 && hsum.shortDays === 4 && hsum.streak === null && hsum.headline === 'More short than usual on 4 of 10 days' && heatSummary(heatCells(Array.from({ length: 10 }, (_, i) => ({ t: at(2026, 9, 27) + i * DAY_SEC, long: i < 7 ? 0.6 : 0.7 })), [], [], nowT)).headline === 'More long than usual 3 days running' && heatSummary(heatCells([], [], [], nowT)).headline === 'No daily positioning read yet')
  check('battlefield: ?board=heat opens the heatmap', parseBoardParam('?board=heat') === 'heat' && viewUrl('field', 'heat', '/t/UNI', '') === '/t/UNI?view=battlefield&board=heat')

  // Wiring: the candles are the view a chart opens on, and only the symbol page offers the switch.
  const chart = readFileSync('components/markets/chart/MarketChart.tsx', 'utf8')
  const page = readFileSync('components/markets/shell/SymbolPage.tsx', 'utf8')
  check('battlefield: MarketChart opens on candles (the view is never remembered), offers the switch only when asked, and hides the drawing tools on the field',
    /useState<'candles' \| 'field'>\('candles'\)/.test(chart) && /battlefield = false/.test(chart) && /\{battlefield && \(\s*<div className="mkt-view"/.test(chart) && /tools && !fieldOn &&/.test(chart) && !/localStorage/.test(chart) && /<ChartMount[^>]*\bbattlefield\b/.test(page))

  // ── The Wall (lib/wall): every dollar at its price, kinds kept apart ────
  const wallBars = [bar(1, 100, 101, 99, 100.5, 10), bar(2, 100.5, 102, 100, 101.2, 20), bar(3, 101.2, 103, 98, 99.4, 5)]
  const w1 = wallRungs({
    last: 100,
    spot: { bids: [{ px: 99.2, usd: 1000 }, { px: 97.9, usd: 500 }, { px: 70, usd: 9999 }], asks: [{ px: 100, usd: 300 }, { px: 101.6, usd: 200 }] },
    perp: { bids: [{ px: 99.9, usd: 400 }], asks: [{ px: 101.2, usd: 100 }] },
    levels: [{ price: 99.5, usd: 2000 }, { price: 103.1, usd: 700 }, { price: 130, usd: 5 }],
    bars: wallBars,
    from: 0,
    to: 1,
  })
  const rBelow = w1.rungs.find((r) => r.k === -1)!
  const rAbove = w1.rungs.find((r) => r.k === 0)!
  check('wall: the grid is anchored on the price (k −1 just under it, 0 just over), a Coinbase bid, a Hyperliquid bid and an estimated cluster in one band share a rung but never a field, and the standing total is the three summed',
    near(w1.step, 1.5) && w1.perSide === 8 && w1.rungs.length === 16 && near(rBelow.lo, 98.5) && near(rBelow.hi, 100) && rBelow.side === 'below' && rBelow.spotUsd === 1000 && rBelow.perpUsd === 400 && rBelow.liqUsd === 2000 && rBelow.usd === 3400 && rAbove.side === 'above' && near(rAbove.lo, 100) && rAbove.spotUsd === 300 && rAbove.perpUsd === 100 && rAbove.usd === 400, JSON.stringify([rBelow, rAbove]))
  check('wall: anything beyond the fence is left out, so a far bid or a far cluster never scales the ladder; an empty read is sixteen empty rungs, no price is no ladder',
    w1.max === 3400 && !w1.rungs.some((r) => r.spotUsd === 9999 || r.liqUsd === 5) && wallRungs({ last: 100 }).rungs.length === 16 && wallRungs({ last: 100 }).max === 0 && wallRungs({ last: 0 }).rungs.length === 0)
  check('wall: traded-here is the bars on screen (close × volume into their band), on its own scale, never part of the standing total; a bar off screen is not counted',
    near(rAbove.tradedUsd, 3029) && near(w1.tradedMax, 3029) && rAbove.usd === 400 && rBelow.tradedUsd === 0 && near(wallRungs({ last: 100, bars: wallBars, from: 0, to: 2 }).rungs.find((r) => r.k === -1)!.tradedUsd, 497))
  check('wall: a price finds its rung, and nothing off the ladder', wallRungAt(w1, 100, 99.9)?.k === -1 && wallRungAt(w1, 100, 100)?.k === 0 && wallRungAt(w1, 100, 50) === null)
  const wsum = wallSummary(w1, 100, 5)
  check('wall: within 5% the summary keeps measured resting dollars and estimated fuel apart, each side', wsum.belowUsd === 1900 && wsum.belowEst === 2000 && wsum.aboveUsd === 600 && wsum.aboveEst === 700, JSON.stringify(wsum))
  const wh = wallHits([{ side: 'long', price: 98, usd: 300, from: 0, at: 5 }, { side: 'long', price: 96, usd: 100, from: 1, at: 5 }, { side: 'short', price: 104, usd: 50, from: 0, at: 5 }, { side: 'long', price: 90, usd: 1000, from: 2, at: 7 }])
  check('wall: hits gather per bar and side (a dollar-weighted price, a count), biggest first', wh.max === 1000 && wh.hits.length === 3 && wh.hits[0].at === 7 && wh.hits[1].at === 5 && wh.hits[1].side === 'long' && wh.hits[1].usd === 400 && near(wh.hits[1].price, 97.5) && wh.hits[1].count === 2 && wh.hits[2].side === 'short')
  check('wall: the margin is the bars worth the ladder\'s pixels at the current spacing, never under the chart\'s own offset, and the chart\'s own offset when nothing draws; a narrow plot gets the narrow ladder',
    marginBarsFor(220, 5, 4) === 45 && marginBarsFor(220, 20, 4) === 12 && marginBarsFor(0, 5, 4) === 4 && marginBarsFor(10, 20, 4) === 4 && marginBarsFor(220, 0, 4) === 221 && wallWidthPx(1000, true) === 220 && wallWidthPx(500, true) === 64 && wallWidthPx(1000, false) === 0)
  const wallSrc = readFileSync('components/markets/chart/TheWall.tsx', 'utf8')
  check('wall: the ladder is drawn from lib/wall\'s rungs on the chart\'s own geometry, the estimate hatched and named est., the hover read off the plot (the canvas stays pointer-transparent), and the Rivers and the old strata are gone',
    /wallRungs\(\{/.test(wallSrc) && /hatch\(tokens\.up\)/.test(wallSrc) && /· est\./.test(wallSrc) && /addEventListener\('pointermove'/.test(wallSrc) && /pointer-events: none/.test(readFileSync('components/markets/chart/battlefield.css', 'utf8')) && !existsSync('components/markets/chart/PositionRivers.tsx') && !existsSync('components/markets/chart/StrataOverlay.tsx'))
  check('wall: the chart re-asks its right margin on every range change, absorbs the volume profile while the Wall draws, offers the WALL toggle only with the Battlefield, and the symbol page opens with it lit',
    /syncMarginRef\.current\(\)/.test(chart) && /marginBarsFor\(wallPxRef\.current/.test(chart) && /overlays\.has\('vp'\) && !wallOn/.test(chart) && /o\.key !== 'wall' \|\| battlefield/.test(chart) && /DEFAULT_SYMBOL_OVERLAYS: OverlayKey\[\] = \['sma50', 'sma200', 'vp', 'wall'\]/.test(readFileSync('lib/chart-indicators.ts', 'utf8')))
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
