// Pins for the apps page's "earn" lane (squad apps-page, 2026-11-17): the
// pure rules behind the Aave, Lido, Morpho, NEAR Intents and funding
// sections (lib/apps-earn.ts). Pure: no server, no chain, no DB.
// Runnable alone:  npx tsx scripts/apps-earn-pins.ts

import fs from 'node:fs'
import path from 'node:path'
import {
  aaveHeadline,
  aaveOffers,
  aaveViewOf,
  boardOffers,
  compactUsd,
  chainGroups,
  fundingHeadline,
  heldBySymbol,
  idleOf,
  lidoHeadline,
  lidoViewOf,
  morphoHeadline,
  morphoViewOf,
  moveAsk,
  nearHeadline,
  placedHoldings,
  usdWords,
  yearlyEarn,
  type PlacedHolding,
} from '../lib/apps-earn'
import { parseCrossChainSwap } from '../lib/cross-chain-swap'
import type { MoneyMap, SplashTile } from '../lib/splash/types'

type Check = (name: string, ok: boolean, extra?: string) => void

const base = { mcpSlug: 'x', mcpName: 'X', title: 't', prompts: [] }

export function appsEarnPins(check: Check) {
  // ── arithmetic + words ────────────────────────────────────────────────────
  check('earn: yearly earnings = principal × rate, to the cent', yearlyEarn(1177.4, 2.34) === 27.55 && yearlyEarn(1000, 4.39) === 43.9, String(yearlyEarn(1177.4, 2.34)))
  check('earn: yearly earnings unknown → null, never 0', yearlyEarn(null, 2) === null && yearlyEarn(100, null) === null && yearlyEarn(0, 2) === null)
  check('earn: money words ($1,121 / $623.97)', usdWords(1121.4) === '$1,121' && usdWords(623.97) === '$623.97')

  // ── Aave ──────────────────────────────────────────────────────────────────
  const aaveTile: SplashTile = {
    ...base,
    id: 'aave-position',
    render: 'rows',
    rows: [
      { label: 'USDC supplied · collateral', value: '$1,121.40', sub: '4.39% APY', tone: 'pos' },
      { label: 'GHO borrowed', value: '$200.00', tone: 'neg' },
      { label: 'Health factor', value: '3.10' },
    ],
    viz: { kind: 'lending', suppliedUsd: 1121.4, borrowedUsd: 200, healthFactor: 3.1, netApyPct: 4.39 },
    prompts: [{ label: 'Repay my GHO', prompt: 'Repay all my GHO on Aave' }],
  }
  const av = aaveViewOf([aaveTile])
  check('aave: the tile reads into rows (health factor row dropped)', av?.rows.length === 2 && av.rows[0].collateral && av.rows[1].side === 'borrowed')
  check(
    'aave: each row carries the source grammar that undoes it',
    av?.rows[0].actions[0]?.prompt === 'Withdraw all my USDC from Aave' && av?.rows[1].actions[0]?.prompt === 'Repay all my GHO on Aave',
  )
  const idleMap: MoneyMap = { facts: [{ bucket: 'idle', usd: 623.97, label: 'USDC on Ethereum' }, { bucket: 'idle', usd: 166.29, label: 'USDC on Base' }, { bucket: 'spot', usd: 152.5, label: 'ETH on Base' }], readChains: [], failedChains: [] }
  check('aave: idle = the map idle bucket only, with its chains', idleOf(idleMap)?.usd === 790.26 && idleOf(idleMap)?.chains.join() === 'Ethereum,Base')
  check('aave: idle unknown → null', idleOf(null) === null && idleOf({ facts: [], readChains: [], failedChains: [] }) === null)
  check('aave: headline with a rate and idle money', aaveHeadline(av, idleOf(idleMap)) === '$1,121 is earning 4.39%. $790.26 is earning nothing.', aaveHeadline(av, idleOf(idleMap)))
  check('aave: headline with no rate says supplied, not earning', aaveHeadline({ ...av!, netApyPct: null }, null) === '$1,121 is supplied on Aave.')
  check('aave: headline with nothing supplied', aaveHeadline(null, null) === 'Nothing supplied on Aave yet.')
  const board = [
    { venue: 'aave', asset: 'USDC', chainLabel: 'Ethereum', apyPct: 5.83, tvlUsd: 9_100_000, detail: 'Main spoke', askTemplate: 'Supply {usd} of USDC to Aave at the best rate' },
    { venue: 'aave', asset: 'LINK', chainLabel: 'Ethereum', apyPct: 0.4, tvlUsd: null, detail: 'Main spoke', askTemplate: 'Supply {usd} of LINK to Aave' },
    { venue: 'aave', asset: 'AAVE', chainLabel: 'Ethereum', apyPct: 1, tvlUsd: null, detail: 'Main spoke', askTemplate: null },
    { venue: 'morpho', asset: 'USDC', chainLabel: 'Base', apyPct: 7, tvlUsd: null, detail: 'x', askTemplate: 'Lend {usd} of USDC on Morpho' },
  ]
  const offers = aaveOffers(board, new Map([['USDC', 623.97], ['LINK', 0.6], ['AAVE', 50]]))
  check('aave offers: only held, Aave-listed assets with a runnable sentence', offers.length === 1 && offers[0].asset === 'USDC', JSON.stringify(offers))
  check('aave offers: sized to what is held, whole dollars, never more', offers[0]?.ask === 'Supply $623 of USDC to Aave at the best rate')
  const mOffers = boardOffers(board, new Map([['USDC', 40.9]]), 'morpho')
  check('morpho offers: the board venue only, its own lend sentence', mOffers.length === 1 && mOffers[0].ask === 'Lend $40 of USDC on Morpho' && mOffers[0].chain === 'Base')
  check('earn: market sizes read compact ($78.4M)', compactUsd(78_425_920) === '$78M' && compactUsd(9_100_000) === '$9.1M' && compactUsd(1_200_000_000) === '$1.2B')
  check('aave offers: ETH counts WETH holdings', heldBySymbol([{ symbol: 'WETH', chain: 'Base', usd: 10, balance: '0.004' }, { symbol: 'ETH', chain: 'Ethereum', usd: 5, balance: null }]).get('ETH') === 15)

  // ── Lido ──────────────────────────────────────────────────────────────────
  const lidoTile: SplashTile = {
    ...base,
    id: 'lido-position',
    render: 'rows',
    subtitle: 'earning ~2.34% APR',
    headline: { value: '$1,177.40', caption: '0.648 stETH total staked' },
    viz: { kind: 'yield', principalUsd: 1177.4, aprPct: 2.34, caption: 'stETH rebases daily' },
    rows: [{ label: 'stETH', value: '$1,177.40' }],
    prompts: [],
  }
  const lv = lidoViewOf([lidoTile])
  check('lido: stETH, value, rate and a year read from the tile', lv?.stEth === '0.648' && lv.stakedUsd === 1177.4 && lv.aprPct === 2.34 && lv.yearUsd === 27.55)
  check('lido: headline', lidoHeadline(lv) === '0.648 stETH is earning 2.34% a year.', lidoHeadline(lv))
  check('lido: headline with nothing staked', lidoHeadline(null) === 'Nothing staked with Lido yet.')

  // ── Morpho ────────────────────────────────────────────────────────────────
  const morphoTile: SplashTile = {
    ...base,
    id: 'morpho-position',
    render: 'rows',
    subtitle: 'lending in 2 markets · Base',
    rows: [
      { label: 'USDC lent', value: '120 USDC' },
      { label: 'WETH lent', value: '0.1 WETH' },
      { label: 'Health factor', value: '2.00' },
    ],
    prompts: [],
  }
  const mv = morphoViewOf([morphoTile])
  check('morpho: headline counts positions in words, no dollars', morphoHeadline(mv) === 'Two Morpho positions on Base.', morphoHeadline(mv))
  check('morpho: no tile → nothing supplied', morphoHeadline(morphoViewOf([])) === 'Nothing supplied on Morpho yet.')

  // ── NEAR Intents: chains + which rows get a Move button ───────────────────
  const holdingsTile: SplashTile = {
    ...base,
    mcpSlug: 'uniswap-free',
    id: 'portfolio-holdings',
    render: 'holdings',
    chain: 'Ethereum · Base · Optimism',
    totalUsd: null,
    holdings: [
      { symbol: 'ETH', address: '0x0', balance: '0.67', priceUsd: 1800, valueUsd: 1214, chain: 'Optimism', native: true },
      { symbol: 'USDC', address: '0xa', balance: '623.97', priceUsd: 1, valueUsd: 623.97, chain: 'Ethereum' },
      { symbol: 'USDC', address: '0xb', balance: '135.04', priceUsd: 1, valueUsd: 135.04, chain: 'Optimism' },
      { symbol: 'USDC', address: '0xc', balance: '3.10', priceUsd: 1, valueUsd: 3.1, chain: 'Base' },
      { symbol: 'USDC', address: '0xd', balance: '50', priceUsd: 1, valueUsd: 50, chain: 'BNB' },
    ],
  }
  const dup = { ...holdingsTile, mcpSlug: 'yeetful-tool-wallet' }
  const placed = placedHoldings(new Map([['uniswap-free', [holdingsTile]], ['yeetful-tool-wallet', [dup]]]), idleMap)
  check('near: holdings across apps are deduped, chain per row', placed.source === 'holdings' && placed.rows.filter((r) => r.balance != null).length === 5)
  check('near: the map adds the ETH/USDC pairs the tile did not list, never twice', placed.rows.length === 6 && placed.rows.filter((r) => r.chain === 'Ethereum' && r.symbol === 'USDC').length === 1 && placed.rows.some((r) => r.chain === 'Base' && r.symbol === 'ETH' && r.balance === null))
  const groups = chainGroups(placed.rows)
  check('near: grouped by chain, largest first', groups.map((g) => g.chain).join() === 'Optimism,Ethereum,Base,BNB' && groups[0].totalUsd === 1349.04, groups.map((g) => `${g.chain}:${g.totalUsd}`).join())
  check('near: headline counts chains in words', nearHeadline(groups) === 'Your money sits on four chains. Move it in one step.')
  const opUsdc = placed.rows.find((r) => r.chain === 'Optimism' && r.symbol === 'USDC') as PlacedHolding
  const ethUsdc = placed.rows.find((r) => r.chain === 'Ethereum') as PlacedHolding
  const m1 = moveAsk(opUsdc, groups)
  check('near: a stable moves to the largest OTHER chain', m1?.ask === 'Swap 135 USDC from Optimism to USDC on Ethereum', m1?.ask)
  check('near: the largest chain moves to the next one', moveAsk(ethUsdc, groups)?.ask === 'Swap 623 USDC from Ethereum to USDC on Optimism', moveAsk(ethUsdc, groups)?.ask)
  const parsed = m1 ? parseCrossChainSwap(m1.ask) : null
  check('near: the sentence is one the chat reads as a cross-chain swap', !!parsed && !('problem' in parsed) && parsed.originChain.toLowerCase() === 'optimism')
  check('near: no button for a non-stable', moveAsk(placed.rows[0], groups) === null)
  check('near: no button under the $5 minimum', moveAsk(placed.rows.find((r) => r.chain === 'Base')!, groups) === null)
  check('near: no button where the venue floor refuses (BNB $1,000)', moveAsk(placed.rows.find((r) => r.chain === 'BNB')!, groups) === null)
  check('near: no button with no other chain to go to', moveAsk(opUsdc, chainGroups([opUsdc])) === null)
  const fromMap = placedHoldings(new Map(), idleMap)
  check('near: with no holdings tile, the map ETH + USDC by chain stand in', fromMap.source === 'map' && fromMap.rows.length === 3)
  check('near: nothing on the page → no chains', placedHoldings(new Map(), null).source === null && nearHeadline([]) === 'Move money between chains in one step.')

  // ── funding ───────────────────────────────────────────────────────────────
  check('funding: headline from the plan estimate', fundingHeadline({ yearUsd: 12.34, moves: [], prompts: [] }) === 'Your idle money could earn about $12.34 a year.')

  // ── house rules on the lane's files ───────────────────────────────────────
  const root = path.resolve(__dirname, '..')
  const files = ['aave', 'lido', 'morpho', 'near', 'funding'].map((f) => `components/apps/sections/${f}.tsx`).concat('lib/apps-earn.ts')
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  for (const f of files) {
    const src = strip(fs.readFileSync(path.join(root, f), 'utf8'))
    check(`earn: ${f} builds and signs nothing (no tx hook, no sign button)`, !/useSendTransaction|useSignTypedData|useWriteContract|signTypedData|sendTransaction|SignOrderButton|SendTxChain/.test(src))
    check(`earn: ${f} UI copy has no em dash or arrow`, !/[—→]/.test(src))
    check(`earn: ${f} offers no new recurring buy`, !/every (day|week|month)|weekly|daily buy/i.test(src))
  }
}

// Runnable alone (the harness imports this file, so the run is argv-gated).
if (process.argv[1] && /apps-earn-pins\.ts$/.test(process.argv[1])) {
  let pass = 0
  let fail = 0
  appsEarnPins((name, ok, extra) => {
    if (ok) pass += 1
    else fail += 1
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? `\n     ${extra}` : ''}`)
  })
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
}
