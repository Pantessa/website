// THE HEATMAP VIEW — pins (2026-11-10). Nate on /t/TSLA and /t/UNI: "remove the
// dune tape and make the graph larger (higher) … for the ones with a heatmap
// replace the Tape bar with heatmap". The executions strip under the candles is
// gone; the year of positioning is a chart view (`?view=heat`) that takes the
// Tape's seat on the switch wherever the coin has a year to show; the candles
// keep the whole card. Live (`--live`, BASE=…): the served page agrees.
//
//   npx tsx scripts/chart-heat-pins.ts
//   BASE=http://localhost:3000 npx tsx scripts/chart-heat-pins.ts --live
import { existsSync, readFileSync } from 'node:fs'
import { parseViewParam, viewUrl } from '../lib/markets'

type Check = (name: string, ok: boolean, extra?: string) => void

export function chartHeatPins(check: Check): void {
  check('chart heat: ?view=heat opens the Heatmap and rides a share link; leaving it clears it; ?view=tape still opens the Tape',
    parseViewParam('?view=heat') === 'heat' && viewUrl('heat', null, '/t/UNI', '?tf=1h') === '/t/UNI?tf=1h&view=heat' && viewUrl('candles', null, '/t/UNI', '?view=heat') === '/t/UNI' && parseViewParam('?view=tape') === 'tape')
  const chart = readFileSync('components/markets/chart/MarketChart.tsx', 'utf8')
  const heat = readFileSync('components/markets/chart/PositionHeat.tsx', 'utf8')
  const css = readFileSync('components/markets/markets.css', 'utf8')
  check('chart heat: the Dune executions strip is gone — no component, no lib, no sink on the relay stream, no row under the candles',
    !existsSync('components/markets/chart/ExecutionsStrip.tsx') && !existsSync('lib/exec-strip.ts') && !chart.includes('stripPrintRef') && !chart.includes('stripOn') && !chart.includes('poshet-row') && !chart.includes('ExecutionsStrip'))
  check('chart heat: the switch offers Heatmap where a coin has a year (never a tokenized stock or a builder-market perp) and the Tape keeps its seat everywhere else',
    /heatCandidate = battlefield && !!pair && pair\.source !== 'robinhood' && !isHip3Pair\(pair\)/.test(chart) && /switchView\('heat'\)/.test(chart) && /\(!heatTab \|\| view === 'tape'\)/.test(chart) && /heatOn && pair && <HeatView year=\{heatYear\}/.test(chart))
  check('chart heat: the year is read once (the chart\'s hook feeds the view) and the view has no collapse of its own',
    /export default function HeatView\(\{ year, mark \}/.test(heat) && !heat.includes('localStorage') && /useHeatYear\(pair\?\.symbol \?\? symbol, heatCandidate\)/.test(chart))
  check('chart heat: the candles take the card — the desktop card is the height the strip used to share, all of it chart; a phone\'s plot grows 260 → 320',
    css.includes('.sym .tchart:not(.tchart--expanded) { height: clamp(520px, 76dvh, 820px); }') && css.includes('.mkt-chart__canvas { flex: 0 0 auto; height: 320px; }') && !css.includes('.poshet.is-open'))
}

export async function chartHeatLivePins(check: Check, base: string): Promise<void> {
  const [uni, aapl] = await Promise.all([fetch(`${base}/t/UNI`), fetch(`${base}/t/AAPL`)])
  const [uniHtml, aaplHtml] = await Promise.all([uni.text(), aapl.text()])
  check('chart heat live: /t/UNI serves the Heatmap on the switch in the Tape\'s seat and no executions table',
    uni.status === 200 && uniHtml.includes('<span>Heatmap</span>') && !uniHtml.includes('<span>Tape</span>') && !uniHtml.includes('UNI executions') && !uniHtml.includes('poshet-row'), `${uni.status}`)
  check('chart heat live: /t/AAPL (a tokenized stock, no positioning year) offers no Heatmap and no executions table',
    aapl.status === 200 && !aaplHtml.includes('<span>Heatmap</span>') && !aaplHtml.includes('AAPL executions'), `${aapl.status}`)
}

if (process.argv[1]?.endsWith('chart-heat-pins.ts')) {
  let failed = 0
  const check: Check = (name, ok, extra) => {
    if (!ok) failed++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
  }
  chartHeatPins(check)
  const done = process.argv.includes('--live') ? chartHeatLivePins(check, process.env.BASE ?? 'http://localhost:3000') : Promise.resolve()
  done.then(() => {
    console.log(failed ? `\n${failed} failed` : '\nall chart heat pins green')
    process.exit(failed ? 1 : 0)
  })
}
