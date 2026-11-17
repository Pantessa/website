// Pins for orders on Hyperliquid's builder-deployed (HIP-3) dexes — "Long $25
// of SP500 on Hyperliquid" builds a guarded order on `xyz:SP500` (2026-11-09).
//
// Every number in the fixtures is the VENUE'S, as it answered that day (the
// PR carries the raw responses), not the docs':
//   · mainnet `perpDexs`: slot 0 null (the main book), slot 1 `xyz`, slot 8
//     `para`; testnet lists `xyz` at slot 65;
//   · mainnet `meta{dex:xyz}`: XYZ100 row 0, TSLA 1, NVDA 2, GOLD 3, JPY 24
//     (isolated-only), EUR 25 (isolated-only), CL 29, SP500 52;
//   · real `xyz:SP500` fills on the explorer carry `a: 110052`; our own
//     testnet fills carried `a: 750024` (xyz:JPY) and `a: 750002` (xyz:NVDA).
//
// Called from scripts/test-api.ts, and runnable alone — no server, no DB:
//   npx tsx scripts/hl-hip3-pins.ts          pure pins
//   npx tsx scripts/hl-hip3-pins.ts --live   + read-only checks against the
//                                             venue (and BASE=http://… adds the
//                                             served pages and the chat turn)
import fs from 'node:fs'
import path from 'node:path'
import { recoverTypedDataAddress } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  HL_BUILDER_ASSET_BASE,
  HL_BUILDER_ASSET_SPAN,
  HL_BUILDER_DEXES,
  HL_BUILDER_DEX_NAMES,
  HL_USDC_TOKEN,
  hlAssetId,
  hlDexOf,
  hlMarginModeOf,
  hlTickerOf,
  isOrderableHlCoin,
  isOrderableHlDex,
  orderableHlTickers,
  resolveHlCoin,
  splitHlAssetId,
} from '../lib/hl-dex'
import {
  buildHlLeverageAction,
  buildHlOrderAction,
  canonicalizeHlAction,
  guardHlDexTransfer,
  guardHlExecBuild,
  guardHlLeverageBuild,
  hlActionSummary,
  hlAssetIdentity,
  hlCanonicalAsk,
  hlCoinLabel,
  hlCollateralUsd,
  hlConsentMessage,
  hlDexCollateralNeedUsd,
  hlDexTransferArtifacts,
  hlDexTransferUsd,
  hlFreshNonce,
  hlMinOpenUsd,
  hlPerDexBalances,
  hlSendAssetTypedData,
  hlUnsizedChips,
  hlUsdcAmount,
  parseHlIntent,
  pickHlMarket,
  stripHlDexPrefixes,
  type HlMarketReads,
  type HlMarketSnapshot,
  type HlOrderIntent,
  type HlWireSendAssetAction,
} from '../lib/hyperliquid-exec'
import { composeHlBatch } from '../lib/hl-batch'
import { fenceGuardianCoin } from '../lib/hl-guardian-fence'
import type { GuardianArmAsk } from '../lib/hl-guardian'

type Check = (name: string, ok: boolean, extra?: string) => void

// ── The venue, as it answered ───────────────────────────────────────────────
const XYZ_DEPLOYER = '0x88806a71d74ad0a510b350545c9ae490912f0888'
const MAINNET_DEXS: ({ name: string; deployer: string } | null)[] = [
  null,
  { name: 'xyz', deployer: XYZ_DEPLOYER },
  { name: 'flx', deployer: '0x2fab552502a6d45920d5741a2f3ebf4c35536352' },
  { name: 'vntl', deployer: '0x8888888192a4a0593c13532ba48449fc24c3beda' },
  { name: 'hyna', deployer: '0x53e655101ea361537124ef814ad4e654b54d0637' },
  { name: 'km', deployer: '0x71f0019cc7fa79e4f42587fb7b9a817d8d2429ec' },
  { name: 'abcd', deployer: '0x372c7f69d0ecc14f73f89bd8a7dfb41bdf29857c' },
  { name: 'cash', deployer: '0xffa8198c62adb1e811629bd54c9b646d726deef7' },
  { name: 'para', deployer: '0x8888888c43cbb7e1c4132542e46831bffd866ed3' },
  { name: 'mkts', deployer: '0x71f0019cc7fa79e4f42587fb7b9a817d8d2429ec' },
  { name: 'io', deployer: '0x320c8988e3d1b5198f335802d7bfd2728a8fcac6' },
]
/** Testnet's list has 278 slots; `xyz` sits at 65. */
const TESTNET_DEXS: ({ name: string; deployer: string } | null)[] = Array.from({ length: 70 }, (_, i) =>
  i === 0 ? null : i === 65 ? { name: 'xyz', deployer: '0x1111111111111111111111111111111111111111' } : { name: `t${i}`, deployer: '0x2222222222222222222222222222222222222222' },
)
type Row = { name: string; szDecimals: number; maxLeverage: number; onlyIsolated?: boolean; marginMode?: string; isDelisted?: boolean }
/** The xyz universe at its real row numbers (filler rows keep the indices true). */
function xyzUniverse(): Row[] {
  const rows: Row[] = Array.from({ length: 144 }, (_, i) => ({ name: `xyz:FILL${i}`, szDecimals: 2, maxLeverage: 10, onlyIsolated: true, marginMode: 'noCross' }))
  rows[0] = { name: 'xyz:XYZ100', szDecimals: 4, maxLeverage: 30 }
  rows[1] = { name: 'xyz:TSLA', szDecimals: 3, maxLeverage: 20 }
  rows[2] = { name: 'xyz:NVDA', szDecimals: 3, maxLeverage: 20 }
  rows[3] = { name: 'xyz:GOLD', szDecimals: 4, maxLeverage: 25 }
  rows[10] = { name: 'xyz:VIX', szDecimals: 2, maxLeverage: 10, onlyIsolated: true, marginMode: 'strictIsolated', isDelisted: true }
  rows[11] = { name: 'xyz:STX', szDecimals: 2, maxLeverage: 10, onlyIsolated: true, marginMode: 'noCross', isDelisted: true }
  rows[12] = { name: 'xyz:MKR', szDecimals: 2, maxLeverage: 10 }
  rows[24] = { name: 'xyz:JPY', szDecimals: 2, maxLeverage: 50, onlyIsolated: true, marginMode: 'noCross' }
  rows[25] = { name: 'xyz:EUR', szDecimals: 1, maxLeverage: 50, onlyIsolated: true, marginMode: 'noCross' }
  rows[29] = { name: 'xyz:CL', szDecimals: 3, maxLeverage: 20 }
  rows[52] = { name: 'xyz:SP500', szDecimals: 3, maxLeverage: 50 }
  return rows
}
const MAIN_UNIVERSE: Row[] = [
  { name: 'BTC', szDecimals: 5, maxLeverage: 40 },
  { name: 'ETH', szDecimals: 4, maxLeverage: 25 },
  { name: 'HYPE', szDecimals: 2, maxLeverage: 10 },
  { name: 'kPEPE', szDecimals: 0, maxLeverage: 10 },
  { name: 'STX', szDecimals: 1, maxLeverage: 5 },
  { name: 'XTEN', szDecimals: 0, maxLeverage: 3, onlyIsolated: true, marginMode: 'strictIsolated' },
  { name: 'MKR', szDecimals: 4, maxLeverage: 10, isDelisted: true },
  { name: 'FTM', szDecimals: 0, maxLeverage: 10, isDelisted: true },
]
const reads = (over: Partial<HlMarketReads> = {}): HlMarketReads => ({
  main: MAIN_UNIVERSE,
  perpDexs: MAINNET_DEXS,
  dexes: { xyz: { universe: xyzUniverse(), collateralToken: 0 } },
  ...over,
})
const throws = (run: () => unknown, re: RegExp): boolean => {
  try {
    run()
    return false
  } catch (e) {
    return re.test((e as Error).message)
  }
}
const SP500_ID = 110052
const spSnap: HlMarketSnapshot = {
  assetIndex: SP500_ID, coin: 'xyz:SP500', dex: 'xyz', dexIndex: 1, localIndex: 52, marginMode: 'cross',
  szDecimals: 3, markPx: 7463.45, positionSzi: 0, maxLeverage: 50, accountLeverage: null, approvedBuilderFeeTenthBps: null,
}
const eurSnap: HlMarketSnapshot = {
  assetIndex: 110025, coin: 'xyz:EUR', dex: 'xyz', dexIndex: 1, localIndex: 25, marginMode: 'isolated',
  szDecimals: 1, markPx: 1.12, positionSzi: 0, maxLeverage: 50, accountLeverage: { type: 'isolated', value: 20 }, approvedBuilderFeeTenthBps: null,
}
const spMarket = { dex: 'xyz', dexIndex: 1, localIndex: 52 }

