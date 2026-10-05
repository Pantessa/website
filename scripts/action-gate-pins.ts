// Pins for "every chip is one its venue can run" (2026-10-05, Nate on
// /t/UNI: "Supply on Aave" answered "UNI isn't an active, supplyable
// reserve"). lib/venue-capability (the listing rule), lib/sell-gate (the
// spot-stop rule), the corrected cold lists in lib/symbol-venues, and the
// Earn board's chips.
//
// Called from scripts/test-api.ts, and runnable alone — no server, no DB:
//   npx tsx scripts/action-gate-pins.ts          pure pins
//   npx tsx scripts/action-gate-pins.ts --live   + the venues' own lists
//                                                 (read-only: Aave reserves,
//                                                 the Hyperliquid universe)
import { chartPairFor } from '../lib/charts'
import { aaveRows } from '../lib/earn'
import { marketSections } from '../lib/markets'
import { canSellAsk, spotStopTarget } from '../lib/sell-gate'
import { COLD_AAVE_SUPPLY, COLD_HL_PERPS, compoundLegKindsFor, venuesFor } from '../lib/symbol-venues'
import { execAsks } from '../lib/trade-asks'
import { canTradeAsk, tradeRefusal } from '../lib/trade-venue-gate'
import { TRADABILITY_MAX_AGE_MS, type SymbolTradability, type TradabilityMap } from '../lib/tradability'
import { aaveCapability, aaveRefusal, canRunVenueAsk, capabilityLegsFor, capabilityTarget, perpCapability, perpRefusal, type ReserveListing } from '../lib/venue-capability'
import { markGuardable } from '../lib/watchlist-holdings'
import { compileJobAsk } from '../lib/jobs'
import { aaveReserveSymbolFor, buildWethWrapTx, guardWethWrap, planWethWrap, WETH_DEPOSIT_SELECTOR, wrapGasReserveWei } from '../lib/weth-wrap'
import type { HeldSymbol } from '../lib/watchlists'

type Check = (name: string, ok: boolean, extra?: string) => void

/** Aave v4's list as it read on 2026-10-05, trimmed to the fields the rule
 *  reads — including the shapes that used to slip through. */
const RESERVES: ReserveListing[] = [
  { asset: { symbol: 'WETH' }, active: true, canSupply: true, canUseAsCollateral: true },
  { asset: { symbol: 'WBTC' }, active: true, canSupply: true, canUseAsCollateral: true },
  { asset: { symbol: 'cbBTC' }, active: true, canSupply: true, canUseAsCollateral: true },
  { asset: { symbol: 'LINK' }, active: true, canSupply: true, canUseAsCollateral: true },
  { asset: { symbol: 'USDG' }, active: true, canSupply: true, canUseAsCollateral: false },
  { asset: { symbol: 'rsETH' }, active: true, canSupply: false, canUseAsCollateral: false },
  { asset: { symbol: 'LUSD' }, active: false, canSupply: true, canUseAsCollateral: true },
  { asset: { symbol: 'GHO' }, canSupply: true, canUseAsCollateral: true }, // `active` unsaid
]

