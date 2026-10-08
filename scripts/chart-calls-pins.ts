// Pins for the chart's drawing gestures (lib/chart-draw), the share picture's
// words (lib/chart-share) and a stamped call (lib/chart-calls). Pure: no
// server, no chain, no DB. Called from scripts/test-api.ts, and runnable alone:
//   npx tsx scripts/chart-calls-pins.ts
import { cleanUsd, composeTicket, defaultLimitPrice, ticketShape } from '../lib/call-ticket'
import { chartPairFor } from '../lib/charts'
import type { Candle } from '../lib/charts'
import { parseChartState, type ChartLine, type ChartState } from '../lib/chart-state'
import { dragLine, emptyUndo, fibLevels, measureReadout, nearestOhlc, recordUndo, redo, spanWords, toolForKey, trendReadout, undo, zoneReadout, type DrawSpace } from '../lib/chart-draw'
import { boxFocus, FOCUS_MIN_BARS, FOCUS_MIN_PX, lineFocus, padRange, wheelScale } from '../lib/chart-focus'
import { shareFileName, shotTimeLabel, watermarkUrl } from '../lib/chart-share'
import { autoCallTitle, callCardSvg, callTweetHref, chartTweetHref, fillTiming, fillWords, fmtCallTime, fmtMove, fmtSpan, movePct, stampFromBars } from '../lib/chart-calls'

type Check = (name: string, ok: boolean, extra?: string) => void

