// Pins for the Tape view on /t/<sym> (lib/chart-tape, 2026-10-20): the venue
// rows (taker side from each venue's own wire), the Dune rows, the merge,
// the perp handoff, the strip, the row's button, the view's URL, and the
// wiring. Pure: no server, no socket, no DB. Called from scripts/test-api.ts,
// and runnable alone:
//   npx tsx scripts/chart-tape-pins.ts
import { readFileSync } from 'node:fs'
import { followRow, mergeTapeRows, rowFromFill, rowsFromVenue, tapeSourceWords, tapeSummary, venueBefore, type ChartTapeRow } from '../lib/chart-tape'
import { printFromCoinbase, printFromHl } from '../lib/venue-trades'
import { parseViewParam, viewUrl } from '../lib/markets'
import type { TapeFill } from '../lib/tape'

type Check = (name: string, ok: boolean, extra?: string) => void

const N = 1_792_000_000_000
const fill = (o: Partial<TapeFill>): TapeFill => ({ id: '1', market: 'HYPE', side: 'buy', size: 2, price: 40, usd: 80, at: N, taker: null, maker: null, hash: null, effect: null, block: null, source: 'dune', venue: 'hyperliquid', chainId: null, ...o })

export function chartTapePins(check: Check): void {
  check('chart tape: Coinbase names the MAKER side (the taker took the other); Hyperliquid names the aggressor (B bought, A sold); no side stays unsaid',
    printFromCoinbase({ price: '7.1', size: '1', time: '2026-10-20T09:29:00Z', side: 'sell' })?.side === 'buy' &&
      printFromCoinbase({ price: '7.1', size: '1', time: '2026-10-20T09:29:00Z', side: 'buy' })?.side === 'sell' &&
      printFromCoinbase({ price: '7.1', size: '1', time: '2026-10-20T09:29:00Z' })?.side === undefined &&
      printFromHl({ px: '42', sz: '1', time: N, side: 'B' })?.side === 'buy' && printFromHl({ px: '42', sz: '1', time: N, side: 'A' })?.side === 'sell')

  check('chart tape: a Coinbase print follows as the chainless spot buy, a Hyperliquid print as the perp; a stock pair lists nothing',
    (() => {
      const cb = rowsFromVenue([{ at: N, price: 7, size: 10, side: 'buy' }], { symbol: 'UNI', source: 'coinbase', pair: 'UNI-USD' })
      const hl = rowsFromVenue([{ at: N, price: 40, size: 1, side: 'sell' }], { symbol: 'HYPE', source: 'hyperliquid', pair: 'HYPE' })
      return cb[0].usd === 70 && cb[0].tag === 'COINBASE' && followRow(cb[0])?.ask === 'Buy $25 of UNI' &&
        hl[0].tag === 'HL' && followRow(hl[0])?.ask === 'Short $25 of HYPE on Hyperliquid' &&
        rowsFromVenue([{ at: N, price: 7, size: 1 }], { symbol: 'AAPL', source: 'robinhood' as never, pair: 'AAPL' }).length === 0
    })())

  check('chart tape: a spot SELL and a sideless row offer no button (a sell needs a holding; nothing is guessed)',
    followRow({ market: 'UNI', side: 'sell', venue: 'dex', chainId: null }) === null && followRow({ market: 'UNI', side: null, venue: 'dex', chainId: null }) === null)

  check('chart tape: a Dune print keeps its venue tag and its own id space; a zero price is dropped',
    rowFromFill(fill({ id: 'x' }))?.id === 'd:x' && rowFromFill(fill({ venue: 'dex', chainId: 8453, market: 'WETH' }))?.tag !== undefined && rowFromFill(fill({ price: 0 })) === null)

  check('chart tape: the merge is newest first, one row per id, capped',
    (() => {
      const a = rowsFromVenue([{ at: N, price: 1, size: 1, side: 'buy' }, { at: N + 2, price: 1, size: 1, side: 'buy' }], { symbol: 'UNI', source: 'coinbase', pair: 'UNI-USD' })
      const b = rowsFromVenue([{ at: N + 2, price: 1, size: 1, side: 'buy' }, { at: N + 1, price: 2, size: 1, side: 'sell' }], { symbol: 'UNI', source: 'coinbase', pair: 'UNI-USD' })
      const m = mergeTapeRows(a, b)
      return m.length === 3 && m[0].at === N + 2 && m[2].at === N && mergeTapeRows(a, b, 2).length === 2
    })())

  check('chart tape: on a perp, once Dune prints, a venue row at or after its first print is the same trade twice and goes',
    (() => {
      const v = rowsFromVenue([{ at: N - 1, price: 1, size: 1, side: 'buy' }, { at: N, price: 1, size: 1, side: 'buy' }], { symbol: 'HYPE', source: 'hyperliquid', pair: 'HYPE' })
      const d = rowFromFill(fill({ at: N })) as ChartTapeRow
      const kept = venueBefore([...v, d], N)
      return kept.length === 2 && kept.some((r) => r.from === 'dune') && venueBefore(v, null).length === 2
    })())

  check('chart tape: the strip counts the window, splits the sided dollars, names the largest',
    (() => {
      const rows = rowsFromVenue([{ at: N, price: 10, size: 3, side: 'buy' }, { at: N, price: 10, size: 1, side: 'sell' }, { at: N, price: 10, size: 9 }, { at: N - 10 * 60_000, price: 10, size: 100, side: 'sell' }], { symbol: 'UNI', source: 'coinbase', pair: 'UNI-USD' })
      const s = tapeSummary(rows, N)
      return s.count === 3 && s.buyUsd === 30 && s.sellUsd === 10 && s.buyShare === 0.75 && s.largest?.usd === 90 && tapeSummary([], N).buyShare === null
    })())

  check('chart tape: the foot names every source on screen',
    (() => {
      const v = rowsFromVenue([{ at: N, price: 1, size: 1, side: 'buy' }], { symbol: 'UNI', source: 'coinbase', pair: 'UNI-USD' })
      const d = rowFromFill(fill({})) as ChartTapeRow
      return tapeSourceWords(v, null, 'Coinbase') === 'Coinbase trades' && tapeSourceWords([d], 'DEX prints', 'Coinbase') === 'Dune · DEX prints' && tapeSourceWords([d, ...v], 'DEX prints', 'Coinbase') === 'Coinbase trades + Dune · DEX prints'
    })())

  check('chart tape: ?view=tape opens the Tape and rides a share link; leaving it clears it',
    parseViewParam('?view=tape') === 'tape' && viewUrl('tape', null, '/t/UNI', '?tf=1h') === '/t/UNI?tf=1h&view=tape' && viewUrl('candles', null, '/t/UNI', '?view=tape') === '/t/UNI' && viewUrl('tape', null, '/t/UNI', '?view=depth&win=10') === '/t/UNI?view=tape')

  check('chart tape: wired — the switch offers Tape beside Depth, the stream feeds it, the chips go through canTradeAsk',
    (() => {
      const src = readFileSync('components/markets/chart/MarketChart.tsx', 'utf8')
      const view = readFileSync('components/markets/chart/TapeView.tsx', 'utf8')
      return /switchView\('tape'\)/.test(src) && /tapePrintRef\.current\?\.\(batch\)/.test(src) && /depthOn \|\| tapeOn/.test(src) && /canAsk=\{\(ask\) => canTradeAsk\(ask, tradable\)\}/.test(src.slice(src.indexOf('<TapeView'))) &&
        /followRow\(r\)/.test(view) && /canAsk\(chip\.ask\)/.test(view)
    })())
}

if (process.argv[1]?.endsWith('chart-tape-pins.ts')) {
  let failed = 0
  chartTapePins((name, ok, extra) => {
    if (!ok) failed++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
  })
  console.log(failed ? `\n${failed} failed` : '\nall chart tape pins green')
  process.exit(failed ? 1 : 0)
}
