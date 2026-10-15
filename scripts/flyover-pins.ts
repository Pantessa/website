// Pins for THE FLYOVER (lib/flyover, /live?view=flyover): the windows and
// lenses and their URL, the continents, the ledger's seconds and its
// retract, the sums, the three height ladders and the color clamp, the
// footprint, the layout (areas, overlaps, containment, determinism, speed),
// the plot cap and the relayout rule, the leaderboard, the label tiers, the
// readout's ASCII sentences, the chips (lib/tape followAsk verbatim), the sky
// log, the legend, and the page's wiring (three only in the scene module,
// loaded lazily; the act door; the tokens probe). Rules, never market state.
// Pure: no server, no socket, no DB. Called from scripts/test-api.ts, and
// runnable alone:
//   npx tsx scripts/flyover-pins.ts
import { readFileSync } from 'node:fs'
import {
  CENSUS_MS,
  CONTINENTS,
  DEFAULT_FLYOVER_WINDOW,
  DEFAULT_LENS,
  EMPTY_SUMS,
  FLYOVER_WINDOWS,
  LABEL_ALWAYS_TOP,
  LEDGER_KEEP_SEC,
  LEDGER_SPAN_SEC,
  LEGEND_LINES,
  LENSES,
  MAX_STORIES,
  MOVE_CLAMP_PCT,
  MOVE_STORIES,
  PLOT_CAP,
  RECENT_SEATS,
  RELAYOUT_MIN_MS,
  SESSION_WEIGHT,
  SIZE_FLOOR_USD,
  SKY_LOG_ROWS,
  UNIT_USD,
  WINDOW_SEC,
  activityHeight,
  asciiOnly,
  boardByFor,
  boardHeads,
  censusDue,
  continentOf,
  createLedger,
  elevation,
  flyoverSearch,
  flyoverShareParams,
  fmtAgo,
  fmtNet,
  fmtPctAscii,
  fmtPx,
  fmtUsd3,
  heightFor,
  ingest,
  isBigPrint,
  labelTier,
  layoutWorld,
  leaderboard,
  lensHasSea,
  meteorTag,
  moveHeight,
  moveT,
  parseFlyoverWindow,
  parseLens,
  parsePlotKey,
  plotAsks,
  plotKey,
  plotSize,
  prune,
  pushSky,
  readoutLines,
  retract,
  selectPlots,
  sessionUsd,
  shouldRelayout,
  sizeBasis,
  skyLine,
  squarify,
  storyUsd,
  sums,
  venuesOfContinents,
  type BoardRow,
  type ContinentId,
  type PlotInput,
  type Rect,
} from '../lib/flyover'
import { DEFAULT_THRESHOLDS, followAsk, type TapeFill } from '../lib/tape'
import { DUNE_VENUES } from '../lib/dune'
import { LIVE_VIEWS, isBattleView, parseLiveView } from '../lib/battle'
import { cardEyebrow, cardFoot, cardRankNote, cardTagline, parseLiveShare, shareDescription, shareText, shareTitle } from '../lib/live-share'
import { simulateLadder } from './ask-ladder'

type Check = (name: string, ok: boolean, extra?: string) => void

const T0 = 1_791_298_000_000 // a whole second
const S0 = T0 / 1000
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps
const ASCII = /^[\x20-\x7e]+$/
let seq = 0
const fill = (over: Partial<TapeFill>): TapeFill => ({
  id: `f${++seq}`, market: 'BTC', side: 'buy', size: 1, price: 100, usd: 1_000, at: T0, taker: null, maker: null, hash: null, effect: null, block: null, source: 'dune', venue: 'hyperliquid', chainId: null, ...over,
})
const area = (r: Rect) => r.w * r.d
const overlap = (a: Rect, b: Rect) => Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 1e-6 && Math.min(a.z + a.d, b.z + b.d) - Math.max(a.z, b.z) > 1e-6
const inside = (a: Rect, b: Rect) => a.x >= b.x - 1e-6 && a.z >= b.z - 1e-6 && a.x + a.w <= b.x + b.w + 1e-6 && a.z + a.d <= b.z + b.d + 1e-6

