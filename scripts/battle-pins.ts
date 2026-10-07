// Pins for the battle views on /live (lib/battle): views and the URL, windows
// and anchors, samples, the percent track, the range, strength and units,
// bursts, rank, the picker, the Siege's polar rules, the Map's bands,
// formats, and the page's door. Pure: no server, no socket, no DB. Called
// from scripts/test-api.ts, and runnable alone:
//   npx tsx scripts/battle-pins.ts
import { readFileSync } from 'node:fs'
import {
  ARMY_SLOTS,
  BURST_UNITS,
  DEFAULT_PICK,
  DEFAULT_WINDOW,
  FALLBACK_ARMIES,
  FRONT_WINDOWS,
  LIVE_VIEWS,
  MAX_ARMIES,
  MIN_HALF_RANGE_PCT,
  PICK_MIN_OI_USD,
  SIEGE_INNER,
  ARMY_MEMORY_KEY,
  HELD_ARMY_MIN_USD,
  addOwnMarkets,
  anchorFor,
  armyLabel,
  armySourceWord,
  burstsOf,
  candleSamples,
  contextFrom,
  dayChangePct,
  fieldUnit,
  fitRange,
  fmtFunding,
  fmtPct,
  glyphsFor,
  heldArmies,
  isBattleView,
  liveUrl,
  mapBands,
  mergeSamples,
  oiUsd,
  openingArmies,
  parseArmyMemory,
  parseFrontTokens,
  parseFrontWindow,
  parseLiveView,
  parsePickMode,
  pctTicks,
  percentOf,
  pickList,
  pushSample,
  rankArmies,
  resolveMarket,
  serializeArmyMemory,
  siegeAngle,
  siegeRadius,
  siegeSectors,
  spreadFlags,
  strengthOf,
  trackOf,
  windowMinutes,
  type ArmyContext,
  type PricePoint,
} from '../lib/battle'
import { composeExecAsk } from '../lib/trade-asks'
import { chartPairFor } from '../lib/charts'
import { followAsk, type TapeFill } from '../lib/tape'
import { isMarketsPath } from '../lib/markets'
import { isPublicAppPath } from '../lib/app-entry'

type Check = (name: string, ok: boolean, extra?: string) => void

const T0 = 1_791_298_000_000
const MIN = 60_000
const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps
const fill = (over: Partial<TapeFill> & { id: string }): TapeFill => ({
  market: 'HYPE', side: 'buy', size: 1, price: 100, usd: 100, at: T0, taker: '0xabc', maker: null, hash: null, effect: null, block: null, source: 'hyperliquid', ...over,
})
const ctx = (markPx: number, oiCoins: number, prevDayPx: number): ArmyContext => ({ markPx, openInterest: oiCoins, funding: 0.00001, prevDayPx, dayNtlVlm: 1e6 })

