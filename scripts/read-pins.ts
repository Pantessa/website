// Pins for THE READ (lib/read + lib/read-server + components/home/TheRead,
// 2026-11-09): the home's lead — the market as one sentence, the macro line,
// the chart of the pick. The rules are pure, so most of this file runs with
// no server: the instruments, the verb ladder at its edges, the headline's
// choice and words, the movers, the numbers, the chart's geometry, the index
// quote's session arithmetic on a fixture, and the wiring (the seats, ISR,
// the gates, no stream on `/`, the battle views off the nav, the old deck
// links forwarded). `readServedPins` reads a running server.
//
//   npx tsx scripts/read-pins.ts                              # the pure half
//   BASE=http://localhost:4410 npx tsx scripts/read-pins.ts   # + the served half
import { readFileSync } from 'node:fs'
import nextConfig from '../next.config'
import { LIVE_VIEWS, liveTabsFor } from '../lib/battle'
import { chartPairFor, isChartOnlyPair } from '../lib/charts'
import { quickActs } from '../lib/symbol-venues'
import { canTradeAsk } from '../lib/trade-venue-gate'
import { pickSheetBlurb } from '../lib/arena'
import {
  EMPTY_READ,
  READ_APP_SYMBOLS,
  READ_DEFAULT_ID,
  READ_DEFAULT_RANGE,
  READ_HEADLINE_CLAUSES,
  READ_IDS,
  READ_INSTRUMENTS,
  READ_MOVER_FLOOR_PCT,
  READ_MOVER_POOL,
  READ_MOVERS_MAX,
  READ_RANGES,
  READ_SERIES_MAX_POINTS,
  READ_VERB_EDGES,
  READ_WAITING,
  fmtReadAmount,
  fmtReadChange,
  fmtReadValue,
  fmtReadValueFull,
  parseReadId,
  parseReadRange,
  rankReadMovers,
  readBasisWords,
  readChart,
  readHeadline,
  readHeadlineText,
  readInstrument,
  readNoActLine,
  readOwnPair,
  readPageHref,
  readPointAt,
  readQuoteOf,
  readScore,
  readSeriesChange,
  readSpark,
  readTileTag,
  readTone,
  readVenueLine,
  readVerb,
  thinReadPoints,
  type ReadId,
  type ReadPoint,
  type ReadQuote,
  type ReadSnapshot,
} from '../lib/read'
import { indexQuoteOf, READ_DAY_BARS } from '../lib/read-server'
import {
  DESK_ALERT_PCT,
  DESK_FILL_TO,
  DESK_LIMIT_PCT,
  DESK_MACRO_ITEMS,
  DESK_TILES_MAX,
  READ_DESK_DEFAULT,
  READ_DESK_SERVER_SYMBOLS,
  deskActs,
  deskActsFor,
  deskBackdrop,
  deskBreadth,
  deskFetchSymbols,
  deskHeadline,
  deskHeadlineText,
  deskItemFor,
  deskLevelSpecs,
  deskMovers,
  deskPlan,
  deskQuote,
  deskScaleAlso,
  fmtDeskValue,
  parseDeskMemory,
  placeDeskLevels,
} from '../lib/read-desk'
import { DEFAULT_ALERT_PCT } from '../lib/pick-alerts'
import { readPost, xIntentHref } from '../lib/share-posts'

type Check = (name: string, ok: boolean, extra?: string) => void