export function flyoverPins(check: Check): void {
  // ── The view on /live ─────────────────────────────────────────────────
  check('flyover: /live has a fifth view, The Flyover; it is not a battle view (it reads every market, not one to five armies); ?view=flyover parses',
    LIVE_VIEWS.some((v) => v.id === 'flyover' && v.label === 'The Flyover') && parseLiveView('flyover') === 'flyover' && !isBattleView('flyover') && isBattleView('front') && isBattleView('siege') && isBattleView('map') && !isBattleView('tape'))

  // ── Windows, lenses, the URL ──────────────────────────────────────────
  check('flyover: three windows (1m, 5m, 15m), default 5m; three lenses (flow, activity, move), default flow; junk reads as the default',
    FLYOVER_WINDOWS.join(',') === '1m,5m,15m' && DEFAULT_FLYOVER_WINDOW === '5m' && parseFlyoverWindow('15m') === '15m' && parseFlyoverWindow('1h') === '5m' && parseFlyoverWindow(null) === '5m' &&
      LENSES.join(',') === 'flow,activity,move' && DEFAULT_LENS === 'flow' && parseLens('move') === 'move' && parseLens('MOVE') === 'flow' && parseLens(undefined) === 'flow' && WINDOW_SEC['1m'] === 60 && WINDOW_SEC['15m'] === 900)
  check('flyover: ?w= and ?lens= are written only off their defaults, everything else in the address (view, t, m) is kept, and the pick reads as commas and colons',
    flyoverSearch('?view=flyover&t=HYPE,xyz:NVDA', '1m', 'move') === '?view=flyover&t=HYPE,xyz:NVDA&w=1m&lens=move' && flyoverSearch('?view=flyover&w=1m&lens=move', '5m', 'flow') === '?view=flyover' && flyoverSearch('', '5m', 'flow') === '' && flyoverSearch('view=flyover&m=BTC', '15m', 'flow') === '?view=flyover&m=BTC&w=15m',
    flyoverSearch('?view=flyover&t=HYPE,xyz:NVDA', '1m', 'move'))
  check('flyover: a share carries the window and the lens off their defaults (the share URL always names view=flyover), nothing at the defaults or for junk',
    flyoverShareParams(new URLSearchParams('view=flyover&w=1m&lens=move&t=HYPE')) === '&w=1m&lens=move' && flyoverShareParams(new URLSearchParams('w=5m&lens=flow')) === '' && flyoverShareParams(new URLSearchParams('w=9y&lens=x')) === '' && flyoverShareParams(new URLSearchParams('lens=activity')) === '&lens=activity')

  // ── Continents ────────────────────────────────────────────────────────
  const dexOf = (id: string) => DUNE_VENUES.find((v) => v.id === id)!
  check('flyover: seven continents in display order, HyperCore first; every relay venue lands on one (HyperCore splits its xyz: stock perps onto their own); an unknown chain lands nowhere',
    CONTINENTS.map((c) => c.id).join(',') === 'hypercore,hypercore-xyz,lighter,lighter-robinhood,dex-base,dex-ethereum,dex-arbitrum' &&
      continentOf(dexOf('hypercore').venue, null, 'BTC') === 'hypercore' && continentOf(dexOf('hypercore').venue, null, 'xyz:NVDA') === 'hypercore-xyz' && continentOf('hyperliquid', null, 'XYZ:TSLA') === 'hypercore-xyz' &&
      continentOf(dexOf('lighter').venue, dexOf('lighter').chainId, 'BTC') === 'lighter' && continentOf(dexOf('lighter-robinhood').venue, dexOf('lighter-robinhood').chainId, 'OPENAI') === 'lighter-robinhood' &&
      continentOf('dex', dexOf('dex-base').chainId, 'WETH') === 'dex-base' && continentOf('dex', dexOf('dex-ethereum').chainId, 'WETH') === 'dex-ethereum' && continentOf('dex', dexOf('dex-arbitrum').chainId, 'WETH') === 'dex-arbitrum' &&
      continentOf('dex', 10, 'WETH') === null && continentOf('dex', null, 'WETH') === null &&
      DUNE_VENUES.every((v) => continentOf(v.venue, v.chainId, 'X') !== null) && CONTINENTS.every((c) => ASCII.test(c.label) && ASCII.test(c.blurb)) &&
      venuesOfContinents(['hypercore-xyz', 'dex-base']).join(',') === 'hypercore,dex-base')
  check('flyover: a plot is a market ON a continent — BTC on HyperCore and BTC on Lighter are two plots; the key round-trips, colons in the market kept',
    plotKey('hypercore', 'BTC') !== plotKey('lighter', 'BTC') && parsePlotKey(plotKey('hypercore-xyz', 'xyz:NVDA'))?.market === 'xyz:NVDA' && parsePlotKey(plotKey('hypercore-xyz', 'xyz:NVDA'))?.continent === 'hypercore-xyz' && parsePlotKey('nowhere|BTC') === null && parsePlotKey('BTC') === null)

  // ── The ledger ────────────────────────────────────────────────────────
  {
    const L = createLedger()
    const now = T0 + 999 // the same second as T0
    ingest(L, fill({ id: 'a', at: T0 + 100, price: 100, usd: 1_000 }), now)
    ingest(L, fill({ id: 'b', at: T0 + 900, side: 'sell', price: 101, usd: 400 }), now)
    ingest(L, fill({ id: 'c', at: T0 - 1, price: 99, usd: 50 }), now) // the second before
    const dup = ingest(L, fill({ id: 'a', at: T0 + 100, usd: 1_000 }), now)
    const p = L.plots.get(plotKey('hypercore', 'BTC'))!
    check('flyover ledger: one bucket per second (a fill at .999 of a second and one at .000 of the next are two buckets), sums by side, first and last price by venue stamp, a repeated id counts once',
      p.buckets.length === 2 && p.buckets[0].sec === S0 - 1 && p.buckets[1].sec === S0 && p.buckets[1].buyUsd === 1_000 && p.buckets[1].sellUsd === 400 && p.buckets[1].count === 2 && p.buckets[1].firstPx === 100 && p.buckets[1].lastPx === 101 && dup === null && L.seen.size === 3,
      JSON.stringify(p.buckets))
    const w1 = sums(p, S0, 1)
    const w2 = sums(p, S0, 2)
    check('flyover sums: the window is the seconds (now - w, now]; the price before the window is its opening price, so a 1-second window measures from the second before',
      w1.count === 2 && w1.buyUsd === 1_000 && w1.sellUsd === 400 && w1.netUsd === 600 && w1.grossUsd === 1_400 && w1.firstPx === 99 && w1.lastPx === 101 && near(w1.movePct!, (101 / 99 - 1) * 100) &&
        w2.count === 3 && w2.firstPx === 99 && w2.lastPx === 101 && w2.largest?.id === 'a' && w2.effects.buy === 1_050 && w2.effects.sell === 400,
      JSON.stringify(w1))
    const future = ingest(L, fill({ id: 'z', at: T0 + 30_000, usd: 5 }), now)
    check('flyover ledger: a fill stamped in the future (a clock behind the venue) counts at now, never in a bucket ahead of it',
      future !== null && p.buckets[p.buckets.length - 1].sec === S0 && sums(p, S0, 1).count === 3)
    const old = ingest(L, fill({ id: 'old', at: T0 - LEDGER_SPAN_SEC * 1000 - 5_000 }), now)
    check('flyover ledger: a fill older than the span is not counted; the span outlasts the widest window', old === null && LEDGER_KEEP_SEC === 900 && LEDGER_SPAN_SEC > LEDGER_KEEP_SEC && WINDOW_SEC['15m'] <= LEDGER_KEEP_SEC)
    const later = T0 + (LEDGER_SPAN_SEC + 2) * 1000
    prune(L, later)
    check('flyover ledger: aging out — past the span every bucket, then the plot, then its ids leave', L.plots.size === 0 && L.seen.size === 0)
  }
  {
    const L = createLedger()
    ingest(L, fill({ id: 's1', side: 'sell', usd: 2_000, price: 50, at: T0 - 10_000 }), T0)
    ingest(L, fill({ id: 's2', side: 'sell', usd: 3_000, price: 49, at: T0 - 5_000 }), T0)
    const p = L.plots.get(plotKey('hypercore', 'BTC'))!
    const s = sums(p, S0, 60)
    const empty = sums(p, S0 + 3_600, 60)
    check('flyover sums: a market that only sold sinks (net negative, every dollar a sell, its price move measured); an empty window is zero with no price and no move',
      s.netUsd === -5_000 && s.buyUsd === 0 && s.count === 2 && near(s.movePct!, -2) && elevation(s.netUsd, '1m') < 0 &&
        empty.count === 0 && empty.netUsd === 0 && empty.firstPx === null && empty.lastPx === null && empty.movePct === null && empty.largest === null && sums(null, S0, 60).count === 0 && EMPTY_SUMS.count === 0)
    const one = createLedger()
    ingest(one, fill({ id: 'o1', at: T0 - 2_000 }), T0)
    const os = sums(one.plots.get(plotKey('hypercore', 'BTC')), S0, 60)
    check('flyover sums: one print and nothing before the window is a price with no move (neutral, never a fake 0.00%)', os.count === 1 && os.lastPx === 100 && os.movePct === null && moveT(os.movePct, '5m') === 0)
  }
  {
    const L = createLedger()
    ingest(L, fill({ id: 'r1', block: 77, usd: 1_000 }), T0)
    ingest(L, fill({ id: 'r2', block: 77, usd: 9_000, side: 'sell' }), T0)
    ingest(L, fill({ id: 'k1', block: 78, usd: 500 }), T0)
    const n = retract(L, 'hyperliquid', 77)
    const p = L.plots.get(plotKey('hypercore', 'BTC'))!
    const after = sums(p, S0, 60)
    // The UPDATE frame carries the replacement, often the same ids: they count again.
    ingest(L, fill({ id: 'r1', block: 77, usd: 1_200 }), T0)
    const again = sums(p, S0, 60)
    check('flyover retract: an UPDATE takes its block\'s fills back out of their buckets (and their largest), frees the ids so the replacement counts, and leaves other blocks alone',
      n === 2 && after.count === 1 && after.buyUsd === 500 && after.sellUsd === 0 && after.largest === null && again.count === 2 && again.buyUsd === 1_700 && retract(L, 'hyperliquid', 999) === 0 && retract(L, 'lighter', 78) === 0,
      JSON.stringify(after))
  }

  // ── Heights and color ─────────────────────────────────────────────────
  const nets = [-1e9, -2e6, -5e4, -1, 0, 1, 5e4, 2e6, 1e9]
  const elev = nets.map((v) => elevation(v, '5m'))
  check('flyover elevation: zero at zero, monotone, odd-symmetric; one UNIT is log10(2) stories and nine UNITs one story, in every window',
    elevation(0, '5m') === 0 && elev.every((e, i) => i === 0 || e > elev[i - 1]) && nets.every((v) => near(elevation(v, '1m'), -elevation(-v, '1m'))) &&
      FLYOVER_WINDOWS.every((w) => near(elevation(UNIT_USD[w], w), Math.log10(2)) && near(elevation(9 * UNIT_USD[w], w), 1) && near(elevation(-99 * UNIT_USD[w], w), -2)) &&
      UNIT_USD['1m'] === 1_000 && UNIT_USD['5m'] === 5_000 && UNIT_USD['15m'] === 15_000 && near(storyUsd(1, '5m'), 45_000) && near(storyUsd(3, '1m'), 999_000) && elevation(NaN, '5m') === 0)
  check('flyover activity lens: everything traded on the same ladder, never below zero; the Activity lens has no sea, Flow and Move do',
    activityHeight(0, '5m') === 0 && near(activityHeight(9 * 5_000, '5m'), 1) && activityHeight(-5, '1m') === 0 && activityHeight(2e6, '5m') > activityHeight(1e6, '5m') && !lensHasSea('activity') && lensHasSea('flow') && lensHasSea('move'))
  check('flyover color + move lens: the move against each window\'s clamp (0.5% / 1.5% / 3%), clamped to -1..1, three stories at the clamp, neutral with no move',
    MOVE_CLAMP_PCT['1m'] === 0.5 && MOVE_CLAMP_PCT['5m'] === 1.5 && MOVE_CLAMP_PCT['15m'] === 3 && moveT(0.25, '1m') === 0.5 && moveT(-3, '5m') === -1 && moveT(9, '15m') === 1 && near(moveT(1.5, '15m'), 0.5) && moveT(null, '5m') === 0 && moveT(NaN, '1m') === 0 &&
      MOVE_STORIES === 3 && moveHeight(1.5, '5m') === 3 && moveHeight(-0.75, '5m') === -1.5 && moveHeight(null, '1m') === 0)
  check('flyover heightFor: the lens picks the ladder, clamped to the scene\'s range',
    near(heightFor('flow', { netUsd: 45_000, grossUsd: 0, movePct: null }, '5m'), 1) && near(heightFor('activity', { netUsd: -1, grossUsd: 45_000, movePct: null }, '5m'), 1) && heightFor('move', { netUsd: 9e9, grossUsd: 9e9, movePct: -0.75 }, '5m') === -1.5 &&
      heightFor('flow', { netUsd: 1e15, grossUsd: 0, movePct: null }, '1m') === MAX_STORIES && heightFor('flow', { netUsd: -1e15, grossUsd: 0, movePct: null }, '1m') === -MAX_STORIES)

  // ── Footprint ─────────────────────────────────────────────────────────
  check('flyover footprint: the venue\'s 24h volume when it is the larger, 96x the session\'s 15 minutes when that is, never under $25K — and the basis is named',
    plotSize({ dayVolumeUsd: 3e9, sessionUsd: 1e6 }) === 3e9 && sizeBasis({ dayVolumeUsd: 3e9, sessionUsd: 1e6 }) === 'day' &&
      plotSize({ dayVolumeUsd: null, sessionUsd: 1e6 }) === 96e6 && sizeBasis({ sessionUsd: 1e6 }) === 'session' && plotSize({ dayVolumeUsd: 1e3, sessionUsd: 1e5 }) === 9.6e6 &&
      plotSize({ sessionUsd: 10 }) === SIZE_FLOOR_USD && sizeBasis({ sessionUsd: 10 }) === 'floor' && plotSize({ dayVolumeUsd: NaN, sessionUsd: NaN }) === SIZE_FLOOR_USD && SESSION_WEIGHT === 96 && SIZE_FLOOR_USD === 25_000)
  {
    const L = createLedger()
    ingest(L, fill({ id: 'x1', usd: 700, at: T0 - 100_000 }), T0)
    ingest(L, fill({ id: 'x2', usd: 300, at: T0 - 910_000 }), T0) // past the keep, inside the span
    check('flyover footprint: the session is the last 15 minutes the ledger holds', sessionUsd(L.plots.get(plotKey('hypercore', 'BTC')), S0) === 700 && sessionUsd(null, S0) === 0)
  }

  // ── Layout ────────────────────────────────────────────────────────────
  const conts: ContinentId[] = ['hypercore', 'hypercore-xyz', 'lighter', 'lighter-robinhood', 'dex-base', 'dex-ethereum', 'dex-arbitrum']
  const fixture: PlotInput[] = []
  for (let i = 0; i < 160; i++) {
    const c = conts[i % (i < 70 ? 1 : 7)]
    fixture.push({ key: plotKey(c, `M${String(i).padStart(3, '0')}`), continent: c, size: 25_000 + Math.round(3e9 / (i + 1) ** 1.6) })
  }
  layoutWorld(fixture) // warm the JIT: the budget is for a frame, not a cold start
  const t0 = performance.now()
  const L = layoutWorld(fixture)
  const ms = performance.now() - t0
  const shuffled = layoutWorld([...fixture].reverse())
  const areasOk = L.continents.every((c) => {
    const mine = L.plots.filter((p) => p.continent === c.id)
    const total = mine.reduce((s, p) => s + area(p.cell), 0)
    const sizes = new Map(fixture.map((f) => [f.key, f.size] as const))
    const sizeTotal = mine.reduce((s, p) => s + sizes.get(p.key)!, 0)
    return mine.every((p) => Math.abs(area(p.cell) / total - sizes.get(p.key)! / sizeTotal) <= 0.01 * (sizes.get(p.key)! / sizeTotal) + 1e-12)
  })
  const noOverlap = L.plots.every((a, i) => L.plots.every((b, j) => j <= i || !overlap(a.rect, b.rect)))
  const contained = L.plots.every((p) => inside(p.rect, L.continents.find((c) => c.id === p.continent)!.rect) && inside(p.rect, p.cell))
  const disjoint = L.continents.every((a, i) => L.continents.every((b, j) => j <= i || !overlap(a.rect, b.rect)))
  check('flyover layout: inside a continent each plot\'s area is its share of the size within 1% (a squarified treemap); no two plots overlap; every plot sits inside its continent and its cell; continents are disjoint',
    L.plots.length === 160 && areasOk && noOverlap && contained && disjoint, `${L.plots.length} plots, areas ${areasOk}, overlap-free ${noOverlap}, contained ${contained}, disjoint ${disjoint}`)
  check('flyover layout: 160 plots lay out in under 5 ms; the same plots in any order lay out the same (size desc, then name); centred on the origin',
    ms < 5 && JSON.stringify(shuffled) === JSON.stringify(L) && near(Math.min(...L.continents.map((c) => c.rect.x)), -L.width / 2, 1e-6) && near(Math.min(...L.continents.map((c) => c.rect.z)), -L.depth / 2, 1e-6), `${ms.toFixed(2)} ms`)
  const sides = L.continents.map((c) => c.rect.w)
  check('flyover layout: continents are squares, side ∝ √(their size) with a floor at 30% of the biggest; seven continents wrap to two rows (four, then three), display order kept',
    L.continents.every((c) => near(c.rect.w, c.rect.d)) && L.continents[0].id === 'hypercore' && near(Math.max(...sides), 120) && Math.min(...sides) >= 0.3 * 120 - 1e-9 && L.continents.length === 7 &&
      new Set(L.continents.slice(0, 4).map((c) => Math.round(c.rect.z + c.rect.d / 2))).size === 1 && L.continents[4].rect.z > L.continents[0].rect.z && L.continents.map((c) => c.id).join(',') === conts.join(','))
  const lone = layoutWorld([{ key: plotKey('dex-base', 'WETH'), continent: 'dex-base', size: 5e6 }])
  const two = layoutWorld([{ key: plotKey('hypercore', 'BTC'), continent: 'hypercore', size: 9e9 }, { key: plotKey('lighter', 'BTC'), continent: 'lighter', size: 1e9 }])
  check('flyover layout: a lone plot fills its continent (inside the shore); four continents or fewer stay on one row; an empty world is empty',
    lone.plots.length === 1 && near(area(lone.plots[0].cell), (lone.continents[0].rect.w - 5) ** 2, 1e-6) && two.continents.length === 2 && near(two.continents[0].rect.z + two.continents[0].rect.d / 2, two.continents[1].rect.z + two.continents[1].rect.d / 2, 1e-6) && near(two.continents[1].rect.w / two.continents[0].rect.w, Math.sqrt(1 / 9)) &&
      layoutWorld([]).plots.length === 0 && squarify([], { x: 0, z: 0, w: 1, d: 1 }).length === 0)

  // ── Stability ─────────────────────────────────────────────────────────
  const cands = Array.from({ length: 200 }, (_, i) => ({ key: `k${String(i).padStart(3, '0')}`, size: 1e9 / (i + 1), lastAt: i >= 190 ? T0 - 5_000 : T0 - 600_000, pick: i === 199 }))
  const sel = selectPlots(cands, T0)
  check('flyover cap: at most 160 plots — the pick always, then the biggest, with twenty seats for markets that printed in the last minute and would be left out by size',
    PLOT_CAP === 160 && RECENT_SEATS === 20 && sel.length === 160 && sel[0] === 'k199' && sel.includes('k000') && sel.includes('k190') && sel.includes('k198') && sel.includes('k149') && !sel.includes('k150') && !sel.includes('k189') && selectPlots(cands.slice(0, 10), T0).length === 10)
  const sizes = new Map([['a', 100], ['b', 100]])
  check('flyover relayout: the set changing relayouts at once; a size moving more than 35% does only after 30 s; a quiet world never does',
    RELAYOUT_MIN_MS === 30_000 && shouldRelayout(null, { keys: ['a'], sizes }, T0) && !shouldRelayout(null, { keys: [], sizes }, T0) &&
      shouldRelayout({ keys: ['a', 'b'], sizes, at: T0 }, { keys: ['a', 'c'], sizes }, T0 + 1) && shouldRelayout({ keys: ['a'], sizes, at: T0 }, { keys: ['a', 'b'], sizes }, T0 + 1) &&
      !shouldRelayout({ keys: ['a', 'b'], sizes, at: T0 }, { keys: ['b', 'a'], sizes: new Map([['a', 200], ['b', 100]]) }, T0 + 29_999) &&
      shouldRelayout({ keys: ['a', 'b'], sizes, at: T0 }, { keys: ['a', 'b'], sizes: new Map([['a', 136], ['b', 100]]) }, T0 + 30_000) &&
      !shouldRelayout({ keys: ['a', 'b'], sizes, at: T0 }, { keys: ['a', 'b'], sizes: new Map([['a', 134], ['b', 70]]) }, T0 + 60_000))

  check('flyover census: which plots hold land is re-decided every 15 s (every 3 s while the world first fills, its first 30 s); the first census is due at once',
    CENSUS_MS === 15_000 && censusDue(null, T0, T0) && !censusDue(T0, T0, T0 + 2_999) && censusDue(T0, T0, T0 + 3_000) && !censusDue(T0 + 40_000, T0, T0 + 54_999) && censusDue(T0 + 40_000, T0, T0 + 55_000))

  // ── Leaderboard ───────────────────────────────────────────────────────
  const row = (market: string, netUsd: number, grossUsd: number, movePct: number | null): BoardRow => ({ key: plotKey('hypercore', market), market, continent: 'hypercore', netUsd, grossUsd, movePct, count: 1 })
  const rows = [row('A', 500, 900, 0.2), row('B', 900, 1_000, -0.4), row('C', -700, 2_000, 0.9), row('D', -100, 300, null), row('E', 0, 50, 0), row('F', 500, 600, -0.1), row('G', -700, 800, -0.9)]
  const net = leaderboard(rows, 5, 'net')
  const gross = leaderboard(rows, 5, 'gross')
  const move = leaderboard(rows, 5, 'move')
  check('flyover leaderboard: by net — risers are the biggest net buyers, sinkers the biggest net sellers, ties by name, zero on neither side, five a side',
    net.risers.map((r) => r.market).join(',') === 'B,A,F' && net.sinkers.map((r) => r.market).join(',') === 'C,G,D' && leaderboard(rows, 1).risers.length === 1)
  check('flyover leaderboard: by gross (Activity) — the busiest, split by which side carried them; by move — the biggest moves up and down, no move on neither; each lens picks its own',
    gross.risers.map((r) => r.market).join(',') === 'B,A,F,E' && gross.sinkers.map((r) => r.market).join(',') === 'C,G,D' && move.risers.map((r) => r.market).join(',') === 'C,A' && move.sinkers.map((r) => r.market).join(',') === 'G,B,F' &&
      boardByFor('flow') === 'net' && boardByFor('activity') === 'gross' && boardByFor('move') === 'move' && boardHeads('flow').risers === 'Rising' && boardHeads('flow').sinkers === 'Sinking')

  // ── Labels ────────────────────────────────────────────────────────────
  check('flyover labels: the top forty by area wear their name (if big enough to hold it); the leaderboard, the pick, the hovered and the pinned plot always do; the rest on hover',
    LABEL_ALWAYS_TOP === 40 && labelTier(0.05, 1) === 'always' && labelTier(0.01, 40) === 'always' && labelTier(0.01, 41) === 'hover' && labelTier(0.00001, 3) === 'hover' &&
      labelTier(0.00001, 150, { board: true }) === 'always' && labelTier(0, 150, { pick: true }) === 'always' && labelTier(0, 150, { hovered: true }) === 'always' && labelTier(0, 150, { pinned: true }) === 'always' && labelTier(0, 150) === 'hover')

  // ── The readout ───────────────────────────────────────────────────────
  {
    const R = createLedger()
    ingest(R, fill({ id: 'p0', price: 81_279.4, usd: 10_000, at: T0 - 400_000 }), T0) // before the window: its opening price
    ingest(R, fill({ id: 'p1', price: 81_300, usd: 86_300, side: 'buy', effect: 'open', at: T0 - 40_000 }), T0)
    ingest(R, fill({ id: 'p2', price: 81_310.2, usd: 30_000, side: 'sell', effect: 'close', at: T0 - 5_000 }), T0)
    ingest(R, fill({ id: 'p3', price: 81_305, usd: 20_000, side: 'buy', effect: 'close', at: T0 - 6_000 }), T0)
    const s = sums(R.plots.get(plotKey('hypercore', 'BTC')), S0, WINDOW_SEC['5m'])
    const lines = readoutLines({ market: 'BTC', continent: 'hypercore' }, s, '5m', T0, { dayVolumeUsd: 3.2e9, sessionUsd: 146_300 })
    const dex = readoutLines({ market: 'USD₮0', continent: 'dex-arbitrum' }, sums(null, S0, 60), '1m', T0)
    check('flyover readout: names the plot and its continent, then bought / sold / net with the buy share, the price from the window\'s open to now, the fills and the largest with its age, the perp position effects, and the footprint\'s basis',
      lines[0] === 'BTC on HyperCore (Hyperliquid perps), last 5m' && lines[1] === 'Bought $106K, sold $30.0K: net +$76.3K (78% buys)' && lines[2] === 'Price 81,279 to 81,310 (+0.04%)' && lines[3] === '3 fills; largest $86.3K buy 40s ago' &&
        lines[4] === 'Opened longs $86.3K, closed longs $30.0K, opened shorts $0, covered shorts $20.0K' && lines[5] === "Footprint: $3.20B traded in 24h (the venue's own number)", JSON.stringify(lines))
    check('flyover readout: every line is printable ASCII (the house dashes, quotes and dots are kept out: a line may become a chip or a share), a venue\'s non-ASCII name included; an empty window says so',
      [...lines, ...dex].every((l) => ASCII.test(l)) && dex[0] === 'USD0 on Arbitrum DEX (spot swaps on Arbitrum), last 1m' && dex[1] === 'No fills in the last 1m.' && asciiOnly('a — b’s') === 'a bs', JSON.stringify(dex))
  }
  check('flyover formats: three significant dollars, signed net, signed ASCII percent, grouped prices, ages',
    fmtUsd3(950) === '$950' && fmtUsd3(86_300) === '$86.3K' && fmtUsd3(230_000) === '$230K' && fmtUsd3(1_290_000) === '$1.29M' && fmtUsd3(-4_500) === '-$4.50K' && fmtNet(1_060_000) === '+$1.06M' && fmtNet(-230_000) === '-$230K' && fmtNet(0) === '$0' &&
      fmtPctAscii(0.0412) === '+0.04%' && fmtPctAscii(-1.2) === '-1.20%' && fmtPctAscii(0.004) === '+0.004%' && fmtPctAscii(12.34) === '+12.3%' && fmtPctAscii(null) === 'n/a' && fmtPctAscii(-0.0001) === '0.00%' &&
      fmtPx(81_279.4) === '81,279' && fmtPx(2_512.44) === '2,512.4' && fmtPx(182.346) === '182.35' && fmtPx(0.132481) === '0.1325' && fmtPx(null) === 'n/a' && fmtAgo(40_400) === '40s ago' && fmtAgo(185_000) === '3m ago')

  // ── The chips ─────────────────────────────────────────────────────────
  const universe = [
    { market: 'BTC', venue: 'hyperliquid' as const, chainId: null },
    { market: 'xyz:NVDA', venue: 'hyperliquid' as const, chainId: null },
    { market: 'xyz:XYZ100', venue: 'hyperliquid' as const, chainId: null },
    { market: 'ETH', venue: 'lighter' as const, chainId: null },
    { market: 'OPENAI', venue: 'lighter-robinhood' as const, chainId: null },
    { market: 'WETH', venue: 'dex' as const, chainId: 8453 },
    { market: 'cbBTC', venue: 'dex' as const, chainId: 8453 },
    { market: 'LINK', venue: 'dex' as const, chainId: 42161 },
    { market: 'kPEPE', venue: 'hyperliquid' as const, chainId: null },
  ]
  const composed = universe.flatMap((u) => [plotAsks(u.market, { netUsd: 1 }, u), plotAsks(u.market, { netUsd: -1 }, u)].flat().map((a) => ({ a, u })))
  const verbatim = composed.every(({ a, u }) => (['buy', 'sell'] as const).some((side) => JSON.stringify(followAsk({ market: u.market, side, venue: u.venue, chainId: u.chainId })) === JSON.stringify(a)))
  check('flyover chips: every ask a plot offers is lib/tape followAsk answered verbatim, for the buy side and the sell side (a perp gets Long and Short, a stock perp the Robinhood Chain buy, a DEX coin its chain\'s buy and no sell), the side carrying the flow first',
    verbatim && composed.length > 0 && plotAsks('BTC', { netUsd: 5 }, universe[0]).map((a) => a.ask).join(' / ') === 'Long $25 of BTC on Hyperliquid / Short $25 of BTC on Hyperliquid' &&
      plotAsks('BTC', { netUsd: -5 }, universe[0])[0].ask === 'Short $25 of BTC on Hyperliquid' && plotAsks('WETH', { netUsd: -5 }, universe[5]).map((a) => a.ask).join(' / ') === 'Buy $25 of ETH on Base' &&
      plotAsks('xyz:NVDA', null, universe[1]).map((a) => a.ask).join(' / ') === 'Buy $25 of NVDA' && plotAsks('xyz:XYZ100', null, universe[2]).length === 0 && plotAsks('kPEPE', null, universe[8]).length === 0, JSON.stringify(composed.map((c) => c.a.ask)))
  check('flyover chips: every sentence lands native on the ladder (a perp on the Hyperliquid gate, a spot buy on the swap gate) — never the planner',
    composed.filter(({ a }) => a.venue !== 'robinhood').every(({ a }) => simulateLadder(a.ask).gate !== 'planner') && simulateLadder('Long $25 of BTC on Hyperliquid').gate !== 'planner' && simulateLadder('Buy $25 of ETH on Base').gate === 'swap')

  // ── The sky ───────────────────────────────────────────────────────────
  let sky = pushSky([], fill({ id: 'm1', usd: 86_300, price: 81_279, at: T0 - 12_000 }))
  sky = pushSky(sky, fill({ id: 'small', usd: 49_999 }))
  sky = pushSky(sky, fill({ id: 'm1', usd: 86_300, price: 81_279, at: T0 - 12_000 }))
  for (let i = 0; i < 12; i++) sky = pushSky(sky, fill({ id: `mm${i}`, usd: 60_000 + i, at: T0 - 100_000 + i }))
  check('flyover sky: a meteor is one fill of $50K or more (the tape\'s big-print bar); the log keeps the newest eight, one row per fill, past tense in ASCII',
    isBigPrint({ usd: 50_000 }) && !isBigPrint({ usd: 49_999 }) && DEFAULT_THRESHOLDS.bigPrintUsd === 50_000 && SKY_LOG_ROWS === 8 && sky.length === 8 && sky[0].id === 'm1' && new Set(sky.map((r) => r.id)).size === 8 &&
      skyLine(pushSky([], fill({ id: 'q', usd: 86_300, price: 81_279, at: T0 - 12_000 }))[0], T0) === '$86.3K bought BTC at 81,279 on HyperCore, 12s ago' && meteorTag({ usd: 86_300, market: 'BTC', side: 'buy' }) === '$86.3K BTC buy' &&
      skyLine({ id: 'd', at: T0, market: 'cbBTC', side: 'sell', usd: 120_000, price: 81_100, venue: 'dex', chainId: 8453 }, T0) === '$120K sold cbBTC at 81,100 on Base DEX, 0s ago')

  // ── The legend ────────────────────────────────────────────────────────
  check('flyover legend: every line ASCII; the first says what height means in THIS lens (net flow / everything traded / the price move) with its ladder; color, footprint, drops, the source (Dune credited, the fallback named) and the rule that nothing fires',
    FLYOVER_WINDOWS.every((w) => LENSES.every((l) => LEGEND_LINES(w, l).every((s) => ASCII.test(s)) && LEGEND_LINES(w, l, 'hyperliquid').every((s) => ASCII.test(s)))) &&
      /^Height = net taker flow over the last 5m/.test(LEGEND_LINES('5m', 'flow')[0]) && LEGEND_LINES('5m', 'flow')[0].includes(`Stories: 1 = $45.0K, 2 = $495K, 3 = ${fmtUsd3(storyUsd(3, '5m'))};`) &&
      /^Height = everything traded/.test(LEGEND_LINES('1m', 'activity')[0]) && /^Height = the price move over the last 15m/.test(LEGEND_LINES('15m', 'move')[0]) && /\+3\.00%/.test(LEGEND_LINES('15m', 'move')[0]) &&
      /full color at \+\/-1\.50%/.test(LEGEND_LINES('5m', 'flow')[1]) && /24h volume/.test(LEGEND_LINES('5m', 'flow')[2]) && /\$50\.0K or more/.test(LEGEND_LINES('5m', 'flow')[3]) &&
      /^Fills: Dune real-time feeds, live/.test(LEGEND_LINES('5m', 'flow')[4]) && /Hyperliquid's own trades socket/.test(LEGEND_LINES('5m', 'flow', 'hyperliquid')[4]) &&
      LEGEND_LINES('5m', 'flow')[5] === 'Every plot is a sentence your wallet can sign - nothing fires on its own.', JSON.stringify(LEGEND_LINES('5m', 'flow')))

  // ── The share ─────────────────────────────────────────────────────────
  const share = parseLiveShare({ view: 'flyover', t: 'HYPE,BTC', since: '4h' })
  check('flyover share: a shared /live?view=flyover&t=... names the view (title, description, card words) and carries no battle window; nothing it prints has a control character',
    share?.view === 'flyover' && share.since === '1h' && share.markets.join(',') === 'HYPE,BTC' && shareTitle('flyover', ['HYPE', 'BTC']) === 'HYPE · BTC on The Flyover' && shareText('flyover', ['HYPE']) === 'HYPE on The Flyover' &&
      /The Flyover/.test(shareDescription('flyover', ['HYPE'])) && cardEyebrow('flyover', '1h') === 'THE FLYOVER · YOUR MARKETS' && cardTagline('flyover') === 'on The Flyover.' && cardTagline('tape') === 'on the live tape.' && cardTagline('front') === 'on The Front.' &&
      /FLY OVER/.test(cardFoot('flyover')) && cardRankNote('flyover', '1h').length === 2 && ![shareTitle('flyover', ['HYPE']), shareDescription('flyover', ['HYPE'])].some((s) => /[\u0000-\u001f]/.test(s)))

  // ── The page ──────────────────────────────────────────────────────────
  check('flyover page: three is imported ONLY by the scene module, and the scene only through a dynamic import after mount (the server bundle and the other views never load it); lib/flyover imports no three and no DOM',
    (() => {
      const lib = readFileSync('lib/flyover.ts', 'utf8')
      const shell = readFileSync('components/live/Flyover.tsx', 'utf8')
      const scene = readFileSync('components/live/flyover-scene.ts', 'utf8')
      const surface = readFileSync('components/live/LiveSurface.tsx', 'utf8')
      const noComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
      const libCode = noComments(lib)
      return !/from ['"]three/.test(libCode) && !/\b(window|document|requestAnimationFrame|fetch)\b/.test(libCode) && /from 'three'/.test(scene) && /three\/examples\/jsm\/controls\/OrbitControls\.js/.test(scene) &&
        !/from ['"]three/.test(noComments(shell)) && /import\(['"]\.\/flyover-scene['"]\)/.test(shell) && !/import [^(]*from ['"]\.\/flyover-scene['"]/.test(shell.replace(/import type[^\n]*\n/g, '')) &&
        /view === 'flyover' \? <Flyover/.test(surface) && !/from ['"]three/.test(noComments(surface))
    })())
  check('flyover page: every act goes through the connect-to-act door into the ask door\'s sheet, every chip is gated by canTradeAsk, inks come from the tokens probe, the relay is the firehose with its backfill, reduced motion and a hidden tab are honored, and nothing posts a chat turn',
    (() => {
      const shell = readFileSync('components/live/Flyover.tsx', 'utf8')
      const scene = readFileSync('components/live/flyover-scene.ts', 'utf8')
      const css = readFileSync('components/live/flyover.css', 'utf8')
      const page = readFileSync('app/live/page.tsx', 'utf8')
      const tabs = readFileSync('components/live/LiveTabs.tsx', 'utf8')
      return /useConnectToAct\(\{ run, redirectFor: promptHref \}\)/.test(shell) && /openDoor\(ask, \{ send: true, mcps: askAppSlugs\(ask\) \}\)/.test(shell) && /canTradeAsk\(a\.ask, tradable\)/.test(shell) && /readTokens\(\)/.test(shell) &&
        /openDuneTape\(\[\], /.test(shell) && /filter: false, backfill: true/.test(shell) && /hlTapeFeed\.connect\(/.test(shell) && /prefers-reduced-motion: reduce/.test(shell) && /pulseStreamWanted\(/.test(shell) && !/fetch\(['"`]\/api\/chat/.test(shell) &&
        /dispose\(\)/.test(scene) && !/var\(--/.test(scene) && /html\[data-theme="light"\] \.flyover/.test(css) && /\.flyover:fullscreen/.test(css) && /flyover\.css/.test(page) && /'w', 'lens'/.test(tabs)
    })())
}

if (process.argv[1]?.endsWith('flyover-pins.ts')) {
  let failed = 0
  let passed = 0
  flyoverPins((name, ok, extra) => {
    if (!ok) failed++
    else passed++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
  })
  console.log(failed ? `\n${failed} failed, ${passed} passed` : `\nall ${passed} flyover pins green`)
  process.exit(failed ? 1 : 0)
}