export function actionGatePins(check: Check): void {
  const now = Date.now()
  const leg = (side: 'supply' | 'collateral' | 'perp' | 'buy', chainId: number, ok: boolean, reason?: string, ageMs = 0) =>
    ({ chainId, side, verdict: ok ? 'fillable' : 'no-venue', ...(reason ? { reason } : {}), checkedAt: new Date(now - ageMs).toISOString() }) as SymbolTradability['legs'][number]
  const sym = (symbol: string, ...legs: SymbolTradability['legs']): SymbolTradability => ({ symbol, legs })

  // ── 1. The verdict is the builder's own question ─────────────────────────
  check(
    'action gate: the Aave verdict asks what the supply layer asks — an ACTIVE row for the reserve the builder resolves, canSupply true. LINK and cbBTC are in; UNI is not listed; ETH reads the WETH row (the layer wraps it, RE-PINNED 2026-10-05 from "ETH is out"); BTC stays out (WBTC and cbBTC are different tokens and nothing aliases them); canSupply false, active false and active unsaid are all a no',
    aaveCapability(RESERVES, 'LINK').supply && aaveCapability(RESERVES, 'link').collateral && aaveCapability(RESERVES, 'CBBTC').supply && aaveCapability(RESERVES, 'WETH').supply &&
      aaveCapability(RESERVES, 'ETH').supply && aaveCapability(RESERVES, 'eth').collateral && !aaveCapability(RESERVES.filter((r) => r.asset?.symbol !== 'WETH'), 'ETH').supply &&
      aaveReserveSymbolFor('eth') === 'WETH' && aaveReserveSymbolFor('BTC') === 'BTC' && aaveReserveSymbolFor('LINK') === 'LINK' &&
      !aaveCapability(RESERVES, 'UNI').supply && !aaveCapability(RESERVES, 'BTC').supply &&
      !aaveCapability(RESERVES, 'RSETH').supply && !aaveCapability(RESERVES, 'LUSD').supply && !aaveCapability(RESERVES, 'GHO').supply &&
      aaveCapability(RESERVES, 'USDG').supply && !aaveCapability(RESERVES, 'USDG').collateral && !aaveCapability([], 'LINK').supply,
  )
  check(
    'action gate: a perp is live only while the venue lists it — a delisted market is not in `listed` and reads as gone',
    perpCapability({ listed: new Set(['ETH', 'UNI']) }, 'uni') && !perpCapability({ listed: new Set(['ETH', 'UNI']) }, 'MKR'),
  )

  // ── 2. The sentence rule ─────────────────────────────────────────────────
  const reads: [string, string, string][] = [
    ['Supply $50 of UNI to Aave', 'UNI', 'supply'],
    ['Supply $25 of USDC to Aave at the best rate', 'USDC', 'supply'],
    ['supply 120 USDC to aave', 'USDC', 'supply'],
    ['Swap 50 USDC for LINK on Ethereum, then supply $50 of LINK to Aave', 'LINK', 'supply'],
    ['Long $50 of UNI on Hyperliquid', 'UNI', 'perp'],
    ['2x Short $25 of MKR on Hyperliquid', 'MKR', 'perp'],
    ['Deposit 50 USDC to Hyperliquid, then 2x Long $50 of ETH on Hyperliquid, then protect my ETH long with a 5% stop', 'ETH', 'perp'],
    ['Protect my HYPE long with a 5% stop', 'HYPE', 'perp'],
  ]
  const misread = reads.filter(([ask, s, side]) => capabilityTarget(ask)?.symbol !== s || capabilityTarget(ask)?.side !== side)
  check(
    'action gate: every supply, perp and perp-Guardian sentence the app composes names the token its venue has to list — also as a clause of a compound ask',
    misread.length === 0,
    misread.map(([a]) => `${a} → ${JSON.stringify(capabilityTarget(a))}`).join(' | '),
  )
  const needNothing = ['Buy $50 of UNI', 'Sell $50 of UNI on Base', 'Stake 0.02 ETH on Lido', 'Borrow 50 USDC from Aave', 'Protect my UNI in my wallet with a 5% stop', 'limit order: buy 1 UNI for at most 8 USDC on Base', 'Swap 20 USDC from Base to USDC on Arbitrum', 'Withdraw all my LINK from Aave']
  check(
    'action gate: a swap, a stake, a borrow (its sentence names the loan, not the collateral — the routes API drops that row), a spot stop, a limit order, a bridge and a withdraw need no listing this rule reads',
    needNothing.every((a) => capabilityTarget(a) === null),
    needNothing.filter((a) => capabilityTarget(a) !== null).join(' | '),
  )

  // ── 3. The gate every surface already asks ───────────────────────────────
  const map: TradabilityMap = {
    UNI: sym('UNI', leg('supply', 1, false, aaveRefusal('UNI', 'supply')), leg('perp', 1337, true), leg('buy', 1, true)),
    MKR: sym('MKR', leg('perp', 1337, false, perpRefusal('MKR')), leg('buy', 1, true)),
    LINK: sym('LINK', leg('supply', 1, true), leg('collateral', 1, true), leg('perp', 1337, true)),
    SNX: sym('SNX', leg('supply', 1, false, aaveRefusal('SNX', 'supply'), TRADABILITY_MAX_AGE_MS + 1_000)),
  }
  check(
    'action gate: the pressed button — "Supply $50 of UNI to Aave" is hidden once Aave is measured not listing UNI, while UNI keeps Buy and Long; LINK keeps Supply; a delisted MKR perp loses Long, Short and its Guardian stop and keeps Buy',
    !canTradeAsk('Supply $50 of UNI to Aave', map) && canTradeAsk('Buy $50 of UNI', map) && canTradeAsk('Long $50 of UNI on Hyperliquid', map) &&
      canTradeAsk('Supply $50 of LINK to Aave', map) &&
      !canTradeAsk('Long $50 of MKR on Hyperliquid', map) && !canTradeAsk('2x Short $50 of MKR on Hyperliquid', map) && !canTradeAsk('Protect my MKR long with a 5% stop', map) && canTradeAsk('Buy $50 of MKR', map) &&
      !canTradeAsk('Swap 50 USDC for UNI on Ethereum, then supply $50 of UNI to Aave', map),
  )
  check(
    'action gate: it fails OPEN like the swap gate — nothing measured, a stale refusal, a token with no row and an empty or missing map all still offer; and the refusal a surface can say is the venue’s own',
    canRunVenueAsk('Supply $50 of UNI to Aave', {}) && canRunVenueAsk('Supply $50 of UNI to Aave', null) && canRunVenueAsk('Supply $50 of SNX to Aave', map) && canRunVenueAsk('Supply $50 of CRV to Aave', map) &&
      (tradeRefusal('Supply $50 of UNI to Aave', map) ?? '').includes("isn't an active, supplyable Aave v4 reserve") && (tradeRefusal('Long $50 of MKR on Hyperliquid', map) ?? '').includes('MKR perp') && tradeRefusal('Supply $50 of LINK to Aave', map) === null,
  )

  // ── 4. What gets measured, and what the cold lists offer ─────────────────
  const legsOf = (s: string) => capabilityLegsFor(s, chartPairFor(s)!).map((l) => `${l.side}@${l.chainId}`).sort().join(' ')
  check(
    'action gate: the measured legs come from the venue map itself — LINK and ETH (via the WETH reserve, RE-PINNED 2026-10-05) need a supplyable reserve, collateral and a live perp; UNI and BTC a live perp only; an HL chart its own perp; a stock nothing',
    legsOf('LINK') === 'collateral@1 perp@1337 supply@1' && legsOf('UNI') === 'perp@1337' && legsOf('ETH') === 'collateral@1 perp@1337 supply@1' && legsOf('BTC') === 'perp@1337' && legsOf('HYPE') === 'perp@1337' && legsOf('AAPL') === '',
    `LINK=${legsOf('LINK')} · UNI=${legsOf('UNI')} · ETH=${legsOf('ETH')} · BTC=${legsOf('BTC')} · HYPE=${legsOf('HYPE')} · AAPL=${legsOf('AAPL')}`,
  )
  const uniPair = chartPairFor('UNI')!
  const ethPair = chartPairFor('ETH')!
  const btcPair = chartPairFor('BTC')!
  const uniAsks = [...execAsks(uniPair, { usd: 50, last: 8 }).map((a) => a.ask), ...venuesFor('UNI', uniPair, { last: 8 }).map((r) => r.ask)]
  const ethAsks = [...execAsks(ethPair, { usd: 50, last: 2500 }).map((a) => a.ask), ...venuesFor('ETH', ethPair, { last: 2500 }).map((r) => r.ask)]
  const btcAsks = [...execAsks(btcPair, { usd: 50, last: 60000 }).map((a) => a.ask), ...venuesFor('BTC', btcPair, { last: 60000 }).map((r) => r.ask)]
  check(
    'action gate: /t/UNI and /t/BTC compose no Aave chip, row or compound leg at all (UNI has no v4 reserve; BTC names neither WBTC nor cbBTC) — /t/ETH composes "Supply $50 of ETH to Aave" again (the layer wraps; RE-PINNED 2026-10-05) and its compound leg names the wrap — and MKR composes no Hyperliquid chip',
    !uniAsks.some((a) => /aave/i.test(a)) && !btcAsks.some((a) => /supply/i.test(a) && /aave/i.test(a)) && !compoundLegKindsFor('UNI', uniPair).includes('supply') && !compoundLegKindsFor('BTC', btcPair).includes('supply') &&
      ethAsks.includes('Supply $50 of ETH to Aave') && compoundLegKindsFor('ETH', ethPair).includes('supply') &&
      !venuesFor('MKR', chartPairFor('MKR')!, { last: 1500 }).some((r) => r.venue === 'hyperliquid'),
    [...uniAsks, ...btcAsks].filter((a) => /aave/i.test(a)).join(' | ') + ` · ETH: ${ethAsks.filter((a) => /aave/i.test(a)).join(' | ')}`,
  )
  const earn = aaveRows([
    { spoke: 'Main', asset: { symbol: 'WETH' }, canSupply: true, active: true, supplyApyPct: 2.1 },
    { spoke: 'Main', asset: { symbol: 'AAVE' }, canSupply: true, active: true, supplyApyPct: 0.4 },
    { spoke: 'Main', asset: { symbol: 'LINK' }, canSupply: true, active: true, supplyApyPct: 0.2 },
    { spoke: 'Main', asset: { symbol: 'rsETH' }, canSupply: true, supplyApyPct: 3 },
  ] as never)
  check(
    'action gate (earn): a row whose sentence cannot run keeps its rate and loses its chip — AAVE (the venue word twice) — the WETH row asks in ETH, what people hold, and the layer wraps it (RE-PINNED 2026-10-05); LINK asks as named, and a row that never says it is active is not a row',
    earn.length === 3 && earn.find((r) => r.asset === 'ETH')?.askFor(25) === 'Supply $25 of ETH to Aave' && earn.find((r) => r.asset === 'AAVE')?.askFor(25) === null && earn.find((r) => r.asset === 'LINK')?.askFor(25) === 'Supply $25 of LINK to Aave',
    JSON.stringify(earn.map((r) => [r.asset, r.askFor(25)])),
  )

  // ── 4b. The ETH wrap ahead of an Aave supply ─────────────────────────────
  const E = BigInt(10) ** BigInt(18)
  const milli = (n: number) => (E * BigInt(n)) / BigInt(1000)
  const reserve = wrapGasReserveWei(1)
  const cover = planWethWrap({ chainId: 1, needWei: milli(20), ethWei: milli(5), wethWei: milli(20) })
  const part = planWethWrap({ chainId: 1, needWei: milli(20), ethWei: milli(30), wethWei: milli(5) })
  const full = planWethWrap({ chainId: 1, needWei: milli(20), ethWei: milli(30), wethWei: BigInt(0) })
  const edge = planWethWrap({ chainId: 1, needWei: milli(20), ethWei: milli(20) + reserve - BigInt(1), wethWei: BigInt(0) })
  const exact = planWethWrap({ chainId: 1, needWei: milli(20), ethWei: milli(20) + reserve, wethWei: BigInt(0) })
  check(
    'action gate (wrap): the plan wraps only the shortfall over WETH already held, wraps nothing when WETH covers it, and refuses by name when ETH cannot cover the wrap plus the 0.002 ETH mainnet gas reserve (one wei short refuses, exact passes)',
    reserve === milli(2) && cover.kind === 'covered' && part.kind === 'wrap' && part.wrapWei === milli(15) && full.kind === 'wrap' && full.wrapWei === milli(20) &&
      edge.kind === 'short' && /gas/.test(edge.problem) && exact.kind === 'wrap',
    JSON.stringify([cover, part, full, edge, exact], (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
  )
  const wrapTx = buildWethWrapTx(1, milli(20))!
  const weth1 = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
  const g = (tx: Record<string, unknown>) => guardWethWrap(tx, { chainId: 1, wrapWei: milli(20) }).ok
  check(
    'action gate (wrap): the call is mainnet WETH deposit() with exactly the planned value; the guard refuses another target, a lookalike address, any other calldata (even deposit plus a trailing argument), a different value, zero, another chain, and a chain whose native is not ETH',
    wrapTx.to.toLowerCase() === weth1.toLowerCase() && wrapTx.data === WETH_DEPOSIT_SELECTOR && wrapTx.value === milli(20).toString() && wrapTx.chainId === 1 && g({ ...wrapTx }) &&
      !g({ ...wrapTx, to: '0x4200000000000000000000000000000000000006' }) && !g({ ...wrapTx, to: weth1.replace(/2$/, '3') }) &&
      !g({ ...wrapTx, data: '0x2e1a7d4d' }) && !g({ ...wrapTx, data: `${WETH_DEPOSIT_SELECTOR}${'0'.repeat(64)}` }) && !g({ ...wrapTx, value: milli(21).toString() }) && !g({ ...wrapTx, value: '0' }) &&
      !g({ ...wrapTx, chainId: 8453 }) && buildWethWrapTx(5042, milli(1)) === null && buildWethWrapTx(1, BigInt(0)) === null,
  )
  const lone = compileJobAsk('supply 0.02 ETH to aave')
  const compound = compileJobAsk('swap 50 USDC for ETH on ethereum, then supply 0.02 ETH to aave')
  const compoundUsd = compileJobAsk('swap 50 USDC for ETH on ethereum, then supply $40 of ETH to Aave')
  const linkJob = compileJobAsk('swap 50 USDC for LINK on ethereum, then supply $40 of LINK to Aave')
  const builders = (j: typeof lone) => (j && 'steps' in j ? j.steps.map((s) => s.builder).join(' ') : JSON.stringify(j))
  check(
    'action gate (wrap): a lone ETH supply is the chat turn’s (it plans against live balances), while a compound one compiles the wrap step ahead of the supply — unit and dollar sized — and a LINK supply carries no wrap',
    lone === null && builders(compound) === 'native-swap native-weth-wrap native-aave-supply' && builders(compoundUsd) === 'native-swap native-weth-wrap native-aave-supply' && builders(linkJob) === 'native-swap native-aave-supply',
    `${builders(compound)} · ${builders(compoundUsd)} · ${builders(linkJob)}`,
  )

  // ── 5. A spot stop needs a holding it can guard ──────────────────────────
  const held = (symbol: string, chainIds: number[], amount = 1): HeldSymbol => ({ symbol, valueUsd: 100, amount, chains: chainIds.map(String), chainIds })
  const eoa = markGuardable([held('UNI', [8453]), held('ETH', [1, 8453])], false)
  const smart = markGuardable([held('UNI', [8453]), held('LINK', [1]), held('ETH', [1, 8453]), held('AERO', [8453], 0)], true)
  check(
    'action gate (spot stop): a holding is guardable only on Base in a smart wallet — an EOA marks nothing, a smart wallet marks its Base holdings and never one held elsewhere or at zero',
    eoa.every((h) => h.guardable === undefined) && smart.filter((h) => h.guardable).map((h) => h.symbol).join() === 'UNI,ETH',
  )
  const spot = 'Protect my UNI in my wallet with a 5% stop'
  check(
    'action gate (spot stop): the chip reads its token in every spelling the app composes, and a Guardian stop on a perp is never mistaken for one',
    spotStopTarget(spot) === 'UNI' && spotStopTarget('Protect my spot ETH if it drops to $2447') === 'ETH' && spotStopTarget('protect my ETH on base with a 10% stop') === 'ETH' && spotStopTarget('Protect my 0.5 WETH in my wallet with a 5% stop') === 'ETH' &&
      spotStopTarget('Protect my HYPE long with a 5% stop') === null && spotStopTarget('Protect my ETH long on Hyperliquid with a 5% stop') === null && spotStopTarget('Buy $50 of UNI on Base') === null,
  )
  check(
    'action gate (spot stop): "Protect with a stop" renders only for a wallet that can arm it — never for a stranger, an unread wallet, an EOA holding the token, a smart wallet that holds it off Base or does not hold it; the perp Guardian chip is untouched',
    !canSellAsk(spot, null) && !canSellAsk(spot, undefined) && !canSellAsk(spot, []) && !canSellAsk(spot, eoa) && canSellAsk(spot, smart) &&
      !canSellAsk('Protect my LINK in my wallet with a 5% stop', smart) && !canSellAsk('Protect my AERO in my wallet with a 5% stop', smart) && !canSellAsk('Protect my BTC in my wallet with a 5% stop', smart) &&
      canSellAsk('Protect my HYPE long with a 5% stop', null) && canSellAsk('Buy $50 of UNI', null),
  )
}

/**
 * The cold lists against the venues themselves. A cold symbol the venue does
 * not list is a button that can only refuse — the exact bug — so it is a red
 * here until the list is corrected. A venue that doesn't answer is reported
 * and skipped, never a red.
 */
export async function actionGateLivePins(check: Check): Promise<void> {
  const [{ callMcpTool }, { AAVE_MCP }, { hlPerpUniverse }] = await Promise.all([import('../lib/mcp-call'), import('../lib/aave-exec'), import('../lib/hl-universe')])
  const [aave, hl] = await Promise.all([
    (callMcpTool(AAVE_MCP, 'reserves', { chainId: 1 }, { timeoutMs: 20_000 }) as Promise<{ reserves?: ReserveListing[] }>).then((r) => (r?.reserves?.length ? r.reserves : null), () => null),
    hlPerpUniverse().catch(() => null),
  ])
  if (aave) {
    const dead = COLD_AAVE_SUPPLY.filter((s) => !aaveCapability(aave, s).supply)
    check('action gate (live): every token the cold list offers "Supply on Aave" for is an active, supplyable Aave v4 reserve under that exact name right now', dead.length === 0, dead.join(', ') || `${COLD_AAVE_SUPPLY.join(', ')} of ${aave.length} rows`)
    // Informational: board coins Aave lists as named that no chip offers yet.
    const board = marketSections().flatMap((s) => s.rows.map((r) => r.symbol.toUpperCase()))
    const unoffered = [...new Set(board)].filter((s) => s !== 'AAVE' && !COLD_AAVE_SUPPLY.includes(s) && chartPairFor(s)?.source === 'coinbase' && aaveCapability(aave, s).supply)
    if (unoffered.length) console.log(`   ℹ️  Aave lists these board coins as named, with no Supply chip yet: ${unoffered.join(', ')}`)
  } else console.log('   ⚠️  action gate (live): Aave reserves did not answer — the cold supply list was not checked')
  if (hl) {
    const dead = COLD_HL_PERPS.filter((s) => !perpCapability(hl, s))
    check('action gate (live): every coin the cold list offers Long / Short for is a live Hyperliquid perp right now (a delisted market leaves the list)', dead.length === 0, dead.join(', ') || `${COLD_HL_PERPS.length} coins of ${hl.listed.size} listed`)
  } else console.log('   ⚠️  action gate (live): the Hyperliquid universe did not answer — the cold perp list was not checked')
}

// Runnable alone (the harness imports this file — guard on argv).
if (process.argv[1]?.endsWith('action-gate-pins.ts')) {
  let pass = 0
  let fail = 0
  const check: Check = (name, ok, extra) => {
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? `\n     ${extra}` : ''}`)
    if (ok) pass++
    else fail++
  }
  actionGatePins(check)
  const done = process.argv.includes('--live') ? actionGateLivePins(check) : Promise.resolve()
  void done.then(() => {
    console.log(`\n${pass} passed, ${fail} failed`)
    process.exit(fail ? 1 : 0)
  })
}
