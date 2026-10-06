// Pins for the live tape (lib/tape): the venue row → fill parse, the flow
// classes, the per-second buckets, the tiles, the follow asks, the trigger
// rules, the market pick, the formats. Pure: no server, no socket, no DB.
// Called from scripts/test-api.ts, and runnable alone:
//   npx tsx scripts/tape-pins.ts
import { readFileSync } from 'node:fs'
import {
  DEFAULT_THRESHOLDS,
  FALLBACK_MARKETS,
  FLOW_STACK,
  TAPE_KEEP_MS,
  detectTriggers,
  fillFromDune,
  fillFromHl,
  flowBuckets,
  flowClassOf,
  flowTone,
  fmtAddr,
  fmtAxisUsd,
  fmtPrice,
  fmtSize,
  fmtUsd,
  followAsk,
  mergeFills,
  niceCeil,
  pickTapeMarkets,
  tapeMarket,
  tapeStats,
  triggerDetail,
  type TapeFill,
} from '../lib/tape'
import { capabilityTarget } from '../lib/venue-capability'
import { tradeTarget } from '../lib/trade-venue-gate'
import { composeExecAsk } from '../lib/trade-asks'
import { chartPairFor } from '../lib/charts'
import { isMarketsPath, } from '../lib/markets'
import { isPublicAppPath } from '../lib/app-entry'

type Check = (name: string, ok: boolean, extra?: string) => void

const T0 = 1_791_292_800_000 // 2026-10-06 ~11:20Z, a venue-shaped stamp
const fill = (over: Partial<TapeFill> & { id: string }): TapeFill => ({
  market: 'HYPE',
  side: 'buy',
  size: 1,
  price: 100,
  usd: 100,
  at: T0,
  taker: '0x98da633cc3814857680eb313de6770b7a801f13b',
  maker: '0x46921f6961bdb411b756c9712f6bdb58fbd9164f',
  hash: null,
  effect: null,
  block: null,
  source: 'hyperliquid',
  ...over,
})

