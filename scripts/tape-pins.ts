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
  TAPE_MAX_FILLS,
  busiestMarkets,
  chainWord,
  detectTriggers,
  dexAskTicker,
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
  venueTag,
  type TapeFill,
} from '../lib/tape'
import {
  DEFAULT_LIVE_VENUES,
  DUNE_FEED_KEY_ENV,
  DUNE_VENUES,
  LIVE_STREAM_HOLD_MS,
  LIVE_STREAM_MAX_DURATION_S,
  PERP_VENUES,
  duneFeedKey,
  duneVenue,
  fillFromDuneDex,
  fillFromDunePerp,
  fillsFromDuneFrame,
  parseMarketList,
  parseVenueList,
  resumeUrl,
  venueWords,
  type DuneDexTrade,
  type DunePerpTrade,
} from '../lib/dune'
import { simulateLadder } from './ask-ladder'
import { LIVE_TAIL_TFS, PRINT_KEEP_MS, applyPrint, barsFromPrints, bucketOf, chartLiveFeed, printOf, tailIsLive, tailWords } from '../lib/chart-live'
import { PRINT_BAR_SPACING, engineRightOffset, fitMarginBars, printOpeningView } from '../lib/chart-viewport'
import { LIVE_BACKFILL_MS } from '../lib/dune'
import { marginBarsFor } from '../lib/wall'
import { CHART_TFS, VENUE_TFS, isPrintTf, technicalsTfs, tfsForSource } from '../lib/charts'
import { tfUrl } from '../lib/markets'
import { LIVE_MARKETS_KEY, MAX_OWN_MARKETS, OWN_SOURCE_NOTE, addLiveMarkets, chipRow, knownMarkets, openingOwnMarkets, parseLiveMarketMemory, removeLiveMarket, serializeLiveMarketMemory, watchlistMarkets } from '../lib/live-markets'
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
  venue: 'hyperliquid',
  chainId: null,
  ...over,
})

// Dune's wire, verbatim from the live feeds on 2026-10-13 (keys the tape
// does not read are left in so the parser is proven on the real shape).
const HC_SELL: DunePerpTrade = { tx: { hash: '0x84ac722b458397e686260446747c2e02028a0010e086b6b828751d7e048771d1' }, trade_id: 'hypercore-1-1182039086-180-match-1030036812375233-0', venue: { name: 'hyperliquid', protocol: 'hypercore', id: 'HLPERP.HL', market: 'BERA', market_id: '180' }, mechanism: 'order_book', maker: { address: '0x8184405076b61ab78013f16393322eaf0d0a01a1', account_id: null, position_side: 'short', position_effect: 'decrease' }, taker: { address: '0x010461C14E146AC35FE42271BDC1134EE31C703A', account_id: null, position_side: 'long', position_effect: 'decrease' }, kind: 'trade', base_symbol: 'BERA', side: 'sell', size: '86.5', executed_price: '0.22125', executed_at: '2026-10-13T07:28:51.856169+00:00', value_usd: { amount: '19.13512682', source: 'chainlink', stale: false }, instrument_code: 'BERA-USDC.HLPERP.HL' }
const LT_BUY: DunePerpTrade = { tx: { hash: '0000001f3bd01f91000001a13429fdbd000000000000000000000000000000000000000000000000' }, trade_id: 'lighter-1-354535562-50-match-0000001f3bd01f91000001a13429fdbd000000000000000000000000000000000000000000000000-0', venue: { name: 'lighter', protocol: 'lighter', id: 'LIGHTER', market: 'ARB', market_id: '50' }, mechanism: 'order_book', maker: { address: null, account_id: '281474976499586', position_side: 'long', position_effect: 'decrease' }, taker: { address: null, account_id: '281474976499712', position_side: 'long', position_effect: 'increase' }, kind: 'trade', base_symbol: 'ARB', side: 'buy', size: '0.2', executed_price: '0.18839', executed_at: '2026-10-13T07:28:49.597689+00:00', value_usd: { amount: '0.037678', source: 'venue_reported', stale: false }, instrument_code: 'ARB-USDC.LIGHTER' }
const DEX_BUY: DuneDexTrade = { base: '0x4200000000000000000000000000000000000006', side: 'buy', executed_price: 2528.30354717563, instrument_code: 'WETH-USDC.UNIV3.BASE', quote: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', taker: '0x61040e143a77f165ba44543af4a079f2c809d14b', tokens: [{ address: '0x4200000000000000000000000000000000000006', amount_in: 0, amount_out: 0.14684991302359976, decimals: 18, symbol: 'WETH' }, { address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', amount_in: 371.281156, amount_out: 0, decimals: 6, symbol: 'USDC' }], trade_id: '8453-52543679-3-trace-146-0', tx: { from: '0xAD3FE4FA38AD6E05B7FC11647FC36457943493ED', hash: '0xe40557ef7d90dfd213ffc82fec0c14dcd054efeabb084aab59693f9d7c0b4126' }, value: { notional_usd: 371.2262695, price_source: 'chainlink', stale_usd_price: false }, venue: { id: 'UNIV3.BASE', name: 'UniswapV3', pool: '0xb4cb800910b228ed3d0834cf79d697127bbb00e5', protocol: 'UniswapV3' } }
const HC_ENV = { block_number: 1182039086, chain: { type: 'hypercore', id: 1 } }
const BASE_ENV = { block_number: 52543679, chain: { type: 'evm', id: 8453 } }