export function battlePins(check: Check): void {
  // ── Views and the URL ─────────────────────────────────────────────────
  check('battle: /live has four views — the tape and three battle projections; an unknown view is the tape; the URL spells only what is not default and round-trips',
    LIVE_VIEWS.map((v) => v.id).join(',') === 'tape,front,siege,map' && parseLiveView('siege') === 'siege' && parseLiveView('nope') === 'tape' && parseLiveView(null) === 'tape' && isBattleView('map') && !isBattleView('tape') &&
      liveUrl('tape', [], '1h') === '/live' && liveUrl('front', ['BTC', 'xyz:NVDA'], '15m') === '/live?view=front&t=BTC%2Cxyz%3ANVDA&since=15m' && liveUrl('map', ['ETH'], '1h') === '/live?view=map&t=ETH' &&
      parseFrontTokens(new URLSearchParams(liveUrl('front', ['BTC', 'xyz:NVDA'], '15m').split('?')[1]).get('t')).join(',') === 'BTC,xyz:NVDA')

  // ── Windows ───────────────────────────────────────────────────────────
  check('battle: five windows — since open (no minutes), 15m, 1h, 4h, 24h; the default is 1h; an unknown word is the default',
    FRONT_WINDOWS.map((w) => w.id).join(',') === 'open,15m,1h,4h,24h' && windowMinutes('open') === null && windowMinutes('4h') === 240 && parseFrontWindow('24h') === '24h' && parseFrontWindow('yesterday') === DEFAULT_WINDOW && parseFrontWindow(null) === '1h')

  // ── Armies from the URL ───────────────────────────────────────────────
  check('battle: tokens parse in any case, a HIP-3 market keeps its xyz: prefix, duplicates collapse, the list caps at five, junk is dropped; five slots, five inks',
    parseFrontTokens('btc, eth,XYZ:nvda,btc,hype,sol,doge').join(',') === 'BTC,ETH,xyz:NVDA,HYPE,SOL' && parseFrontTokens('0x1234,;;,  ').length === 0 && parseFrontTokens(null).length === 0 && MAX_ARMIES === 5 && ARMY_SLOTS.length === 5 &&
      FALLBACK_ARMIES.length === 3 && armyLabel('HYPE') === 'HYPE' && armyLabel('xyz:NVDA') === 'NVDA·xyz')

  // ── The picker ────────────────────────────────────────────────────────
  const ctxs = new Map<string, ArmyContext>([
    ['BTC', ctx(86_000, 50_000, 85_000)], // +1.18%, OI $4.3B
    ['ETH', ctx(2_700, 1_000_000, 2_800)], // −3.57%, OI $2.7B
    ['HYPE', ctx(93, 12_000_000, 90)], // +3.33%, OI $1.1B
    ['DUST', ctx(0.01, 1_000, 0.001)], // +900%, OI $10: thin, never listed
    ['xyz:XYZ100', ctx(100, 1_000_000, 90)], // the dex index: never listed
    ['xyz:NVDA', ctx(242, 100_000, 240)], // +0.83%, OI $24M
  ])
  const gainers = pickList(ctxs, 'gainers')
  const biggest = pickList(ctxs, 'biggest')
  check('battle: the pick list is the venue\'s own rows — gainers by day change, the biggest by open interest — with a floor on open interest so a thin perp\'s wild day never leads, and the dex index never listed',
    gainers.map((r) => r.market).join(',') === 'HYPE,BTC,xyz:NVDA,ETH' && biggest.map((r) => r.market).join(',') === 'BTC,ETH,HYPE,xyz:NVDA' && near(gainers[0].dayPct!, (93 / 90 - 1) * 100) && biggest[0].oiUsd === 4.3e9 && PICK_MIN_OI_USD === 2_000_000 && pickList(ctxs, 'gainers', 2).length === 2 && DEFAULT_PICK === 3 && parsePickMode('biggest') === 'biggest' && parsePickMode('x') === 'gainers', `${gainers.map((r) => r.market)} / ${biggest.map((r) => r.market)}`)

  // ── Your own armies ───────────────────────────────────────────────────
  const uni = ['BTC', 'ETH', 'NEAR', 'kPEPE', 'xyz:NVDA', 'xyz:AAPL', 'HYPE']
  check('battle: a typed name resolves to the venue\'s spelling — near → NEAR, pepe → kPEPE, nvda → xyz:NVDA, XYZ:aapl → xyz:AAPL; a name the venue lists nothing for is null; an unknown universe accepts the typed shape',
    resolveMarket('near', uni) === 'NEAR' && resolveMarket('pepe', uni) === 'kPEPE' && resolveMarket('KPEPE', uni) === 'kPEPE' && resolveMarket('nvda', uni) === 'xyz:NVDA' && resolveMarket('XYZ:aapl', uni) === 'xyz:AAPL' && resolveMarket('doge', uni) === null && resolveMarket('0x12', uni) === null && resolveMarket('doge', []) === 'DOGE')
  const own = addOwnMarkets('near, pepe sol,nvda,btc, eth', uni, ['BTC', 'HYPE'])
  const fullAdd = addOwnMarkets('near pepe nvda', uni, ['BTC', 'ETH', 'HYPE', 'xyz:AAPL'])
  check('battle: several of your own at once — commas or spaces, each resolved, the already-picked skipped, the unknown named, the ones past the cap named as not fitting',
    own.added.join(',') === 'NEAR,kPEPE,xyz:NVDA' && own.unknown.join(',') === 'sol' && own.full.join(',') === 'ETH' && fullAdd.added.join(',') === 'NEAR' && fullAdd.full.join(',') === 'kPEPE,xyz:NVDA' && addOwnMarkets('', uni, []).added.length === 0, JSON.stringify([own, fullAdd]))

  // ── Samples ───────────────────────────────────────────────────────────
  const cs = candleSamples([{ t: T0, T: T0 + 59_999, o: '100', c: '101' }, { t: T0 + MIN, T: T0 + 2 * MIN - 1, o: '101', c: 'nope' }])
  check('battle: a one-minute candle becomes its open at the bar\'s start and its close at its end; an unreadable close is skipped', cs.length === 3 && cs[0].t === T0 && cs[0].p === 100 && cs[1].t === T0 + 59_999 && cs[1].p === 101 && cs[2].t === T0 + MIN && cs[2].p === 101)
  const merged = mergeSamples([{ t: T0 + 500, p: 1 }, { t: T0 + 2000, p: 3 }], [{ t: T0 + 900, p: 2 }, { t: T0 - 10 * MIN, p: 9 }, { t: T0 + 2000, p: 0 }], T0 - MIN)
  check('battle: merging keeps one sample a second (the newest in the second wins), sorted, dropping anything before the keep edge and any price that is not a price',
    merged.length === 2 && merged[0].t === T0 + 900 && merged[0].p === 2 && merged[1].t === T0 + 2000 && merged[1].p === 3, JSON.stringify(merged))
  const live: PricePoint[] = []
  const r1 = pushSample(live, { t: T0, p: 10 })
  const r2 = pushSample(live, { t: T0 + 300, p: 11 })
  const r3 = pushSample(live, { t: T0 - 5000, p: 1 })
  const r4 = pushSample(live, { t: T0 + 1500, p: 12 })
  check('battle: a live sample appends in place — the same second is replaced by the newer, an older stamp is refused, a new second is pushed', r1 && r2 && !r3 && r4 && live.length === 2 && live[0].p === 11 && live[1].p === 12 && !pushSample(live, { t: T0 + 2000, p: NaN }))

  // ── Anchors and the track ─────────────────────────────────────────────
  const series: PricePoint[] = []
  for (let i = 0; i <= 120; i++) series.push({ t: T0 - 120 * MIN + i * MIN, p: 100 + i * 0.1 })
  const a1h = anchorFor(series, '1h', T0, T0 - 5 * MIN)
  const aOpen = anchorFor(series, 'open', T0, T0 - 5 * MIN)
  const a24 = anchorFor(series, '24h', T0, T0)
  check('battle: a minute window anchors on the first sample at or after its left edge; "since open" anchors on the first sample after the page opened; a series that starts inside the window is marked partial and anchors on its first sample',
    !!a1h && a1h.t === T0 - 60 * MIN && near(a1h.p, 106) && !a1h.partial && !!aOpen && aOpen.t === T0 - 5 * MIN && !aOpen.partial && !!a24 && a24.t === T0 - 120 * MIN && a24.partial && anchorFor([], '1h', T0, T0) === null, JSON.stringify([a1h, aOpen, a24]))
  const track = trackOf(series, a1h!)
  check('battle: the track runs from the anchor on, in percent of the anchor price', track.length === 61 && near(track[0].pct, 0) && near(track[60].pct, (112 / 106 - 1) * 100) && near(percentOf(53, a1h!), -50))

  // ── The range ─────────────────────────────────────────────────────────
  const flat = fitRange([0.01, -0.02])
  const up = fitRange([2, 1.5, 0.4])
  const both = fitRange([3, -1])
  check('battle: the range always holds the horizon, pads 15% past the furthest line, and a flat field still shows a quarter percent each way',
    near(flat.lo, -MIN_HALF_RANGE_PCT) && near(flat.hi, MIN_HALF_RANGE_PCT) && near(up.lo, -0.3) && near(up.hi, 2.3) && near(both.lo, -1.6) && near(both.hi, 3.6) && fitRange([]).hi === MIN_HALF_RANGE_PCT, JSON.stringify([flat, up, both]))
  check('battle: grid lines are a round step giving four to nine lines', pctTicks({ lo: -0.3, hi: 2.3 }).join(',') === '0,0.5,1,1.5,2' && pctTicks({ lo: -0.25, hi: 0.25 }).length >= 4 && pctTicks({ lo: -0.25, hi: 0.25 }).length <= 9 && pctTicks({ lo: -12, hi: 30 }).join(',') === '-10,-5,0,5,10,15,20,25,30')

  // ── Strength, units, bursts ───────────────────────────────────────────
  const fills = [
    fill({ id: 'a', at: T0 - 1000, usd: 30_000, side: 'buy' }),
    fill({ id: 'b', at: T0 - 20_000, usd: 10_000, side: 'sell' }),
    fill({ id: 'c', at: T0 - 30_000, usd: 125_000, side: 'buy', price: 101 }),
    fill({ id: 'd', at: T0 - 40_000, usd: 5_000, side: 'buy', market: 'ETH' }),
    fill({ id: 'e', at: T0 - 70_000, usd: 900_000, side: 'sell' }),
  ].sort((x, y) => y.at - x.at)
  const s = strengthOf(fills, 'HYPE', T0)
  check('battle: strength is the last sixty seconds of one army\'s fills — buys, sells, net, count, the buy share; a fill past the minute is out', s.buyUsd === 155_000 && s.sellUsd === 10_000 && s.netUsd === 145_000 && s.fills === 3 && s.buyPct === 94 && strengthOf(fills, 'SOL', T0).buyPct === null, JSON.stringify(s))
  const unit = fieldUnit([s, strengthOf(fills, 'ETH', T0)])
  check('battle: the field\'s unit keeps the strongest side under twenty glyphs and is shared by every army; glyphs round, none under half a unit', unit === 10_000 && glyphsFor(155_000, unit) === 16 && glyphsFor(4_000, unit) === 0 && glyphsFor(6_000, unit) === 1 && fieldUnit([]) === 10_000)
  const bursts = burstsOf(fills, 'HYPE', unit, T0 - 60_000)
  check('battle: a burst is a fill of four units or more, inside the window, in time order, carrying its own price', BURST_UNITS === 4 && bursts.length === 1 && bursts[0].id === 'c' && bursts[0].price === 101 && burstsOf(fills, 'HYPE', unit, T0 - 120_000).length === 2 && burstsOf(fills, 'HYPE', unit, T0 - 120_000)[0].id === 'e')

  // ── Rank ──────────────────────────────────────────────────────────────
  const ranked = rankArmies(['a', 'b', 'c', 'd'], (m) => ({ a: -1, b: 2, c: null, d: 2.5 } as Record<string, number | null>)[m])
  check('battle: rank is most ground first; an army with no ground yet ranks last', ranked.map((r) => `${r.army}${r.rank}`).join(',') === 'd1,b2,a3,c4' && ranked[3].pct === null)

  // ── The Siege ─────────────────────────────────────────────────────────
  const two = siegeSectors(2)
  const one = siegeSectors(1)
  const range = { lo: -1, hi: 3 }
  check('battle: the siege gives every army an equal sector from three o\'clock round, two armies face left and right, one army owns the circle; the most ground stands nearest the hill, the least at the camp on the edge; time sweeps a sector with a margin kept',
    two.length === 2 && near(two[0].start, -Math.PI / 2) && near(two[0].end, Math.PI / 2) && near(two[1].end, (3 * Math.PI) / 2) && one.length === 1 && near(one[0].end - one[0].start, Math.PI * 2) &&
      near(siegeRadius(3, range, 100), 100 * SIEGE_INNER) && near(siegeRadius(-1, range, 100), 100) && near(siegeRadius(1, range, 100), 100 * (SIEGE_INNER + (1 - SIEGE_INNER) * 0.5)) && siegeRadius(9, range, 100) === 100 * SIEGE_INNER &&
      near(siegeAngle(T0 - 60_000, T0 - 60_000, T0, two[0]), -Math.PI / 2 + Math.PI * 0.05) && near(siegeAngle(T0, T0 - 60_000, T0, two[0]), Math.PI / 2 - Math.PI * 0.05) && near(siegeAngle(T0 + 999, T0 - 60_000, T0, two[0]), Math.PI / 2 - Math.PI * 0.05))

  // ── Flags ─────────────────────────────────────────────────────────────
  const spread = spreadFlags([100, 104, 300, 102], 30, 20, 400)
  const pinned = spreadFlags([395, 398], 30, 20, 400)
  check('battle: flags keep their fronts\' order and at least the gap between them, inside the field; a crowd at the bottom edge is pushed up, not off',
    spread[0] === 100 && spread[3] === 130 && spread[1] === 160 && spread[2] === 300 && pinned[1] === 400 && pinned[0] === 370 && spreadFlags([], 30, 0, 10).length === 0, JSON.stringify([spread, pinned]))

  // ── The Map ───────────────────────────────────────────────────────────
  const bands = mapBands([4.3e9, 2.7e9, 1.1e9], 1000)
  const minned = mapBands([1e9, 1e6], 400)
  const unknown = mapBands([null, null], 500)
  check('battle: the map\'s bands are as wide as each army\'s open-interest share with gaps between, a small army still gets its minimum width taken from the widest, and unknown open interest reads as equal shares',
    bands.length === 3 && near(bands[0].share, 4.3 / 8.1) && near(bands[0].w + bands[1].w + bands[2].w, 980) && near(bands[1].x, bands[0].w + 10) && minned[1].w === 72 && near(minned[0].w + minned[1].w, 390) && near(unknown[0].share, 0.5) && near(unknown[0].w, 245) && mapBands([], 500).length === 0, JSON.stringify([bands, minned]))

  // ── The recruit chip is the tape\'s own follow sentence ─────────────
  const longAsk = followAsk({ market: 'HYPE', side: 'buy' })
  check('battle: the recruit chip is the markets\' own grammar — a coin recruits as the perp long/short, an xyz stock as the spot buy', longAsk?.ask === composeExecAsk(chartPairFor('HYPE')!, 'long', { usd: 25 }) && followAsk({ market: 'xyz:NVDA', side: 'buy' })?.ask === 'Buy $25 of NVDA' && followAsk({ market: 'xyz:GOLD', side: 'buy' }) === null)

  // ── Context ───────────────────────────────────────────────────────────
  const c = contextFrom({ markPx: '92.5', openInterest: '1000000', funding: '0.0000125', prevDayPx: '90', dayNtlVlm: '474000000' })
  check('battle: the venue\'s context row reads mark, OI in dollars, funding per hour and the day change; a row with no mark is nothing', !!c && oiUsd(c) === 92_500_000 && near(dayChangePct(c)!, (92.5 / 90 - 1) * 100) && fmtFunding(c.funding) === '+0.0013%/h' && contextFrom({ markPx: 'x', openInterest: '1', funding: '0', prevDayPx: '1', dayNtlVlm: '1' }) === null)


  // ── Memory and holdings (2026-10-07) ─────────────────────────────────
  check('battle memory: a hand-set field round-trips through localStorage in the venue\'s spelling with its pick mode; any defect — not JSON, wrong version, no usable army — reads as nothing remembered, and unknown shapes drop',
    (() => {
      const m = { armies: ['xyz:NVDA', 'kPEPE', 'ETH'], pick: 'biggest' as const, at: T0 }
      const back = parseArmyMemory(serializeArmyMemory(m))
      const raw = serializeArmyMemory({ armies: ['HYPE', 'bad token!', 'SOL'], pick: 'gainers', at: T0 })
      return ARMY_MEMORY_KEY === 'pantessa.live.armies.v1' && JSON.stringify(back) === JSON.stringify(m) &&
        parseArmyMemory(null) === null && parseArmyMemory('') === null && parseArmyMemory('{nope') === null && parseArmyMemory('[]') === null &&
        parseArmyMemory(JSON.stringify({ v: 2, armies: ['ETH'] })) === null && parseArmyMemory(JSON.stringify({ v: 1, armies: [] })) === null &&
        parseArmyMemory(JSON.stringify({ v: 1, armies: 'ETH' })) === null && parseArmyMemory(JSON.stringify({ v: 1, armies: ['!!', 7] })) === null &&
        JSON.stringify(parseArmyMemory(raw)?.armies) === '["HYPE","SOL"]' && JSON.stringify(parseArmyMemory(JSON.stringify({ v: 1, armies: ['kPEPE', 'XYZ:nvda', 'kPEPE'] }))?.armies) === '["kPEPE","xyz:nvda"]' && parseArmyMemory(JSON.stringify({ v: 1, armies: ['eth'], pick: 'odd', at: 'x' }))?.pick === 'gainers' &&
        parseArmyMemory(JSON.stringify({ v: 1, armies: ['eth'] }))?.at === 0 &&
        parseArmyMemory(JSON.stringify({ v: 1, armies: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] }))!.armies.length === MAX_ARMIES
    })())
  check('battle held: a wallet\'s holdings raise armies biggest first in the venue\'s spelling — a Robinhood-Chain stock is its xyz perp, cbBTC and WBTC are one BTC army, WETH is ETH — never a stable, never dust, never an unpriced row, never a coin the venue lists no market for, capped at the field, and nothing while the venue\'s list is unknown',
    (() => {
      const uni = ['BTC', 'ETH', 'HYPE', 'SOL', 'kPEPE', 'xyz:AAPL', 'xyz:NVDA', 'UNI', 'LINK', 'DOGE']
      const held = [
        { symbol: 'USDC', valueUsd: 5000 },
        { symbol: 'ETH', valueUsd: 120 },
        { symbol: 'cbBTC', valueUsd: 900 },
        { symbol: 'WBTC', valueUsd: 50 },
        { symbol: 'AAPL', valueUsd: 40 },
        { symbol: 'WETH', valueUsd: 300 },
        { symbol: 'PEPE', valueUsd: 30 },
        { symbol: 'FARTCOIN', valueUsd: 25 },
        { symbol: 'UNI', valueUsd: 0.4 },
        { symbol: 'LINK', valueUsd: null },
        { symbol: 'DOGE', valueUsd: 2 },
        { symbol: 'SOL', valueUsd: 3 },
      ]
      const got = heldArmies(held, uni)
      return JSON.stringify(got) === '["BTC","ETH","xyz:AAPL","kPEPE","SOL"]' && got.length === MAX_ARMIES &&
        JSON.stringify(heldArmies(held, uni, 2)) === '["BTC","ETH"]' &&
        heldArmies(held, []).length === 0 && heldArmies([], uni).length === 0 &&
        heldArmies([{ symbol: 'USDT', valueUsd: 1e6 }, { symbol: 'DAI', valueUsd: 10 }, { symbol: 'USDG', valueUsd: 10 }], uni).length === 0 &&
        heldArmies([{ symbol: 'ETH', valueUsd: HELD_ARMY_MIN_USD }], uni).length === 1 && heldArmies([{ symbol: 'ETH', valueUsd: HELD_ARMY_MIN_USD - 0.01 }], uni).length === 0
    })())
  check('battle opening: the URL\'s armies lead, then this browser\'s hand-set memory, then the wallet\'s holdings, then the venue\'s pick, then the fallback; the venue\'s pick waits while a wallet may still answer and never while nobody will',
    (() => {
      const memory = { armies: ['UNI'], pick: 'gainers' as const, at: T0 }
      const venue = ['AAOI', 'ZRO', 'GRIFFAIN']
      const o = (over: Partial<Parameters<typeof openingArmies>[0]>) => openingArmies({ url: [], memory: null, held: null, venue, waitForHeld: false, ...over })
      return o({ url: ['HYPE'], memory, held: ['ETH'] })?.source === 'url' && o({ memory, held: ['ETH'] })?.source === 'memory' &&
        JSON.stringify(o({ held: ['BTC', 'ETH'] })) === JSON.stringify({ armies: ['BTC', 'ETH'], source: 'held' }) &&
        o({ held: null, waitForHeld: true }) === null && o({ held: [], waitForHeld: true })?.source === 'venue' &&
        o({ held: null, waitForHeld: false })?.source === 'venue' && o({ held: ['ETH'], waitForHeld: true })?.source === 'held' &&
        JSON.stringify(o({ venue: [] })?.armies) === JSON.stringify(FALLBACK_ARMIES) && o({ venue: [] })?.source === 'fallback' &&
        o({ venue: [], held: null, waitForHeld: true }) === null &&
        armySourceWord('held') === 'from your wallet' && armySourceWord('memory') === 'as you left them' && armySourceWord('url') === null && armySourceWord('venue') === null && armySourceWord('hand') === null
    })())
  check('battle memory: the page reads the wallet\'s holdings through the shared read, decides the opening pick with the rule, writes the memory only after a hand touched the picker (the three hand actions mark it), and holds the opening while a wallet may still answer',
    (() => {
      const src = readFileSync('components/live/Battle.tsx', 'utf8')
      const hands = (src.match(/byHand\(\)/g) ?? []).length
      return /useHeld\(\)/.test(src) && /heldArmies\(held, universe\)/.test(src) && /openingArmies\(\{/.test(src) &&
        /if \(!handRef\.current \|\| !armies\.length\) return\n\s*writeArmyMemory\(/.test(src) && hands === 3 &&
        /waitForHeld: !signedOut && !heldWaited/.test(src) && /localStorage\.getItem\(ARMY_MEMORY_KEY\)/.test(src) && /localStorage\.setItem\(ARMY_MEMORY_KEY/.test(src) &&
        /armySourceWord\(source\)/.test(src) && !/FALLBACK_ARMIES/.test(src)
    })())

  // ── Formats ───────────────────────────────────────────────────────────
  check('battle: percent prints with its sign and the places the size deserves', fmtPct(2.312) === '+2.31%' && fmtPct(-0.06) === '−0.06%' && fmtPct(0.004) === '+0.004%' && fmtPct(12.34) === '+12.3%' && fmtPct(0) === '0.00%' && fmtPct(null) === '—')

  // ── The page ──────────────────────────────────────────────────────────
  check('battle: the views ride /live (a public markets-shell page), every act goes through the connect-to-act door into the ask door\'s sheet, the canvas reads its inks from the page\'s tokens, tracers stop under reduced motion, and the three projections are the three draws',
    isMarketsPath('/live') && isPublicAppPath('/live') && (() => {
      const src = readFileSync('components/live/Battle.tsx', 'utf8')
      const draw = readFileSync('components/live/battle-draw.ts', 'utf8')
      const css = readFileSync('components/live/battle.css', 'utf8')
      const surface = readFileSync('components/live/LiveSurface.tsx', 'utf8')
      return /useConnectToAct\(\{ run, redirectFor: promptHref \}\)/.test(src) && /openDoor\(ask, \{ send: true, mcps: askAppSlugs\(ask\) \}\)/.test(src) && /canTradeAsk\(f\.ask, tradable\)/.test(src) && /getPropertyValue\(name\)/.test(src) && /prefers-reduced-motion: reduce/.test(src) && !/fetch\(['"`]\/api\/chat/.test(src) &&
        /if \(view === 'front'\) drawFront/.test(src) && /else if \(view === 'map'\) drawMap/.test(src) && /else drawSiege/.test(src) && /if \(d\.reduced \|\| d\.paused\) return/.test(draw) &&
        /--army-5/.test(css) && /html\[data-theme="light"\] \.battle/.test(css) && /isBattleView\(view\)/.test(surface) && /addOwnMarkets\(raw, universe, armies\)/.test(src) && /insertReplacementText/.test(src) && /battle__addbtn/.test(src)
    })())
  check('battle: the venue reads are the browser\'s — candles, contexts and mids from the info API and the allMids socket; no server holds a socket and nothing is stored',
    (() => {
      const src = readFileSync('lib/battle-feed.ts', 'utf8')
      return /candleSnapshot/.test(src) && /metaAndAssetCtxs/.test(src) && /type: 'allMids', dex/.test(src) && /wss:\/\/api\.hyperliquid\.xyz\/ws/.test(src) && !/prisma|localStorage/.test(src)
    })())
}

if (process.argv[1]?.endsWith('battle-pins.ts')) {
  let failed = 0
  battlePins((name, ok, extra) => {
    if (!ok) failed++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
  })
  console.log(failed ? `\n${failed} failed` : '\nall battle pins green')
  process.exit(failed ? 1 : 0)
}