const src = (p: string) => readFileSync(p, 'utf8')
/** A source file with its comments stripped: a pin on what the code DOES never matches what a header says. */
const code = (p: string) => src(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')

const NOW = Date.UTC(2026, 10, 9, 15, 0, 0) // a Monday, 10:00 in New York

/** A quote that moved `chg` (percent, or bp for a yield) from `prev`. */
function q(id: ReadId, chg: number | null, last = 100): ReadQuote {
  const inst = readInstrument(id)
  const prev = chg == null ? null : inst.unit === 'yield' ? last - chg / 100 : last / (1 + chg / 100)
  return readQuoteOf(inst, last, prev, NOW, true, [[1, last * 0.99], [2, last]])!
}
const snap = (quotes: Partial<Record<ReadId, ReadQuote>>, movers: ReadSnapshot['movers'] = []): ReadSnapshot => ({ asOf: NOW, quotes, movers })

export function readPins(check: Check): void {
  // ── The instruments ───────────────────────────────────────────────────
  check(
    // RE-PINNED 2026-11-09 (hip3 orders): was "only bitcoin and ether take orders on themselves". The S&P 500, gold and oil are Hyperliquid `xyz:` builder-dex perps
    // and the order layer builds there now (lib/hl-dex), so the card offers their own Long / Short first — and still names the nearest fund (`near`) beside it.
    'read: nine instruments in tile order (S&P 500 · Nasdaq 100 · 10-yr yield · VIX · Dollar · Gold · Oil · Bitcoin · Ether); the app quotes five of them (SP500, GOLD, CL, BTC, ETH) and four are look-only index data; six can be a headline subject; the five the app quotes take orders on themselves (the three Hyperliquid builder-dex perps since the order layer builds there), and each of those three still names its nearest fund',
    READ_IDS.join() === 'spx,ndx,us10y,vix,dxy,gold,oil,btc,eth' &&
      READ_APP_SYMBOLS.join() === 'SP500,GOLD,CL,BTC,ETH' &&
      READ_INSTRUMENTS.filter((i) => i.source === 'index').map((i) => i.symbol).join() === '^NDX,^TNX,^VIX,DX-Y.NYB' &&
      READ_INSTRUMENTS.filter((i) => i.subject !== null).map((i) => `${i.id}:${i.subject}`).join() === 'spx:Stocks,us10y:Yields,dxy:The dollar,gold:Gold,oil:Oil,btc:Bitcoin' &&
      READ_INSTRUMENTS.filter((i) => i.direct).map((i) => i.id).join() === 'spx,gold,oil,btc,eth' &&
      READ_INSTRUMENTS.filter((i) => i.direct).map((i) => i.symbol).join() === READ_APP_SYMBOLS.join() &&
      READ_INSTRUMENTS.filter((i) => i.direct && i.near.length > 0).map((i) => `${i.id}:${i.near[0].symbol}`).join() === 'spx:SPY,gold:GLD,oil:USO' &&
      // The three state their own market, so the chips are composed from static facts: the browser on `/` holds no
      // live perp table (the server does), and chips the server rendered from it vanished at hydration.
      READ_INSTRUMENTS.filter((i) => i.coin).map((i) => `${i.id}:${i.coin}`).join() === 'spx:xyz:SP500,gold:xyz:GOLD,oil:xyz:CL' &&
      readOwnPair(readInstrument('spx'))?.pair === 'xyz:SP500' && readOwnPair(readInstrument('spx'))?.source === 'hyperliquid' && readOwnPair(readInstrument('btc')) === null && readOwnPair(readInstrument('vix')) === null &&
      !isChartOnlyPair(readOwnPair(readInstrument('gold'))) &&
      quickActs('SP500', readOwnPair(readInstrument('spx'))!).map((a) => a.ask).join('|') === '2x Long $25 of SP500 on Hyperliquid|2x Short $25 of SP500 on Hyperliquid' &&
      quickActs('CL', readOwnPair(readInstrument('oil'))!).every((a) => canTradeAsk(a.ask, {})) &&
      READ_INSTRUMENTS.every((i) => i.typical > 0 && i.label.length > 0 && i.name.length > 0) &&
      READ_DEFAULT_ID === 'spx' && parseReadId('gold') === 'gold' && parseReadId('nope') === null && parseReadId(null) === null,
  )
  check(
    // RE-PINNED 2026-11-09 (macro board): an index has a look-only chart page of its own now (lib/charts CHART_INDEXES) — the tile's door opens it; it used to have none.
    'read: every instrument has a chart page — an app instrument its symbol page, an index its look-only page under the symbol a trader types (^TNX → /t/US10Y, DX-Y.NYB → /t/DXY), and each of those resolves to a look-only pair on the same data symbol; every stand-in a look-only market offers a chip for is a stock listed here (SPY · QQQ · SHY · GLD · USO resolve to the stock tape), so the sentence it offers is one the app builds',
    readPageHref(readInstrument('spx')) === '/t/SP500' && readPageHref(readInstrument('btc')) === '/t/BTC' && readPageHref(readInstrument('us10y')) === '/t/US10Y' && readPageHref(readInstrument('vix')) === '/t/VIX' &&
      readPageHref(readInstrument('ndx')) === '/t/NDX' && readPageHref(readInstrument('dxy')) === '/t/DXY' &&
      READ_INSTRUMENTS.filter((i) => i.source === 'index').every((i) => { const p = chartPairFor((readPageHref(i) ?? '').slice(3)); return p?.source === 'index' && p.pair === i.symbol && p.label === i.name }) &&
      ['SPY', 'QQQ', 'SHY', 'GLD', 'USO'].every((s) => chartPairFor(s)?.source === 'robinhood') &&
      readInstrument('spx').near[0].symbol === 'SPY' && readInstrument('ndx').near[0].symbol === 'QQQ' && readInstrument('us10y').near[0].symbol === 'SHY' && readInstrument('gold').near[0].symbol === 'GLD' && readInstrument('oil').near[0].symbol === 'USO' &&
      readInstrument('vix').near.length === 0 && readInstrument('btc').near.length === 0,
  )

  // ── The quote ─────────────────────────────────────────────────────────
  const y = readQuoteOf(readInstrument('us10y'), 4.84, 4.86, NOW, true, [])
  const p = readQuoteOf(readInstrument('oil'), 110, 100, NOW, true, [])
  check(
    'read: a change is percent, except a yield, whose change is basis points (4.84% from 4.86% is −2 bp); no previous value → no change stated (never a guessed flat); a last that is not a positive number is no quote',
    !!y && Math.abs((y.chg as number) + 2) < 1e-9 && !!p && Math.abs((p.chg as number) - 10) < 1e-9 &&
      readQuoteOf(readInstrument('btc'), 100, null, NOW, true, [])?.chg === null && readQuoteOf(readInstrument('btc'), 100, 0, NOW, true, [])?.chg === null &&
      readQuoteOf(readInstrument('btc'), 0, 100, NOW, true, []) === null && readQuoteOf(readInstrument('btc'), Number.NaN, 100, NOW, true, []) === null,
  )

  // ── The verbs ─────────────────────────────────────────────────────────
  const v = (z: number) => readVerb(z)
  check(
    'read: the verb is the move over that market\'s own typical day — under a fifth of one nothing happened (hold steady, no amount), then edge up / slip, rise / fall from 0.6, jump / slump from 1.75; each edge belongs to the stronger word; a plural subject and a singular one take their own form',
    READ_VERB_EDGES.steady === 0.2 && READ_VERB_EDGES.edge === 0.6 && READ_VERB_EDGES.jump === 1.75 &&
      v(0.19).plural === 'hold steady' && v(-0.19).singular === 'holds steady' && v(0).tone === 'flat' && !v(0.1).amount &&
      v(0.2).plural === 'edge up' && v(0.59).singular === 'edges up' && v(0.6).plural === 'rise' && v(1.74).singular === 'rises' && v(1.75).plural === 'jump' && v(9).singular === 'jumps' &&
      v(-0.2).plural === 'slip' && v(-0.59).singular === 'slips' && v(-0.6).plural === 'fall' && v(-1.74).singular === 'falls' && v(-1.75).plural === 'slump' && v(-9).singular === 'slumps' &&
      v(0.3).tone === 'up' && v(-0.3).tone === 'down' && v(0.3).amount && v(-3).amount &&
      readScore(readInstrument('oil'), -4) === -2 && readScore(readInstrument('us10y'), 6) === 1 && readScore(readInstrument('spx'), null) === null,
  )
  check(
    'read: an amount is never signed (the verb is the sign) — one decimal under ten percent, none past it; a yield in basis points, "2 bp" not "2.0 bp"',
    fmtReadAmount(readInstrument('spx'), 0.94) === '0.9%' && fmtReadAmount(readInstrument('oil'), -4.12) === '4.1%' && fmtReadAmount(readInstrument('btc'), 12.4) === '12%' &&
      fmtReadAmount(readInstrument('us10y'), -2) === '2 bp' && fmtReadAmount(readInstrument('us10y'), 1.5) === '1.5 bp' && fmtReadAmount(readInstrument('us10y'), 12.4) === '12 bp',
  )

  // ── The headline ──────────────────────────────────────────────────────
  const day = snap({ spx: q('spx', 0.9), us10y: q('us10y', -1.2, 4.84), dxy: q('dxy', 0.02), gold: q('gold', 0.3), oil: q('oil', -4.1), btc: q('btc', -1.2), ndx: q('ndx', 3), vix: q('vix', -30), eth: q('eth', -9) })
  const noStocks = snap({ gold: q('gold', 0.3), oil: q('oil', -4.1), btc: q('btc', -1.2), dxy: q('dxy', 0.02) })
  check(
    'read: the headline leads with stocks when they are quoted, then the markets that surprised most by their own typical day, three clauses in all — "Stocks rise 0.9%, oil slumps 4.1%, bitcoin slips 1.2%." A tile-only market (the Nasdaq, the VIX, ether) is never a clause however far it moved',
    READ_HEADLINE_CLAUSES === 3 && readHeadlineText(readHeadline(day)) === 'Stocks rise 0.9%, oil slumps 4.1%, bitcoin slips 1.2%.' &&
      readHeadline(day).map((c) => `${c.id}:${c.tone}`).join() === 'spx:up,oil:down,btc:down' &&
      readHeadline(day, 9).every((c) => !['ndx', 'vix', 'eth'].includes(c.id)),
    readHeadlineText(readHeadline(day)),
  )
  check(
    'read: without stocks the line is the three biggest surprises, the first one capitalised ("Oil slumps 4.1%, bitcoin slips 1.2%, gold edges up 0.3%."); a market that held steady stands without a number ("Stocks hold steady."); a yield speaks in basis points ("Yields rise 8 bp."); "The dollar" is "the dollar" past the first clause',
    readHeadlineText(readHeadline(noStocks)) === 'Oil slumps 4.1%, bitcoin slips 1.2%, gold edges up 0.3%.' &&
      readHeadlineText(readHeadline(snap({ spx: q('spx', 0.05) }))) === 'Stocks hold steady.' &&
      readHeadlineText(readHeadline(snap({ us10y: q('us10y', 8, 4.84) }))) === 'Yields rise 8 bp.' &&
      readHeadlineText(readHeadline(snap({ spx: q('spx', 0.4), dxy: q('dxy', 0.9) }))) === 'Stocks edge up 0.4%, the dollar jumps 0.9%.',
    readHeadlineText(readHeadline(noStocks)),
  )
  check(
    'read: a market with no stated change is never a clause, and neither is a CLOSED one (its change is a session that already ended — Friday\'s yields are not Sunday\'s news); no quote at all reads the waiting words (never a blank, never a guess); a tie keeps tile order',
    readHeadlineText(readHeadline(snap({ spx: q('spx', null), oil: q('oil', 2) }))) === 'Oil rises 2.0%.' &&
      readHeadlineText(readHeadline(snap({ spx: q('spx', 0.9), us10y: { ...q('us10y', 30, 4.84), live: false }, dxy: { ...q('dxy', 3), live: false }, btc: q('btc', -1.2) }))) === 'Stocks rise 0.9%, bitcoin slips 1.2%.' &&
      readHeadline(EMPTY_READ).length === 0 && readHeadlineText(readHeadline(EMPTY_READ)) === `${READ_WAITING}.` &&
      readHeadline(snap({ gold: q('gold', 1), oil: q('oil', 2) })).map((c) => c.id).join() === 'gold,oil',
  )

  // ── The movers ────────────────────────────────────────────────────────
  const ranked = rankReadMovers([{ symbol: 'A', chgPct: 1.49 }, { symbol: 'B', chgPct: -5.5 }, { symbol: 'C', chgPct: 4.2 }, { symbol: 'D', chgPct: null }, { symbol: 'E', chgPct: -3.9 }, { symbol: 'F', chgPct: 3.8 }, { symbol: 'G', chgPct: 2 }])
  check(
    'read: the movers are the biggest absolute moves at or past 1.5% among the household pool, largest first, four at most; an unquoted stock never ranks; the pool is unique tickers',
    READ_MOVER_FLOOR_PCT === 1.5 && READ_MOVERS_MAX === 4 && ranked.map((m) => m.symbol).join() === 'B,C,E,F' &&
      rankReadMovers([{ symbol: 'A', chgPct: 1.2 }, { symbol: 'D', chgPct: undefined }]).length === 0 &&
      new Set(READ_MOVER_POOL).size === READ_MOVER_POOL.length && READ_MOVER_POOL.every((s) => /^[A-Z]{1,5}$/.test(s)) && READ_MOVER_POOL.length >= 20,
  )

  // ── Numbers ───────────────────────────────────────────────────────────
  check(
    'read: a tile prints narrow ("7,445" · "101.85" · "4.84%" · "$74,587" · "$86.68"), the chart header full ("7,444.70" · "$74,587.25" · "4.841%"); a change is signed with a true minus ("+0.86%" · "−4.12%" · "−1.8 bp"); a missing number is a dash; a move inside the noise has no tone',
    fmtReadValue(readInstrument('spx'), 7444.7) === '7,445' && fmtReadValue(readInstrument('dxy'), 101.846) === '101.85' && fmtReadValue(readInstrument('us10y'), 4.841) === '4.84%' &&
      fmtReadValue(readInstrument('btc'), 74587.25) === '$74,587' && fmtReadValue(readInstrument('oil'), 86.68) === '$86.68' && fmtReadValue(readInstrument('oil'), null) === '—' &&
      fmtReadValueFull(readInstrument('spx'), 7444.7) === '7,444.70' && fmtReadValueFull(readInstrument('btc'), 74587.25) === '$74,587.25' && fmtReadValueFull(readInstrument('us10y'), 4.841) === '4.841%' &&
      fmtReadChange(readInstrument('spx'), 0.861) === '+0.86%' && fmtReadChange(readInstrument('oil'), -4.12) === '−4.12%' && fmtReadChange(readInstrument('us10y'), -1.8) === '−1.8 bp' && fmtReadChange(readInstrument('us10y'), 12.4) === '+12 bp' && fmtReadChange(readInstrument('spx'), null) === '—' &&
      readTone(0.2) === 'up' && readTone(-0.2) === 'down' && readTone(0.001) === 'flat' && readTone(null) === 'flat' && readTone(0.04, 'yield') === 'flat' && readTone(-0.5, 'yield') === 'down',
  )

  // ── Ranges ────────────────────────────────────────────────────────────
  const pts: ReadPoint[] = [[1, 100], [2, 104], [3, 102], [4, 110]]
  check(
    'read: four ranges (1D · 1W · 1M · 6M), 1D by default; a round-the-clock market states its last 24 hours, an index its move since the last close while it trades and its last session\'s move once closed; a longer range states its own first-to-last move (basis points for a yield)',
    READ_RANGES.map((r) => `${r.id}:${r.label}`).join() === '1d:1D,1w:1W,1m:1M,6m:6M' && READ_DEFAULT_RANGE === '1d' && parseReadRange('6m') === '6m' && parseReadRange('5y') === null &&
      readBasisWords(readInstrument('btc')) === 'in 24 hours' && readBasisWords(readInstrument('ndx'), '1d', true) === 'since the last close' && readBasisWords(readInstrument('ndx'), '1d', false) === 'in its last session' &&
      readBasisWords(readInstrument('ndx'), '1w') === 'over a week' && readBasisWords(readInstrument('btc'), '6m') === 'over six months' &&
      Math.abs((readSeriesChange(readInstrument('btc'), pts) as number) - 10) < 1e-9 &&
      Math.abs((readSeriesChange(readInstrument('us10y'), [[1, 4.4], [2, 4.83]]) as number) - 43) < 1e-6 && readSeriesChange(readInstrument('btc'), [[1, 5]]) === null,
  )

  // ── The chart's geometry ──────────────────────────────────────────────
  const c = readChart(pts, 100)!
  const flat = readChart([[1, 5], [2, 5], [3, 5]])
  const wide = readChart(pts, 90)!
  check(
    'read: the chart is drawn in a 1000×300 box by POINT ORDER (an index\'s overnight gap is not a flat line), the series inside it with air above and below, the baseline on the plot (a baseline outside the series widens the scale), a flat series still draws, fewer than two points draw nothing',
    c.line.startsWith('M0 ') && c.xs[c.xs.length - 1] === 1000 && c.xs.length === 4 && c.ys.every((yy) => yy > 0 && yy < 300) && c.ys[3] < c.ys[0] &&
      c.area.endsWith(' L1000 300 L0 300 Z') && c.min === 100 && c.max === 110 && c.baseY !== null && Math.abs(c.baseY - c.ys[0]) < 1e-9 &&
      wide.min === 90 && wide.baseY !== null && wide.baseY > wide.ys[0] && wide.baseY < 300 &&
      !!flat && flat.ys.every((yy) => Number.isFinite(yy)) && readChart([[1, 5]]) === null && readChart([]) === null && readChart(pts)!.baseY === null,
  )
  const long: ReadPoint[] = Array.from({ length: 1000 }, (_, i) => [i, 100 + Math.sin(i / 20)] as const)
  check(
    'read: a tile\'s sparkline is the same series thinned; a longer series is thinned to at most 240 points and always keeps its last; the pointer picks the nearest point and never leaves the series',
    readSpark(pts).startsWith('M0 ') && readSpark([[1, 5]]) === '' && readSpark(long).split('L').length <= 40 &&
      READ_SERIES_MAX_POINTS === 240 && thinReadPoints(long).length <= 240 && thinReadPoints(long)[thinReadPoints(long).length - 1][0] === 999 && thinReadPoints(pts).length === 4 &&
      readPointAt(pts, 0) === 0 && readPointAt(pts, 1) === 3 && readPointAt(pts, 0.5) === 2 && readPointAt(pts, 7) === 3 && readPointAt(pts, -2) === 0 && readPointAt([], 0.5) === null,
  )

  // ── Words ─────────────────────────────────────────────────────────────
  check(
    'read: the panel says whose number it is (a Hyperliquid market that never closes · Coinbase spot · delayed index data that closes with its exchange); a market nothing here stands in for is said to be here to read; a tile is tagged 24/7 for an app market, closed for an index outside its session, and nothing while an index trades',
    readVenueLine(readInstrument('gold')) === "Hyperliquid's round-the-clock Gold market." && readVenueLine(readInstrument('btc')) === 'Coinbase spot, round the clock.' && /delayed/.test(readVenueLine(readInstrument('us10y'))) &&
      readNoActLine(readInstrument('vix')) === 'Nothing listed here trades the VIX. It is here to read.' && readNoActLine(readInstrument('dxy')) === 'Nothing here trades it directly.' &&
      readTileTag(readInstrument('spx'), undefined) === '24/7' && readTileTag(readInstrument('ndx'), { ...q('ndx', 1), live: false }) === 'closed' && readTileTag(readInstrument('ndx'), q('ndx', 1)) === '' && readTileTag(readInstrument('ndx'), undefined) === '',
  )

  // ── The index quote's session arithmetic (a fixture in New York time) ──
  const D0 = Date.UTC(2026, 10, 6, 14, 30, 0) / 1000 // Fri 09:30 ET
  const D1 = Date.UTC(2026, 10, 9, 14, 30, 0) / 1000 // Mon 09:30 ET
  const bars = (start: number, closes: number[]) => closes.map((cl, i) => [start + i * 900, cl] as const)
  const fri = bars(D0, [100, 101, 102])
  const monFull = bars(D1, [103, 103.5, 104, 104.2, 104.1, 104.4, 104.6, 104.5, 104.5])
  const result = (rows: (readonly [number, number])[], price: number, at: number) => ({ meta: { regularMarketPrice: price, regularMarketTime: at, exchangeTimezoneName: 'America/New_York' }, timestamp: rows.map((r) => r[0]), indicators: { quote: [{ close: rows.map((r) => r[1]) }] } })
  const full = indexQuoteOf(readInstrument('ndx'), result([...fri, ...monFull], 104.5, D1 + 8 * 900), (D1 + 8 * 900) * 1000 + 60_000)
  const stub = indexQuoteOf(readInstrument('ndx'), result([...fri, ...bars(D1, [103, 103.5])], 103.5, D1 + 900), (D1 + 900) * 1000 + 60_000)
  const lone = indexQuoteOf(readInstrument('ndx'), result(monFull, 104.5, D1 + 8 * 900), (D1 + 8 * 900) * 1000 + 3 * 3_600_000)
  check(
    'read: an index quote is the venue\'s own price against the close of the session BEFORE the one it printed in, with that session\'s bars as "today"; a session that has just opened is drawn after the one before it (never a two-point stub); no earlier session → no change stated; a print older than twenty minutes is outside its session',
    !!full && Math.abs((full.chg as number) - (104.5 / 102 - 1) * 100) < 1e-9 && full.prev === 102 && full.points.length === 9 && full.live === true &&
      !!stub && stub.prev === 102 && stub.points.length === 5 && stub.points[0][1] === 100 &&
      !!lone && lone.chg === null && lone.live === false && READ_DAY_BARS === 96 &&
      indexQuoteOf(readInstrument('ndx'), {}, NOW) === null,
  )

  // ── The wiring ────────────────────────────────────────────────────────
  const home = code('components/home/HomeSurface.tsx')
  const page = code('app/page.tsx')
  const server = code('lib/read-server.ts')
  const route = code('app/api/markets/read/route.ts')
  const card = code('components/home/TheRead.tsx')
  const css = src('components/home/read.css')
  const deskSrc = code('lib/read-desk.ts')
  const index = code('components/markets/shell/MarketsIndex.tsx')
  check(
    'read: `/` seats THE READ in the lead seat after the sent-home notice (the live deck is not mounted on the splash), reads its snapshot at render THROUGH the data cache so the page stays ISR at one minute (the readers fetch no-store), and the route serves the same object with a short shared cache, a 400 by name for a bad parameter and never a 500',
    /<SentHomeNotice \/>\s*<TheRead initial=\{read\} \/>/.test(home) && !/Deck/.test(home) && /guide=\{<AppsRow \/>\}/.test(home) &&
      /export const revalidate = 60/.test(page) && /readSnapshotForRender\(\)/.test(page) && /<HomeSurface trending=\{trending\} tradable=\{tradable\} read=\{read\} tour=\{tour\} called=\{called\.summaries\.length \? <CalledShelf data=\{called\} \/> : undefined\} suggest=\{<SuggestionsBoard data=\{suggestions\} \/>\} \/>/.test(page) && // RE-PINNED 2026-11-10 (landing): the page hands the tour's snapshot beside the read's. RE-PINNED 2026-11-17 (harness-zero): + the Called it shelf (#1075, only when it has records) and the suggestions board
     
      /unstable_cache\(async \(\) => readSnapshot\(\), \['read-snapshot-v2'\], \{ revalidate: 60 \}\)/.test(server) &&
      /const snapshot = await readSnapshot\(\)/.test(route) && /s-maxage=20/.test(route) && /status: 400/.test(route) && !/status: 500/.test(route) && /export const dynamic = 'force-dynamic'/.test(route),
  )
  check(
    'read: the card opens NO stream and fires no turn — it re-reads one cached route while the tab is in view, every chip is gated by the measured venue verdicts and goes through the connect-to-act door into the ask door\'s sheet, a builder-market perp is offered as a chart (never an order the app cannot build), and every link out is the app\'s own door',
    !/WebSocket|EventSource|connectTape|openDuneTape|openHlTape/.test(card) && !/fetch\(['"`]\/api\/chat/.test(card) &&
      /if \(document\.visibilityState !== 'visible'\) return/.test(card) && /fetch\('\/api\/markets\/read', \{ cache: 'no-store' \}\)/.test(card) &&
      // RE-PINNED 2026-11-20 (the desk): the acts are composed in lib/read-desk (deskActs / deskActsFor) from the routes table, each passed by the card's own
      // gate (the measured venue verdicts); the card hands that gate down and sends what comes back through the same door.
      /const canAct = useCallback\(\(ask: string\) => canTradeAsk\(ask, tradable\), \[tradable\]\)/.test(card) && /deskActs\(item, last, hasQuote, canAct\)/.test(card) &&
      /rows\.find\(\(r\) => r\.kind === kind && r\.side === side && canAct\(r\.ask\)\)/.test(deskSrc) &&
      /useConnectToAct\(\{ run, redirectFor: promptHref \}\)/.test(card) && /openDoor\(ask, \{ send: true, mcps: askAppSlugs\(ask\) \}\)/.test(card) &&
      // RE-PINNED 2026-11-09 (hip3 orders): the bar is lib/charts isChartOnlyPair (a builder dex the order layer does NOT build on), and an instrument that takes
      // orders on itself is offered FIRST with every one of its chips, the nearest listed thing after it with one.
      // RE-PINNED 2026-11-20 (the desk): the same rule, one file over (lib/read-desk deskActs). A token, a stock or a perp is its own only target.
      /const found = pair && !isChartOnlyPair\(pair\) \? deskActsFor\(n\.symbol, pair, own \? last : null, canAct\) : \[\]/.test(deskSrc) &&
      /const targets: readonly ReadNear\[\] = inst \? \(inst\.direct \? \[\{ symbol: inst\.symbol, as: '' \}, \.\.\.inst\.near\] : inst\.near\) : \[\{ symbol: item\.key, as: '' \}\]/.test(deskSrc) &&
      /if \(own\) acts\.push\(\.\.\.found\)/.test(deskSrc) && /acts\.push\(\{ \.\.\.found\[0\], label: `\$\{found\[0\]\.label\} of \$\{n\.symbol\}` \}\)/.test(deskSrc) &&
      /const stated = own && inst \? readOwnPair\(inst\) : null/.test(deskSrc) && /const pair = stated \? \(hasQuote \? stated : null\) : chartPairFor\(n\.symbol\)/.test(deskSrc) && /const hasQuote = !!q\b/.test(card) &&
      /<SpineLink /.test(card) && !/<Link[\s>]/.test(card) && /\{door\}/.test(card),
  )
  check(
    'read: the first frame is the server\'s — the line is one h2 whose aria-label is the whole sentence, each clause a pressed-state button, each tile a link onto its market\'s own page (a tile with no page a pressed-state button onto the chart), the chart an SVG in a stretched viewBox inside a box whose height is CSS; clock words wait for the browser; nothing animates under reduced motion',
    /<h2 className="read__line" aria-label=\{headline\}>/.test(card) && /aria-pressed=\{c\.key === sel\}/.test(card) /* RE-PINNED 2026-11-20 (the desk): a clause is keyed by its symbol */ && /* RE-PINNED 2026-11-25 (tiles link to the asset page, Nate): was a tablist with arrow keys */ /const href = deskPageHref\(i\)/.test(card) && /<SpineLink href=\{href\} prefetch=\{false\} className=\{cls\} data-read-tile=\{i\.key\}/.test(card) && /aria-pressed=\{on\} className=\{cls\} onClick=\{\(\) => pick\(i\.key\)\}/.test(card) && !/role="tablist"/.test(card) &&
      /viewBox="0 0 1000 300" preserveAspectRatio="none"/.test(card) && /vectorEffect="non-scaling-stroke"/.test(card) &&
      /useState<Date \| null>\(null\)/.test(card) && /suppressHydrationWarning/.test(card) &&
      /\.read__plot \{ position: relative; height: clamp\(/.test(css) && /prefers-reduced-motion: reduce/.test(css) && /@media \(hover: none\) \{[\s\S]*\.read__chip \{ min-height: 44px; \}/.test(css) &&
      !/#[0-9a-fA-F]{3,8}\b|rgba?\(|font-size: \d+px|border-radius: \d+px/.test(css),
  )
  check(
    'read: the index no longer mounts the session strip or the movers tape (the lead says the bell and names the movers), and the guide seat (the apps row) renders inside the data column after the market boards and before Earn',
    !/<SessionStrip|<MoversTape/.test(index) && !/import SessionStrip|import MoversTape/.test(index) &&
      index.indexOf('className="mk-lead-seat"') < index.indexOf('className="mkt-frame__data"') &&
      index.indexOf('className="mkt-frame__data"') < index.indexOf('className="mk-guide-seat"') &&
      index.indexOf('<Board key={s.id}') < index.indexOf('className="mk-guide-seat"') && index.indexOf('className="mk-guide-seat"') < index.indexOf('<EarnBoard'),
  )

  // ── THE DESK (2026-11-20, lib/read-desk) ──────────────────────────────
  const dq = (last: number, chg: number | null, live = true): ReadQuote => ({ last, prev: chg == null ? null : last / (1 + chg / 100), chg, asOf: NOW, live, points: [[1, last * 0.99], [2, last]] })
  const near = deskItemFor('near')!
  const aapl = deskItemFor('AAPL')
  check(
    'read desk: a symbol becomes a desk item only when the app can chart it — one of the nine IS that instrument (BTC, WETH → ether, US10Y → the 10-year, in its own unit), a token is a ticker with a crypto day as its measure, a stock a stock\'s, and a stablecoin or junk is no tile; the nine keep their page symbols',
    deskItemFor('BTC')?.inst?.id === 'btc' && deskItemFor('weth')?.inst?.id === 'eth' && deskItemFor('US10Y')?.inst?.id === 'us10y' && deskItemFor('US10Y')?.unit === 'yield' && deskItemFor('SP500')?.inst?.id === 'spx' &&
      near.key === 'NEAR' && near.inst === null && near.kind === 'crypto' && near.subject === 'NEAR' && !near.common && near.icon === 'NEAR' &&
      (!aapl || (aapl.kind === 'stock' && aapl.typical < near.typical)) &&
      deskItemFor('USDC') === null && deskItemFor('') === null && deskItemFor('<script>') === null && deskItemFor(null) === null &&
      DESK_MACRO_ITEMS.map((i) => i.key).join() === 'SP500,NDX,US10Y,VIX,DXY,GOLD,CL,BTC,ETH' && DESK_MACRO_ITEMS.every((i) => i.common && i.inst !== null),
    `${near.key}/${near.kind} · ${DESK_MACRO_ITEMS.map((i) => i.key).join()}`,
  )
  const deskOnly = deskPlan(null)
  const short = deskPlan(['NEAR', 'USDC', 'btc', 'NEAR'])
  const sixteen = ['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'ADA', 'AVAX', 'LINK', 'DOT', 'SUI', 'APT', 'NEAR', 'ATOM', 'ARB', 'OP', 'UNI']
  const longPlan = deskPlan(sixteen)
  const longAll = deskPlan(sixteen, { all: true })
  check(
    'read desk: no list (or a list of nothing chartable) is THE CRYPTO DESK — eight tokens led by bitcoin and ether, every tile a suggestion; a list is YOURS — its own symbols, deduped, tokens leading the wall (then stocks, then macro markets, the list\'s order inside each), a short one filled out to eight with the desk\'s tokens it lacks, a long one cut to eleven tiles and a "more" door until "show all"; the backdrop is whichever of the nine is not a tile',
    deskOnly.mode === 'desk' && deskOnly.tiles.map((t) => t.item.key).join() === READ_DESK_DEFAULT.join() && READ_DESK_DEFAULT.length === 8 && READ_DESK_DEFAULT.slice(0, 2).join() === 'BTC,ETH' && deskOnly.tiles.every((t) => !t.own) &&
      deskPlan(['USDC']).mode === 'desk' && deskPlan([]).mode === 'desk' &&
      short.mode === 'yours' && short.owned.map((i) => i.key).join() === 'NEAR,BTC' && short.tiles.length === DESK_FILL_TO && short.tiles.filter((t) => t.own).length === 2 && short.tiles.slice(2).map((t) => t.item.key).join() === 'ETH,SOL,HYPE,UNI,AAVE,LINK' &&
      longPlan.owned.length === 16 && longPlan.tiles.length === DESK_TILES_MAX - 1 && longPlan.hidden === 5 && longPlan.tiles.every((t) => t.own) && longAll.tiles.length === 16 && longAll.hidden === 0 &&
      deskPlan(['GOLD', 'US10Y', 'NEAR', 'HYPE']).tiles.slice(0, 4).map((t) => t.item.key).join() === 'NEAR,HYPE,GOLD,US10Y' && deskPlan(['GOLD', 'US10Y', 'NEAR', 'HYPE']).owned.map((i) => i.key).join() === 'GOLD,US10Y,NEAR,HYPE' &&
      deskBackdrop(deskOnly).map((i) => i.key).join() === 'SP500,NDX,US10Y,VIX,DXY,GOLD,CL' && deskBackdrop(deskPlan(['GOLD', 'NEAR'])).map((i) => i.key).join() === 'SP500,NDX,US10Y,VIX,DXY,CL' &&
      READ_DESK_SERVER_SYMBOLS.join() === 'SOL,HYPE,UNI,AAVE,LINK,DOGE',
    `desk ${deskOnly.tiles.length} · short ${short.tiles.map((t) => t.item.key).join()} · long ${longPlan.tiles.length}+${longPlan.hidden}`,
  )
  const deskSnap: ReadSnapshot = { ...snap({ spx: q('spx', -3.5), gold: q('gold', -1), us10y: { ...q('us10y', 9), live: false }, btc: q('btc', -3.1), eth: q('eth', -2.9) }, [{ symbol: 'AMD', chgPct: -4.9 }, { symbol: 'INTC', chgPct: 4.6 }]), desk: { HYPE: dq(40, 12), SOL: dq(150, -4.6), DOGE: dq(0.1234, 0.1) }, tokenMovers: [{ symbol: 'ENA', chgPct: -9 }, { symbol: 'HYPE', chgPct: 12 }, { symbol: 'WLD', chgPct: 7 }] }
  const deskLine = deskHeadline(deskOnly, (i) => deskQuote(i, deskSnap))
  const yoursQuotes: Record<string, ReadQuote> = { NEAR: dq(3, -11.3), LINK: dq(14, 2.62), AERO: dq(0.42, -2.88), UNI: dq(4.8, -7.4) }
  const yours = deskPlan(['AERO', 'UNI', 'NEAR', 'LINK', 'BTC'])
  const yoursLine = deskHeadline(yours, (i) => deskQuote(i, deskSnap, yoursQuotes))
  const two = deskPlan(['NEAR', 'LINK'])
  check(
    'read desk: the crypto desk\'s line is bitcoin, then the desk token that surprised most, then the macro market trading now that surprised most (a closed one stays out); a list\'s line is its breadth as a sentence (from three quoted symbols up) and its three biggest surprises by each market\'s own typical day, a ticker never lower-cased; the list read asks only for what the snapshot does not carry',
    deskHeadlineText(deskLine) === 'Bitcoin falls 3.1%, HYPE jumps 12%, stocks slump 3.5%.' && deskLine.lead === '' && deskLine.clauses.map((c) => c.key).join() === 'BTC,HYPE,SP500' &&
      deskHeadlineText(deskHeadline(deskOnly, () => undefined)) === `${READ_WAITING}.` &&
      deskHeadlineText(yoursLine) === '4 of your 5 are down. NEAR slumps 11%, UNI falls 7.4%, bitcoin falls 3.1%.' && yoursLine.clauses.map((c) => c.key).join() === 'NEAR,UNI,BTC' &&
      deskBreadth(yours.owned, (i) => deskQuote(i, deskSnap, yoursQuotes)).down === 4 && deskBreadth(two.owned, (i) => deskQuote(i, deskSnap, yoursQuotes)).text === '' &&
      deskHeadlineText(deskHeadline(two, (i) => deskQuote(i, deskSnap, yoursQuotes))) === 'NEAR slumps 11%, LINK edges up 2.6%.' &&
      deskBreadth([near, near, near], () => dq(1, 2)).text === 'All 3 on your list are up.' && deskBreadth([near, near, near, near], (i) => dq(1, 0)).text === 'Your list is flat.' &&
      deskFetchSymbols(deskOnly, deskSnap).join() === 'UNI,AAVE,LINK' && deskFetchSymbols(yours, deskSnap).join() === 'AERO,UNI,NEAR,LINK,SOL,HYPE' &&
      deskMovers(deskSnap, deskOnly).tokens.map((m) => m.symbol).join() === 'ENA,WLD' && deskMovers(deskSnap, deskOnly).stocks.map((m) => m.symbol).join() === 'AMD,INTC',
    `${deskHeadlineText(deskLine)} | ${deskHeadlineText(yoursLine)} | ${deskFetchSymbols(yours, deskSnap).join()}`,
  )
  const ethPair = chartPairFor('ETH')!
  const ethActs = deskActsFor('ETH', ethPair, 3000, () => true)
  const ethItem = deskItemFor('ETH')!
  const limit = ethActs.find((a) => a.price !== null)
  const specs = deskLevelSpecs(ethItem, 3000, ethActs, true)
  const quiet: ReadPoint[] = [[1, 2990], [2, 3010], [3, 3000]]
  const placed = placeDeskLevels(specs, 2980, 3020)
  const wideDay: ReadPoint[] = [[1, 2800], [2, 3100], [3, 3000]]
  check(
    'read desk: every act is a sentence the routes table composes and the gate passed, naming where it routes (buy at the market, a resting limit 3% under it only with a live price, long and short on Hyperliquid); a limit is a LEVEL on the chart with the price now and the alert\'s ±5% band (the alerts\' own distance); an act joins the scale only while the series keeps its share of the plot, else it is pinned to the edge it lies beyond; the alert\'s band never widens the scale and is drawn only when the range in view reaches it; tags on the rail never overlap',
    ethActs.length >= 2 && ethActs[0].label === 'Buy $25' && ethActs[0].tone === 'buy' && /^Buy \$25 of ETH/.test(ethActs[0].ask) && /^Uniswap · /.test(ethActs[0].where) &&
      !!limit && limit.label === `Buy ${DESK_LIMIT_PCT}% lower` && Math.abs(limit.price! - 2910) < 1e-6 && /^limit order: buy [\d.]+ ETH for at most [\d.]+ USDC on /.test(limit.ask) && /^CoW Swap · /.test(limit.where) &&
      deskActsFor('ETH', ethPair, null, () => true).every((a) => a.price === null) && deskActsFor('ETH', ethPair, 3000, () => false).length === 0 &&
      deskActsFor('ETH', ethPair, 3000, (ask) => !/^limit order/.test(ask)).every((a) => a.price === null) &&
      deskActs(deskItemFor('NDX')!, 26000, true, () => true).acts.every((a) => / of QQQ$/.test(a.label)) && deskActs(deskItemFor('VIX')!, 29, true, () => true).acts.length === 0 &&
      DESK_ALERT_PCT === DEFAULT_ALERT_PCT && specs.map((l) => l.kind).join() === 'now,limit,alert,alert' && specs[1].act === limit && specs[1].label === 'Buy at $2,910' && deskLevelSpecs(ethItem, null, ethActs, true).length === 0 &&
      deskLevelSpecs(deskItemFor('US10Y')!, 5.05, [], true).length === 1 &&
      deskScaleAlso(quiet, 3000, specs).join() === '3000' && deskScaleAlso(wideDay, 3000, specs).join() === '3000,2910' &&
      placed.map((l) => `${l.kind}:${l.off}`).join() === 'now:0,limit:1' && placed[0].tagY === 50 && placed[1].tagY === 93 &&
      placeDeskLevels(specs, 2800, 3200).length === 4 && placeDeskLevels(specs, 2800, 3200).every((l) => l.off === 0) && placeDeskLevels(specs, 2990, 3010.5).every((l, i, a) => i === 0 || l.tagY - a[i - 1].tagY >= 10.99) && placeDeskLevels(specs, 5, 5).length === 0 &&
      fmtDeskValue(near, 0.000672) === '$0.000672' && fmtDeskValue(near, 0.4208) === '$0.4208' && fmtDeskValue(near, 61718) === '$61,718' && fmtDeskValue(near, null) === '—' &&
      parseDeskMemory('["BTC","near","<x>",5]').join() === 'BTC,near' && parseDeskMemory('{') .length === 0 && parseDeskMemory(null).length === 0,
    `${ethActs.map((a) => `${a.label} [${a.where}]`).join(' · ')} | levels ${placed.map((l) => `${l.kind}@${l.tagY}`).join(' ')}`,
  )
  const hook = code('components/markets/watchlist/useWatchlists.ts')
  check(
    'read desk: the card is built from the OPEN watchlist through a second instance of the rail\'s hook (no holdings read), opens on what this browser last drew while the lists load, and a write in any instance reaches the others (the rail adds a token, the read has it); the snapshot is rendered through the data cache under a new key, with the desk\'s tokens and the token movers in it',
    /const wl = useWatchlists\(\{ holdings: false \}\)/.test(card) && /const listSymbols = listReady \? \(wl\.active\?\.symbols \?\? null\) : memory/.test(card) && /parseDeskMemory\(window\.localStorage\.getItem\(DESK_MEMORY_KEY\)\)/.test(card) &&
      /useState<string\[\]>\(\[\]\)/.test(card) && /fetch\(`\/api\/markets\/read\?symbols=\$\{encodeURIComponent\(fetchKey\)\}`, \{ cache: 'no-store' \}\)/.test(card) &&
      /announceLists\(selfLists\.current, modeKeyRef\.current, next, null\)/.test(hook) && /announceLists\(selfLists\.current, modeKeyRef\.current, null, id\)/.test(hook) && /if \(fn !== from\) fn\(modeKey, lists, activeId\)/.test(hook) &&
      /return \{ asOf: nowMs, quotes, movers, desk, tokenMovers \}/.test(server) && /readDeskQuotes\(asked\)/.test(route) && /readSymbolSeries\(symbolRaw, range\)/.test(route) &&
      !/linearGradient|radial-gradient|linear-gradient|box-shadow: 0 0 \d+px \d+px/.test(card + css),
  )

  // ── The line is a post ────────────────────────────────────────────────
  const post = readPost('Stocks rise 0.9%, oil slumps 4.1%, bitcoin slips 1.2%.')
  check(
    'read: the line is a post — the card mounts the app\'s own share door with the sentence as composed (only once there is a sentence), the post leads with it, fits one X post with its link, and points at `/`',
    // RE-PINNED 2026-11-20 (the desk): only the MARKET's line is a post; a list's line is its owner's and wears no share door.
    /\{plan\.mode === 'desk' && clauses\.length > 0 && <ShareActions post=\{readPost\(headline\)\} variant="pill" label="Post the read" surface="read" className="read__share" \/>\}/.test(card) &&
      post.text.startsWith('Stocks rise 0.9%, oil slumps 4.1%, bitcoin slips 1.2%.\n\n') && /@askPantessa/.test(post.text) && post.text.length + 24 <= 280 &&
      /^https:\/\/www\.pantessa\.com\/?$/.test(post.url) && xIntentHref(post.text, post.url).startsWith('https://twitter.com/intent/tweet?text=Stocks+rise+0.9%25'),
    `${post.text.length} chars · ${post.url}`,
  )

  // ── The battle views are off the nav; their URLs stay ─────────────────
  const tabs = code('components/live/LiveTabs.tsx')
  check(
    'read: /live\'s tape offers no view tabs and a battle view or The Flyover offers them all (a visitor who arrived by a link can move between them and back); the first-run sheet off the battle seats names no battle view',
    liveTabsFor('tape').length === 0 && liveTabsFor('front').length === LIVE_VIEWS.length && liveTabsFor('flyover').length === LIVE_VIEWS.length && liveTabsFor('map').map((x) => x.id).join() === LIVE_VIEWS.map((x) => x.id).join() &&
      /liveTabsFor\(view\)\.map\(\(v\) => \(/.test(tabs) && !/LIVE_VIEWS/.test(tabs) &&
      !/Front|Siege|Flyover|Map/.test(pickSheetBlurb('pulse')) && !/Front|Siege|Flyover|Map/.test(pickSheetBlurb('tape')) && !/Front|Siege|Flyover|Map/.test(pickSheetBlurb('deck')) && /first \d+ march/.test(pickSheetBlurb('battle')),
  )
}

/** The redirect table is async: its own pin. */
export async function readRedirectPins(check: Check): Promise<void> {
  const redirects = (await nextConfig.redirects?.()) ?? []
  const deck = redirects.find((r) => r.source === '/' && r.destination === '/live')
  const has = (deck as { has?: { type: string; key?: string; value?: string }[] } | undefined)?.has ?? []
  const re = has[0]?.value ? new RegExp(`^${has[0].value}$`) : null
  check(
    'read: a deck link already in the world still opens its view — next.config forwards `/` to /live ONLY when `?view=` names a /live view (every one of them), temporarily, and no other redirect touches `/`',
    !!deck && deck.permanent === false && has.length === 1 && has[0].type === 'query' && has[0].key === 'view' && !!re &&
      LIVE_VIEWS.every((v) => re.test(v.id)) && !re.test('pulse') && !re.test('junk') && !re.test('') && !re.test('xfrontx') &&
      redirects.filter((r) => r.source === '/').length === 1,
    JSON.stringify(deck ?? null),
  )
}

/** Against a running server (BASE): the snapshot route, the served line, the forwarded deck links, /live's strips. */
export async function readServedPins(check: Check, BASE: string): Promise<void> {
  const get = (path: string, init?: RequestInit) => fetch(`${BASE}${path}`, { ...init, headers: { 'x-yf-internal-run': '1', ...(init?.headers ?? {}) } })
  try {
    const res = await get('/api/markets/read')
    const body = (await res.json()) as ReadSnapshot
    const ids = Object.keys(body.quotes ?? {}) as ReadId[]
    check(
      'read (served): GET /api/markets/read answers 200 with a shared short cache and a snapshot whose quotes are well-formed (a positive last, a series, a finite change or none) — a feed that did not answer is simply absent',
      res.status === 200 && /s-maxage=20/.test(res.headers.get('cache-control') ?? '') && typeof body.asOf === 'number' && Array.isArray(body.movers) &&
        ids.every((id) => READ_IDS.includes(id) && body.quotes[id]!.last > 0 && Array.isArray(body.quotes[id]!.points) && (body.quotes[id]!.chg === null || Number.isFinite(body.quotes[id]!.chg))),
      `quotes=${ids.length} movers=${body.movers?.length}`,
    )
    const bad = await get('/api/markets/read?id=nope')
    const badRange = await get('/api/markets/read?id=gold&range=5y')
    const series = await get('/api/markets/read?id=btc&range=1w')
    const sBody = (await series.json()) as { id?: string; range?: string; points?: ReadPoint[] }
    check(
      'read (served): an unknown id or range is a 400 by name; a known one answers its series (possibly empty when the feed is down, never an error)',
      bad.status === 400 && badRange.status === 400 && series.status === 200 && sBody.id === 'btc' && sBody.range === '1w' && Array.isArray(sBody.points),
      `points=${sBody.points?.length}`,
    )
    const list = await get('/api/markets/read?symbols=SOL,UNI,BTC,NOPE9')
    const lBody = (await list.json()) as { quotes?: Record<string, ReadQuote>; unknown?: string[] }
    const badList = await get('/api/markets/read?symbols=' + encodeURIComponent('SOL,<x>'))
    const sym = await get('/api/markets/read?symbol=SOL&range=1w')
    const symBody = (await sym.json()) as { symbol?: string; range?: string; points?: ReadPoint[] }
    const symBad = await get('/api/markets/read?symbol=SOL&range=5y')
    check(
      'read desk (served): `?symbols=` answers a list\'s own quotes (a token\'s last, change and series; one of the nine is left to the snapshot; a symbol with no chart is named in `unknown`), a malformed list is a 400, `?symbol=&range=` answers a token\'s series and a 400 for an unknown range, and the snapshot carries the crypto desk\'s tokens',
      list.status === 200 && !!lBody.quotes && !('BTC' in lBody.quotes) && (lBody.unknown ?? []).includes('NOPE9') &&
        Object.values(lBody.quotes).every((x) => x.last > 0 && Array.isArray(x.points) && (x.chg === null || Number.isFinite(x.chg))) &&
        badList.status === 400 && sym.status === 200 && symBody.symbol === 'SOL' && symBody.range === '1w' && Array.isArray(symBody.points) && symBad.status === 400 &&
        typeof body.desk === 'object' && Object.keys(body.desk ?? {}).every((k) => READ_DESK_SERVER_SYMBOLS.includes(k)) && Array.isArray(body.tokenMovers),
      `list=${Object.keys(lBody.quotes ?? {}).join(',')} unknown=${(lBody.unknown ?? []).join(',')} series=${symBody.points?.length} desk=${Object.keys(body.desk ?? {}).join(',')}`,
    )
    const html = await (await get('/')).text()
    const line = html.match(/class="read__line" aria-label="([^"]*)"/)?.[1] ?? null
    check(
      // RE-PINNED 2026-11-20 (the desk): the first frame is the crypto desk — eight token tiles, and the seven macro markets that are not a tile on the backdrop row.
      'read (served): `/` server-renders the read — the line (a real sentence or the waiting words), the crypto desk\'s eight tiles, the seven backdrop markets, the chart\'s stage — and none of the deck, the first-run sheet, the session strip or the movers tape',
      !!line && (/^[A-Z].+\.$/.test(line) || line === `${READ_WAITING}.`) && (html.match(/data-read-tile="/g) ?? []).length === 8 && (html.match(/data-read-back="/g) ?? []).length === 7 && /data-mode="desk"/.test(html) && /class="read__stage" role="tabpanel"/.test(html) &&
        !/data-deck|class="picksheet|class="mk-session"|data-seat="MoversTape"/.test(html),
      String(line),
    )
    const fwd = await get('/?view=front&t=ZK,OP', { redirect: 'manual' })
    const stay = await get('/?view=junk', { redirect: 'manual' })
    const tape = await (await get('/live')).text()
    const front = await (await get('/live?view=front')).text()
    check(
      'read (served): `/?view=front&t=…` is a 307 to /live with the query kept, a junk view stays on `/`, /live\'s tape renders no view tab and /live?view=front renders all five',
      fwd.status === 307 && /\/live\?view=front&t=ZK(%2C|,)OP$/.test(fwd.headers.get('location') ?? '') && stay.status === 200 &&
        /class="live__views"[^>]*data-tabs="0"/.test(tape) && /class="live__views"[^>]*data-tabs="5"/.test(front),
      `${fwd.status} ${fwd.headers.get('location')}`,
    )
  } catch (err) {
    check('read (served): the server answered', false, err instanceof Error ? err.message : String(err))
  }
}

if (process.argv[1]?.endsWith('read-pins.ts')) {
  ;(async () => {
    let failed = 0
    let n = 0
    const check: Check = (name, ok, extra) => {
      n++
      console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
      if (!ok) failed++
    }
    readPins(check)
    await readRedirectPins(check)
    if (process.env.BASE) await readServedPins(check, process.env.BASE)
    console.log(failed ? `\n${failed} of ${n} read pins failed` : `\nall ${n} read pins green${process.env.BASE ? '' : ' (pure half only)'}`)
    process.exit(failed ? 1 : 0)
  })()
}