export function hlHip3Pins(check: Check): void {
  // ── 1. The registry is the gate ──────────────────────────────────────────
  check(
    'hip3 (registry): the order layer builds on exactly one builder dex — `xyz`, pinned to mainnet slot 1 and its deployer, USDC collateral — and every other dex the venue lists (para, io, mkts, flx …) is not orderable; a main-book coin always is; USDC is named per network and the two ids never stand in for each other',
    HL_BUILDER_DEX_NAMES.join() === 'xyz' && HL_BUILDER_DEXES.xyz.mainnetIndex === 1 && HL_BUILDER_DEXES.xyz.mainnetDeployer === XYZ_DEPLOYER && HL_BUILDER_DEXES.xyz.collateralToken === 0 &&
      isOrderableHlDex('xyz') && isOrderableHlDex('XYZ') && !isOrderableHlDex('para') && !isOrderableHlDex('io') && !isOrderableHlDex('') && !isOrderableHlDex(null) && !isOrderableHlDex('constructor') && !isOrderableHlDex('toString') &&
      isOrderableHlCoin('BTC') && isOrderableHlCoin('kPEPE') && isOrderableHlCoin('xyz:SP500') && !isOrderableHlCoin('para:10Y') && !isOrderableHlCoin(':SP500') && !isOrderableHlCoin('') && !isOrderableHlCoin(null) &&
      HL_USDC_TOKEN.mainnet === 'USDC:0x6d1e7cde53ba9467b783cb7c530ce054' && HL_USDC_TOKEN.testnet === 'USDC:0xeb62eee3685fc4c43992febcd9e75443',
  )

  // ── 2. The asset id ──────────────────────────────────────────────────────
  check(
    'hip3 (asset id): a builder-dex market is 100000 + dex slot × 10000 + its row — `xyz:SP500` is 110052 on mainnet (what real fills carry), `xyz:JPY` was 750024 and `xyz:NVDA` 750002 on testnet (what OUR fills carried, xyz being slot 65 there); a main-book coin\'s id is its bare row; the split is the exact inverse',
    HL_BUILDER_ASSET_BASE === 100_000 && HL_BUILDER_ASSET_SPAN === 10_000 &&
      hlAssetId(1, 52) === 110052 && hlAssetId(1, 3) === 110003 && hlAssetId(1, 29) === 110029 && hlAssetId(1, 0) === 110000 && hlAssetId(8, 0) === 180000 &&
      hlAssetId(65, 24) === 750024 && hlAssetId(65, 2) === 750002 && hlAssetId(null, 3) === 3 && hlAssetId(null, 0) === 0 &&
      JSON.stringify(splitHlAssetId(110052)) === '{"dexIndex":1,"localIndex":52}' && JSON.stringify(splitHlAssetId(750024)) === '{"dexIndex":65,"localIndex":24}' && JSON.stringify(splitHlAssetId(3)) === '{"dexIndex":null,"localIndex":3}' &&
      [0, 3, 234, 110000, 110052, 119999, 120000, 750024].every((id) => { const s = splitHlAssetId(id)!; return hlAssetId(s.dexIndex, s.localIndex) === id }),
  )
  check(
    'hip3 (asset id): an id that could wrap into another market throws instead — a row past its dex\'s 10,000 ids, a slot below 1, a main-book row in the builder range, anything fractional or negative; and nothing that is not a whole non-negative number splits (100000–109999, the slot-0 gap, is no market)',
    throws(() => hlAssetId(1, 10_000), /does not fit/) && throws(() => hlAssetId(0, 5), /bad dex index/) && throws(() => hlAssetId(-1, 5), /bad dex index/) && throws(() => hlAssetId(1.5, 5), /bad dex index/) &&
      throws(() => hlAssetId(null, 100_000), /out of range/) && throws(() => hlAssetId(1, -1), /bad market index/) && throws(() => hlAssetId(1, 2.5), /bad market index/) && throws(() => hlAssetId(1, Number.NaN), /bad market index/) &&
      splitHlAssetId(105_000) === null && splitHlAssetId(-1) === null && splitHlAssetId(1.5) === null && splitHlAssetId('110052') === null && splitHlAssetId(null) === null && splitHlAssetId(Number.NaN) === null,
  )

  // ── 3. Which market a coin names ─────────────────────────────────────────
  const sp = pickHlMarket('SP500', reads())
  const kp = pickHlMarket('KPEPE', reads())
  check(
    'hip3 (market): a bare ticker resolves on the MAIN book first, in the venue\'s own casing (`KPEPE` is `kPEPE`), then on the xyz dex (`sp500` is `xyz:SP500`, slot 1 row 52); a `dex:` prefix names that dex and nothing else; the main book wins a ticker collision even when the dex lists the name too',
    sp.coin === 'xyz:SP500' && sp.dex === 'xyz' && sp.dexIndex === 1 && sp.localIndex === 52 && hlAssetId(sp.dexIndex, sp.localIndex) === SP500_ID &&
      pickHlMarket('sp500', reads()).coin === 'xyz:SP500' && pickHlMarket('xyz:sp500', reads()).localIndex === 52 && pickHlMarket('XYZ:GOLD', reads()).localIndex === 3 && pickHlMarket('cl', reads()).localIndex === 29 &&
      kp.coin === 'kPEPE' && kp.dex === null && kp.dexIndex === null && kp.localIndex === 3 &&
      pickHlMarket('BTC', reads()).localIndex === 0 && pickHlMarket('btc', reads()).dex === null &&
      // STX: live on main, delisted on xyz → main. MKR: delisted on main, live on xyz → xyz.
      pickHlMarket('STX', reads()).dex === null && pickHlMarket('MKR', reads()).coin === 'xyz:MKR' && pickHlMarket('xyz:MKR', reads()).dex === 'xyz' &&
      // FTM: delisted on main, listed nowhere live → the main row (the caller's "no live mark" refusal, as before).
      pickHlMarket('FTM', reads()).dex === null && pickHlMarket('FTM', reads()).row.isDelisted === true,
  )
  check(
    'hip3 (market): the build FAILS CLOSED on anything that is not the venue it was measured against — the xyz dex missing from perpDexs, at another mainnet slot, under another deployer, or with a collateral token that is not USDC; a dex outside the registry is refused by name; a dex that did not answer is "did not answer", never "not a perp"; and an unknown coin is still "is not a Hyperliquid perp"',
    throws(() => pickHlMarket('SP500', reads({ perpDexs: [null, { name: 'flx', deployer: XYZ_DEPLOYER }] })), /does not carry the XYZ dex/) &&
      throws(() => pickHlMarket('SP500', reads({ perpDexs: [null, { name: 'flx', deployer: XYZ_DEPLOYER }, { name: 'xyz', deployer: XYZ_DEPLOYER }] })), /no longer answers at the slot it was measured at/) &&
      throws(() => pickHlMarket('SP500', reads({ perpDexs: [null, { name: 'xyz', deployer: '0x0000000000000000000000000000000000000bad' }] })), /no longer answers at the slot/) &&
      throws(() => pickHlMarket('SP500', reads({ perpDexs: null })), /does not carry the XYZ dex/) &&
      throws(() => pickHlMarket('SP500', reads({ dexes: { xyz: { universe: xyzUniverse(), collateralToken: 360 } } })), /collateral is no longer USDC/) &&
      throws(() => pickHlMarket('SP500', reads({ dexes: { xyz: { universe: xyzUniverse() } } })), /collateral is no longer USDC/) &&
      throws(() => pickHlMarket('para:10Y', reads()), /para builder dex — Pantessa places orders on the main book and the xyz dex only/) &&
      throws(() => pickHlMarket('SP500', reads({ dexes: { xyz: null } })), /XYZ dex did not answer/) && throws(() => pickHlMarket('SP500', reads({ dexes: {} })), /XYZ dex did not answer/) &&
      throws(() => pickHlMarket('NOPE', reads()), /^NOPE is not a Hyperliquid perp$/) && throws(() => pickHlMarket('xyz:NOPE', reads()), /^NOPE is not a Hyperliquid perp$/) && throws(() => pickHlMarket('xyz:VIX', reads()), /is not a Hyperliquid perp/) &&
      throws(() => pickHlMarket('BTC', reads({ main: null })), /did not answer with its market list/),
  )
  const tn = pickHlMarket('JPY', reads({ perpDexs: TESTNET_DEXS }), true)
  check(
    'hip3 (market): the dex slot is per NETWORK and read live — on testnet xyz answers at slot 65 (id 750024 for JPY) and builds only when the caller says testnet; the same list on mainnet is refused',
    tn.dexIndex === 65 && hlAssetId(tn.dexIndex, tn.localIndex) === 750024 && throws(() => pickHlMarket('JPY', reads({ perpDexs: TESTNET_DEXS })), /no longer answers at the slot/),
  )
  check(
    'hip3 (margin): the mode is the market\'s own row — no flag is cross; `onlyIsolated`, `noCross` and `strictIsolated` are isolated (99 of xyz\'s 121 live markets, and XTEN on the main book)',
    hlMarginModeOf(sp.row) === 'cross' && hlMarginModeOf(pickHlMarket('GOLD', reads()).row) === 'cross' && hlMarginModeOf(pickHlMarket('EUR', reads()).row) === 'isolated' && hlMarginModeOf(pickHlMarket('JPY', reads()).row) === 'isolated' &&
      hlMarginModeOf(pickHlMarket('XTEN', reads()).row) === 'isolated' && hlMarginModeOf({ marginMode: 'strictIsolated' }) === 'isolated' && hlMarginModeOf({ onlyIsolated: true }) === 'isolated' && hlMarginModeOf({}) === 'cross' && hlMarginModeOf(null) === 'cross',
  )
  const listings = { main: MAIN_UNIVERSE.filter((r) => !r.isDelisted).map((r) => r.name), dexes: { xyz: xyzUniverse().filter((r) => !r.isDelisted).map((r) => r.name) } }
  check(
    'hip3 (resolver): the chat\'s own lookup agrees with the build — main first, then the proven dex, the venue\'s casing back; an unproven prefix and a stray colon resolve to nothing; the "did you mean" list is every main coin plus the dex\'s bare tickers',
    resolveHlCoin('sp500', listings)?.coin === 'xyz:SP500' && resolveHlCoin('SP500', listings)?.ticker === 'SP500' && resolveHlCoin('xyz:gold', listings)?.coin === 'xyz:GOLD' && resolveHlCoin('kpepe', listings)?.coin === 'kPEPE' && resolveHlCoin('STX', listings)?.dex === null &&
      resolveHlCoin('para:10Y', { ...listings, dexes: { ...listings.dexes, para: ['para:10Y'] } }) === null && resolveHlCoin(':SP500', listings) === null && resolveHlCoin('', listings) === null && resolveHlCoin('NOPE', listings) === null &&
      resolveHlCoin('SP500', { main: listings.main, dexes: {} }) === null && resolveHlCoin('SP500', { main: listings.main, dexes: { xyz: null } }) === null &&
      orderableHlTickers(listings).includes('SP500') && orderableHlTickers(listings).includes('kPEPE') && !orderableHlTickers(listings).some((t) => t.includes(':')) &&
      hlDexOf('xyz:SP500') === 'xyz' && hlDexOf('XYZ:sp500') === 'xyz' && hlDexOf('BTC') === null && hlDexOf(':x') === null && hlTickerOf('xyz:SP500') === 'SP500' && hlTickerOf('BTC') === 'BTC',
  )

  // ── 4. The sentence ──────────────────────────────────────────────────────
  const open = parseHlIntent('Long $25 of SP500 on Hyperliquid')
  const pre = parseHlIntent('2x long $25 of xyz:SP500 on hyperliquid')
  const close = parseHlIntent('close my xyz:gold position on hyperliquid')
  check(
    'hip3 (parser): "Long $25 of SP500 on Hyperliquid" reads as an open on SP500 (the build resolves it to xyz:SP500); the venue\'s own spelling is read too and keeps its dex (`xyz:SP500`), on an open, a leveraged open and a close; every chip it prints reads back to the same intent; a time, a ratio and a URL are never a market',
    open?.kind === 'open' && open.coin === 'SP500' && open.isBuy === true && open.notionalUsd === 25 &&
      pre?.kind === 'open' && pre.coin === 'xyz:SP500' && pre.leverage === 2 && pre.notionalUsd === 25 &&
      close?.kind === 'close' && close.coin === 'xyz:GOLD' &&
      JSON.stringify(parseHlIntent(hlCanonicalAsk(pre as HlOrderIntent))) === JSON.stringify(pre) && JSON.stringify(parseHlIntent(hlCanonicalAsk(open as HlOrderIntent))) === JSON.stringify(open) && JSON.stringify(parseHlIntent(hlCanonicalAsk(close as HlOrderIntent))) === JSON.stringify(close) &&
      parseHlIntent('short 0.01 xyz:gold on hl')?.kind === 'open' && (parseHlIntent('short 0.01 xyz:gold on hl') as HlOrderIntent).coin === 'xyz:GOLD' && (parseHlIntent('short 0.01 xyz:gold on hl') as HlOrderIntent).sizeUnits === 0.01 &&
      (parseHlIntent('long $25 of para:10y on hyperliquid') as HlOrderIntent | null)?.coin === 'para:10Y' &&
      stripHlDexPrefixes('long $25 of xyz:sp500 at 10:30 on hyperliquid').text === 'long $25 of sp500 at 10:30 on hyperliquid' && stripHlDexPrefixes('see https://x.com/a ratio 2:1').dexOf.size === 0 &&
      (parseHlIntent('Long $25 of HYPE on Hyperliquid') as HlOrderIntent).coin === 'HYPE',
  )
  const unsized = parseHlIntent('2x long SP500 on hyperliquid')
  check(
    'hip3 (parser): an unsized open offers sizes the market takes — xyz:SP500 trades in 0.001 (~$7.46), so the row starts at its smallest workable order instead of a $12 chip that rounds under the venue\'s $10; a fine-step market keeps $12 · $25 · $50; every chip reads back as a full order',
    unsized?.kind === 'open-unsized' && hlMinOpenUsd(7463.45, 3) === 16 && hlMinOpenUsd(4125.75, 4) === 11 && hlMinOpenUsd(87.062, 3) === 11 && hlMinOpenUsd(74000, 5) === 11 && hlMinOpenUsd(99.6875, 1) === 21 &&
      unsized.kind === 'open-unsized' && hlUnsizedChips(unsized, 16).map((c) => c.resume).join('|') === '2x long $16 of SP500 on hyperliquid|2x long $25 of SP500 on hyperliquid|2x long $50 of SP500 on hyperliquid' &&
      hlUnsizedChips(unsized).map((c) => c.label).join('|') === '2x Long $12 of SP500|2x Long $25 of SP500|2x Long $50 of SP500' && hlUnsizedChips(unsized, 11).length === 3 && hlUnsizedChips(unsized, 11)[0].resume.includes('$12 ') &&
      hlUnsizedChips(unsized, 30).map((c) => c.resume.match(/\$(\d+)/)![1]).join() === '30,50,100' &&
      hlUnsizedChips(unsized, 16).every((c) => parseHlIntent(c.resume)?.kind === 'open'),
  )

  // ── 5. The order guard ───────────────────────────────────────────────────
  const intent: HlOrderIntent = { kind: 'open', coin: 'SP500', isBuy: true, notionalUsd: 25 }
  const action = buildHlOrderAction(intent, spSnap, { builderFee: false })
  const ctx = { markPx: spSnap.markPx, assetIndex: SP500_ID, withdrawableUsd: 24.98, positionSzi: 0, szDecimals: 3, ...spMarket }
  const good = guardHlExecBuild(intent, action, ctx)
  const withA = (a: number) => ({ ...action, orders: [{ ...action.orders[0], a }] })
  const bad = (a: number, c: Parameters<typeof guardHlExecBuild>[2] = ctx) => !guardHlExecBuild(intent, withA(a), c).ok
  check(
    'hip3 (order): $25 of SP500 at 7463.45 builds asset 110052, size 0.003 (rounded DOWN to the market\'s step, ~$22.39), an IOC within 1% of the mark — and passes its guard with the id\'s own arithmetic on the card',
    action.orders[0].a === SP500_ID && action.orders[0].s === '0.003' && action.orders[0].b === true && action.orders[0].r === false && action.orders[0].t.limit.tif === 'Ioc' && Number(action.orders[0].p) > 7463.45 && Number(action.orders[0].p) <= 7463.45 * 1.0101 &&
      good.ok && good.valueUsd === 22.39 && good.checks.some((c) => c.id === 'asset-market' && c.ok && /XYZ builder dex, slot 1, market 52 — id 110052 = 100000 \+ 1 × 10000 \+ 52/.test(c.note)) &&
      good.checks.some((c) => c.id === 'has-collateral' && /available to trade on the XYZ dex/.test(c.note)),
    JSON.stringify(action.orders[0]),
  )
  check(
    'hip3 (order guard): a wrong asset id is an order on the wrong market, so every near miss is refused — the same row on the main book (52), the next market (110053), the same row on another dex slot (120052), an id in the slot-0 gap; a builder-dex id against a context that names NO dex (a main-book market) or an unproven dex; a live slot that is not the registry\'s on mainnet; a slot or row that was never read',
    bad(52) && bad(110053) && bad(120052) && bad(100052) && bad(110052.5) && bad(-1) &&
      bad(SP500_ID, { ...ctx, dex: null }) && bad(SP500_ID, { markPx: ctx.markPx, assetIndex: SP500_ID, withdrawableUsd: 24.98, positionSzi: 0 }) &&
      bad(180000, { ...ctx, assetIndex: 180000, dex: 'para', dexIndex: 8, localIndex: 0 }) &&
      bad(120052, { ...ctx, assetIndex: 120052, dexIndex: 2 }) && bad(SP500_ID, { ...ctx, dexIndex: 2 }) && bad(SP500_ID, { ...ctx, localIndex: 51 }) &&
      bad(SP500_ID, { ...ctx, dexIndex: null }) && bad(SP500_ID, { ...ctx, localIndex: undefined }) &&
      // The main book is untouched: its ids are bare rows, and a builder id never passes for one.
      guardHlExecBuild({ kind: 'open', coin: 'ETH', isBuy: true, notionalUsd: 25 }, buildHlOrderAction({ kind: 'open', coin: 'ETH', isBuy: true, notionalUsd: 25 }, { assetIndex: 1, szDecimals: 4, markPx: 3000, positionSzi: 0, maxLeverage: 25, accountLeverage: null, approvedBuilderFeeTenthBps: null }, { builderFee: false }), { markPx: 3000, assetIndex: 1, withdrawableUsd: 50, positionSzi: 0 }).ok,
  )
  const tnCtx = { ...ctx, assetIndex: 750052, dexIndex: 65, isTestnet: true }
  check(
    'hip3 (order guard): the mainnet slot pin is skipped only on testnet — the testnet id (slot 65) passes when the context says testnet and is refused as mainnet; the identity check is one pure function the relay and the build share',
    guardHlExecBuild(intent, withA(750052), tnCtx).ok && !guardHlExecBuild(intent, withA(750052), { ...tnCtx, isTestnet: false }).ok && !guardHlExecBuild(intent, withA(SP500_ID), tnCtx).ok &&
      hlAssetIdentity(SP500_ID, { assetIndex: SP500_ID, ...spMarket }).ok && !hlAssetIdentity(SP500_ID, { assetIndex: 110053, ...spMarket }).ok && hlAssetIdentity(3, { assetIndex: 3 }).ok && !hlAssetIdentity(SP500_ID, { assetIndex: SP500_ID }).ok &&
      !hlAssetIdentity(52, { assetIndex: 52, ...spMarket }).ok && !hlAssetIdentity('110052', { assetIndex: SP500_ID, ...spMarket }).ok,
  )
  const small: HlOrderIntent = { kind: 'open', coin: 'SP500', isBuy: true, notionalUsd: 12 }
  const smallGuard = guardHlExecBuild(small, buildHlOrderAction(small, spSnap, { builderFee: false }), ctx)
  check(
    'hip3 (order guard): "$12 of SP500" rounds down to ONE step (0.001 ≈ $7.46) and is refused under the venue\'s $10 — in words that name the step and the smallest order that works, the one refusal a bigger number fixes',
    !smallGuard.ok && smallGuard.checks.filter((c) => !c.ok && c.level === 'block').map((c) => c.id).join() === 'min-notional' &&
      /~\$7\.46 is under the venue's \$10 minimum/.test(smallGuard.checks.find((c) => c.id === 'min-notional')!.note) && /SP500 trades in steps of 0\.001 \(~\$7\.46 each\) and the size rounds down, so the smallest order here is about \$16\./.test(smallGuard.checks.find((c) => c.id === 'min-notional')!.note),
    smallGuard.checks.find((c) => c.id === 'min-notional')?.note,
  )

  // ── 6. Collateral: a builder dex keeps its own balance ────────────────────
  check(
    'hip3 (collateral): the figure an open can draw on is the venue\'s own per-coin availableToTrade in every mode (measured: a standard account with $2,256 on the main book and $477 in xyz reads 477; a unified one with $11.69 of spot USDC and nothing in either ledger reads 11.69), with the dex\'s own ledger and — unified only — free spot USDC as the floor; only a KNOWN standard account can move main-book USDC in',
    hlCollateralUsd({ perpWithdrawable: 477.294988, availableToTrade: ['477.04545', '557.67285'], isBuy: true, abstraction: 'disabled', spotUsdcFree: null }) === 477.294988 &&
      hlCollateralUsd({ perpWithdrawable: 0, availableToTrade: ['11.685725', '11.685725'], isBuy: true, abstraction: 'unifiedAccount', spotUsdcFree: 11.685725 }) === 11.685725 &&
      hlCollateralUsd({ perpWithdrawable: 0, availableToTrade: null, isBuy: true, abstraction: 'unifiedAccount', spotUsdcFree: 24.975185 }) === 24.975185 &&
      hlCollateralUsd({ perpWithdrawable: 0, availableToTrade: ['0.0', '0.0'], isBuy: true, abstraction: 'default', spotUsdcFree: 500 }) === 0 &&
      hlPerDexBalances('default') && hlPerDexBalances('disabled') && hlPerDexBalances('dexAbstraction') && !hlPerDexBalances('unifiedAccount') && !hlPerDexBalances('portfolioMargin') && !hlPerDexBalances(null) && !hlPerDexBalances(undefined),
  )
  check(
    'hip3 (collateral): the move into the dex is sized to the same yardstick as a deposit (notional over the leverage being set, default 3, to the cent, no bridge floor): nothing when the dex already covers it, the gap otherwise, never more than the main balance has free, never under a cent',
    hlDexCollateralNeedUsd(22.39) === 7.47 && hlDexCollateralNeedUsd(22.39, 2) === 11.2 && hlDexCollateralNeedUsd(25, 5) === 5 &&
      hlDexTransferUsd({ notionalUsd: 22.39, dexAvailableUsd: 0, transferableUsd: 999 }) === 7.47 && hlDexTransferUsd({ notionalUsd: 22.39, leverage: 2, dexAvailableUsd: 0, transferableUsd: 999 }) === 11.2 &&
      hlDexTransferUsd({ notionalUsd: 22.39, dexAvailableUsd: 5, transferableUsd: 999 }) === 2.47 && hlDexTransferUsd({ notionalUsd: 22.39, dexAvailableUsd: 7.47, transferableUsd: 999 }) === 0 && hlDexTransferUsd({ notionalUsd: 22.39, dexAvailableUsd: 40, transferableUsd: 999 }) === 0 &&
      hlDexTransferUsd({ notionalUsd: 22.39, dexAvailableUsd: 0, transferableUsd: 3.129 }) === 3.12 && hlDexTransferUsd({ notionalUsd: 22.39, dexAvailableUsd: 0, transferableUsd: 0 }) === 0 && hlDexTransferUsd({ notionalUsd: 22.39, dexAvailableUsd: 0, transferableUsd: 0.004 }) === 0 &&
      hlUsdcAmount(7.47) === '7.47' && hlUsdcAmount(40) === '40' && hlUsdcAmount(11.2) === '11.2' && hlUsdcAmount(0.01) === '0.01' && throws(() => hlUsdcAmount(0), /bad amount/) && throws(() => hlUsdcAmount(Number.NaN), /bad amount/),
  )
  const pendingGuard = guardHlExecBuild(intent, action, { ...ctx, withdrawableUsd: 0, pendingTransferUsd: 7.47 })
  const emptyGuard = guardHlExecBuild(intent, action, { ...ctx, withdrawableUsd: 0 })
  check(
    'hip3 (collateral): an open against an EMPTY dex builds when its own first step moves the collateral in (the card says so), and is refused when nothing is in the dex and nothing can be moved — at submit the move has landed and the live figure stands alone',
    pendingGuard.ok && /\$7\.47 moves into the XYZ dex first — a builder dex keeps its own balance\./.test(pendingGuard.checks.find((c) => c.id === 'has-collateral')!.note) &&
      !emptyGuard.ok && /No free collateral on the XYZ builder dex, and none in your Hyperliquid perp balance to move there/.test(emptyGuard.checks.find((c) => c.id === 'has-collateral')!.note) &&
      /beside the \$2\.00 already there/.test(guardHlExecBuild(intent, action, { ...ctx, withdrawableUsd: 2, pendingTransferUsd: 5.47 }).checks.find((c) => c.id === 'has-collateral')!.note),
  )

  // ── 7. The move itself ───────────────────────────────────────────────────
  const me = '0x5EaaBd731d2Bc0490C2D47e41858e9b0629455a0'
  const move = hlDexTransferArtifacts({ from: me, dex: 'xyz', amount: '7.47', nonce: 1794235800000, signatureChainId: 8453, isTestnet: false })
  const mv = (over: Partial<HlWireSendAssetAction>, free: number | null = 999) => guardHlDexTransfer({ ...move.action, ...over }, { from: me, isTestnet: false, mainWithdrawableUsd: free })
  check(
    'hip3 (move): the transfer the client builds is the venue\'s `sendAsset` — the wallet\'s OWN address (lowercased) as destination, out of the main perp balance (sourceDex ""), into the xyz dex, mainnet USDC by token id, no sub-account — under the HyperliquidSignTransaction domain on the wallet\'s own chain, fields in the venue\'s order',
    move.action.type === 'sendAsset' && move.action.destination === me.toLowerCase() && move.action.sourceDex === '' && move.action.destinationDex === 'xyz' && move.action.token === HL_USDC_TOKEN.mainnet && move.action.amount === '7.47' &&
      move.action.fromSubAccount === '' && move.action.hyperliquidChain === 'Mainnet' && move.action.signatureChainId === '0x2105' && move.action.nonce === 1794235800000 &&
      (move.typedData.domain as { name: string; chainId: number }).name === 'HyperliquidSignTransaction' && (move.typedData.domain as { chainId: number }).chainId === 8453 && move.typedData.primaryType === 'HyperliquidTransaction:SendAsset' &&
      (move.typedData.types as Record<string, { name: string; type: string }[]>)['HyperliquidTransaction:SendAsset'].map((f) => `${f.name}:${f.type}`).join() === 'hyperliquidChain:string,destination:string,sourceDex:string,destinationDex:string,token:string,amount:string,fromSubAccount:string,nonce:uint64' &&
      hlDexTransferArtifacts({ from: me, dex: 'xyz', amount: '1', nonce: 1, signatureChainId: 421614, isTestnet: true }).action.token === HL_USDC_TOKEN.testnet &&
      JSON.stringify(hlSendAssetTypedData(move.action)) === JSON.stringify(move.typedData) && canonicalizeHlAction(move.action as never) === (move.action as never),
  )
  check(
    'hip3 (move guard): it can only ever move the signer\'s own USDC from their main balance into a dex orders are placed on — a foreign destination, another source (a dex, spot), a dex outside the registry (para, "", XYZ, a prototype key), another token (testnet\'s USDC id on mainnet, HYPE), a sub-account, a network mismatch, an amount that is zero, negative, fractional-cent, exponent-spelled or over what the main balance has free are each refused; an unread balance leaves the venue the last word',
    mv({}).ok && mv({}).valueUsd === 0 && mv({}, null).ok && mv({ amount: '999' }).ok && mv({ destination: me }).ok &&
      !mv({ destination: '0x000000000000000000000000000000000000dEaD' }).ok && !mv({ destination: '' }).ok &&
      !mv({ sourceDex: 'xyz' }).ok && !mv({ sourceDex: 'spot' }).ok &&
      !mv({ destinationDex: 'para' }).ok && !mv({ destinationDex: '' }).ok && !mv({ destinationDex: 'XYZ' }).ok && !mv({ destinationDex: 'spot' }).ok && !mv({ destinationDex: 'constructor' }).ok && !mv({ destinationDex: '__proto__' }).ok &&
      !mv({ token: HL_USDC_TOKEN.testnet }).ok && !mv({ token: 'HYPE:0x0d01dc56dcaaca66ad901c959b4011ec' }).ok && !mv({ token: 'USDC' }).ok &&
      !mv({ fromSubAccount: '0x000000000000000000000000000000000000dEaD' }).ok && !mv({ hyperliquidChain: 'Testnet' }).ok && !guardHlDexTransfer(move.action, { from: me, isTestnet: true }).ok &&
      !mv({ amount: '0' }).ok && !mv({ amount: '-1' }).ok && !mv({ amount: '1.234' }).ok && !mv({ amount: '1e3' }).ok && !mv({ amount: '' }).ok && !mv({ amount: ' 5' }).ok && !mv({ amount: '1000' }).ok && !mv({ amount: '7.47' }, 7).ok &&
      !mv({ type: 'usdSend' as never }).ok &&
      /not the signing wallet/.test(mv({ destination: '0x000000000000000000000000000000000000dEaD' }).checks.find((c) => c.id === 'xfer-own-account')!.note),
  )

  // ── 8. Leverage on a builder dex ─────────────────────────────────────────
  const levCross = buildHlLeverageAction({ kind: 'open', coin: 'SP500', isBuy: true, notionalUsd: 25, leverage: 2 }, spSnap)
  const levIso = buildHlLeverageAction({ kind: 'open', coin: 'EUR', isBuy: true, notionalUsd: 25, leverage: 5 }, eurSnap)
  const eurMarket = { dex: 'xyz', dexIndex: 1, localIndex: 25 }
  const lg = (a: typeof levCross, mode: 'cross' | 'isolated', asset: number, market: typeof spMarket, coin: string, lev: number) =>
    guardHlLeverageBuild({ kind: 'open', coin, leverage: lev }, a, { assetIndex: asset, maxLeverage: 50, marginMode: mode, ...market })
  check(
    'hip3 (leverage): the update carries the builder-dex asset id and the mode the MARKET takes — cross on SP500, isolated on EUR (the venue answers a cross update there with "Cross margin is not allowed for this asset.") — and the guard refuses the other mode, another market\'s id, a main-book id, a fraction and anything past the market\'s own max',
    levCross.asset === SP500_ID && levCross.isCross === true && levCross.leverage === 2 && levIso.asset === 110025 && levIso.isCross === false && levIso.leverage === 5 &&
      lg(levCross, 'cross', SP500_ID, spMarket, 'SP500', 2).ok && lg(levIso, 'isolated', 110025, eurMarket, 'EUR', 5).ok &&
      !lg({ ...levIso, isCross: true }, 'isolated', 110025, eurMarket, 'EUR', 5).ok && !lg({ ...levCross, isCross: false }, 'cross', SP500_ID, spMarket, 'SP500', 2).ok &&
      !lg({ ...levCross, asset: 110053 }, 'cross', SP500_ID, spMarket, 'SP500', 2).ok && !lg({ ...levCross, asset: 52 }, 'cross', SP500_ID, spMarket, 'SP500', 2).ok &&
      !guardHlLeverageBuild({ kind: 'open', coin: 'SP500', leverage: 2 }, levCross, { assetIndex: SP500_ID, maxLeverage: 50 }).ok &&
      !lg({ ...levCross, leverage: 51 }, 'cross', SP500_ID, spMarket, 'SP500', 51).ok && !lg({ ...levCross, leverage: 2.5 }, 'cross', SP500_ID, spMarket, 'SP500', 2.5).ok &&
      /Isolated margin — EUR is an isolated-only market/.test(lg(levIso, 'isolated', 110025, eurMarket, 'EUR', 5).checks.find((c) => c.id === 'lev-cross')!.note) &&
      // The main book keeps its rule: no mode in the context means cross, as before.
      guardHlLeverageBuild({ kind: 'open', coin: 'ETH', leverage: 2 }, { type: 'updateLeverage', asset: 1, isCross: true, leverage: 2 }, { assetIndex: 1, maxLeverage: 25 }).ok &&
      !guardHlLeverageBuild({ kind: 'open', coin: 'ETH', leverage: 2 }, { type: 'updateLeverage', asset: 1, isCross: false, leverage: 2 }, { assetIndex: 1, maxLeverage: 25 }).ok,
  )

  // ── 9. What the wallet reads, and what an agent is told ──────────────────
  const consent = hlConsentMessage({ from: me, action, nonce: 1794235800000, isTestnet: false, expected: { coin: 'xyz:sp500', kind: 'open', isBuy: true } })
  check(
    'hip3 (consent): the line a wallet signs names the market the venue\'s way whatever case it arrived in (`XYZ:sp500` → `xyz:SP500`, `sp500` → `SP500`, `kpepe` → `KPEPE` as before), an isolated leverage set says isolated, and the client and the relay derive the same text',
    hlCoinLabel('XYZ:sp500') === 'xyz:SP500' && hlCoinLabel('sp500') === 'SP500' && hlCoinLabel('kpepe') === 'KPEPE' && hlCoinLabel('HYPE') === 'HYPE' &&
      /^Action: buy \(long\) 0\.003 xyz:SP500 @ /m.test(consent) && consent === hlConsentMessage({ from: me, action, nonce: 1794235800000, isTestnet: false, expected: { coin: hlCoinLabel('xyz:sp500'), kind: 'open', isBuy: true } }) &&
      hlActionSummary(levIso, { coin: 'EUR', leverage: 5 }) === 'set 5x isolated leverage on EUR' && hlActionSummary(levCross, { coin: 'SP500', leverage: 2 }) === 'set 2x cross leverage on SP500',
  )
  const typed = { domain: {}, types: {}, primaryType: 'Agent', message: {} }
  const req = (hl: Record<string, unknown>) => ({ protocol: 'hyperliquid', typedData: typed, hl: { action, nonce: 2, isTestnet: false, expected: { coin: 'SP500', kind: 'open', isBuy: true }, ...hl } })
  check(
    'hip3 (agents): an order whose collateral still has to move into the dex is never offered as a one-pass batch — the move is a wallet-chain signature, not an L1 action, and the order has no margin until it lands; without it the batch composes as before',
    composeHlBatch(req({ dexTransfer: { dex: 'xyz', amount: '7.47' } })) === null && composeHlBatch(req({}))?.length === 1 &&
      composeHlBatch(req({ dexTransfer: { dex: 'xyz', amount: '7.47' }, pre: { action: levCross, nonce: 1, typedData: typed, expected: { coin: 'SP500', leverage: 2 } } })) === null,
  )

  // ── 10. The Guardian does not watch a builder dex ────────────────────────
  const arm = (coin: string): GuardianArmAsk => ({ coin, kind: 'stop_loss', triggerMode: 'price_move_pct', triggerValue: 5 }) as GuardianArmAsk
  const mainU = { listed: new Set(['BTC', 'HYPE', 'kPEPE']), delisted: new Set(['MKR']) }
  const dexU = { xyz: new Set(['xyz:SP500', 'xyz:GOLD', 'xyz:NVDA']) }
  const spFence = fenceGuardianCoin(arm('SP500'), mainU, dexU)
  check(
    'hip3 (guardian): a stop on a builder-dex market is refused in its own words — it IS a Hyperliquid market, the Guardian\'s watcher just reads the main book\'s ledger — with the close as the chip (a sentence the HL layer parses); a Robinhood stock keeps the stock\'s answer, a main-book coin still arms, an unknown coin is still "isn\'t a Hyperliquid market", and without the dex listings nothing changes',
    !spFence.ok && spFence.reason === 'builder-dex' && /SP500 trades on Hyperliquid's XYZ builder dex/.test(spFence.reply) && !/isn't a Hyperliquid market/.test(spFence.reply) &&
      spFence.chips.length === 1 && parseHlIntent(spFence.chips[0].resume)?.kind === 'close' && (parseHlIntent(spFence.chips[0].resume) as HlOrderIntent).coin === 'SP500' &&
      (() => { const f = fenceGuardianCoin(arm('NVDA'), mainU, dexU); return !f.ok && f.reason === 'stock' })() &&
      fenceGuardianCoin(arm('hype'), mainU, dexU).ok && (() => { const f = fenceGuardianCoin(arm('NOPE'), mainU, dexU); return !f.ok && f.reason === 'not-listed' })() &&
      (() => { const f = fenceGuardianCoin(arm('SP500'), mainU); return !f.ok && f.reason === 'not-listed' })() && (() => { const f = fenceGuardianCoin(arm('MKR'), mainU, dexU); return !f.ok && f.reason === 'delisted' })(),
  )

  // ── 11. The wiring (source) ──────────────────────────────────────────────
  const read = (p: string) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8')
  const relay = read('app/api/hl/submit/route.ts')
  const card = read('components/SignHlActionButton.tsx')
  const exec = read('lib/hyperliquid-exec.ts')
  const route = read('app/api/chat/route.ts')
  check(
    'hip3 (relay): a `sendAsset` is recovered from its own typed data, must be signed by `from`, is never taken through the delegated agent, is guarded against the main balance read live and gated by the kill switch before the venue sees it; orders and leverage updates are re-guarded with the market\'s dex, slot and row and the network',
    /const isDexTransfer = \(action as \{ type\?: string \} \| undefined\)\?\.type === 'sendAsset'/.test(relay) && /const isUserSigned = isFeeApproval \|\| isDexTransfer/.test(relay) && /\(delegated && isUserSigned\)/.test(relay) &&
      /const td = hlSendAssetTypedData\(xfer\)/.test(relay) && /xferSigner\.toLowerCase\(\) !== from\.toLowerCase\(\)/.test(relay) && /guardHlDexTransfer\(xfer, \{ from, isTestnet, mainWithdrawableUsd: mainFree \}\)/.test(relay) && /ACCOUNT_FROZEN \(hl dex transfer\)/.test(relay) &&
      relay.indexOf('if (isDexTransfer) {') < relay.indexOf('const typedData = hlActionTypedData(action as HlWireAction, nonce, isTestnet)') &&
      /const market = \{ dex: snap\.dex \?\? null, dexIndex: snap\.dexIndex \?\? null, localIndex: snap\.localIndex, isTestnet \}/.test(relay) && (relay.match(/\.\.\.market \}/g) ?? []).length === 2 && /amountUsd: 0,\s+ok: true,\s+note: `hl collateral moved/.test(relay),
  )
  check(
    'hip3 (card): the signatures ride one card in the order that works — the fee cap (no money), the move into the dex, the leverage set, the order — each behind its own tap; the move is built in the browser on the wallet\'s own chain from facts alone and a landed move is not re-asked when the order is rebuilt; a step signed at tap time never reuses a nonce the card already carries',
    /const moveStep = !feeStep && hl\.dexTransfer && !moveDone \? hl\.dexTransfer : null/.test(card) && /const pre = !feeStep && !moveStep && hl\.pre && !preDone \? hl\.pre : null/.test(card) &&
      /onClick=\{\(\) => void \(feeStep \? signFee\(\) : moveStep \? signMove\(\) : pre \? signPre\(\) : sign\(\)\)\}/.test(card) && /hlDexTransferArtifacts\(\{\s+from: address,\s+dex: hl\.dexTransfer\.dex,\s+amount: hl\.dexTransfer\.amount,\s+nonce: freshNonce\(\),\s+signatureChainId: chainId,/.test(card) &&
      /approveBuilderFeeArtifacts\(\{ nonce: freshNonce\(\), signatureChainId: chainId/.test(card) && /hlFreshNonce\(\[hl\.nonce, hl\.pre\?\.nonce, \.\.\.tapNonces\.current\]\)/.test(card) && !/nonce: Date\.now\(\)/.test(card) &&
      /const totalSteps = 1 \+ \(hl\.feeApproval \? 1 : 0\) \+ \(hl\.dexTransfer \? 1 : 0\) \+ \(hl\.pre \? 1 : 0\)/.test(card) && !/setMoveDone\(false\)/.test(card),
  )
  // Met on testnet 2026-11-09: a script signed the move in the same millisecond the order had been built in,
  // the venue answered "Invalid nonce: duplicate nonce 1794237548856", and the order behind a landed move was dead.
  check(
    'hip3 (nonce): a step signed at tap time takes the clock unless that exact millisecond is already an action\'s on the same card — then the next free one, however many are taken; the venue refuses a repeated nonce outright',
    hlFreshNonce([], 1794237548856) === 1794237548856 && hlFreshNonce([1794237548856], 1794237548856) === 1794237548857 && hlFreshNonce([1794237548856, 1794237548855], 1794237548856) === 1794237548857 &&
      hlFreshNonce([1794237548856, 1794237548857, 1794237548858], 1794237548856) === 1794237548859 && hlFreshNonce([undefined, null, 5], 7) === 7 && hlFreshNonce([1794237548856], 1794237549000) === 1794237549000,
  )
  check(
    'hip3 (build): the snapshot reads the market\'s OWN dex — its meta, its mids, its clearinghouse ledger — and the account\'s mode and main balance only for a builder-dex market; the chat says "isn\'t a Hyperliquid perp" only when every listing it would look on was read; the funding gate counts main-book USDC a standard account can move',
    /dex \? info\.allMids\(\{ dex \}\) : info\.allMids\(\)/.test(exec) && /dex \? info\.clearinghouseState\(\{ user, dex \}\) : info\.clearinghouseState\(\{ user \}\)/.test(exec) && /info\.activeAssetData\(\{ user, coin: venueCoin \}\)/.test(exec) &&
      /user && dex \? info\.userAbstraction\(\{ user \}\)/.test(exec) && /transferableUsd: dex && mainState && hlPerDexBalances\(abstraction\)/.test(exec) && /const fundable = snap\.withdrawableUsd \+ snap\.transferableUsd/.test(exec) &&
      /assetIndex: hlAssetId\(market\.dexIndex, market\.localIndex\)/.test(exec) && /if \(listings\?\.complete && !resolved\) \{/.test(route) && /const resolved = listings \? resolveHlCoin\(hlIntent\.coin, listings\) : null/.test(route),
  )
}

/** The typed data is the venue's: a signature made over it recovers to the
 *  signer, and a changed destination recovers to someone else. Async (viem). */
export async function hlHip3SignPins(check: Check): Promise<void> {
  const signer = privateKeyToAccount(generatePrivateKey())
  const { action, typedData } = hlDexTransferArtifacts({ from: signer.address, dex: 'xyz', amount: '7.47', nonce: Date.now(), signatureChainId: 8453, isTestnet: false })
  const signature = await signer.signTypedData({ ...typedData, message: { ...typedData.message, nonce: BigInt(action.nonce) } } as Parameters<typeof signer.signTypedData>[0])
  const recover = async (a: HlWireSendAssetAction) => {
    const td = hlSendAssetTypedData(a)
    return recoverTypedDataAddress({ domain: td.domain as Parameters<typeof recoverTypedDataAddress>[0]['domain'], types: td.types, primaryType: td.primaryType, message: td.message, signature })
  }
  const same = await recover(action)
  const moved = await recover({ ...action, destination: '0x000000000000000000000000000000000000dead' })
  const more = await recover({ ...action, amount: '747' })
  const otherDex = await recover({ ...action, destinationDex: 'para' })
  check(
    'hip3 (move): the wallet\'s signature binds every field — the relay\'s re-derivation recovers the signer from the action as signed, and a swapped destination, amount or dex recovers to a stranger (so it is refused before any guard runs)',
    same.toLowerCase() === signer.address.toLowerCase() && moved.toLowerCase() !== signer.address.toLowerCase() && more.toLowerCase() !== signer.address.toLowerCase() && otherDex.toLowerCase() !== signer.address.toLowerCase(),
  )
}

/**
 * The rules against the venue itself, read-only. A venue that does not answer
 * is reported and skipped, never a red.
 */
export async function hlHip3LivePins(check: Check): Promise<void> {
  const post = async (host: string, body: unknown): Promise<unknown> => {
    const res = await fetch(`https://${host}/info`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) })
    if (!res.ok) throw new Error(`${host} ${res.status}`)
    return res.json()
  }
  try {
    const [dexs, meta, spot, tSpot] = (await Promise.all([
      post('api.hyperliquid.xyz', { type: 'perpDexs' }),
      post('api.hyperliquid.xyz', { type: 'meta', dex: 'xyz' }),
      post('api.hyperliquid.xyz', { type: 'spotMeta' }),
      post('api.hyperliquid-testnet.xyz', { type: 'spotMeta' }).catch(() => null),
    ])) as [({ name: string; deployer: string } | null)[], { universe: Row[]; collateralToken: number }, { tokens: { index: number; name: string; tokenId: string }[] }, { tokens: { index: number; name: string; tokenId: string }[] } | null]
    const xyz = HL_BUILDER_DEXES.xyz
    const usdc = spot.tokens.find((t) => t.index === 0)
    check(
      'hip3 (live): the venue is still the one this layer was measured against — mainnet perpDexs slot 0 is the main book and slot 1 is xyz under the pinned deployer, its collateral token is 0, and spot token 0 is USDC under the pinned token id (testnet\'s id checked when it answers)',
      dexs[0] === null && dexs[xyz.mainnetIndex]?.name === 'xyz' && dexs[xyz.mainnetIndex]?.deployer.toLowerCase() === xyz.mainnetDeployer && meta.collateralToken === xyz.collateralToken &&
        !!usdc && `${usdc.name}:${usdc.tokenId}` === HL_USDC_TOKEN.mainnet &&
        (tSpot === null || (() => { const t = tSpot.tokens.find((x) => x.index === 0); return !!t && `${t.name}:${t.tokenId}` === HL_USDC_TOKEN.testnet })()),
      `slot1=${dexs[1]?.name}/${dexs[1]?.deployer} collateral=${meta.collateralToken} usdc=${usdc?.name}:${usdc?.tokenId}`,
    )
    const row = meta.universe.findIndex((u) => u.name === 'xyz:SP500')
    const picked = pickHlMarket('SP500', { main: [], perpDexs: dexs, dexes: { xyz: meta } })
    const expected = hlAssetId(xyz.mainnetIndex, row)
    // The id scheme, SEEN: what a real fill's order carried, from the venue's explorer.
    const trades = ((await post('api.hyperliquid.xyz', { type: 'recentTrades', coin: 'xyz:SP500' }).catch(() => [])) as { hash: string }[]).filter((t) => !/^0x0+$/.test(t.hash)).slice(0, 5)
    const seen: number[] = []
    for (const t of trades) {
      const tx = (await fetch('https://rpc.hyperliquid.xyz/explorer', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'txDetails', hash: t.hash }), signal: AbortSignal.timeout(15_000) })
        .then((r) => r.json())
        .catch(() => null)) as { tx?: { action?: { type?: string; orders?: { a: number }[] } } } | null
      for (const o of tx?.tx?.action?.type === 'order' ? (tx.tx.action.orders ?? []) : []) seen.push(o.a)
    }
    if (row < 0) console.log('   ⚠️  hip3 (live): the venue lists no xyz:SP500 right now — the asset-id check was skipped')
    else if (!seen.length) console.log('   ⚠️  hip3 (live): the explorer returned no recent xyz:SP500 order — the asset-id check was skipped')
    else {
      check(
        'hip3 (live): the asset id the builder derives for xyz:SP500 (100000 + slot × 10000 + its live row) is the id real fills on that market carry on the venue\'s explorer right now',
        picked.coin === 'xyz:SP500' && picked.dexIndex === xyz.mainnetIndex && picked.localIndex === row && seen.includes(expected),
        `derived ${expected} (row ${row}) · explorer orders carried ${[...new Set(seen)].join(', ')}`,
      )
    }
  } catch (e) {
    console.log(`   ⚠️  hip3 (live): Hyperliquid did not answer (${(e as Error).message}) — the venue checks were skipped`)
  }
}