export function chartCallsPins(check: Check): void {
  // A linear chart: $1 per pixel downwards from $1,000 at y=0; one hourly bar per 10px from t=0.
  const space: DrawSpace = {
    priceToY: (p) => 1000 - p,
    yToPrice: (y) => 1000 - y,
    timeToX: (t) => t / 360,
    xToTime: (x) => Math.round(x / 10) * 3600,
  }
  const h: ChartLine = { id: 'h1', kind: 'h', price: 500, label: 'entry', action: { kind: 'limit', ask: 'limit order: buy $25 of ETH at $500' } }
  const zone: ChartLine = { id: 'z1', kind: 'zone', p1: 400, p2: 450 }
  const trend: ChartLine = { id: 't1', kind: 'trend', t1: 3600, p1: 300, t2: 36000, p2: 350 }
  const note: ChartLine = { id: 'n1', kind: 'note', t: 7200, price: 600, text: 'here' }
  const stateOf = (lines: ChartLine[]): ChartState => ({ v: 1, symbol: 'ETH', tf: '1h', lines })

  const movedH = dragLine(h, 'body', 37, -20, space)
  check('draw: dragging a level moves its price by the pointer\'s vertical travel only, and keeps its label and its order', !!movedH && movedH.kind === 'h' && movedH.price === 520 && movedH.label === 'entry' && movedH.action?.ask === h.action!.ask)
  const zBody = dragLine(zone, 'body', 0, 10, space)
  const zA = dragLine(zone, 'a', 0, 10, space)
  const zB = dragLine(zone, 'b', 0, -25, space)
  check('draw: a zone moves whole by its body and resizes by either edge, the other edge staying put',
    !!zBody && zBody.kind === 'zone' && zBody.p1 === 390 && zBody.p2 === 440 && !!zA && zA.kind === 'zone' && zA.p1 === 390 && zA.p2 === 450 && !!zB && zB.kind === 'zone' && zB.p1 === 400 && zB.p2 === 475)
  check('draw: a zone edge dragged onto the other edge is refused (a zone has height), so the last good zone stays', dragLine(zone, 'a', 0, -50, space) === null)
  const tBody = dragLine(trend, 'body', 20, 10, space)
  check('draw: a trend line dragged by its body keeps its length in bars and its rise', !!tBody && tBody.kind === 'trend' && tBody.t2 - tBody.t1 === trend.t2 - trend.t1 && tBody.p2 - tBody.p1 === 50 && tBody.t1 === 3600 + 7200 && tBody.p1 === 290)
  const tEnd = dragLine(trend, 'b', -10, -50, space)
  check('draw: a trend line dragged by one end moves that end alone', !!tEnd && tEnd.kind === 'trend' && tEnd.t1 === 3600 && tEnd.p1 === 300 && tEnd.p2 === 400 && tEnd.t2 === 32400)
  const snapSpace: DrawSpace = { ...space, snap: () => ({ t: 18000, price: 777 }) }
  const tSnap = dragLine(trend, 'a', 3, 3, snapSpace)
  const nSnap = dragLine(note, 'body', 1, 1, snapSpace)
  check('draw: trend ends and notes take the magnet; a level never does', !!tSnap && tSnap.kind === 'trend' && tSnap.p1 === 777 && tSnap.t1 === 18000 && !!nSnap && nSnap.kind === 'note' && nSnap.price === 777 && dragLine(h, 'body', 1, 1, snapSpace)?.kind === 'h' && (dragLine(h, 'body', 1, 1, snapSpace) as { price: number }).price === 499)
  check('draw: a drag that leaves the price scale (a price at or under zero) is refused', dragLine(h, 'body', 0, 600, space) === null)
  const dragged = [movedH, zBody, zA, zB, tBody, tEnd, tSnap, nSnap].filter((l): l is ChartLine => !!l)
  check('draw: every dragged drawing still parses as a v1 chart state (ids, kinds and integer times intact)', dragged.every((l) => parseChartState(stateOf([l])) !== null))

  const bar: Candle = { t: 0, o: 100, h: 110, l: 90, c: 105, v: 1 }
  const py = (p: number) => 200 - p
  check('draw: the magnet picks the nearest of open/high/low/close within reach and nothing beyond it', nearestOhlc(bar, py(109), py) === 110 && nearestOhlc(bar, py(104), py) === 105 && nearestOhlc(bar, py(97.5), py, 8) === 100 && nearestOhlc(bar, py(130), py) === null)
  check('draw: a trend line reads its move and its length; a zone reads its width', trendReadout(100, 104.21, 0, 43200, 3600) === '+4.21% · 12 bars' && trendReadout(100, 95, 0, 3600, 3600) === '−5.00% · 1 bar' && trendReadout(0, 5, 0, 1, 1) === '' && zoneReadout(103.1, 100) === '3.10% wide')

  // ── the drawing tools of 2026-10-08 (chart-draw-focus): fib, vertical, trend reach, magnet, measure, zoom ──
  const fib: ChartLine = { id: 'f1', kind: 'fib', t1: 3600, p1: 100, t2: 36000, p2: 200 }
  const vline: ChartLine = { id: 'v1', kind: 'vline', t: 7200, label: 'earnings' }
  const ray: ChartLine = { ...trend, id: 't2', extend: 'right' }
  check('chart-state: fib, vertical lines and an extended trend line round-trip the strict parse byte-equal, and a fib with no swing / a bad reach / a vline with a bad time refuse',
    parseChartState(stateOf([fib, vline, ray, { ...trend, id: 't3', extend: 'both' }])) !== null &&
      JSON.stringify(parseChartState(stateOf([fib, vline, ray]))?.lines) === JSON.stringify([fib, vline, ray]) &&
      parseChartState(stateOf([{ ...fib, p2: 100 }])) === null &&
      parseChartState(stateOf([{ ...trend, extend: 'left' } as unknown as ChartLine])) === null &&
      parseChartState(stateOf([{ id: 'v', kind: 'vline', t: 1.5 } as unknown as ChartLine])) === null &&
      parseChartState(stateOf([{ id: 'v', kind: 'vline', t: 7200, label: 'a\nb' } as unknown as ChartLine])) === null)
  const lv = fibLevels(100, 200)
  const down = fibLevels(200, 100)
  check('fib: nine levels — 0 at the swing\'s end, 1 at its start, 0.618 three-fifths of the way back, the two extensions past the end; a down-swing mirrors; a flat swing has none',
    lv.length === 9 && lv[0].ratio === 0 && lv[0].price === 200 && lv[6].ratio === 1 && lv[6].price === 100 && Math.abs(lv[4].price - 138.2) < 1e-9 && lv[4].label === '0.618' && lv[0].label === '0' &&
      Math.abs(lv[8].price - (200 - 161.8)) < 1e-9 && down[4].price > 100 && Math.abs(down[4].price - 161.8) < 1e-9 && fibLevels(5, 5).length === 0 && fibLevels(0, 5).length === 0)
  check('fib: a level past zero is dropped (an extension under a small base) instead of drawing a negative price', fibLevels(2, 10).every((l) => l.price > 0) && fibLevels(2, 10).length < 9 && fibLevels(10, 2).length === 9)
  const fBody = dragLine(fib, 'body', 20, 10, space)
  const fEnd = dragLine(fib, 'b', 0, 20, space)
  const vMove = dragLine(vline, 'body', 25, 40, space)
  check('draw: a fib drags like a trend line (whole by the body, one end alone), a vertical line only sideways, and a magnet-off drag ignores the snap',
    !!fBody && fBody.kind === 'fib' && fBody.t2 - fBody.t1 === fib.t2 - fib.t1 && fBody.p1 === 90 && fBody.p2 === 190 &&
      !!fEnd && fEnd.kind === 'fib' && fEnd.p1 === 100 && fEnd.p2 === 180 &&
      !!vMove && vMove.kind === 'vline' && vMove.t === 7200 + 3 * 3600 && vMove.label === 'earnings' &&
      dragLine(trend, 'a', 3, 3, snapSpace, false)?.kind === 'trend' && (dragLine(trend, 'a', 3, 3, snapSpace, false) as Extract<ChartLine, { kind: 'trend' }>).p1 === 297 &&
      dragLine(fib, 'a', 0, -100, space) === null /* the ends meet in price: no swing */)
  check('draw: a dragged fib / vline still parses as a v1 state', [fBody, fEnd, vMove].every((l) => !!l && parseChartState(stateOf([l])) !== null))
  check('keys: one letter arms one tool — H R T N F V Z M, either case — and a modifier, a word key or a digit arms nothing',
    toolForKey({ key: 'z' }) === 'zoom' && toolForKey({ key: 'Z' }) === 'zoom' && toolForKey({ key: 'm' }) === 'measure' && toolForKey({ key: 'f' }) === 'fib' && toolForKey({ key: 'v' }) === 'vline' &&
      toolForKey({ key: 'r' }) === 'zone' && toolForKey({ key: 'h' }) === 'h' && toolForKey({ key: 't' }) === 'trend' && toolForKey({ key: 'n' }) === 'note' &&
      toolForKey({ key: 'z', metaKey: true }) === null && toolForKey({ key: 'z', shiftKey: true }) === null && toolForKey({ key: 'Escape' }) === null && toolForKey({ key: '1' }) === null && toolForKey({ key: 'l' }) === null)
  const fmt = (p: number) => p.toFixed(2)
  const m1 = measureReadout(100, 104.21, 0, 43200, 3600, fmt)
  const m2 = measureReadout(100, 95, 3600, 0, 3600, fmt)
  check('measure: a box reads percent, dollars, bars and time, signed by the move\'s direction; a span reads in a trader\'s words',
    !!m1 && m1.words === '+4.21% · +$4.21 · 12 bars · 12h' && m1.bars === 12 && !!m2 && m2.words === '−5.00% · −$5.00 · 1 bar · 1h' && m2.pct === -5 &&
      measureReadout(0, 5, 0, 1, 1, fmt) === null && spanWords(45) === '45s' && spanWords(90 * 60) === '1h 30m' && spanWords(3 * 86400 + 4 * 3600) === '3d 4h' && spanWords(15 * 86400) === '2w 1d' && spanWords(86400 * 14) === '2w')
  const pr = padRange(2150, 2790)
  check('focus: a price range breathes 6% of its height on each side, in either order, and a flat range still opens on something',
    !!pr && Math.abs(pr.from - (2150 - 38.4)) < 1e-9 && Math.abs(pr.to - (2790 + 38.4)) < 1e-9 && JSON.stringify(padRange(2790, 2150)) === JSON.stringify(pr) && !!padRange(10, 10) && padRange(10, 10)!.to > padRange(10, 10)!.from && padRange(-5, 5) === null)
  const xToL = (x: number) => x / 10
  const yToP = (y: number) => 1000 - y
  const box = boxFocus({ x: 100, y: 100 }, { x: 300, y: 400 }, xToL, yToP)
  check('focus: a dragged box becomes a view — its bars as the logical range, its prices padded as the price range, corners in any order; a click (under 8px either way) is no view',
    !!box && box.logical.from === 10 && box.logical.to === 30 && box.price.from === 600 - 18 && box.price.to === 900 + 18 &&
      JSON.stringify(boxFocus({ x: 300, y: 400 }, { x: 100, y: 100 }, xToL, yToP)) === JSON.stringify(box) &&
      boxFocus({ x: 100, y: 100 }, { x: 100 + FOCUS_MIN_PX - 1, y: 400 }, xToL, yToP) === null && boxFocus({ x: 100, y: 100 }, { x: 300, y: 104 }, xToL, yToP) === null)
  const thin = boxFocus({ x: 100, y: 100 }, { x: 110, y: 300 }, xToL, yToP)
  check('focus: a box narrower than three bars opens on three bars about its middle (never a view with no candles in it)', !!thin && thin.logical.to - thin.logical.from === FOCUS_MIN_BARS && Math.abs((thin.logical.from + thin.logical.to) / 2 - 10.5) < 1e-9)
  check('focus: a drawing\'s Focus aims at its own prices — a zone\'s edges, a fib\'s swing, a ±3% window around a level or a note, nothing for a vertical line',
    JSON.stringify(lineFocus(zone)) === JSON.stringify(padRange(400, 450)) && JSON.stringify(lineFocus(fib)) === JSON.stringify(padRange(100, 200)) &&
      Math.abs(lineFocus(h)!.from - 485) < 1e-9 && Math.abs(lineFocus(h)!.to - 515) < 1e-9 && lineFocus(vline) === null && !!lineFocus(note))
  const w1 = wheelScale({ from: 100, to: 200 }, 150, -100)
  const w2 = wheelScale({ from: 100, to: 200 }, 150, 100)
  const w3 = wheelScale({ from: 100, to: 200 }, 125, 100)
  check('focus: a wheel over the axis scales the range about the price under the pointer — tighter rolling up, wider rolling down, the pivot staying put; off the range it scales about the middle',
    !!w1 && w1.to - w1.from < 100 && Math.abs((150 - w1.from) / (w1.to - w1.from) - 0.5) < 1e-9 && !!w2 && w2.to - w2.from > 100 && Math.abs((150 - w2.from) / (w2.to - w2.from) - 0.5) < 1e-9 &&
      !!w3 && Math.abs((125 - w3.from) / (w3.to - w3.from) - 0.25) < 1e-9 && JSON.stringify(wheelScale({ from: 100, to: 200 }, 900, 100)) === JSON.stringify(wheelScale({ from: 100, to: 200 }, null, 100)) &&
      wheelScale({ from: 100, to: 200 }, 150, 0) === null && wheelScale({ from: 200, to: 100 }, 150, 1) === null)

  const a = [h]
  const b = [h, zone]
  const c = [h, zone, trend]
  let u = recordUndo(emptyUndo(), a)
  u = recordUndo(u, b)
  const back = undo(u, c)
  const back2 = back && undo(back.stacks, back.lines)
  const fwd = back2 && redo(back2.stacks, back2.lines)
  check('draw: undo walks back one edit at a time, redo walks forward, and a fresh edit ends the redo', !!back && back.lines === b && !!back2 && back2.lines === a && !!fwd && fwd.lines === b && undo(emptyUndo(), a) === null && recordUndo(back!.stacks, a).future.length === 0)

  const at = new Date(Date.UTC(2026, 9, 5, 14, 2, 59))
  check('share: the picture carries its UTC minute, a file name that says what it is, and the address it came from', shotTimeLabel(at) === '2026-10-05 14:02 UTC' && shareFileName('AAPL', '1D', at) === 'pantessa-aapl-1d-20261005-1402.png' && watermarkUrl('AAPL') === 'pantessa.com/t/AAPL' && watermarkUrl('AAPL', 'abc123def4') === 'pantessa.com/c/abc123def4')

  // The stamp: the last bar that had FULLY closed at the call.
  const callT = 10 * 3600 + 1800 // half past the tenth hour
  const hourly: Candle[] = Array.from({ length: 12 }, (_, i) => ({ t: i * 3600, o: 100 + i, h: 102 + i, l: 99 + i, c: 101 + i, v: 1 }))
  const stamp = stampFromBars(hourly, callT, '1h')
  check('call: the stamp is the close of the last bar that had fully closed at the call, never the bar the call was made inside', !!stamp && stamp.barT === 9 * 3600 && stamp.price === 110 && stamp.tf === '1h')
  check('call: a bar that closed exactly at the call is the stamp', stampFromBars(hourly, 10 * 3600, '1h')?.barT === 9 * 3600 && stampFromBars(hourly, 10 * 3600 - 1, '1h')?.barT === 8 * 3600)
  check('call: a tape with a hole at the call gives no stamp on a fine frame, and the daily frame bridges a weekend',
    stampFromBars(hourly.slice(0, 2), callT, '1h') === null && stampFromBars([], callT, '15m') === null && stampFromBars([{ t: 0, o: 1, h: 1, l: 1, c: 42, v: 0 }], 86400 * 3 + 3600, '1d')?.price === 42 && stampFromBars([{ t: 0, o: 1, h: 1, l: 1, c: 42, v: 0 }], 86400 * 9, '1d') === null)
  check('call: the move since the stamp is stated signed to two places, and a missing price is no move', fmtMove(movePct(100, 107.7)!) === '+7.70%' && fmtMove(movePct(100, 93)!) === '−7.00%' && movePct(0, 5) === null && movePct(5, 0) === null)
  check('call: one clock for every reader', fmtCallTime(Date.UTC(2026, 9, 5, 14, 2) / 1000) === 'Oct 5, 2026 · 14:02 UTC' && fmtSpan(45) === 'under a minute' && fmtSpan(12 * 60) === '12 min' && fmtSpan(3 * 86400 + 4 * 3600 + 60) === '3d 4h' && fmtSpan(7200) === '2h')
  check('call: a fill is placed before or after the stamp in words', fillTiming(1000, 1720).when === 'before' && fillTiming(1000, 1720).words === '12 min before the call' && fillTiming(9000, 1800).words === '2h after the call')

  check('call: a verified fill reads as side, dollars, venue and chain', fillWords({ side: 'buy', usd: 25, venue: 'Uniswap v3', chain: 'Base' }, 'ETH') === 'Bought $25.00 of ETH · Uniswap v3 · Base' && fillWords({ side: 'sell', usd: null, venue: 'CoW', chain: null }, 'AAPL') === 'Sold of AAPL · CoW' && fillWords({ side: 'buy', usd: 1234.5, venue: 'v', chain: null }, 'X') === 'Bought $1,235 of X · v')

  check('call: a one-press share is titled from the first thing its author labelled, else its line count, always within the post door\'s 3 to 120 characters',
    autoCallTitle('UNI', '1D', [{ id: 'a', kind: 'h', price: 3.27 }, { id: 'b', kind: 'trend', t1: 1, p1: 1, t2: 2, p2: 2, label: 'yeet line' }]) === 'UNI 1D: yeet line' && autoCallTitle('ETH', '4H', [note]) === 'ETH 4H: here' && autoCallTitle('ETH', '1D', [{ id: 'a', kind: 'h', price: 1 }]) === 'ETH 1D: 1 line on the chart' && autoCallTitle('ETH', '1D', [{ id: 'a', kind: 'h', price: 1, label: 'x'.repeat(80) }, zone]).length <= 120 && autoCallTitle('E', '1D', []).length >= 3)

  const tweet = new URL(callTweetHref({ id: 'abc123def4', symbol: 'AAPL', title: 'Breakout over 340', verified: true }))
  const plain = new URL(chartTweetHref('ETH', '1D'))
  check('call: the post on X is a cashtag, the claim, our handle and the call\'s own page; a plain chart share links the symbol page',
    tweet.origin === 'https://twitter.com' && tweet.searchParams.get('text')!.startsWith('$AAPL — Breakout over 340') && /position verified on-chain/.test(tweet.searchParams.get('text')!) && /@askPantessa:$/.test(tweet.searchParams.get('text')!) && !/#/.test(tweet.searchParams.get('text')!) && /\/c\/abc123def4$/.test(tweet.searchParams.get('url')!) && /\/t\/ETH$/.test(plain.searchParams.get('url')!) && !/verified/.test(new URL(callTweetHref({ id: 'x', symbol: 'ETH', title: 't' })).searchParams.get('text')!))
  const auto = new URL(callTweetHref({ id: 'abc123def4', symbol: 'UNI', title: 'UNI 1D: yeet line' })).searchParams.get('text')!
  check('call: the post on X opens with the cashtag exactly once (a title that already leads with the ticker is not given it twice), and never with a mention', auto.startsWith('$UNI 1D: yeet line') && (auto.match(/\$UNI/g) ?? []).length === 1 && !/^@/.test(auto) && new URL(chartTweetHref('ETH', '1D')).searchParams.get('text')!.startsWith('$ETH '))
  check('call: a long claim is cut to fit the post, never the link', new URL(callTweetHref({ id: 'abc123def4', symbol: 'AAPL', title: 'x'.repeat(400) })).searchParams.get('text')!.length < 280)

  // The order ticket composes only sentences the venue map already offers.
  const uni = chartPairFor('UNI')!
  const aapl = chartPairFor('AAPL')!
  const hype = chartPairFor('HYPE')!
  const mkt = composeTicket({ symbol: 'UNI', pair: uni, side: 'buy', mode: 'market', usd: 25, price: null, last: 8.9 })
  const sell = composeTicket({ symbol: 'UNI', pair: uni, side: 'sell', mode: 'market', usd: 25, price: null, last: 8.9 })
  const lim = composeTicket({ symbol: 'UNI', pair: uni, side: 'buy', mode: 'limit', usd: 25, price: 3.27, last: 8.9 })
  const wrongSide = composeTicket({ symbol: 'UNI', pair: uni, side: 'buy', mode: 'limit', usd: 25, price: 12, last: 8.9 })
  const stock = composeTicket({ symbol: 'AAPL', pair: aapl, side: 'buy', mode: 'market', usd: 12, price: null, last: 336 })
  const perp = composeTicket({ symbol: 'HYPE', pair: hype, side: 'sell', mode: 'market', usd: 20, price: null, last: 40 })
  check('ticket: market buy / sell and a stock buy are the venue map\'s own sentences', mkt.ok && mkt.ask === 'Buy $25 of UNI on Ethereum' && sell.ok && sell.ask === 'Sell $25 of UNI on Ethereum' && stock.ok && stock.ask === 'Buy $12 of AAPL')
  check('ticket: a limit under the market is a resting CoW buy at that price, and a buy limit over the market is refused by name', lim.ok && /^limit order: buy [\d.]+ UNI for at most [\d.]+ USDC on Ethereum$/.test(lim.ask) && !wrongSide.ok && /UNDER the market/.test(wrongSide.reason))
  check('ticket: a perp-only symbol reads Long/Short and a sell opens a short', ticketShape('HYPE', hype, 40).sides.sell === 'Short' && ticketShape('UNI', uni, 8.9).sides.buy === 'Buy' && perp.ok && /short/i.test(perp.ask))
  check('ticket: a stock has no resting limit; a size outside $1–$100,000 is refused; cents only under $10', !ticketShape('AAPL', aapl, 336).limit && ticketShape('UNI', uni, 8.9).limit && !composeTicket({ symbol: 'UNI', pair: uni, side: 'buy', mode: 'market', usd: 0.5, price: null, last: 8.9 }).ok && cleanUsd(5.555) === 5.56 && cleanUsd(25.6) === 26 && cleanUsd(1e9) === null)
  check('ticket: the limit price opens on the call\'s nearest level under the market for a buy, over it for a sell, else 1% off', defaultLimitPrice([{ id: 'a', kind: 'h', price: 3.27 }, { id: 'b', kind: 'zone', p1: 10, p2: 12 }, { id: 'c', kind: 'h', price: 7 }], 'buy', 8.9) === 7 && defaultLimitPrice([{ id: 'b', kind: 'zone', p1: 10, p2: 12 }], 'sell', 8.9) === 10 && defaultLimitPrice([], 'buy', 100) === 99 && defaultLimitPrice([], 'buy', null) === null)

  const daily: Candle[] = Array.from({ length: 80 }, (_, i) => ({ t: i * 86400, o: 100 + i, h: 103 + i, l: 98 + i, c: 101 + i, v: 1 }))
  const svg = callCardSvg(daily, stateOf([{ id: 'a', kind: 'h', price: 170 }, { id: 'far', kind: 'h', price: 5000 }, zone]), 70 * 86400, { width: 1072, height: 232, up: '#0f0', down: '#f00', grid: '#111', ink: '#fff', accent: '#0f0', sell: '#f00' })
  check('call card: the tape is drawn with the call\'s lines and a rule on the day of the call; a level far off the tape is left off instead of flattening it',
    svg.startsWith('<svg') && (svg.match(/<rect /g) ?? []).length === 70 && /stroke-dasharray="3 7"/.test(svg) && (svg.match(/stroke-dasharray="8 6"/g) ?? []).length === 1 && !/NaN|Infinity/.test(svg))
  check('call card: a short tape draws the empty grid, and a call older than the tape draws no rule', !/<rect /.test(callCardSvg([], null, 0, { width: 10, height: 10, up: '', down: '', grid: '', ink: '', accent: '', sell: '' })) && !/stroke-dasharray="3 7"/.test(callCardSvg(daily, null, -86400 * 30, { width: 1072, height: 232, up: '', down: '', grid: '', ink: '', accent: '', sell: '' })))
}

if (process.argv[1]?.endsWith('chart-calls-pins.ts')) {
  let failed = 0
  chartCallsPins((name, ok, extra) => {
    if (!ok) failed++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
  })
  console.log(failed ? `\n${failed} failed` : '\nall chart-calls pins green')
  process.exit(failed ? 1 : 0)
}