export function tapePins(check: Check): void {
  // ── The venue's row ───────────────────────────────────────────────────
  const buy = fillFromHl({ coin: 'HYPE', side: 'B', px: '92.921', sz: '0.39', time: T0, hash: '0x' + '0'.repeat(64), tid: 400622078463441, users: ['0xBUYER00000000000000000000000000000000001', '0xseller0000000000000000000000000000000002'] })
  const sell = fillFromHl({ coin: 'xyz:SNDK', side: 'A', px: '1703.0', sz: '0.47', time: T0, hash: '0xa39c7381c1336f4ca5160445f7f3e002050300675c368e1e47651ed480374937', tid: 1034643273275415, users: ['0xbuyer', '0xseller'] })
  check('tape: a Hyperliquid row parses with the TAKER\'s side — B is the buyer lifting the ask (users[0]), A is the seller hitting the bid (users[1]); a zero hash is no hash, a real one is kept; notional is size × price',
    !!buy && buy.side === 'buy' && buy.taker === '0xbuyer00000000000000000000000000000000001' && buy.maker === '0xseller0000000000000000000000000000000002' && buy.hash === null && Math.abs(buy.usd - 36.23919) < 1e-6 && buy.id === 'hl:400622078463441' && buy.effect === null && buy.block === null &&
      !!sell && sell.side === 'sell' && sell.taker === '0xseller' && sell.hash?.startsWith('0xa39c') === true && sell.market === 'xyz:SNDK', JSON.stringify([buy, sell]))
  check('tape: a row with no price, no size, a bad side or no coin is dropped, never drawn',
    fillFromHl({ coin: 'HYPE', side: 'B', px: 'nope', sz: '1', time: T0, tid: 1 }) === null && fillFromHl({ coin: 'HYPE', side: 'B', px: '1', sz: '0', time: T0, tid: 1 }) === null && fillFromHl({ coin: 'HYPE', side: 'X' as 'A', px: '1', sz: '1', time: T0, tid: 1 }) === null && fillFromHl({ coin: '', side: 'B', px: '1', sz: '1', time: T0, tid: 1 }) === null)
  const dune = fillFromDune({ market: 'xyz:INTC', side: 'sell', size: '12.94', price: '118.62', notional: '1534.94', effect: 'increase', time: '2026-10-06T10:03:28.859Z', taker: '0x98DA633CC3814857680EB313DE6770B7A801F13B', block: '1159201256', id: 'abc' })
  check('tape: a Dune-shaped row maps field for field — effect and block ride through, the venue\'s notional wins over size × price when given, the taker is lowercased, an unknown effect word is null not guessed',
    !!dune && dune.source === 'dune' && dune.effect === 'increase' && dune.block === 1159201256 && dune.usd === 1534.94 && dune.taker === '0x98da633cc3814857680eb313de6770b7a801f13b' && dune.at === Date.parse('2026-10-06T10:03:28.859Z') && dune.id === 'dune:abc' &&
      fillFromDune({ market: 'HYPE', side: 'B', size: 1, price: 2, time: T0, effect: 'wat' })?.effect === null && fillFromDune({ market: 'HYPE', side: 'B', size: 1, price: 2, time: 'never' }) === null, JSON.stringify(dune))

  // ── Flow classes ──────────────────────────────────────────────────────
  check('tape: without an effect the class is the taker side; with one, a buy that opens/increases is a long open, a buy that closes/decreases is a short cover, a sell likewise is a short open or a long close, and a flip opens',
    flowClassOf({ side: 'buy', effect: null }) === 'buy' && flowClassOf({ side: 'sell', effect: null }) === 'sell' && flowClassOf({ side: 'buy', effect: 'open' }) === 'long-open' && flowClassOf({ side: 'buy', effect: 'increase' }) === 'long-open' && flowClassOf({ side: 'buy', effect: 'decrease' }) === 'short-cover' && flowClassOf({ side: 'buy', effect: 'close' }) === 'short-cover' &&
      flowClassOf({ side: 'sell', effect: 'open' }) === 'short-open' && flowClassOf({ side: 'sell', effect: 'close' }) === 'long-close' && flowClassOf({ side: 'sell', effect: 'flip' }) === 'short-open' && flowClassOf({ side: 'buy', effect: 'flip' }) === 'long-open')
  check('tape: opens wear the strong shade and closes the soft one, buys up-ink and sells down-ink; the stack puts every up class under every down class',
    flowTone('long-open').strong && flowTone('long-open').dir === 'up' && !flowTone('short-cover').strong && flowTone('short-cover').dir === 'up' && !flowTone('long-close').strong && flowTone('long-close').dir === 'down' && flowTone('short-open').strong && flowTone('sell').dir === 'down' &&
      FLOW_STACK.findIndex((c) => flowTone(c).dir === 'down') > FLOW_STACK.filter((c) => flowTone(c).dir === 'up').length - 1)

  // ── The buffer ────────────────────────────────────────────────────────
  const a = fill({ id: 'a', at: T0 - 1000 })
  const b = fill({ id: 'b', at: T0 })
  const merged = mergeFills([a], [b, b, fill({ id: 'a', at: T0 }), fill({ id: 'old', at: T0 - TAPE_KEEP_MS - 1 })], T0)
  check('tape: the buffer merges newest first, drops a duplicate id whether it is already held or repeated inside the batch, and ages out anything past the keep window',
    merged.length === 2 && merged[0].id === 'b' && merged[1].id === 'a' && merged[1].at === T0 - 1000 && mergeFills([a], [], T0).length === 1 && mergeFills([a], [], T0 + TAPE_KEEP_MS + 1).length === 0, JSON.stringify(merged.map((f) => f.id)))

  // ── Buckets ───────────────────────────────────────────────────────────
  const sec = Math.floor(T0 / 1000)
  const fills = [
    fill({ id: '1', at: sec * 1000 + 10, side: 'buy', usd: 300 }),
    fill({ id: '2', at: sec * 1000 + 900, side: 'sell', usd: 100 }),
    fill({ id: '3', at: (sec - 1) * 1000 + 500, side: 'sell', usd: 50, market: 'BTC' }),
    fill({ id: '4', at: (sec - 200) * 1000, side: 'buy', usd: 9999 }),
    fill({ id: '5', at: sec * 1000 + 100, side: 'buy', usd: 70, effect: 'close' }),
  ]
  const bk = flowBuckets(fills, sec * 1000 + 950, 120)
  check('tape: 120 buckets end on the current second, every second present (an empty one is a zero bar), fills land by class and the last bucket sums its own; a fill outside the window is not counted',
    bk.length === 120 && bk[119].sec === sec && bk[0].sec === sec - 119 && bk[119].usd.buy === 300 && bk[119].usd.sell === 100 && bk[119].usd['short-cover'] === 70 && bk[119].total === 470 && bk[119].count === 3 && bk[118].total === 50 && bk[0].total === 0 && bk.reduce((s, x) => s + x.total, 0) === 520, JSON.stringify(bk[119]))
  check('tape: a market filter keeps only that market\'s dollars', flowBuckets(fills, sec * 1000 + 950, 120, 'BTC').reduce((s, x) => s + x.total, 0) === 50 && flowBuckets(fills, sec * 1000 + 950, 120, 'HYPE')[119].total === 470)
  check('tape: the axis top is a round number at or above the tallest bar, never zero', niceCeil(0) === 1 && niceCeil(1_200_000) === 2_000_000 && niceCeil(230_000) === 250_000 && niceCeil(500_000) === 500_000 && niceCeil(6_000) === 10_000 && niceCeil(3) === 5)

  // ── Tiles ─────────────────────────────────────────────────────────────
  const st = tapeStats(fills, sec * 1000 + 950)
  check('tape: the tiles read the last minute — notional, the largest print, the hot market by dollars, the taker split by dollars — and trades/s over the last ten seconds; the fill 200s back is out',
    st.notionalPerMin === 520 && st.largestPrint?.id === '1' && st.hotMarket?.market === 'HYPE' && st.hotMarket.usd === 470 && st.takerFlow.buyUsd === 370 && st.takerFlow.sellUsd === 150 && st.takerFlow.buyPct === 71 && st.tradesPerSec === 0, JSON.stringify(st))
  check('tape: an empty tape prints no numbers it does not have', tapeStats([], T0).largestPrint === null && tapeStats([], T0).hotMarket === null && tapeStats([], T0).takerFlow.buyPct === null && tapeStats([], T0).notionalPerMin === 0)

  // ── Follow asks: the button on every row, in the pages' own grammar ──
  const fLong = followAsk({ market: 'HYPE', side: 'buy' })
  const fShort = followAsk({ market: 'BTC', side: 'sell' })
  const fStock = followAsk({ market: 'xyz:INTC', side: 'buy' })
  check('tape: a coin buy follows as the perp long, a coin sell as the short, in exactly the sentence the symbol page\'s strip composes',
    fLong?.ask === 'Long $25 of HYPE on Hyperliquid' && fLong.venue === 'hyperliquid' && fLong.tone === 'buy' && fShort?.ask === 'Short $25 of BTC on Hyperliquid' && fShort.tone === 'sell' &&
      fLong.ask === composeExecAsk(chartPairFor('HYPE')!, 'long', { usd: 25 }) && fShort.ask === composeExecAsk({ symbol: 'BTC', source: 'coinbase', pair: 'BTC-USD', label: 'BTC / USD' }, 'short', { usd: 25 }), JSON.stringify([fLong, fShort]))
  check('tape: an xyz stock buy follows as the spot buy on Robinhood Chain (our Hyperliquid layer runs the main book only); a stock sell needs a position and offers nothing; gold, FX and a k-prefixed coin offer nothing',
    fStock?.ask === 'Buy $25 of INTC' && fStock.venue === 'robinhood' && followAsk({ market: 'xyz:INTC', side: 'sell' }) === null && followAsk({ market: 'xyz:GOLD', side: 'buy' }) === null && followAsk({ market: 'xyz:JPY', side: 'sell' }) === null && followAsk({ market: 'kPEPE', side: 'buy' }) === null && followAsk({ market: 'xyz:XYZ100', side: 'buy' }) === null, JSON.stringify(fStock))
  check('tape: every follow sentence lands on the venue gates the markets chips are judged by (a perp names its venue for the capability rule; a stock buy is a market buy for the fill rule)',
    capabilityTarget(fLong!.ask)?.side === 'perp' && capabilityTarget(fLong!.ask)?.symbol === 'HYPE' && tradeTarget(fLong!.ask) === null && tradeTarget(fStock!.ask)?.side === 'buy' && tradeTarget(fStock!.ask)?.symbol === 'INTC')
  check('tape: a market resolves to its page — a coin to /t/<sym>, an xyz stock the house lists to /t/<ticker>, gold to nothing',
    tapeMarket('HYPE').href === '/t/HYPE' && tapeMarket('HYPE').kind === 'coin' && tapeMarket('xyz:INTC').href === '/t/INTC' && tapeMarket('xyz:INTC').kind === 'stock' && tapeMarket('xyz:INTC').dex === 'xyz' && tapeMarket('xyz:GOLD').href === null && tapeMarket('xyz:GOLD').kind === 'other')

  // ── Triggers ──────────────────────────────────────────────────────────
  const seen = new Set<string>()
  const now = T0 + 5000
  const whale = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  const stream = [
    fill({ id: 'w3', at: now - 100, usd: 4000, taker: whale, market: 'ETH', side: 'sell' }),
    fill({ id: 'w2', at: now - 2000, usd: 4000, taker: whale, market: 'ETH', side: 'sell' }),
    fill({ id: 'w1', at: now - 4000, usd: 4000, taker: whale, market: 'ETH', side: 'buy' }),
    fill({ id: 'big', at: now - 3000, usd: 60_000, market: 'BTC', side: 'buy', price: 86047 }),
    ...Array.from({ length: 25 }, (_, i) => fill({ id: `s${i}`, at: now - 10_000 - i * 100, usd: 100, market: 'SOL', side: i < 20 ? 'sell' : 'buy' })),
  ].sort((x, y) => y.at - x.at)
  const ev = detectTriggers(stream, now, seen)
  const big = ev.find((e) => e.rule === 'big-print')
  const wh = ev.find((e) => e.rule === 'whale-repeat')
  const sk = ev.find((e) => e.rule === 'flow-skew')
  check('tape: a big print fires on one fill at or over the bar, named in past tense with its measured numbers and the follow ask',
    !!big && big.market === 'BTC' && big.usd === 60_000 && big.text === '$60.00K bought on BTC in one fill at 86047.0.' && big.follow?.ask === 'Long $25 of BTC on Hyperliquid', JSON.stringify(big))
  check('tape: one taker filling three times in ten seconds for $10K+ fires once, on the side that carried the dollars',
    !!wh && wh.market === 'ETH' && wh.usd === 12_000 && wh.side === 'sell' && wh.text.startsWith('0xaaaa_aaaa sold $12.00K of ETH across 3 fills in 10s.') && wh.follow?.ask === 'Short $25 of ETH on Hyperliquid', JSON.stringify(wh))
  check('tape: a one-sided minute fires when 70%+ of a market\'s last-minute dollars sit on one side over 20+ fills', !!sk && sk.market === 'SOL' && sk.side === 'sell' && sk.text === '80% of $2.50K on SOL in the last minute was selling, over 25 fills.' && sk.follow?.ask === 'Short $25 of SOL on Hyperliquid', JSON.stringify(sk))
  check('tape: the same occurrence never fires twice (the caller\'s seen set), and a quieter threshold table fires nothing on the same stream',
    detectTriggers(stream, now, seen).length === 0 && detectTriggers(stream, now, new Set(), { ...DEFAULT_THRESHOLDS, bigPrintUsd: 1e9, whaleUsd: 1e9, skewPct: 99 }).length === 0 && ev.length === 3 && ev[0].at >= ev[ev.length - 1].at)
  check('tape: every rule explains itself from the thresholds it runs on', triggerDetail('big-print', DEFAULT_THRESHOLDS) === 'a single fill of $50.00K or more' && triggerDetail('whale-repeat', DEFAULT_THRESHOLDS).includes('3+ times in 10s') && triggerDetail('flow-skew', DEFAULT_THRESHOLDS).startsWith('70%+'))

  // ── Market pick ───────────────────────────────────────────────────────
  const picked = pickTapeMarkets(
    [{ name: 'BTC', volumeUsd: 100 }, { name: 'ETH', volumeUsd: 300 }, { name: 'DEAD', volumeUsd: 999, delisted: true }, { name: 'ZERO', volumeUsd: 0 }],
    [{ name: 'xyz:XYZ100', volumeUsd: 999 }, { name: 'xyz:TSLA', volumeUsd: 50 }, { name: 'xyz:INTC', volumeUsd: 70 }],
    { main: 1, xyz: 1 },
  )
  check('tape: the subscription is the busiest books by the venue\'s own 24h volume, main then xyz; delisted, zero-volume and the dex index never make it; the fallback list stands on its own',
    picked.join(',') === 'ETH,xyz:INTC' && pickTapeMarkets([], []).length === 0 && FALLBACK_MARKETS.includes('HYPE') && FALLBACK_MARKETS.some((m) => m.startsWith('xyz:')), picked.join(','))

  // ── Formats ───────────────────────────────────────────────────────────
  check('tape: dollars print like a tape ($898.53 · $1.53K · $83.85K · $1.20M), the axis in short units, a price at its own precision, a size without trailing zeros, an address as 0x98da_f13b',
    fmtUsd(898.53) === '$898.53' && fmtUsd(1534.94) === '$1.53K' && fmtUsd(83_850) === '$83.85K' && fmtUsd(1_200_000) === '$1.20M' && fmtAxisUsd(200_000) === '200K' && fmtAxisUsd(1_200_000) === '1.2M' && fmtPrice(86047) === '86047.0' && fmtPrice(1703) === '1703.0' && fmtPrice(118.62) === '118.62' && fmtPrice(0.13248) === '0.1325' && fmtPrice(0.008636) === '0.008636' && fmtPrice(4.2226) === '4.2226' && fmtSize(0.00200) === '0.002' && fmtSize(22499) === '22499' && fmtSize(2.918) === '2.918' && fmtAddr('0x98da633cc3814857680eb313de6770b7a801f13b') === '0x98da_f13b')

  // ── The page ──────────────────────────────────────────────────────────
  check('tape: /live is a public markets-shell page (looking needs no wallet) and every act goes through the connect-to-act door into the ask door\'s sheet with the ask\'s own apps',
    isMarketsPath('/live') && isPublicAppPath('/live') && (() => {
      const src = readFileSync('components/live/LiveFeed.tsx', 'utf8')
      return /useConnectToAct\(\{ run, redirectFor: promptHref \}\)/.test(src) && /openDoor\(ask, \{ send: true, mcps: askAppSlugs\(ask\) \}\)/.test(src) && /canTradeAsk\(f\.ask, tradable\)/.test(src) && !/fetch\(['"`]\/api\/chat/.test(src)
    })())
  check('tape: the feed adapters are the browser\'s (no server holds the socket), the Hyperliquid feed names the two fields it lacks, and the Dune slot reports unconfigured by name instead of pretending',
    (() => {
      const src = readFileSync('lib/tape-feed.ts', 'utf8')
      return /wss:\/\/api\.hyperliquid\.xyz\/ws/.test(src) && /fields: \{ effect: false, block: false \}/.test(src) && /fields: \{ effect: true, block: true \}/.test(src) && /NEXT_PUBLIC_DUNE_STREAM_URL/.test(src) && /onStatus\('unconfigured'/.test(src) && /requestAnimationFrame/.test(src)
    })())
}

if (process.argv[1]?.endsWith('tape-pins.ts')) {
  let failed = 0
  tapePins((name, ok, extra) => {
    if (!ok) failed++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
  })
  console.log(failed ? `\n${failed} failed` : '\nall tape pins green')
  process.exit(failed ? 1 : 0)
}
