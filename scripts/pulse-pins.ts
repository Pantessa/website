// Pins for the live pulse (lib/pulse — the band at the top of `/`, squad
// front-door 2026-10-06): the market pick and its fallback, the buffer
// window, the per-second bars, the tiles from a fixture of fills, the chip
// grammar (followAsk → canTradeAsk → the sentence lands on a native gate as
// an ACTION in the ladder replica), the hidden-tab policy, the words, and
// the SSR frame (the CSS heights equal the lib constants; the component
// wires the act door the way /live does). Pure: no server, no socket, no DB.
//   npx tsx scripts/pulse-pins.ts      (npm run pins:pulse)
import { readFileSync } from 'node:fs'
import {
  PULSE_BAND_MIN_H,
  PULSE_CHART_H,
  PULSE_CHART_H_PHONE,
  PULSE_FALLBACK_MARKETS,
  PULSE_FLUSH_MS,
  PULSE_HIDDEN_CLOSE_MS,
  PULSE_KEEP_MS,
  PULSE_LIVE_HREF,
  PULSE_MAX_FILLS,
  PULSE_PHONE_BUDGET_PX,
  PULSE_PICK,
  PULSE_TILE_WINDOW_SEC,
  PULSE_VIEW_LINKS,
  PULSE_WAITING,
  PULSE_WHY,
  PULSE_WINDOW_SEC,
  mergePulseFills,
  pickPulseMarkets,
  pulseBars,
  pulseLiveHref,
  pulseMarketsFrom,
  pulsePick,
  pulseNoChipWords,
  pulseStatusWords,
  pulseStreamWanted,
  pulseTiles,
  pulseVisibilityStep,
} from '../lib/pulse'
import { FALLBACK_MARKETS, TAPE_KEEP_MS, TAPE_MAX_FILLS, followAsk, mergeFills, subscriptionDelta, tapeMarket, type TapeFill } from '../lib/tape'
import { canTradeAsk } from '../lib/trade-venue-gate'
import { simulateLadder } from './ask-ladder'
import { isMarketsPath } from '../lib/markets'
import { isPublicAppPath } from '../lib/app-entry'

type Check = (name: string, ok: boolean, extra?: string) => void

// ── The fixture: ~40 fills over the last 100 seconds ──────────────────────
// Second-aligned so the bucket arithmetic reads plainly. `now` sits 950ms
// into the current second; the chart window is the 90 seconds ending on it.
const SEC = 1_791_292_800 // 2026-10-06 ~11:20Z
const NOW = SEC * 1000 + 950
const fill = (id: string, agoSec: number, over: Partial<TapeFill> = {}): TapeFill => ({
  id,
  market: 'HYPE',
  side: 'buy',
  size: 1,
  price: 42.5,
  usd: 500,
  at: (SEC - agoSec) * 1000 + 100,
  taker: '0x98da633cc3814857680eb313de6770b7a801f13b',
  maker: '0x46921f6961bdb411b756c9712f6bdb58fbd9164f',
  hash: null,
  effect: null,
  block: null,
  source: 'hyperliquid',
  ...over,
})
const FIXTURE: TapeFill[] = [
  // HYPE, the hot market: 12 fills in the last minute, $500 each, 7 bought / 5 sold = $6,000, 58% buys.
  ...Array.from({ length: 12 }, (_, i) => fill(`h${i}`, 2 + i * 4, { side: i % 12 < 7 ? 'buy' : 'sell' })),
  // BTC: three fills in the minute, $800 each, two sold.
  fill('b0', 5, { market: 'BTC', side: 'sell', usd: 800, price: 86047, size: 0.0093 }),
  fill('b1', 20, { market: 'BTC', side: 'sell', usd: 800, price: 86050, size: 0.0093 }),
  fill('b2', 40, { market: 'BTC', side: 'buy', usd: 800, price: 86040, size: 0.0093 }),
  // xyz:SNDK, a house-listed stock: the largest print of the minute, bought.
  fill('s0', 9, { market: 'xyz:SNDK', side: 'buy', usd: 2500, price: 1703, size: 1.468 }),
  fill('s1', 33, { market: 'xyz:SNDK', side: 'sell', usd: 300, price: 1702, size: 0.176 }),
  // xyz:GOLD and kPEPE: on the tape, no route — never a chip.
  fill('g0', 14, { market: 'xyz:GOLD', side: 'sell', usd: 900, price: 4012, size: 0.224 }),
  fill('k0', 27, { market: 'kPEPE', side: 'buy', usd: 120, price: 0.0098, size: 12245 }),
  // Nine fills 61–89s back: in the chart's window, out of the tiles' minute.
  ...Array.from({ length: 9 }, (_, i) => fill(`w${i}`, 61 + i * 3, { side: i % 2 ? 'sell' : 'buy', usd: 400, market: i % 3 ? 'ETH' : 'HYPE' })),
  // ETH: five fills in the minute, $200 each, three bought.
  ...Array.from({ length: 5 }, (_, i) => fill(`e${i}`, 7 + i * 10, { market: 'ETH', side: i < 3 ? 'buy' : 'sell', usd: 200, price: 1762, size: 0.1135 })),
  // Four fills in the current second (bucket 89): $100 bought ×3, $50 sold.
  fill('c0', 0, { usd: 100, at: SEC * 1000 + 10 }),
  fill('c1', 0, { usd: 100, at: SEC * 1000 + 400 }),
  fill('c2', 0, { usd: 100, at: SEC * 1000 + 700 }),
  fill('c3', 0, { usd: 50, side: 'sell', at: SEC * 1000 + 900 }),
  // Three fills past the chart's window (and one past the keep).
  fill('o0', 92, { usd: 9_000 }),
  fill('o1', 95, { usd: 9_000, side: 'sell' }),
  fill('o2', 120, { usd: 90_000 }),
].sort((a, b) => b.at - a.at)