export function tapePins(check: Check): void {
  // ── The venue's row ───────────────────────────────────────────────────
  const buy = fillFromHl({ coin: 'HYPE', side: 'B', px: '92.921', sz: '0.39', time: T0, hash: '0x' + '0'.repeat(64), tid: 400622078463441, users: ['0xBUYER00000000000000000000000000000000001', '0xseller0000000000000000000000000000000002'] })
  const sell = fillFromHl({ coin: 'xyz:SNDK', side: 'A', px: '1703.0', sz: '0.47', time: T0, hash: '0xa39c7381c1336f4ca5160445f7f3e002050300675c368e1e47651ed480374937', tid: 1034643273275415, users: ['0xbuyer', '0xseller'] })
  check('tape: a Hyperliquid row parses with the TAKER\'s side — B is the buyer lifting the ask (users[0]), A is the seller hitting the bid (users[1]); a zero hash is no hash, a real one is kept; notional is size × price',
    !!buy && buy.side === 'buy' && buy.taker === '0xbuyer00000000000000000000000000000000001' && buy.maker === '0xseller0000000000000000000000000000000002' && buy.hash === null && Math.abs(buy.usd - 36.23919) < 1e-6 && buy.id === 'hl:400622078463441' && buy.effect === null && buy.block === null &&
      !!sell && sell.side === 'sell' && sell.taker === '0xseller' && sell.hash?.startsWith('0xa39c') === true && sell.market === 'xyz:SNDK', JSON.stringify([buy, sell]))
  check('tape: a row with no price, no size, a bad side or no coin is dropped, never drawn',
    fillFromHl({ coin: 'HYPE', side: 'B', px: 'nope', sz: '1', time: T0, tid: 1 }) === null && fillFromHl({ coin: 'HYPE', side: 'B', px: '1', sz: '0', time: T0, tid: 1 }) === null && fillFromHl({ coin: 'HYPE', side: 'X' as 'A', px: '1', sz: '1', time: T0, tid: 1 }) === null && fillFromHl({ coin: '', side: 'B', px: '1', sz: '1', time: T0, tid: 1 }) === null)
  // ── Dune's wire (lib/dune) ────────────────────────────────────────────
  const hc = fillFromDunePerp(HC_SELL, HC_ENV, 'hyperliquid')
  const lt = fillFromDunePerp(LT_BUY, { block_number: 354535562, chain: { type: 'lighter', id: 1 } }, 'lighter')
  check('dune: a HyperCore perp execution parses as the TAKER\'s side with its position effect, the venue\'s own market name, Chainlink\'s dollar value over size × price, the L1 hash, both addresses lowercased, the block from the envelope, tagged hyperliquid over the dune transport',
    !!hc && hc.market === 'BERA' && hc.side === 'sell' && hc.size === 86.5 && hc.price === 0.22125 && hc.usd === 19.13512682 && hc.effect === 'decrease' && hc.taker === '0x010461c14e146ac35fe42271bdc1134ee31c703a' && hc.maker === '0x8184405076b61ab78013f16393322eaf0d0a01a1' && hc.hash === '0x84ac722b458397e686260446747c2e02028a0010e086b6b828751d7e048771d1' && hc.block === 1182039086 &&
      hc.at === Date.parse('2026-10-13T07:28:51.856169+00:00') && hc.id === 'dune:hypercore-1-1182039086-180-match-1030036812375233-0' && hc.source === 'dune' && hc.venue === 'hyperliquid' && hc.chainId === null, JSON.stringify(hc))
  check('dune: a Lighter execution names its parties by account id (address null → acct:<id>), its 80-hex tx id is not an EVM hash (null, never shown as one), and it is tagged with the venue the socket speaks for',
    !!lt && lt.market === 'ARB' && lt.side === 'buy' && lt.effect === 'increase' && lt.taker === 'acct:281474976499712' && lt.maker === 'acct:281474976499586' && lt.hash === null && lt.venue === 'lighter' && lt.usd === 0.037678 && lt.block === 354535562, JSON.stringify(lt))
  check('dune: a settlement (side null) is no print; a stale or missing dollar value falls back to size × price; an effect word outside the five is null, never guessed; a bad price, size or time is dropped',
    fillFromDunePerp({ ...HC_SELL, side: null }, HC_ENV, 'hyperliquid') === null &&
      fillFromDunePerp({ ...HC_SELL, value_usd: { amount: '19.1', source: 'chainlink', stale: true } }, HC_ENV, 'hyperliquid')?.usd === 86.5 * 0.22125 && fillFromDunePerp({ ...HC_SELL, value_usd: null }, HC_ENV, 'hyperliquid')?.usd === 86.5 * 0.22125 &&
      fillFromDunePerp({ ...HC_SELL, taker: { address: '0x1', account_id: null, position_effect: 'wat' } }, HC_ENV, 'hyperliquid')?.effect === null && fillFromDunePerp({ ...HC_SELL, taker: null }, HC_ENV, 'hyperliquid')?.effect === null &&
      fillFromDunePerp({ ...HC_SELL, executed_price: 'nope' }, HC_ENV, 'hyperliquid') === null && fillFromDunePerp({ ...HC_SELL, size: '0' }, HC_ENV, 'hyperliquid') === null && fillFromDunePerp({ ...HC_SELL, executed_at: 'never' }, HC_ENV, 'hyperliquid') === null)
  const dx = fillFromDuneDex(DEX_BUY, BASE_ENV)
  check('dune: a DEX swap parses on its BASE token — the taker\'s side on it, the base amount that moved, dollars per unit from the venue\'s notional, the sender as the taker, the tx hash, the block, the chain id, no position effect — and a spot sell is the base amount paid in',
    !!dx && dx.market === 'WETH' && dx.side === 'buy' && dx.size === 0.14684991302359976 && dx.usd === 371.2262695 && Math.abs(dx.price - 371.2262695 / 0.14684991302359976) < 1e-9 && dx.taker === '0xad3fe4fa38ad6e05b7fc11647fc36457943493ed' && dx.hash === '0xe40557ef7d90dfd213ffc82fec0c14dcd054efeabb084aab59693f9d7c0b4126' &&
      dx.block === 52543679 && dx.chainId === 8453 && dx.venue === 'dex' && dx.effect === null && dx.source === 'dune' && dx.id === 'dune:evm-8453-8453-52543679-3-trace-146-0' &&
      fillFromDuneDex({ ...DEX_BUY, side: 'sell', tokens: [{ ...DEX_BUY.tokens[0], amount_in: 0.5, amount_out: 0 }, DEX_BUY.tokens[1]] }, BASE_ENV)?.size === 0.5 &&
      fillFromDuneDex({ ...DEX_BUY, value: null, executed_price: 2500 }, BASE_ENV)?.price === 2500 && fillFromDuneDex({ ...DEX_BUY, value: null, executed_price: 2500, quote: '0xnot', tokens: [DEX_BUY.tokens[0], { ...DEX_BUY.tokens[1], address: '0xnot', symbol: 'LINK' }] }, BASE_ENV) === null, JSON.stringify(dx))
  const frame = fillsFromDuneFrame({ schema_version: 'perp-trades.json.v1', chain: { type: 'hypercore', id: 1 }, block_number: 1182039086, op: 'INSERT', sequence_number: '75604723', trades: [HC_SELL, { ...HC_SELL, trade_id: 'x', side: null }] }, duneVenue('hypercore')!)
  const dexFrame = fillsFromDuneFrame({ schema_version: 'dex-trades.json.v1', chain: { type: 'evm', id: 8453 }, block_number: 52543679, block_timestamp: '2026-10-13T07:30:01+00:00', op: 'UPDATE', sequence_number: '12009732', trades: [DEX_BUY] }, duneVenue('dex-base')!)
  check('dune: one envelope → its prints in wire order with the op and block beside them (an UPDATE replaces a block downstream); a spot swap wears the block\'s own time; an unknown op or schema answers nothing',
    !!frame && frame.op === 'INSERT' && frame.block === 1182039086 && frame.fills.length === 1 && frame.fills[0].market === 'BERA' &&
      !!dexFrame && dexFrame.op === 'UPDATE' && dexFrame.fills[0].at === Date.parse('2026-10-13T07:30:01+00:00') && dexFrame.fills[0].venue === 'dex' &&
      fillsFromDuneFrame({ schema_version: 'perp-trades.json.v1', chain: { type: 'hypercore', id: 1 }, block_number: 1, op: 'DELETE', sequence_number: '1', trades: [] }, duneVenue('hypercore')!) === null &&
      fillsFromDuneFrame({ schema_version: 'nope.v9', chain: { type: 'hypercore', id: 1 }, block_number: 1, op: 'INSERT', sequence_number: '1', trades: [] }, duneVenue('hypercore')!) === null, JSON.stringify([frame, dexFrame]))
  check('dune: the venue table is the six feeds the key reaches (three perp venues, three spot chains), the perp list is the pulse\'s and the battle\'s, `?venues=` keeps table order and falls back whole, `?markets=` takes venue spellings only, and a resume URL carries the cursor strictly as digits',
    DUNE_VENUES.length === 6 && DUNE_VENUES.filter((v) => v.kind === 'perp').length === 3 && PERP_VENUES.every((id) => duneVenue(id)?.kind === 'perp') && DEFAULT_LIVE_VENUES.length === 6 && DUNE_VENUES.every((v) => /^wss:\/\/api\.dune\.com\//.test(v.url)) &&
      parseVenueList('lighter,hypercore,nope').join(',') === 'hypercore,lighter' && parseVenueList('').join(',') === DEFAULT_LIVE_VENUES.join(',') && parseVenueList('zzz', PERP_VENUES).join(',') === PERP_VENUES.join(',') &&
      parseMarketList('BTC,xyz:NVDA,BTC, bad market ,x'.repeat(1)).join(',') === 'BTC,xyz:NVDA,x' && parseMarketList(null).length === 0 &&
      resumeUrl('wss://x/1', '123') === 'wss://x/1?resume_after=123' && resumeUrl('wss://x/1', null) === 'wss://x/1' && resumeUrl('wss://x/1', '12a') === 'wss://x/1' && venueWords(DEFAULT_LIVE_VENUES) === 'every venue' && venueWords(['hypercore', 'dex-base']) === '1 perp venue + 1 spot chain')
  check('dune: the feed reads DUNE_BETA_API_KEY and ONLY that — the older DUNE_API_KEY is the Analytics key, which the feed refuses (probed 2026-10-13, close 1006 like no key), so it is never a fallback',
    DUNE_FEED_KEY_ENV === 'DUNE_BETA_API_KEY' && duneFeedKey({ DUNE_BETA_API_KEY: ' k1 ' }) === 'k1' && duneFeedKey({ DUNE_API_KEY: 'old' }) === null && duneFeedKey({}) === null && duneFeedKey({ DUNE_BETA_API_KEY: '' }) === null)
  check('dune: the relay says bye before the function\'s own limit (a browser reopens cleanly instead of reading a dropped socket as a quiet market)',
    LIVE_STREAM_HOLD_MS < LIVE_STREAM_MAX_DURATION_S * 1000 - 5_000 && LIVE_STREAM_HOLD_MS >= 60_000)
  check('tape: a venue tag beside the market reads hl · lighter · lighter·rh · the chain of a spot swap; a spot symbol maps to the ticker the ask grammar buys (WETH → ETH, cbBTC → BTC)',
    venueTag('hyperliquid', null) === 'hl' && venueTag('lighter', null) === 'lighter' && venueTag('lighter-robinhood', null) === 'lighter·rh' && venueTag('dex', 8453) === 'base' && venueTag('dex', 1) === 'eth' && venueTag('dex', 42161) === 'arb' && venueTag('dex', null) === 'dex' &&
      dexAskTicker('WETH') === 'ETH' && dexAskTicker('cbBTC') === 'BTC' && dexAskTicker('LINK') === 'LINK' && chainWord(8453) === 'Base' && chainWord(999) === null)

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
    st.notionalPerMin === 520 && st.largestPrint?.id === '1' && st.hotMarket?.market === 'HYPE' && st.hotMarket.usd === 470 && st.hotMarket.side === 'buy' && st.takerFlow.buyUsd === 370 && st.takerFlow.sellUsd === 150 && st.takerFlow.buyPct === 71 && st.tradesPerSec === 0, JSON.stringify(st))
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
  const dexFollow = followAsk({ market: 'WETH', side: 'buy', venue: 'dex', chainId: 8453 })
  check('tape: a DEX print follows as the same swap on its chain — a WETH buy on Base is `Buy $25 of ETH on Base` on the spot cascade (a native ask: the ladder lands it on the swap gate), a spot sell needs a holding and offers nothing, an unknown chain drops the clause',
    dexFollow?.ask === 'Buy $25 of ETH on Base' && dexFollow.venue === 'spot' && dexFollow.tone === 'buy' && dexFollow.label === 'Buy ETH' && simulateLadder('Buy $25 of ETH on Base').gate === 'swap' && simulateLadder('Buy $25 of LINK on Arbitrum').gate === 'swap' &&
      followAsk({ market: 'WETH', side: 'sell', venue: 'dex', chainId: 8453 }) === null && followAsk({ market: 'UNI', side: 'buy', venue: 'dex', chainId: null })?.ask === 'Buy $25 of UNI' && followAsk({ market: 'BTC', side: 'buy', venue: 'lighter', chainId: null })?.ask === 'Long $25 of BTC on Hyperliquid', JSON.stringify(dexFollow))
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
  const pickedXyz = pickTapeMarkets([], [{ name: 'xyz:SPCX', volumeUsd: 900 }, { name: 'xyz:GOLD', volumeUsd: 800 }, { name: 'xyz:JPY', volumeUsd: 700 }, { name: 'xyz:TSLA', volumeUsd: 50 }, { name: 'xyz:INTC', volumeUsd: 70 }, { name: 'xyz:XYZ100', volumeUsd: 999 }], { main: 0, xyz: 4 })
  check('tape: the subscription is the busiest books by the venue\'s own 24h volume, main then xyz; delisted, zero-volume and the dex index never make it; among xyz the two hottest lead, then the stocks the house lists (their rows carry a button) before gold and FX; the fallback list stands on its own',
    picked.join(',') === 'ETH,xyz:INTC' && pickedXyz.join(',') === 'xyz:SPCX,xyz:GOLD,xyz:INTC,xyz:TSLA' && pickTapeMarkets([], []).length === 0 && FALLBACK_MARKETS.includes('HYPE') && FALLBACK_MARKETS.some((m) => m.startsWith('xyz:')), `${picked.join(',')} / ${pickedXyz.join(',')}`)

  const busy = busiestMarkets([fill({ id: 'a', market: 'BTC', usd: 50, at: T0 }), fill({ id: 'b', market: 'ETH', usd: 500, at: T0 }), fill({ id: 'c', market: 'ETH', usd: 1, at: T0 - 59_000 }), fill({ id: 'd', market: 'SOL', usd: 9_999, at: T0 - 61_000 }), fill({ id: 'e', market: 'ARB', usd: 50, at: T0 })], T0 + 500, 3)
  check('tape: the busiest markets are the ones with the most dollars in the last minute (the firehose\'s chip row), ties by name, nothing older than the window, capped',
    busy.join(',') === 'ETH,ARB,BTC' && busiestMarkets([], T0, 5).length === 0 && TAPE_MAX_FILLS >= 110 * (TAPE_KEEP_MS / 1000), busy.join(','))

  // ── Your own markets (lib/live-markets, 2026-10-13) ───────────────────
  const UNI = ['BTC', 'ETH', 'UNI', 'kPEPE', 'xyz:NVDA', 'xyz:AAPL', 'HYPE']
  const mem = parseLiveMarketMemory(serializeLiveMarketMemory({ own: ['UNI', 'XYZ:nvda', 'UNI', 'bad market'], at: 5 }))
  check('own markets: the memory round-trips in the venue\'s spelling (xyz: lowercased, duplicates and bad shapes dropped), an EMPTY memory is a real one (a hand cleared the row), and any defect reads as nothing remembered',
    !!mem && mem.own.join(',') === 'UNI,xyz:nvda' && mem.at === 5 && parseLiveMarketMemory(serializeLiveMarketMemory({ own: [], at: 1 }))?.own.length === 0 && parseLiveMarketMemory('nope') === null && parseLiveMarketMemory(JSON.stringify({ v: 2, own: ['UNI'] })) === null && parseLiveMarketMemory(null) === null && LIVE_MARKETS_KEY === 'pantessa.live.markets.v1', JSON.stringify(mem))
  const watch = watchlistMarkets(['AAPL', 'cbBTC', 'USDC', 'eth', 'PEPE', 'NOPE', 'ETH', 'NVDA'], UNI)
  check('own markets: the watchlist resolves to venue markets in list order — AAPL is the xyz:AAPL perp, cbBTC is BTC, pepe is kPEPE, money and unknown names drop, duplicates fold; nothing while the universe is unknown',
    watch.join(',') === 'xyz:AAPL,BTC,ETH,kPEPE,xyz:NVDA' && watchlistMarkets(['AAPL'], []).length === 0 && watchlistMarkets(Array.from({ length: 30 }, (_, i) => `T${i}`), Array.from({ length: 30 }, (_, i) => `T${i}`)).length === MAX_OWN_MARKETS, watch.join(','))
  check('own markets: the row opens on the memory (even an empty one — never re-seeded), else the watchlist, else nothing; only a hand\'s source wears "as you left them"',
    openingOwnMarkets({ memory: { own: [], at: 1 }, watch: ['ETH'] }).source === 'memory' && openingOwnMarkets({ memory: { own: [], at: 1 }, watch: ['ETH'] }).own.length === 0 && openingOwnMarkets({ memory: { own: ['UNI'], at: 1 }, watch: ['ETH'] }).own.join() === 'UNI' &&
      openingOwnMarkets({ memory: null, watch: ['ETH', 'BTC'] }).source === 'watchlist' && openingOwnMarkets({ memory: null, watch: [] }).source === null && OWN_SOURCE_NOTE.watchlist === 'from your watchlist' && OWN_SOURCE_NOTE.memory === 'as you left them')
  const add = addLiveMarkets('uni, nvda OPENAI btc nope', knownMarkets(UNI, ['OPENAI', 'btc']), ['BTC'])
  check('own markets: a typed list adds several at once in the venue\'s spelling (uni → UNI, nvda → xyz:NVDA), a name the stream has printed resolves even off the venue\'s list (OPENAI on Lighter), an already-held market is skipped silently, an unknown name is named back; remove drops one',
    add.added.join(',') === 'UNI,xyz:NVDA,OPENAI' && add.unknown.join(',') === 'nope' && add.full.length === 0 && removeLiveMarket(['BTC', 'UNI'], 'BTC').join() === 'UNI' && knownMarkets(['BTC'], ['btc', 'ETH']).join(',') === 'BTC,ETH', JSON.stringify(add))
  const row = chipRow(['UNI', 'ETH'], ['BTC', 'ETH', 'SOL', 'DOGE'], 'xyz:MU', 2)
  check('own markets: the chip row leads with yours in your order (wearing the remove button), then the page\'s own list minus what you hold, capped, the active filter kept in view',
    row.map((e) => `${e.market}${e.own ? '*' : ''}`).join(',') === 'xyz:MU,UNI*,ETH*,BTC,SOL' && chipRow([], ['BTC'], null, 5).length === 1 && chipRow([], ['BTC'], 'BTC', 5).length === 1, row.map((e) => e.market).join(','))
  // RE-PINNED 2026-10-13 (gtm3h): the rows read THE ONE PICK (lib/use-market-pick) — the store reads the
  // memory once, writes it only from a hand (add / remove / a fill-from), reads the watchlist as a second
  // instance; the rows write no storage of their own and the old live-row key is never written.
  // RE-PINNED 2026-10-13 (pick-reads): the watchlist reaches the store through the page's ONE subscriber
  // (components/live/PickReads, `holdings: false`) — the store calls no hook; one GET /api/watchlists a page.
  check('own markets: both rows read the one pick, write it ONLY from a hand (add / remove — a watchlist default is never remembered as yours), the store takes the watchlist from the page\'s one subscriber (`holdings: false`, never the rail\'s reconcile claim), and the venue socket\'s subscription carries your own markets',
    (() => {
      const live = readFileSync('components/live/LiveFeed.tsx', 'utf8')
      const slot = readFileSync('components/home/PulseSlot.tsx', 'utf8')
      const store = readFileSync('lib/use-market-pick.ts', 'utf8')
      const reads = readFileSync('components/live/PickReads.tsx', 'utf8')
      const hand = (src: string) => /useMarketPick\(\{ seat: '(page|stage)' \}\)/.test(src) && /\.set\(\[\.\.\.(pick|picked)\.markets, \.\.\.r\.added\], 'hand'\)/.test(src) && /\.remove\(m\)/.test(src) && !/localStorage\.setItem|writeLiveMarketMemory\(|writeMarketPick\(/.test(src) && /insertReplacementText/.test(src)
      const storeOk = /useWatchlists\(\{ holdings: false \}\)/.test(reads) && !/useWatchlists\(/.test(store) && /show: \(markets, source, write = source === 'hand'\) => \{\s*const next = cleanPick\(markets\)\s*if \(write\) writeMarketPick\(next\)/.test(store) && /readMarketPick\(\)/.test(store) && !/writeLiveMarketMemory|ARMY_MEMORY_KEY/.test(store)
      return hand(live) && hand(slot) && storeOk && /feed\.connect\(\[\.\.\.new Set\(\[\.\.\.markets, \.\.\.own\]\)\], handlers\)/.test(live) && /chipRow\(own, busiest \?\? markets \?\? \[\.\.\.FALLBACK_MARKETS\], filter, CHIP_MARKETS\)/.test(live) && /const aim = useMemo\(\(\) => \[\.\.\.new Set\(\[\.\.\.own, \.\.\.markets\]\)\], \[own, markets\]\)/.test(slot) && /chipRow\(own, markets, null, markets\.length\)/.test(slot)
    })())
  // THE ONE PICK'S READS (2026-10-13): one subscriber a page. Found by the GTM squad's QA FINAL — six
  // GET /api/watchlists on a signed-in `/`, one per useMarketPick() instance; scripts/pick-reads-drive.mjs
  // counts one a page now.
  check('pick reads: ONE subscriber a page — components/live/PickReads calls useWatchlists({ holdings: false }) and useHeld() once each and publishes through publishPickReads; the deck and /live\'s surface mount <PickReads /> once each, outside the view that remounts; no other home or live surface calls either hook (the first-run sheet reads usePickReads); the store decides the opening once (decide) and useMarketPick runs no opening effect of its own; the lists hook shares an in-flight GET /api/watchlists across the instances of one commit',
    (() => {
      const reads = readFileSync('components/live/PickReads.tsx', 'utf8')
      const store = readFileSync('lib/use-market-pick.ts', 'utf8')
      const deck = readFileSync('components/home/Deck.tsx', 'utf8')
      const surface = readFileSync('components/live/LiveSurface.tsx', 'utf8')
      const sheet = readFileSync('components/live/PickSheet.tsx', 'utf8')
      const hook = readFileSync('components/markets/watchlist/useWatchlists.ts', 'utf8')
      const others = ['components/home/PulseSlot.tsx', 'components/home/TapeStage.tsx', 'components/home/Deck.tsx', 'components/live/Battle.tsx', 'components/live/LiveFeed.tsx', 'components/live/ShareLive.tsx', 'components/live/PickSheet.tsx', 'components/live/LiveSurface.tsx', 'lib/use-market-pick.ts']
      const noHooks = others.every((f) => !/useWatchlists\(|useHeld\(/.test(readFileSync(f, 'utf8')))
      return (reads.match(/const wl = useWatchlists\(\{ holdings: false \}\)/g) ?? []).length === 1 && (reads.match(/const held = useHeld\(\)/g) ?? []).length === 1 && /publishPickReads\(\{ watchSymbols, held, signedOut \}\)/.test(reads) && /claimSeat\(/.test(reads) && /return owns \? <PickReadsSubscriber \/> : null/.test(reads) &&
        (deck.match(/<PickReads \/>/g) ?? []).length === 1 && (surface.match(/<PickReads \/>/g) ?? []).length === 1 && /<PickReads \/>\s*\{isBattleView\(view\) \? <Battle key=\{view\}/.test(surface) &&
        noHooks && /const \{ watchSymbols, held \} = usePickReads\(\)/.test(sheet) &&
        /function decide\(\): void/.test(store) && /export function publishPickReads\(r: PickReads\): void/.test(store) && !/useEffect\(\(\) => \{[^}]*openingPick/.test(store) && (store.match(/openingPick\(\{/g) ?? []).length === 1 &&
        /const listReads = new Map<string, Promise<\{ lists: WatchlistShape\[\] \}>>\(\)/.test(hook) && /await readLists\(modeKey\)/.test(hook) && /listReads\.delete\(modeKey\)/.test(hook)
    })())

  // ── The chart's live tail (lib/chart-live, 2026-10-13) ────────────────
  const hype = chartLiveFeed({ symbol: 'HYPE', source: 'hyperliquid', pair: 'HYPE' })
  const uni = chartLiveFeed({ symbol: 'UNI', source: 'coinbase', pair: 'UNI-USD' })
  const eth = chartLiveFeed({ symbol: 'ETH', source: 'coinbase', pair: 'ETH-USD' })
  check('chart tail: only the chart\'s OWN instrument drives its tail — a perp takes HyperCore prints for its coin, a trial-covered coin takes DEX spot prints under its printed symbols (ETH ← WETH + ETH, BTC ← WBTC + cbBTC), a coin outside the trial and every stock take nothing',
    hype?.venues.join() === 'hypercore' && hype.markets.join() === 'HYPE' && uni?.venues.join(',') === 'dex-ethereum,dex-base,dex-arbitrum' && uni.markets.join() === 'UNI' && eth?.markets.join(',') === 'WETH,ETH' && chartLiveFeed({ symbol: 'BTC', source: 'coinbase', pair: 'BTC-USD' })?.markets.join(',') === 'WBTC,cbBTC' &&
      chartLiveFeed({ symbol: 'DOGE', source: 'coinbase', pair: 'DOGE-USD' }) === null && chartLiveFeed({ symbol: 'AAPL', source: 'robinhood', pair: 'AAPL' }) === null && chartLiveFeed(null) === null)
  check('chart tail: the tail follows the prints on 1s · 1m · 15m · 1H only (4H and 1D poll); the list leads 1s then 1m; a stock\'s list has neither (no prints, no minute bar); the Technicals gauge never reads a print frame; VENUE_TFS is every frame a venue serves',
    LIVE_TAIL_TFS.join(',') === '10s,1m,15m,1h' && tailIsLive('1h', hype) && !tailIsLive('4h', hype) && !tailIsLive('1d', hype) && !tailIsLive('1m', null) && CHART_TFS[0].key === '10s' && CHART_TFS[1].key === '1m' && CHART_TFS.length === 6 && isPrintTf('10s') && !isPrintTf('1m') &&
      tfsForSource('robinhood').map((t) => t.key).join(',') === '15m,1h,4h,1d' && tfsForSource('coinbase').length === 6 && technicalsTfs('coinbase').every((t) => !isPrintTf(t.key)) && VENUE_TFS.length === 5 && VENUE_TFS[0].key === '1m')
  const TP = 1_791_880_000_000
  const ring = [{ at: TP + 2_500, price: 7.5, size: 1 }, { at: TP + 100, price: 7.4, size: 2 }, { at: TP + 1_200, price: 7.45, size: 1 }, { at: TP + 1_900, price: 7.3, size: 3 }, { at: TP + 1_500, price: 0, size: 1 }]
  const pb = barsFromPrints(ring, 1)
  check('print frame: the bars come from the prints alone, oldest first whatever order they arrived in — one bar per second that printed (a quiet second is a gap, never an invented flat bar), a zero price is noise',
    pb.length === 3 && pb[0].t === Math.floor((TP + 100) / 1000) && pb[0].c === 7.4 && pb[1].o === 7.45 && pb[1].h === 7.45 && pb[1].l === 7.3 && pb[1].c === 7.3 && pb[1].v === 4 && pb[2].o === 7.5 && pb.every((b, i) => i === 0 || b.t > pb[i - 1].t), JSON.stringify(pb))
  check('print frame: the frame is a shareable address — ?tf= set for every frame but the default, which drops it, other params kept',
    tfUrl('10s', '1d', '/t/HYPE', '') === '/t/HYPE?tf=10s' && tfUrl('1d', '1d', '/t/HYPE', '?tf=10s&tab=trade') === '/t/HYPE?tab=trade' && tfUrl('15m', '1d', '/t/UNI', '?vs=ETH') === '/t/UNI?vs=ETH&tf=15m')
  check('print frame: the relay remembers each venue\'s last minutes of prints (an UPDATE replaces its block) and hands them to a `?backfill=1` reader before the live ones; the adapter delivers them as onBackfill; the chart asks for them only on a print frame, polls the venue for the header\'s numbers alone, re-derives its bars once a second, and the symbol page hands the chart the URL\'s frame and mirrors it back',
    (() => {
      const server = readFileSync('lib/dune-feed-server.ts', 'utf8')
      const route = readFileSync('app/api/live/stream/route.ts', 'utf8')
      const feed = readFileSync('lib/tape-feed.ts', 'utf8')
      const chart = readFileSync('components/markets/chart/MarketChart.tsx', 'utf8')
      const page = readFileSync('components/markets/shell/SymbolPage.tsx', 'utf8')
      const candles = readFileSync('app/api/charts/candles/route.ts', 'utf8')
      return /remember\(u, parsed\.op, parsed\.block, parsed\.fills\)/.test(server) && /ring\.filter\(\(f: TapeFill\) => f\.block !== block\)/.test(server) && /export function duneBackfill/.test(server) &&
        /sp\.get\('backfill'\) === '1'/.test(route) && /type: 'backfill', venue: v, fills: b\.fills/.test(route) && route.indexOf("type: 'backfill'") < route.indexOf('unsub = subscribeDune') &&
        /addEventListener\('backfill'/.test(feed) && /handlers\.onBackfill\?\.\(e\.fills, e\.sinceMs\)/.test(feed) &&
        /backfill: print \}/.test(chart) && /barsFromPrints\(printsRef\.current\.map\(printOf\), tfSec\)/.test(chart) && /tf=\$\{isPrintTf\(tf\) \? '1m' : tf\}/.test(chart) && /setInterval\(rebuild, 1_000\)/.test(chart) && /secondsVisible: isPrintTf\(tf\)/.test(chart) && /if \(urlTf\) syncTfParam\(tf, DEFAULT_CHART_TF\)/.test(chart) &&
        /defaultTf=\{initialTf\} urlTf/.test(page) && /if \(isPrintTf\(tf\)\) return NextResponse\.json/.test(candles)
    })())
  const T = 1_791_880_000_000 // ms
  const b0 = bucketOf(T, 60)
  const open = applyPrint(null, { at: T, price: 7.4, size: 10 }, 60)
  const up = applyPrint(open!.bar, { at: T + 5_000, price: 7.5, size: 2 }, 60)
  const down = applyPrint(up!.bar, { at: T + 9_000, price: 7.3, size: 1 }, 60)
  const next = applyPrint(down!.bar, { at: (b0 + 60) * 1000 + 100, price: 7.35, size: 4 }, 60)
  check('chart tail: a print stretches the tail\'s high and low, moves its close and adds its size; a print in a newer bucket opens a new bar at its price; a print older than the tail is history the venue closed (ignored); a zero price is noise',
    !!open && open.fresh && open.bar.t === b0 && open.bar.o === 7.4 && open.bar.v === 10 && !!up && !up.fresh && up.bar.h === 7.5 && up.bar.c === 7.5 && up.bar.v === 12 && !!down && down.bar.l === 7.3 && down.bar.h === 7.5 && down.bar.c === 7.3 && down.bar.o === 7.4 && down.bar.v === 13 &&
      !!next && next.fresh && next.bar.t === b0 + 60 && next.bar.o === 7.35 && next.bar.v === 4 && applyPrint(next.bar, { at: T, price: 7.9, size: 1 }, 60) === null && applyPrint(null, { at: T, price: 0, size: 1 }, 60) === null && printOf({ at: 1, price: 2, size: 3 }).size === 3, JSON.stringify([open, up, down, next]))
  check('chart tail: the pill says where the prints come from and whether the tail is live, says "polled" by name for a frame or an instrument that polls, and names a keyless relay',
    tailWords('live', hype, '15m') === 'Hyperliquid prints · live' && tailWords('live', uni, '1m') === 'DEX prints · live' && tailWords('live', hype, '1d') === 'polled · prints on 1m–1H' && tailWords('live', null, '1m') === 'polled' && tailWords('unconfigured', hype, '1m') === 'polled · relay has no key' && tailWords('reconnecting', uni, '1h') === 'DEX prints · reconnecting')
  // RE-PINNED 2026-10-13 (depth): the stream opens for the Depth view on any frame too; the engine's bar still moves only on a live frame.
  check('chart tail: MarketChart opens the relay filtered to the instrument\'s own prints only on a live frame (or for the Depth view), updates the engine\'s last bar in place (never setData per print), re-applies a live bar the poll has not reached yet, and a stock never asks for 1m',
    (() => {
      const src = readFileSync('components/markets/chart/MarketChart.tsx', 'utf8')
      return /openDuneTape\(liveFeed\.markets/.test(src) && /\{ venues: liveFeed\.venues, filter: true, backfill: print \}/.test(src) && /if \(!liveFeed \|\| !\(tailIsLive\(tf, liveFeed\) \|\| depthOn\)\)/.test(src) && /if \(!tailLive\) return/.test(src) && /applyPrint\(tailRef\.current, printOf\(f\), tfSec\)/.test(src) && /cs\.update\(\{ time: r\.bar\.t as UTCTimestamp/.test(src) && /tailRef\.current = bars\[bars\.length - 1\] \?\? null/.test(src) && /tfsForSource\(pair\?\.source\)/.test(src) && /pair\?\.source === 'robinhood' && tf === '1m'/.test(src) && /data-tail=\{/.test(src)
    })())

  // ── Formats ───────────────────────────────────────────────────────────
  check('tape: dollars print like a tape ($898.53 · $1.53K · $83.85K · $1.20M), the axis in short units, a price at its own precision, a size without trailing zeros, an address as 0x98da_f13b',
    fmtUsd(898.53) === '$898.53' && fmtUsd(1534.94) === '$1.53K' && fmtUsd(83_850) === '$83.85K' && fmtUsd(1_200_000) === '$1.20M' && fmtAxisUsd(200_000) === '200K' && fmtAxisUsd(1_200_000) === '1.2M' && fmtPrice(86047) === '86047.0' && fmtPrice(1703) === '1703.0' && fmtPrice(118.62) === '118.62' && fmtPrice(0.13248) === '0.1325' && fmtPrice(0.008636) === '0.008636' && fmtPrice(4.2226) === '4.2226' && fmtSize(0.00200) === '0.002' && fmtSize(22499) === '22499' && fmtSize(2.918) === '2.918' && fmtAddr('0x98da633cc3814857680eb313de6770b7a801f13b') === '0x98da_f13b')

  // ── The page ──────────────────────────────────────────────────────────
  check('tape: /live is a public markets-shell page (looking needs no wallet) and every act goes through the connect-to-act door into the ask door\'s sheet with the ask\'s own apps',
    isMarketsPath('/live') && isPublicAppPath('/live') && (() => {
      const src = readFileSync('components/live/LiveFeed.tsx', 'utf8')
      return /useConnectToAct\(\{ run, redirectFor: promptHref \}\)/.test(src) && /openDoor\(ask, \{ send: true, mcps: askAppSlugs\(ask\) \}\)/.test(src) && /canTradeAsk\(f\.ask, tradable\)/.test(src) && !/fetch\(['"`]\/api\/chat/.test(src)
    })())
  check('tape: Dune is read through OUR relay (the key rides the WebSocket upgrade — lib/dune-feed-server alone sends X-Dune-Api-Key; no client file and no NEXT_PUBLIC_ name ever carries it), the page holds the relay\'s Server-Sent Events with a probe first so `unconfigured` is a word, the venue\'s keyless socket is the fallback that names its two missing fields, and the relay route says bye before its limit',
    (() => {
      const feed = readFileSync('lib/tape-feed.ts', 'utf8')
      const server = readFileSync('lib/dune-feed-server.ts', 'utf8')
      const route = readFileSync('app/api/live/stream/route.ts', 'utf8')
      const clientFiles = ['lib/tape-feed.ts', 'lib/tape.ts', 'lib/pulse.ts', 'lib/dune.ts', 'lib/deck.ts', 'components/live/LiveFeed.tsx', 'components/home/PulseSlot.tsx', 'components/home/Deck.tsx', 'components/home/TapeStage.tsx', 'components/home/BookLadder.tsx', 'components/live/Battle.tsx'].map((f) => readFileSync(f, 'utf8')).join('\n')
      return /^'use client'/.test(feed) && /wss:\/\/api\.hyperliquid\.xyz\/ws/.test(feed) && /fields: \{ effect: false, block: false \}/.test(feed) && /fields: \{ effect: true, block: true \}/.test(feed) && /new EventSource\(url\)/.test(feed) && /\?probe=1/.test(feed) && /res\.status === 503/.test(feed) && /onStatus\('unconfigured'/.test(feed) && /addEventListener\('bye'/.test(feed) && /export function connectTape/.test(feed) && /requestAnimationFrame/.test(feed) &&
        !/'use client'/.test(server) && /'X-Dune-Api-Key': key/.test(server) && /resumeUrl\(venue\.url, u\.cursor\)/.test(server) && /ev\.code === 1008/.test(server) && /IDLE_CLOSE_MS/.test(server) &&
        /text\/event-stream/.test(route) && new RegExp(`export const maxDuration = ${LIVE_STREAM_MAX_DURATION_S}\\b`).test(route) && /status: 503/.test(route) && /type: 'bye'/.test(route) && /LIVE_STREAM_PER_IP/.test(route) &&
        // The prod leak (2026-10-13): a gone client leaves only backpressure on Vercel — a writer releases itself after two stalled heartbeats, and the cap counts only writers younger than the hold.
        /c\.desiredSize !== null && c\.desiredSize <= 0/.test(route) && /stalled >= DEAD_BEATS/.test(route) && /const STALE_MS = LIVE_STREAM_HOLD_MS \+/.test(route) && /liveWriters\(ip, now\)/.test(route) && !/__liveStreamsTotal/.test(route) &&
        !/X-Dune-Api-Key|DUNE_BETA_API_KEY|process\.env\.DUNE/.test(clientFiles.replace(/\/\/[^\n]*|\/\*[^]*?\*\//g, '').replace(/DUNE_FEED_KEY_ENV = 'DUNE_BETA_API_KEY'/, '')) && !/NEXT_PUBLIC_DUNE/.test(clientFiles + feed + server + route)
    })())

  // ── Print-frame zoom + the Wall's fitted margin (2026-10-13) ────────────
  check('print frame zoom: a print frame opens at PRINT_BAR_SPACING (6 px — the engine\'s own default, what Reset restores) with the newest bar at the right edge plus the margin, however few bars the ring holds: a range the engine turns into exactly that spacing (width / (to − from + 1)), `from` negative on a cold ring (the time before the relay held prints is empty, not missing); no bars, no width or no spacing → no view',
    (() => {
      const cold = printOpeningView(1, 4, 904)
      const warm = printOpeningView(300, 40, 1500)
      return PRINT_BAR_SPACING === 6 && !!cold && cold.to === 4 && Math.abs(cold.to - cold.from + 1 - 904 / 6) < 1e-9 && cold.from < 0 &&
        !!warm && warm.to === 339 && Math.abs(1500 / (warm.to - warm.from + 1) - 6) < 1e-9 && warm.from === 90 &&
        printOpeningView(0, 4, 904) === null && printOpeningView(5, 4, 0) === null && printOpeningView(5, 4, 904, 0) === null
    })(), JSON.stringify({ cold: printOpeningView(1, 4, 904), warm: printOpeningView(300, 40, 1500) }))
  check('print frame zoom: a fit\'s margin for the Wall is solved at the FITTED spacing — a fixed point of marginBarsFor at width / (bars + margin) — so 15 bars and a 212 px Wall on a 904 px plot fit at ~41 px a bar with 7 bars of margin, never the 221 bars the zoomed-out spacing counted; no Wall, no bars or no width → the engine\'s own offset; the engine\'s held offset reads off its range as to − (bars − 1)',
    (() => {
      const m = fitMarginBars(15, 4, 212, 904)
      const s = 904 / (15 + m)
      const big = fitMarginBars(380, 4, 212, 1500)
      return m >= 6 && m <= 9 && marginBarsFor(212, s, 4) === m && s > 30 && s < 45 &&
        fitMarginBars(15, 4, 0, 904) === 4 && fitMarginBars(0, 4, 212, 904) === 4 && fitMarginBars(15, 4, 212, 0) === 4 &&
        marginBarsFor(212, 1500 / (380 + big), 4) === big && big < 100 &&
        engineRightOffset({ from: 4.66, to: 18 }, 14) === 5 && engineRightOffset({ from: 0, to: 10 }, 0) === null
    })(), JSON.stringify({ m: fitMarginBars(15, 4, 212, 904), big: fitMarginBars(380, 4, 212, 1500) }))
  check('print frame zoom: the chart wires it — the viewport guard leaves a print frame alone (no clamp, nothing to page), a fit carries fitMarginBars and records it, a print frame opens on printOpeningView (never fitContent), the margin sync reads the engine\'s held offset (an offset written in the same frame as a range write is dropped by the engine), the browser keeps half an hour of prints while the relay backfills five minutes, and no drive hook ships',
    (() => {
      const chart = readFileSync('components/markets/chart/MarketChart.tsx', 'utf8')
      const guard = chart.slice(chart.indexOf('const requestGuard'), chart.indexOf('// Warm-up:'))
      return /if \(isPrintTf\(tfRef\.current\)\) \{\s*emitViewport\(view\)\s*return\s*\}/.test(guard) && guard.indexOf('isPrintTf(tfRef.current)') < guard.indexOf('clampToFirstBar(view, drawn, marginRef.current)') &&
        /fitMarginBars\(drawn, RIGHT_OFFSET, wallPxRef\.current, ts\.width\(\)\)/.test(guard) && /marginRef\.current = margin\s*clamped = \{ from: 0, to: drawn - 1 \+ margin \}/.test(guard) &&
        /if \(isPrintTf\(tf\)\) \{[\s\S]{0,600}printOpeningView\(bars\.length, margin, ts\.width\(\)\)/.test(chart) && /marginBarsFor\(wallPxRef\.current, PRINT_BAR_SPACING, RIGHT_OFFSET\)/.test(chart) &&
        /engineRightOffset\(view, drawnRef\.current\)/.test(chart) && /Math\.abs\(held - want\) < 1/.test(chart) &&
        PRINT_KEEP_MS === 30 * 60_000 && LIVE_BACKFILL_MS === 5 * 60_000 && !chart.includes('__mkChart')
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
