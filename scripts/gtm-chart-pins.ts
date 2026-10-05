// Pins for the GTM chart lane (squad-gtm-2026-10-05): the on-plot readout, the
// price a "+" drops a level at, the Live button's rule and the chart's keys
// (lib/chart-legend). Pure: no server, no chain, no DB.
//   npx tsx scripts/gtm-chart-pins.ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Candle, ChartTf } from '../lib/charts'
import { CHART_TFS } from '../lib/charts'
import { awayFromLive, chartKey, fmtLegendPct, fmtLegendTime, fmtLegendVol, legendOf, tidyPrice, zoomedFrom } from '../lib/chart-legend'
import { composeLineActions } from '../lib/chart-actions'

type Check = (name: string, ok: boolean, extra?: string) => void

export function gtmChartPins(check: Check): void {
  const bars: Candle[] = [
    { t: 1000, o: 100, h: 110, l: 95, c: 105, v: 1200 },
    { t: 2000, o: 106, h: 108, l: 99, c: 100, v: 0 },
    { t: 3000, o: 100, h: 103, l: 100, c: 102, v: 48_200_000 },
  ]
  const lastRead = legendOf(bars, null)
  check('legend: with nothing hovered it reads the newest bar, and says it is live', !!lastRead && lastRead.t === 3000 && lastRead.live && lastRead.c === 102)
  check('legend: the move is close over the PREVIOUS close (102 vs 100 = +2%), not over the bar\'s open', !!lastRead && Math.abs(lastRead.chgPct - 2) < 1e-9 && lastRead.chg === 2)
  const mid = legendOf(bars, 2000)
  check('legend: a hovered bar reads its own O/H/L/C and is not live', !!mid && mid.o === 106 && mid.h === 108 && mid.l === 99 && mid.c === 100 && !mid.live)
  check('legend: the color follows the candle body (close under open = down) even when the previous close says otherwise', !!mid && mid.dir === 'down' && Math.abs(mid.chgPct - (-5 / 105) * 100) < 1e-9)
  check('legend: a bar with no volume prints no volume (never "Vol 0")', !!mid && mid.vol === null && lastRead!.vol === 48_200_000)
  const first = legendOf(bars, 1000)
  check('legend: the first held bar has no previous close, so its move is open to close', !!first && first.chg === 5 && Math.abs(first.chgPct - 5) < 1e-9)
  check('legend: a time no bar carries falls back to the newest bar; no bars, no legend', legendOf(bars, 1234)?.t === 3000 && legendOf([], null) === null)
  check('legend: percent wears a sign and a real minus, zero wears neither', fmtLegendPct(1.239) === '+1.24%' && fmtLegendPct(-0.664) === '−0.66%' && fmtLegendPct(0.001) === '0.00%' && fmtLegendPct(-0.001) === '0.00%')
  check('legend: volume in three significant digits', fmtLegendVol(48_200_000) === '48.2M' && fmtLegendVol(1234) === '1.23K' && fmtLegendVol(999) === '999' && fmtLegendVol(2.5e9) === '2.5B')
  check('legend: a daily bar reads a date, an intraday bar its UTC minute', fmtLegendTime(Date.UTC(2026, 9, 5) / 1000, '1d') === 'Oct 5, 2026' && fmtLegendTime(Date.UTC(2026, 9, 5, 14) / 1000, '1h') === 'Oct 5 14:00 UTC')

  check('plus: a price off a pixel is cut to what the axis prints', tidyPrice(2650.3718264) === 2650 && tidyPrice(333.6871) === 333.69 && tidyPrice(0.123456) === 0.1235 && tidyPrice(0.000123456) === 0.000123)
  check('plus: no level at a price an order cannot carry', tidyPrice(0) === null && tidyPrice(-4) === null && tidyPrice(NaN) === null && tidyPrice(null) === null)
  // What the "+" opens is the level's own offers: every one is a sentence with the tidy price in it or a market ask.
  const offers = composeLineActions({ symbol: 'ETH', source: 'coinbase', price: tidyPrice(2400.4321)!, last: 2700, usd: 25 })
  check('plus: a level under the price on a coin offers a resting limit buy, sized so its price is the level', offers.some((o) => { const m = /buy ([\d.]+) ETH for at most (\d+) USDC/.exec(o.action.ask); return o.action.kind === 'limit' && !!m && Math.abs(Number(m[2]) / Number(m[1]) - 2400.43) < 3 }), offers.map((o) => o.action.ask).join(' | '))

  check('live: the newest bar on screen (with the right offset) is live', !awayFromLive(183, 180) && !awayFromLive(178.4, 180))
  check('live: more than a bar past the right edge is away; no view or no bars is never away', awayFromLive(150, 180) && awayFromLive(177.9, 180) && !awayFromLive(null, 180) && !awayFromLive(10, 0))

  const frames = CHART_TFS.map((t) => t.key) as ChartTf[]
  const k = (key: string, mod: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => chartKey({ key, ...mod }, frames, 100)
  const one = k('1')
  const lastFrame = k(String(frames.length))
  check('keys: 1..n pick the chart\'s own frames in order; a number past the list does nothing', one?.kind === 'tf' && one.tf === frames[0] && lastFrame?.kind === 'tf' && lastFrame.tf === frames[frames.length - 1] && k(String(frames.length + 1)) === null)
  const left = k('ArrowLeft')
  const farRight = k('ArrowRight', { shiftKey: true })
  check('keys: the arrows walk about an eighth of the screen, Shift four times that', left?.kind === 'pan' && left.bars === -12 && farRight?.kind === 'pan' && farRight.bars === 48)
  check('keys: + and - zoom, L and End return to the newest bar', k('+')?.kind === 'zoom' && k('=')?.kind === 'zoom' && (k('-') as { factor: number }).factor > 1 && k('l')?.kind === 'live' && k('End')?.kind === 'live')
  check('keys: Cmd/Ctrl/Alt chords are never the chart\'s (undo, browser zoom, tab switch stay theirs)', k('z', { metaKey: true }) === null && k('-', { ctrlKey: true }) === null && k('1', { metaKey: true }) === null && k('ArrowLeft', { altKey: true }) === null)
  check('keys: the up and down arrows, space and letters stay the page\'s', k('ArrowUp') === null && k('ArrowDown') === null && k(' ') === null && k('b') === null)
  check('keys: a zoom holds the right edge and never leaves fewer than 12 bars', zoomedFrom(80, 180, 0.8) === 100 && zoomedFrom(170, 180, 0.8) === 168 && zoomedFrom(80, 180, 1.25) === 55)

  // Source fences: the things a refactor must not drop.
  const src = readFileSync(join(__dirname, '..', 'components/markets/chart/MarketChart.tsx'), 'utf8')
  check('fence: the TradingView attribution notice is still in the chart footer', src.includes('Charts by TradingView Lightweight Charts') && src.includes('© 2025 TradingView, Inc.') && src.includes('https://www.tradingview.com/'))
  check('fence: the "+" drops a plain level (no action attached): the offers stay the gated popover\'s', /edit\(\[\.\.\.linesRef\.current, \{ id, kind: 'h', price \}\]\)/.test(src))
  check('fence: the chart keys ignore typing targets and act only on the hovered chart', src.includes("target.isContentEditable") && src.includes('if (!overRef.current || e.defaultPrevented) return'))
}

if (require.main === module) {
  let pass = 0
  let fail = 0
  gtmChartPins((name, ok, extra) => {
    if (ok) pass++
    else fail++
    console.log(`${ok ? '✅' : '❌'} ${name}${!ok && extra ? ` — ${extra}` : ''}`)
  })
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