export function pulsePins(check: Check): void {
  // ── The pick ──────────────────────────────────────────────────────────
  const picked = pickPulseMarkets(
    [{ name: 'BTC', volumeUsd: 100 }, { name: 'ETH', volumeUsd: 300 }, { name: 'HYPE', volumeUsd: 200 }, { name: 'DEAD', volumeUsd: 999, delisted: true }, { name: 'ZERO', volumeUsd: 0 }],
    [{ name: 'xyz:XYZ100', volumeUsd: 999 }, { name: 'xyz:CL', volumeUsd: 900 }, { name: 'xyz:GOLD', volumeUsd: 800 }, { name: 'xyz:TSLA', volumeUsd: 50 }, { name: 'xyz:INTC', volumeUsd: 70 }, { name: 'xyz:SP500', volumeUsd: 700 }],
    { main: 2, xyz: 3 },
  )
  check('pulse: the pick is the busiest main books by the venue\'s own 24h volume, then among xyz the stocks the house lists FIRST (their rows carry a button) and the busiest of the rest after; delisted, zero-volume and the dex index never make it',
    picked.join(',') === 'ETH,HYPE,xyz:INTC,xyz:TSLA,xyz:CL', picked.join(','))
  check('pulse: a smaller pick than /live — enough books to never be quiet (eight main books measured ~35 fills/s on 2026-10-06), few enough to read as one number',
    PULSE_PICK.main === 8 && PULSE_PICK.xyz === 4 && PULSE_PICK.main < 14 && PULSE_PICK.xyz < 8 && pickPulseMarkets([], []).length === 0)
  check('pulse: the fallback list is /live\'s, cut to the pulse\'s sizes, every xyz entry a house-listed stock, nothing the venue would refuse',
    PULSE_FALLBACK_MARKETS.length === PULSE_PICK.main + PULSE_PICK.xyz && PULSE_FALLBACK_MARKETS.every((m) => FALLBACK_MARKETS.includes(m)) && PULSE_FALLBACK_MARKETS.filter((m) => m.includes(':')).every((m) => tapeMarket(m).kind === 'stock') && !PULSE_FALLBACK_MARKETS.some((m) => /:XYZ100$/.test(m)) && new Set(PULSE_FALLBACK_MARKETS).size === PULSE_FALLBACK_MARKETS.length, PULSE_FALLBACK_MARKETS.join(','))

  const xyzOnly = [{ name: 'xyz:SNDK', volumeUsd: 9 }, { name: 'xyz:NVDA', volumeUsd: 8 }]
  const mainOnly = [{ name: 'BTC', volumeUsd: 9 }]
  check('pulse: a universe half the venue failed to answer keeps the fallback\'s half — one failed read never leaves four quiet stock books as the whole pulse (measured twice on 2026-10-06); both halves failing is the whole fallback',
    pulseMarketsFrom([], xyzOnly).join(',') === [...PULSE_FALLBACK_MARKETS.filter((m) => !m.includes(':')), 'xyz:SNDK', 'xyz:NVDA'].join(',') &&
      pulseMarketsFrom(mainOnly, []).join(',') === ['BTC', ...PULSE_FALLBACK_MARKETS.filter((m) => m.includes(':'))].join(',') &&
      pulseMarketsFrom([], []).join(',') === PULSE_FALLBACK_MARKETS.join(',') && pulseMarketsFrom(mainOnly, xyzOnly).join(',') === 'BTC,xyz:SNDK,xyz:NVDA', pulseMarketsFrom([], xyzOnly).join(','))
  const delta = subscriptionDelta(['BTC', 'ETH', 'xyz:AAPL'], ['ETH', 'HYPE', 'xyz:AAPL', 'HYPE'])
  check('pulse: re-aiming the open socket is a delta — subscribe what the pick adds, drop what it leaves, nothing for what stays (lib/tape subscriptionDelta; a duplicate counts once)',
    delta.add.join(',') === 'HYPE' && delta.drop.join(',') === 'BTC' && subscriptionDelta(['A'], ['A']).add.length === 0 && subscriptionDelta(['A'], ['A']).drop.length === 0 && subscriptionDelta([], ['A', 'B']).add.join(',') === 'A,B', JSON.stringify(delta))

  // ── The buffer ────────────────────────────────────────────────────────
  check('pulse: the buffer keeps the chart\'s whole window plus an edge bucket, covers the tiles\' minute, and its cap holds 120 fills/s across the keep (the 12-market pick measured 47/s) — a cap that bit inside the window would thin the oldest bars',
    PULSE_KEEP_MS >= (PULSE_WINDOW_SEC + 1) * 1000 && PULSE_KEEP_MS >= PULSE_TILE_WINDOW_SEC * 1000 && PULSE_MAX_FILLS >= 120 * (PULSE_KEEP_MS / 1000) && PULSE_WINDOW_SEC === 90 && PULSE_TILE_WINDOW_SEC === 60, `${PULSE_KEEP_MS} / ${PULSE_MAX_FILLS}`)
  const merged = mergePulseFills(FIXTURE, [fill('h0', 2), fill('new', 0, { at: NOW - 5 }), fill('new', 0, { at: NOW - 5 })], NOW)
  check('pulse: the fixture is forty fills; mergePulseFills merges newest first, drops a duplicate id held or repeated inside the batch, and ages out at the PULSE keep — while lib/tape mergeFills keeps its own 180s window and 4,000 cap untouched',
    FIXTURE.length === 40 && merged.length === FIXTURE.length - 1 + 1 && merged[0].id === 'new' && merged.every((f, i) => i === 0 || merged[i - 1].at >= f.at) && !merged.some((f) => f.id === 'o2') && merged.filter((f) => f.id === 'h0').length === 1 &&
      mergeFills(FIXTURE, [], NOW).some((f) => f.id === 'o2') && TAPE_KEEP_MS === 180_000 && TAPE_MAX_FILLS === 4_000, `${merged.length} / ${merged[0]?.id}`)
  check('pulse: the band repaints at most four times a second (a batch lands every frame on a busy second; the first fill paints at once)', PULSE_FLUSH_MS >= 200 && PULSE_FLUSH_MS <= 500)

  // ── The bars ──────────────────────────────────────────────────────────
  const bars = pulseBars(FIXTURE, NOW)
  const inWindow = FIXTURE.filter((f) => f.at >= (SEC - PULSE_WINDOW_SEC + 1) * 1000)
  const upUsd = inWindow.filter((f) => f.side === 'buy').reduce((s, f) => s + f.usd, 0)
  const downUsd = inWindow.filter((f) => f.side === 'sell').reduce((s, f) => s + f.usd, 0)
  check('pulse: 90 bars end on the current second, every second present (a quiet one is a zero bar), buys in up-ink and sells in down-ink, the current second summing its own fills; the fills past the window are not drawn',
    bars.length === PULSE_WINDOW_SEC && bars[89].sec === SEC && bars[0].sec === SEC - 89 && bars[89].up === 300 && bars[89].down === 50 && bars[89].total === 350 && bars[89].count === 4 &&
      Math.abs(bars.reduce((s, b) => s + b.up, 0) - upUsd) < 1e-6 && Math.abs(bars.reduce((s, b) => s + b.down, 0) - downUsd) < 1e-6 && bars.reduce((s, b) => s + b.count, 0) === inWindow.length && bars.some((b) => b.total === 0), JSON.stringify(bars[89]))
  const effectBars = pulseBars([fill('e0', 0, { effect: 'close', side: 'buy', usd: 70, at: SEC * 1000 }), fill('e1', 0, { effect: 'open', side: 'sell', usd: 30, at: SEC * 1000 })], NOW)
  check('pulse: a position-aware feed\'s six classes fold to the two inks by the taker side — a short cover is up-ink, a short open is down-ink', effectBars[89].up === 70 && effectBars[89].down === 30)

  // ── The tiles ─────────────────────────────────────────────────────────
  const t = pulseTiles(FIXTURE, NOW)
  check('pulse: the tiles read the last minute — the hot market by dollars with the side that carried them and its buy share, the largest print, trades/s over ten seconds, notional/min, the taker split; the window\'s older fills are out',
    t.hot?.market.name === 'HYPE' && t.hot.usd === 6000 + 350 && t.hot.side === 'buy' && t.hot.buyPct === Math.round(((7 * 500 + 300) / 6350) * 100) &&
      t.largest?.fill.id === 's0' && t.largest.market.kind === 'stock' && t.largest.market.ticker === 'SNDK' &&
      t.tradesPerSec === 1 && FIXTURE.filter((f) => f.at >= NOW - 10_000).length === 9 && t.notionalPerMin === 6350 + 2400 + 2800 + 900 + 120 + 1000 && t.split.buyPct !== null && t.split.buyUsd + t.split.sellUsd === t.notionalPerMin, JSON.stringify({ hot: t.hot && { ...t.hot, chip: t.hot.chip?.ask }, largest: t.largest?.fill.id, tps: t.tradesPerSec, npm: t.notionalPerMin, split: t.split }))
  const empty = pulseTiles([], NOW)
  check('pulse: an empty buffer answers nulls, never a number it did not measure — the band says "waiting for the first fill"',
    empty.hot === null && empty.largest === null && empty.tradesPerSec === 0 && empty.notionalPerMin === 0 && empty.split.buyPct === null && PULSE_WAITING === 'waiting for the first fill')

  // ── The chips ─────────────────────────────────────────────────────────
  check('pulse: the hot market\'s chip is the perp sentence on the side that carried the dollars, the largest print\'s is the spot buy of the listed stock — lib/tape followAsk, the symbol pages\' own grammar',
    t.hot?.chip?.ask === 'Long $25 of HYPE on Hyperliquid' && t.hot.chip.tone === 'buy' && t.largest?.chip?.ask === 'Buy $25 of SNDK' && t.largest.chip.venue === 'robinhood', `${t.hot?.chip?.ask} / ${t.largest?.chip?.ask}`)
  const gated = pulseTiles(FIXTURE, NOW, () => false)
  check('pulse: the caller\'s gate (canTradeAsk with the measured verdicts) decides the chip — a refused sentence is no chip, and the numbers stay', gated.hot?.chip === null && gated.largest?.chip === null && gated.hot?.usd === t.hot?.usd)
  const goldLargest = pulseTiles([fill('g', 3, { market: 'xyz:GOLD', side: 'buy', usd: 5000 }), fill('p', 4, { market: 'kPEPE', side: 'sell', usd: 100 })], NOW)
  const stockSell = pulseTiles([fill('s', 3, { market: 'xyz:SNDK', side: 'sell', usd: 5000 })], NOW)
  check('pulse: gold, FX, a k-prefixed coin and a stock SELL offer no chip, and the tile says why in /live\'s words',
    goldLargest.largest?.chip === null && goldLargest.hot?.chip === null && pulseNoChipWords(goldLargest.hot!.market, goldLargest.hot!.side) === 'no route here' &&
      stockSell.largest?.chip === null && pulseNoChipWords(stockSell.largest!.market, stockSell.largest!.fill.side) === 'needs a position')
  const sentences = new Set<string>()
  for (const m of [...PULSE_FALLBACK_MARKETS, 'HYPE', 'ZEC', 'PUMP', 'xyz:MU']) for (const side of ['buy', 'sell'] as const) {
    const f = followAsk({ market: m, side })
    if (f) sentences.add(f.ask)
  }
  const dead = [...sentences].filter((ask) => !(canTradeAsk(ask, {}) && simulateLadder(ask).kind === 'action'))
  check(`pulse: every sentence the band can put on a chip for its fallback markets (${sentences.size} of them) passes the venue gate cold and lands on a native gate as an ACTION in the ladder replica — a chip is never a dead end`,
    sentences.size >= 20 && dead.length === 0, dead.join(' | '))
  check('pulse: a coin\'s chip lands on the hyperliquid gate, a stock\'s on the swap gate', simulateLadder('Long $25 of HYPE on Hyperliquid').gate === 'hyperliquid' && simulateLadder('Buy $25 of SNDK').gate === 'swap')

  // ── The hidden-tab policy ─────────────────────────────────────────────
  const T = 1_000_000
  const seen = pulseVisibilityStep(null, false, T)
  const hid = pulseVisibilityStep(seen, true, T + 10)
  check(`pulse: a hidden tab keeps the stream for ${PULSE_HIDDEN_CLOSE_MS / 1000}s then closes it (between a glance and a wait: 5–30s, so the 30s tab-switch drill proves it), reopens the moment it is visible, and a tab born hidden never opens it`,
    PULSE_HIDDEN_CLOSE_MS === 15_000 && PULSE_HIDDEN_CLOSE_MS >= 5_000 && PULSE_HIDDEN_CLOSE_MS <= 30_000 &&
      pulseStreamWanted(seen, T) && pulseStreamWanted(hid, T + 10 + PULSE_HIDDEN_CLOSE_MS - 1) && !pulseStreamWanted(hid, T + 10 + PULSE_HIDDEN_CLOSE_MS) &&
      pulseStreamWanted(pulseVisibilityStep(hid, false, T + 99_999), T + 99_999) && !pulseStreamWanted(pulseVisibilityStep(null, true, T), T + 1) &&
      pulseVisibilityStep(hid, true, T + 5_000).hiddenAt === T + 10, JSON.stringify([seen, hid]))

  // ── The words ─────────────────────────────────────────────────────────
  check('pulse: the status says live with the market count, connecting, reconnecting with the feed\'s own detail, and "paused · tab in the background" for the policy\'s close — never "live" while the socket is closed',
    pulseStatusWords('live', undefined, { markets: 12 }) === 'live · 12 markets' && pulseStatusWords('connecting') === 'connecting' && pulseStatusWords('reconnecting', 'in 2s') === 'reconnecting in 2s' &&
      pulseStatusWords('closed', undefined, { hidden: true }) === 'paused · tab in the background' && pulseStatusWords('idle', undefined, { hidden: true }) === 'paused · tab in the background' && !pulseStatusWords('closed').includes('live'))
  check('pulse: the mono line says what it is (keyless, the venue\'s own fills, read in the browser) and why it is different (every number is a sentence the wallet signs; nothing fires on its own); the phone keeps one sentence of at most 54 characters (one 9.5px mono line in the 321px a 375 phone leaves the band)',
    /keyless/.test(PULSE_WHY.what) && /Hyperliquid/.test(PULSE_WHY.what) && /browser/.test(PULSE_WHY.what) && /nothing fires on its own/.test(PULSE_WHY.why) && /wallet/.test(PULSE_WHY.why) && PULSE_WHY.phone.length <= 54 && /you sign/.test(PULSE_WHY.phone), String(PULSE_WHY.phone.length))

  // ── The door ──────────────────────────────────────────────────────────
  const battle = readFileSync('lib/battle.ts', 'utf8')
  check('pulse: the door is /live, and the three small links are lib/battle\'s own views by id and label (`?view=front|siege|map`)',
    PULSE_LIVE_HREF === '/live' && PULSE_VIEW_LINKS.length === 3 && PULSE_VIEW_LINKS.every((v) => v.href === `/live?view=${v.id}` && new RegExp(`id: '${v.id}', label: '${v.label}'`).test(battle)))

  // ── The frame ─────────────────────────────────────────────────────────
  const css = readFileSync('components/home/pulse.css', 'utf8')
  const slot = readFileSync('components/home/PulseSlot.tsx', 'utf8')
  const home = readFileSync('components/home/HomeSurface.tsx', 'utf8')
  check(`pulse: the SSR frame is the final frame — pulse.css min-heights equal lib/pulse PULSE_BAND_MIN_H, the phone under the ${PULSE_PHONE_BUDGET_PX}px budget (MOBILE's baseline: the first board row stays above the bar), the plot heights the lib constants, and the component starts in "connecting"`,
    new RegExp(`\\.pulse \\{[^}]*min-height: ${PULSE_BAND_MIN_H.desktop}px`).test(css) && new RegExp(`\\.pulse \\{ --pulse-plot-h: ${PULSE_CHART_H_PHONE}px; min-height: ${PULSE_BAND_MIN_H.phone}px`).test(css) &&
      new RegExp(`--pulse-plot-h: ${PULSE_CHART_H}px;`).test(css) && PULSE_BAND_MIN_H.phone <= PULSE_PHONE_BUDGET_PX && PULSE_PHONE_BUDGET_PX === 160 && /useState<FeedStatus>\('connecting'\)/.test(slot) && /PULSE_WAITING/.test(slot))
  // The contract (coordinator, R2): nothing in the band at z-index 20 or above — the stuck board
  // tabs sit at 20 and the top strip at 32 — and nothing sticky. A layer of 1 is fine.
  const cssRules = css.replace(/\/\*[^]*?\*\//g, '') // the rules, not the comments that explain them
  const zIndexes = [...cssRules.matchAll(/z-index:\s*(-?\d+)/g)].map((m) => Number(m[1]))
  check('pulse: MOBILE\'s checklist — a 44px chip under a coarse pointer (min-height under hover: none, the tile rows making room), tabular numerals on every number line, axis labels at 10px mono, nothing sticky and no layer in the band at z-index 20 or above',
    /@media \(hover: none\) \{ \.pulse__chip \{ min-height: 44px; \}/.test(css) && /\.pulse__tv \{[^}]*tabular-nums/.test(css) && /\.pulse__ts \{[^}]*tabular-nums/.test(css) && /\.pulse__splitk \{[^}]*tabular-nums/.test(css) && /\.pulse__ax \{[^}]*font-size: 10px/.test(css) && !/position:\s*sticky/.test(cssRules) && zIndexes.every((z) => z < 20), `z-index values: ${zIndexes.join(',') || 'none'}`)
  // The door's 44px hit area on a phone (MOBILE round 2): an 18px line, 13px of reach above and
  // below through a ::after the door lifts one layer for — the plot is drawn after the head and
  // would take anything reaching into it otherwise.
  const doorRule = css.match(/@media \(max-width: 640px\) \{[^]*?\.pulse__door \{ position: relative; z-index: 1; \}[^]*?\.pulse__door::after \{ content: ''; position: absolute; inset: -(\d+)px -\d+px; \}/)
  check('pulse: at ≤640px the door ("Live tape →", an 18px line) reaches 44px — `position: relative; z-index: 1` and a ::after with 13px of inset above and below',
    !!doorRule && Number(doorRule[1]) * 2 + 18 >= 44 && Number(doorRule[1]) <= 13, doorRule ? `inset ${doorRule[1]}px` : 'no door rule')
  const feedSrc = readFileSync('lib/tape-feed.ts', 'utf8')
  check('pulse: the stream opens on the fallback list the moment the band mounts and the venue\'s pick re-aims the SAME socket (connectHlTape setMarkets: unsubscribe the drops, subscribe the adds) — never a reconnect drawn as a quiet second; /live\'s hlTapeFeed.connect still stands',
    /useState<readonly string\[\]>\(PULSE_FALLBACK_MARKETS\)/.test(slot) && /connectHlTape\(marketsRef\.current/.test(slot) && /handleRef\.current\?\.setMarkets\(markets\)/.test(slot) && /\}, \[streamOn\]\)/.test(slot) && !/feedFor\(/.test(slot) &&
      /hlSub\(coin, 'unsubscribe'\)/.test(feedSrc) && /export function connectHlTape/.test(feedSrc) && /connect\(markets, handlers\) \{\s*return openHlTape\(markets, handlers\)\.close/.test(feedSrc))
  check('pulse: the band is calm — no tape rows, no row flashes, nothing animates under reduced motion, and the socket follows the tab (visibilitychange → pulseStreamWanted)',
    !/<table/.test(slot) && !/live-row|TapeRow/.test(slot) && /prefers-reduced-motion: reduce/.test(css) && /animation: none/.test(css) && /transition: none/.test(css) && /visibilitychange/.test(slot) && /pulseStreamWanted\(vis, now\)/.test(slot) && /pulseVisibilityStep\(prev, document\.hidden/.test(slot))
  check('pulse: every chip goes through the connect-to-act door into the ask door\'s sheet with the ask\'s own apps, gated by canTradeAsk with the measured verdicts (useTradable) — the /live pattern verbatim; the band never calls the chat route itself',
    /useConnectToAct\(\{ run, redirectFor: promptHref \}\)/.test(slot) && /openDoor\(ask, \{ send: true, mcps: askAppSlugs\(ask\) \}\)/.test(slot) && /canTradeAsk\(ask, tradable\)/.test(slot) && /useTradable\(\)/.test(slot) && !/fetch\(['"`]\/api\/chat/.test(slot) && /\{door\}/.test(slot))
  check('pulse: the band mounts in the splash\'s lead seat (HomeSurface) as a default export with no props, and `/` is a public markets path (looking needs no wallet)',
    /<PulseSlot \/>/.test(home) && /export default function PulseSlot\(\)/.test(slot) && isMarketsPath('/') && isPublicAppPath('/'))
  check('pulse: the door and the views are links in the band\'s head (a URL never fires a turn): /live with prefetch off, and the three views from PULSE_VIEW_LINKS',
    /href=\{pulseLiveHref\(pick\)\}/.test(slot) && pulseLiveHref(null) === PULSE_LIVE_HREF && /PULSE_VIEW_LINKS\.map/.test(slot) && !/openDoor\([^)]*PULSE_LIVE_HREF/.test(slot) && slot.indexOf('PULSE_VIEW_LINKS.map') < slot.indexOf('</header>') && /data-markets=\{markets\.length\}/.test(slot))

  // ── The token pick (2026-10-06: "add the token options to track") ─────
  const ethBars = pulseBars(FIXTURE, NOW, undefined, 'ETH')
  const allBars = pulseBars(FIXTURE, NOW)
  const ethTiles = pulseTiles(FIXTURE, NOW, () => true, 'ETH')
  check('pulse pick: a token narrows the bars and every tile to that book — the hot market IS the pick, the largest print is its own, and its dollars are never more than All\'s',
    ethBars.length === allBars.length && ethBars.every((b, i) => b.total <= allBars[i].total) && ethBars.reduce((n, b) => n + b.total, 0) > 0 &&
      ethTiles.hot?.market.ticker === 'ETH' && ethTiles.largest?.fill.market === 'ETH' && ethTiles.notionalPerMin === 1000,
    `hot=${ethTiles.hot?.market.ticker} largest=${ethTiles.largest?.fill.market} perMin=${ethTiles.notionalPerMin}`)
  check('pulse pick: a pick the stream no longer carries falls back to All, never a band reading zero; the door carries the pick to /live as ?m=',
    pulsePick('ETH', ['BTC', 'ETH']) === 'ETH' && pulsePick('DOGE', ['BTC', 'ETH']) === null && pulsePick(null, ['ETH']) === null &&
      pulseLiveHref('xyz:SNDK') === '/live?m=xyz%3ASNDK' && pulseLiveHref(null) === '/live')
  check('pulse pick: the chip row renders All + one button per streamed market, the pick reaches pulseBars and pulseTiles, the remembered pick is read after mount (try/catch), and the row is fixed-height and leaves the phone (the 160px budget holds)',
    /className="pulse__markets"/.test(slot) && /markets\.map\(\(m\)/.test(slot) && /pulseBars\(fills, now, undefined, pick\)/.test(slot) && /pulseTiles\(fills, now, chipOk, pick\)/.test(slot) &&
      /matchMedia\('\(min-width: 641px\)'\)\.matches\) return\s*try \{\s*const m = window\.localStorage\.getItem\(PULSE_PICK_KEY\)/.test(slot) &&
      /\.pulse__markets \{[^}]*height: 28px/.test(css) && /@container pulse \(max-width: 560px\) \{[^]*?\.pulse__markets \{ display: none; \}/.test(css))
}

if (process.argv[1]?.endsWith('pulse-pins.ts')) {
  let failed = 0
  pulsePins((name, ok, extra) => {
    if (!ok) failed++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
  })
  console.log(failed ? `\n${failed} failed` : '\nall pulse pins green')
  process.exit(failed ? 1 : 0)
}