/**
 * The served half (needs a running `next start`): the sentence through the
 * chat route, and the three macro pages' chips.
 */
export async function hlHip3ServedPins(check: Check, base: string, wallet?: string): Promise<void> {
  const chat = async (message: string, walletAddress?: string) => {
    const r = await fetch(`${base}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-yf-internal-run': '1', 'x-yf-no-ask-log': '1' },
      body: JSON.stringify({ message, history: [], activeServers: [], ...(walletAddress ? { walletAddress } : {}) }),
    })
    return (await r.json().catch(() => ({}))) as Record<string, unknown> & { reply?: string }
  }
  const door = await chat('Long $25 of SP500 on Hyperliquid')
  check(
    'hip3 (served): "Long $25 of SP500 on Hyperliquid" with no wallet answers the connect door with the ask held verbatim — never "SP500 isn\'t a Hyperliquid perp"',
    door.connectWallet === true && door.connectAsk === 'Long $25 of SP500 on Hyperliquid' && door.buildPath === 'native-hl-exec' && !/isn't a Hyperliquid perp|is not a Hyperliquid perp/.test(door.reply ?? ''),
    JSON.stringify(door).slice(0, 240),
  )
  const unproven = await chat('Long $25 of para:10Y on Hyperliquid')
  check(
    'hip3 (served): a market named on a builder dex outside the registry is refused by name, with nothing to sign and no planner turn',
    /para\*\* builder dex/.test(unproven.reply ?? '') && /main book and the XYZ builder dex only/.test(unproven.reply ?? '') && !unproven.orderRequest && !unproven.jobId && unproven.buildPath === 'native-hl-exec',
    JSON.stringify(unproven).slice(0, 240),
  )
  const typo = await chat('Long $25 of SP50 on Hyperliquid')
  check(
    'hip3 (served): a near miss ("SP50") offers the builder-dex market it meant as a chip that reads back as the same order on SP500',
    /isn't a Hyperliquid perp/.test(typo.reply ?? '') && ((typo.clarify as { options?: { resume: string }[] } | undefined)?.options ?? []).some((o) => (parseHlIntent(o.resume) as HlOrderIntent | null)?.coin === 'SP500'),
    JSON.stringify(typo).slice(0, 240),
  )
  if (wallet) {
    const turn = await chat('Long $25 of SP500 on Hyperliquid', wallet)
    const order = ((turn.orderRequest as { hl?: { action?: { orders?: { a: number; s: string; b: boolean }[] }; expected?: { coin?: string } } } | undefined)?.hl?.action?.orders ?? [])[0]
    const split = order ? splitHlAssetId(order.a) : null
    // A funded account gets the order; an unfunded one the funding path (a job, a card door or a refusal that
    // names the collateral). What it never gets is the old wall.
    const funded = !!order
    check(
      `hip3 (served): the same sentence for a wallet builds — ${funded ? 'a guarded order on the xyz dex (the asset id is slot 1 of the builder range), guard green, an honest size' : 'this wallet has no Hyperliquid collateral, so the funding path answers'} — and never the "isn\'t a Hyperliquid perp" wall`,
      !/isn't a Hyperliquid perp|is not a Hyperliquid perp/.test(turn.reply ?? '') &&
        (funded
          ? split?.dexIndex === HL_BUILDER_DEXES.xyz.mainnetIndex && order.b === true && Number(order.s) > 0 && (turn.guardrails as { ok?: boolean } | undefined)?.ok === true && /SP500 on Hyperliquid \(XYZ builder dex\)/.test(turn.reply ?? '') && turn.buildPath === 'native-hl-exec'
          : !!turn.jobId || !!turn.clarify || /collateral|deposit|USDC/i.test(turn.reply ?? '')),
      JSON.stringify({ reply: turn.reply, a: order?.a, s: order?.s, jobId: turn.jobId, buildPath: turn.buildPath }).slice(0, 300),
    )
    if (funded) {
      const small = await chat('Long $12 of SP500 on Hyperliquid', wallet)
      const chip = ((small.clarify as { options?: { resume: string }[] } | undefined)?.options ?? [])[0]?.resume
      const sized = chip ? (parseHlIntent(chip) as HlOrderIntent | null) : null
      check(
        'hip3 (served): "$12 of SP500" (one size step, under the venue\'s $10) is refused in words that name the step, with a chip for the smallest order that works — a sentence that reads back as a bigger open on SP500',
        /under the venue's \$10 minimum/.test(small.reply ?? '') && /SP500 trades in steps of 0\.001/.test(small.reply ?? '') && !small.orderRequest && sized?.kind === 'open' && sized.coin === 'SP500' && (sized.notionalUsd ?? 0) > 12,
        JSON.stringify({ reply: small.reply, chip }).slice(0, 300),
      )
    }
  }
  for (const sym of ['SP500', 'GOLD', 'CL']) {
    const html = await fetch(`${base}/t/${sym}`).then((r) => r.text(), () => '')
    const asks = [...html.matchAll(/data-ask="([^"]+)"/g)].map((m) => m[1].replace(/&#x27;/g, "'").replace(/&amp;/g, '&'))
    const long = asks.some((a) => new RegExp(`^(?:\\d+x )?Long \\$\\d+ of ${sym} on Hyperliquid$`).test(a))
    const short = asks.some((a) => new RegExp(`^(?:\\d+x )?Short \\$\\d+ of ${sym} on Hyperliquid$`).test(a))
    const stop = asks.some((a) => /^Protect my /i.test(a))
    check(
      `hip3 (served): /t/${sym} offers its chips again — a Long and a Short that say "${sym} on Hyperliquid", each a sentence the HL layer parses onto ${sym} — and no Guardian stop`,
      long && short && !stop && asks.filter((a) => /on Hyperliquid$/.test(a)).every((a) => (parseHlIntent(a) as HlOrderIntent | null)?.coin === sym) && !/does not place orders there yet/.test(html),
      asks.slice(0, 6).join(' | ') || `no data-ask in ${html.length} bytes`,
    )
  }
}

// Runnable alone (the harness imports this file — guard on argv).
if (process.argv[1]?.endsWith('hl-hip3-pins.ts')) {
  let pass = 0
  let fail = 0
  const check: Check = (name, ok, extra) => {
    console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? `\n     ${extra}` : ''}`)
    if (ok) pass++
    else fail++
  }
  hlHip3Pins(check)
  void (async () => {
    await hlHip3SignPins(check)
    if (process.argv.includes('--live')) {
      await hlHip3LivePins(check)
      if (process.env.BASE) await hlHip3ServedPins(check, process.env.BASE, process.env.WALLET)
    }
    console.log(`\n${pass} passed, ${fail} failed`)
    process.exit(fail ? 1 : 0)
  })()
}
