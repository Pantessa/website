// Pure unit tests for the connected-wallet splash sources — no network, no DB.
// Feeds each source a fake MCP caller returning canned tool payloads and asserts
// the tile shape, prompt derivation, avatar resolution, and empty-state handling.
//
//   npx tsx scripts/test-splash.ts
//
// (Kept out of test:api since it needs neither a server nor Neon.)

import { SPLASH_SOURCES, previewTile, finalizeSplashTiles, type SplashServer, type SourceResult } from '@/lib/splash/sources'
// The real App-mode parser — asserting against a copy of it would prove nothing.
import { parseUsd } from '@/components/AppModeWorkspace'
import { touchesContracts, UNISWAP_CONTRACTS } from '@/lib/splash/affinity'
import type { McpServer } from '@/lib/store'
import type { HoldingsTile, ProposalsTile, RowsTile, SplashTile } from '@/lib/splash/types'
import { allocationViz, holdingsFacts, usdOfString } from '@/lib/splash/viz'
import { mergeMoneyMap, summarizeMoneyMap, MONEY_BUCKETS } from '@/lib/splash/money-map'
import { planLayout, planSpans, wantsWide } from '@/lib/splash/layout'
import { composeMoneyFacts, composeMoneyMap, type BriefingInputs } from '@/lib/briefing'
import type { AppChain } from '@/lib/chains'
// The real Morpho parsers — a chip that doesn't round-trip these is a lie.
import { parseMorphoLend, parseMorphoOp } from '@/lib/morpho-supply'

let passed = 0
let failed = 0
function check(name: string, cond: boolean) {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.log(`  ✗ ${name}`)
  }
}

const ADDR = '0x66268791B55e1F5fA585D990326519F101407257'
const srv = (slug: string, name: string): McpServer =>
  ({ id: slug, slug, name, endpoint: 'https://x.example/mcp' } as McpServer)
const uni = SPLASH_SOURCES.find((s) => s.id === 'uniswap')!
const snap = SPLASH_SOURCES.find((s) => s.id === 'snapshot')!
const cow = SPLASH_SOURCES.find((s) => s.id === 'cow')!
const hl = SPLASH_SOURCES.find((s) => s.id === 'hyperliquid')!
const aave = SPLASH_SOURCES.find((s) => s.id === 'aave')!
const lido = SPLASH_SOURCES.find((s) => s.id === 'lido')!
const morpho = SPLASH_SOURCES.find((s) => s.id === 'morpho')!
/** The fake MCP caller shape (name + args) — chain-aware sources read args. */
type McpCall = (name: string, args: Record<string, unknown>) => Promise<unknown>

async function run() {
  console.log('splash sources — uniswap (holdings)')
  {
    const call = async () => ({
      chainId: 8453,
      totalUsd: 534.99,
      holdings: [
        { symbol: 'USDC', address: '0xusdc', decimals: 6, balance: '307.66', priceUsd: 1, valueUsd: 307.66 },
        { symbol: 'ETH', address: '0xweth', decimals: 18, balance: '0.106', priceUsd: 1790, valueUsd: 190.99, native: true },
        { symbol: 'DEGEN', address: '0xdegen', decimals: 18, balance: '9623', priceUsd: 0.0015, valueUsd: 15.15 },
      ],
    })
    const tile = (await uni.build(call, ADDR, srv('uniswap-free', 'Uniswap (Free)'))) as HoldingsTile
    check('render is holdings', tile.render === 'holdings')
    check('totalUsd carried through', tile.totalUsd === 534.99)
    check('holdings sorted richest-first (USDC then ETH)', tile.holdings[0].symbol === 'USDC' && tile.holdings[1].symbol === 'ETH')
    check('derives an idle-stablecoin prompt', tile.prompts.some((p) => /USDC/i.test(p.prompt) && /swap/i.test(p.prompt)))
    check('derives an ETH prompt', tile.prompts.some((p) => /ETH/i.test(p.label)))
    check('caps prompts at 3', tile.prompts.length <= 3)
  }

  console.log('splash sources — uniswap (empty wallet → no card)')
  {
    const call = async () => ({ chainId: 8453, totalUsd: 0, holdings: [] })
    const tile = await uni.build(call, ADDR, srv('uniswap-free', 'Uniswap (Free)'))
    check('empty wallet contributes no tile', tile === null)
  }

  console.log('splash sources — snapshot (proposals)')
  {
    const call = async () => ({
      proposals: [
        {
          id: '0xaaa',
          title: 'Activate v4 Protocol Fees',
          choices: ['For', 'Against', 'Abstain'],
          scores: [256130, 0, 0],
          end: 1783867278,
          space: { id: 'uniswapgovernance.eth', name: 'Uniswap' },
        },
        {
          id: '0xbbb',
          title: 'Fund the thing',
          choices: ['Yes', 'No'],
          scores: [0, 0],
          end: 1783593007,
          space: { id: 'nategeier.dcl.eth', name: 'Nate DAO' },
        },
      ],
    })
    const tile = (await snap.build(call, ADDR, srv('snapshot-free', 'Snapshot DAO (Free)'))) as ProposalsTile
    check('render is proposals', tile.render === 'proposals')
    check('two proposals mapped', tile.proposals.length === 2)
    check('leading choice from scores (For)', tile.proposals[0].leadingChoice === 'For')
    check('no leading choice when no votes', tile.proposals[1].leadingChoice === null)
    check('avatar resolves via stamp.fyi by space id', tile.proposals[0].avatarUrl.includes('cdn.stamp.fyi/space/uniswapgovernance.eth'))
    check('spaces deduped from proposals (2 distinct)', tile.spaces.length === 2)
    check('summarize prompt references the first proposal', tile.prompts.some((p) => /Activate v4/i.test(p.prompt)))
  }

  console.log('splash sources — snapshot (no follows → no card)')
  {
    const call = async () => ({ proposals: [], note: '0x… follows no spaces on Snapshot — no proposals in scope.' })
    const tile = await snap.build(call, ADDR, srv('snapshot-free', 'Snapshot DAO (Free)'))
    check('no follows contributes no tile', tile === null)
  }

  console.log('splash sources — cow')
  {
    const active = async () => ({
      chains: [
        {
          chain: 'mainnet',
          openOrders: [{ pair: 'WETH → USDC', kind: 'sell', status: 'open', filledPct: 62, validTo: 1783867278 }],
          tradeCount: 14,
          recentFills: [{ pair: 'USDC → WETH', txHash: '0xabc' }],
        },
      ],
    })
    const tile = (await cow.build(active, ADDR, srv('cow-free', 'CoW Protocol (Free)'))) as RowsTile
    check('cow activity → rows render', tile.render === 'rows')
    check('open order mapped with fill pct', tile.rows.some((r) => /62% filled/.test(r.value ?? '')))

    const never = async () => ({ chains: [{ chain: 'mainnet', openOrders: [], tradeCount: 0, recentFills: [] }] })
    check('never traded contributes no tile', (await cow.build(never, ADDR, srv('cow-free', 'CoW Protocol (Free)'))) === null)

    const pastOnly = async () => ({ chains: [{ chain: 'mainnet', openOrders: [], tradeCount: 9, recentFills: [] }] })
    const past = (await cow.build(pastOnly, ADDR, srv('cow-free', 'CoW Protocol (Free)'))) as RowsTile
    check('past trades w/o recent fills still shows the trade count', past?.rows?.some((r) => r.value === '9') === true)
  }

  console.log('splash sources — hyperliquid (no account → no card)')
  {
    const call = async () => ({ perp: { accountValueUsd: '0', positions: [] } })
    check('no account contributes no tile', (await hl.build(call, ADDR, srv('hyperliquid-free', 'Hyperliquid (Free)'))) === null)
  }

  console.log('splash sources — hyperliquid (positions carry the chart symbol)')
  {
    const positioned = async () => ({
      perp: {
        accountValueUsd: '250.10',
        withdrawableUsd: '100',
        positions: [
          { coin: 'HYPE', szi: '10', unrealizedPnl: '12.5', leverage: { value: 2 }, entryPx: '38.2', liquidationPx: '20.1' },
          { coin: 'ETH', szi: '-0.1', unrealizedPnl: '-3.1', entryPx: '3500' },
        ],
      },
    })
    const tile = (await hl.build(positioned, ADDR, srv('hyperliquid-free', 'Hyperliquid (Free)'))) as RowsTile
    check('positions render as rows', tile.render === 'rows')
    // The uniform chart button contract: a row whose label isn't a bare
    // symbol names its coin so the client can offer the chart.
    check('every position row carries its coin as chartSymbol', tile.rows.length === 2 && tile.rows[0].chartSymbol === 'HYPE' && tile.rows[1].chartSymbol === 'ETH')
    check('long/short labels intact', /HYPE long 2x/.test(tile.rows[0].label) && /ETH short/.test(tile.rows[1].label))
  }

  console.log('splash sources — aave')
  {
    const positioned = async () => ({
      positions: [
        { spoke: 'Core', netBalanceUsd: '$1,204.50', netApyPct: 3.1, healthFactor: '1.42', totalDebtUsd: '$500.00' },
      ],
      supplies: [
        { token: { symbol: 'USDC' }, balance: '1700.2', balanceUsd: '$1,700.20', earnedInterestUsd: '$12.40', supplyApyPct: 4.2, isCollateral: true },
      ],
      borrows: [{ token: { symbol: 'WETH' }, debt: '0.2', debtUsd: '$500.00', borrowApyPct: 2.9 }],
    })
    const tile = (await aave.build(positioned, ADDR, srv('aave-mcp-yeetful', 'Aave MCP · Pantessa'))) as RowsTile
    check('aave position → rows render', tile.render === 'rows')
    check('headline is the net balance', tile.headline?.value === '$1,204.50')
    check('supply row carries earned interest', tile.rows.some((r) => /USDC supplied/.test(r.label) && /12\.40 earned/.test(r.sub ?? '')))
    check('borrow row is negative-toned', tile.rows.some((r) => /WETH borrowed/.test(r.label) && r.tone === 'neg'))
    check('tight health factor flagged', tile.rows.some((r) => r.label === 'Health factor' && r.tone === 'neg'))
    check('repay prompt when borrowing', tile.prompts.some((p) => /repay/i.test(p.prompt)))

    const empty = async () => ({ note: 'No Aave v4 positions for this address.', positions: [], supplies: [], borrows: [] })
    check('no position contributes no tile', (await aave.build(empty, ADDR, srv('aave-mcp-yeetful', 'Aave MCP · Pantessa'))) === null)
  }

  console.log('splash sources — morpho (the pools you lend into)')
  {
    const mkt = '0x9103c3b4e834476c9a62ea009ba2c884ee42e94e6e314a26f04d312434191836'
    const rowSrv = srv('morpho-free', 'Morpho (Free)')
    // The live Base payload for Nate's wallet (2026-09-08), trimmed.
    const lending: McpCall = async (name, args) => {
      if (name !== 'position') throw new Error(`unexpected tool ${name}`)
      if (args.chainId === 1) return { chain: 'Ethereum', positions: [] }
      return {
        chain: 'Base',
        positions: [
          {
            marketId: mkt,
            market: 'USDC / cbBTC (lltv 86.0%)',
            supplied: { amount: '2.000055', asset: 'USDC', apy: '4.30%' },
            collateral: null,
            borrowed: null,
            healthFactor: null,
          },
        ],
      }
    }
    const tile = (await morpho.build(lending, ADDR, rowSrv)) as RowsTile
    check('morpho position → rows render', tile.render === 'rows')
    check('headline is the lent amount, not a market count', tile.headline?.value === '2.000055 USDC')
    check('headline names the yield', /4\.30% APY/.test(tile.headline?.caption ?? ''))
    // lltv is a liquidation number — noise above a lend row, and the row is
    // already three lines wide in the card's column.
    check('the lend row leaves lltv off', !/lltv/.test(tile.rows[0].sub ?? ''))
    // The whole point of the card (Nate, 2026-09-08): WHICH pool, not "51 items".
    check('row names the pool it is earning in', tile.rows.some((r) => /USDC lent/.test(r.label) && /USDC \/ cbBTC/.test(r.sub ?? '')))
    check('row carries the live APY and chain', /4\.30% APY/.test(tile.rows[0].sub ?? '') && /Base/.test(tile.rows[0].sub ?? ''))
    check('lent row is positive-toned', tile.rows[0].tone === 'pos')
    check('row links to its own Morpho market', tile.rows[0].infoUrl === `https://app.morpho.org/base/market/${mkt}`)
    check('no borrow → no health-factor row', !tile.rows.some((r) => r.label === 'Health factor'))
    check('subtitle counts markets lent into', /lending in 1 market · Base/.test(tile.subtitle ?? ''))

    // Nothing anywhere → no card (the affinity contract), on BOTH chains.
    const empty: McpCall = async () => ({ chain: 'Base', positions: [] })
    check('no position contributes no tile', (await morpho.build(empty, ADDR, rowSrv)) === null)
    // A zeroed row is not a position either.
    const zeroed: McpCall = async () => ({
      chain: 'Base',
      positions: [{ marketId: mkt, market: 'USDC / cbBTC (lltv 86.0%)', supplied: { amount: '0', asset: 'USDC' }, collateral: null, borrowed: null }],
    })
    check('zero-amount rows contribute no tile', (await morpho.build(zeroed, ADDR, rowSrv)) === null)
  }

  console.log('splash sources — morpho (debt, collateral, chains, failure)')
  {
    const rowSrv = srv('morpho-mcp-yeetful', 'Morpho MCP · Pantessa')
    const borrowing: McpCall = async (name, args) => ({
      chain: args.chainId === 1 ? 'Ethereum' : 'Base',
      positions:
        args.chainId === 1
          ? []
          : [
              {
                marketId: '0x' + 'a'.repeat(64),
                market: 'USDC / cbBTC (lltv 86.0%)',
                supplied: null,
                collateral: { amount: '0.05', asset: 'cbBTC' },
                borrowed: { amount: '1200.5', asset: 'USDC', apy: '5.10%' },
                healthFactor: 1.21,
              },
            ],
    })
    const tile = (await morpho.build(borrowing, ADDR, rowSrv)) as RowsTile
    check('borrow row is negative-toned', tile.rows.some((r) => /USDC borrowed/.test(r.label) && r.tone === 'neg'))
    // Collateral earns nothing — the card must never imply otherwise.
    check('collateral row says it earns nothing', tile.rows.some((r) => /cbBTC collateral/.test(r.label) && /earns nothing/.test(r.sub ?? '')))
    check('rows that can be liquidated carry lltv', tile.rows.filter((r) => /collateral|borrowed/.test(r.label)).every((r) => /lltv 86\.0%/.test(r.sub ?? '')))
    check('thin health factor flagged', tile.rows.some((r) => r.label === 'Health factor' && r.value === '1.21' && r.tone === 'neg'))
    check('repay leads the chips when there is debt', /repay/i.test(tile.prompts[0]?.prompt ?? ''))

    // A position on Ethereum: every chip must pin the chain (Base is the
    // Morpho layer's parse default — an unpinned chip would rebuild on Base).
    const onMainnet: McpCall = async (name, args) => ({
      chain: args.chainId === 1 ? 'Ethereum' : 'Base',
      positions:
        args.chainId === 1
          ? [{ marketId: '0x' + 'b'.repeat(64), market: 'WETH / wstETH (lltv 94.5%)', supplied: { amount: '1.5', asset: 'WETH', apy: '2.10%' }, collateral: null, borrowed: null }]
          : [],
    })
    const eth = (await morpho.build(onMainnet, ADDR, rowSrv)) as RowsTile
    check('mainnet position keeps its chain in the row', /Ethereum/.test(eth.rows[0].sub ?? ''))
    check('mainnet chips name Ethereum', eth.prompts.every((p) => !/withdraw|repay/i.test(p.prompt) || / \(Ethereum\)$/.test(p.prompt)))
    check('mainnet chips never double the preposition', eth.prompts.every((p) => !/on Morpho on /i.test(p.prompt)))
    check('mainnet market link is the ethereum page', (eth.rows[0].infoUrl ?? '').includes('/ethereum/market/'))

    // Lending on BOTH chains: neither scan hides the other, and each row
    // keeps the chain it was read on.
    const bothChains: McpCall = async (name, args) => ({
      chain: args.chainId === 1 ? 'Ethereum' : 'Base',
      positions: [
        args.chainId === 1
          ? { marketId: '0x' + 'e'.repeat(64), market: 'WETH / wstETH (lltv 94.5%)', supplied: { amount: '1.5', asset: 'WETH', apy: '2.10%' }, collateral: null, borrowed: null }
          : { marketId: '0x' + 'f'.repeat(64), market: 'USDC / cbBTC (lltv 86.0%)', supplied: { amount: '2', asset: 'USDC', apy: '4.30%' }, collateral: null, borrowed: null },
      ],
    })
    const both = (await morpho.build(bothChains, ADDR, rowSrv)) as RowsTile
    check('both chains land on the card', both.rows.length === 2 && both.rows.some((r) => /USDC lent/.test(r.label)) && both.rows.some((r) => /WETH lent/.test(r.label)))
    check('each row names its own chain', both.rows.every((r) => /Base|Ethereum/.test(r.sub ?? '')))
    check('two lent assets → no single-number headline', both.headline === undefined)
    check('subtitle names both chains', /Base/.test(both.subtitle ?? '') && /Ethereum/.test(both.subtitle ?? ''))

    // Chain picker: Morpho is Base + Ethereum only.
    const calls: number[] = []
    const counting: McpCall = async (_n, args) => {
      calls.push(args.chainId as number)
      return { chain: 'Base', positions: [] }
    }
    await morpho.build(counting, ADDR, rowSrv, { key: 'base', name: 'Base' } as AppChain)
    check('a base selection scans base alone', calls.length === 1 && calls[0] === 8453)
    check('an off-Morpho chain contributes no tile', (await morpho.build(counting, ADDR, rowSrv, { key: 'arbitrum', name: 'Arbitrum' } as AppChain)) === null)
    check('the off-chain skip makes no call', calls.length === 1)

    // One chain down must not hide the other; both down is an error card.
    const halfDown: McpCall = async (name, args) => {
      if (args.chainId === 1) throw new Error('rpc down')
      return { chain: 'Base', positions: [{ marketId: '0x' + 'c'.repeat(64), market: 'USDC / cbBTC (lltv 86.0%)', supplied: { amount: '2', asset: 'USDC', apy: '4.30%' }, collateral: null, borrowed: null }] }
    }
    check('one chain failing still paints the other', ((await morpho.build(halfDown, ADDR, rowSrv)) as RowsTile).rows.length === 1)
    let threw = false
    try {
      await morpho.build(async () => { throw new Error('rpc down') }, ADDR, rowSrv)
    } catch {
      threw = true
    }
    check('every chain failing throws → the retryable error card', threw)
  }

  console.log('splash sources — morpho chips round-trip the native parsers')
  {
    // The standing contract: a chip is a promise the chat layer keeps. Every
    // action prompt this card emits must parse into a guarded build, not a
    // planner freelance.
    const parses = (p: string) => parseMorphoLend(p) !== null || parseMorphoOp(p) !== null
    const rowSrv = srv('morpho-free', 'Morpho (Free)')
    const full: McpCall = async (name, args) => ({
      chain: args.chainId === 1 ? 'Ethereum' : 'Base',
      positions:
        args.chainId === 1
          ? []
          : [
              {
                marketId: '0x' + 'd'.repeat(64),
                market: 'USDC / cbBTC (lltv 86.0%)',
                supplied: { amount: '2.000055', asset: 'USDC', apy: '4.30%' },
                collateral: { amount: '0.05', asset: 'cbBTC' },
                borrowed: { amount: '10', asset: 'USDC', apy: '5.10%' },
                healthFactor: 2.4,
              },
            ],
    })
    const tile = (await morpho.build(full, ADDR, rowSrv)) as RowsTile
    const actionPrompts = tile.rows.flatMap((r) => (r.actions ?? []).map((a) => a.prompt))
    check('every row action parses natively', actionPrompts.length === 3 && actionPrompts.every(parses))
    check('every act-shaped chip parses natively', tile.prompts.filter((p) => /withdraw|repay|lend/i.test(p.prompt)).every((p) => p.prompt && parses(p.prompt)))
    check('a mainnet chip still parses (and lands on chain 1)', (() => {
      const r = parseMorphoOp('Withdraw all my USDC from Morpho on Ethereum')
      return !!r && 'chainId' in r && r.chainId === 1
    })())
    // The manual-pick preview card is a door, not decoration.
    const preview = previewTile(rowSrv, 'morpho')
    check('morpho preview offers its own lend chip', preview.prompts.some((p) => parseMorphoLend(p.prompt) !== null))
    check('morpho preview names the venue honestly', /Nothing lent on Morpho/.test((preview as { message: string }).message))
  }

  console.log('affinity — uniswap router probe (pure)')
  {
    const ur = UNISWAP_CONTRACTS['base-mainnet'][0]
    check('counterparty in the router set matches', touchesContracts(['0xdeadbeef', ur], UNISWAP_CONTRACTS['base-mainnet']))
    check('no router counterparty → no match', !touchesContracts(['0xdeadbeef'], UNISWAP_CONTRACTS['base-mainnet']))
    check('all probe addresses are lowercase', Object.values(UNISWAP_CONTRACTS).flat().every((a) => a === a.toLowerCase() && /^0x[0-9a-f]{40}$/.test(a)))
  }

  console.log('preview tiles — the manual-pick exception')
  {
    // Every dedicated source has canned preview copy with prompt chips.
    for (const source of SPLASH_SOURCES) {
      const tile = previewTile(srv(`${source.id}-x`, source.id) as SplashServer, source.id)
      check(`${source.id} preview is an empty-render tile with prompts`, tile.render === 'empty' && tile.prompts.length >= 2)
      check(`${source.id} preview has a message`, tile.render === 'empty' && tile.message.length > 0)
    }
    // Generic preview (no dedicated source): example queries become the chips…
    const custom = { ...srv('my-mcp', 'My MCP'), description: 'Does useful things.', exampleQueries: ['Ask me a thing', 'Ask me another'] } as SplashServer
    const generic = previewTile(custom)
    check('generic preview chips come from exampleQueries', generic.prompts.length === 2 && generic.prompts[0].prompt === 'Ask me a thing')
    check('generic preview message from the description', generic.render === 'empty' && /useful things/i.test(generic.message))
    // …and a bare row still gets a "what can you do" way in.
    const bare = previewTile(srv('bare-mcp', 'Bare MCP') as SplashServer)
    check('bare preview falls back to a what-can-you-do prompt', bare.prompts.length === 1 && /what can/i.test(bare.prompts[0].prompt))
    check('preview id is slug-scoped (dedupe-safe)', bare.id === 'bare-mcp-preview')
  }

  console.log('splash sources — robinhood')
  {
    const rh = SPLASH_SOURCES.find((s) => s.id === 'robinhood')!
    const stocked = async () => ({
      kind: 'portfolio',
      chain: 'Robinhood Chain',
      chainId: 4663,
      totalUsd: 142.5,
      holdings: [
        { symbol: 'USDG', kind: 'stable', balance: '80.00', usd: 80, priceUsd: 1 },
        { symbol: 'AAPL', kind: 'stock', balance: '0.25', usd: 52.5, priceUsd: 210 },
        { symbol: 'ETH', kind: 'native', balance: '0.003', usd: 10, priceUsd: 3300 },
      ],
    })
    const tile = (await rh.build(stocked, ADDR, srv('robinhood-free', 'Robinhood Chain (Free)'))) as HoldingsTile
    check('robinhood holdings → holdings render', tile.render === 'holdings')
    check('tile id is its own (not the wallet card id)', tile.id === 'robinhood-portfolio')
    check('subtitle counts the stocks', /1 stock/.test(tile.subtitle ?? ''))
    check('usd field mapped onto valueUsd', tile.holdings[0].valueUsd === 80)
    check('idle USDG → buy-a-stock chip', tile.prompts.some((p) => /Swap 50 USDG for AAPL on Robinhood Chain/.test(p.prompt)))
    check('held stock → sell chip', tile.prompts.some((p) => /Swap 0\.25 AAPL for USDG/.test(p.prompt)))
    // DCA + buy + sell already fill the three chip slots; the bridge-in chip
    // rides only when there's room (a funded wallet with no stock yet).
    check('chips cap at 3 — DCA, buy, sell fill them', tile.prompts.length === 3 && !tile.prompts.some((p) => /Bridge/.test(p.prompt)))
    const noStock = (await rh.build(async () => ({ kind: 'portfolio', totalUsd: 90, holdings: [
      { symbol: 'USDG', kind: 'stable', balance: '80.00', usd: 80, priceUsd: 1 },
      { symbol: 'ETH', kind: 'native', balance: '0.003', usd: 10, priceUsd: 3300 },
    ] }), ADDR, srv('robinhood-free', 'Robinhood Chain (Free)'))) as HoldingsTile
    check('bridge chip rides along when there is room', noStock.prompts.some((p) => /Bridge .* ETH from Ethereum to Robinhood Chain/.test(p.prompt)))

    const empty = async () => ({ kind: 'portfolio', chainId: 4663, totalUsd: 0, holdings: [] })
    check('empty chain wallet contributes no tile', (await rh.build(empty, ADDR, srv('robinhood-free', 'Robinhood Chain (Free)'))) === null)

    const ethOnly = async () => ({ kind: 'portfolio', chainId: 4663, totalUsd: 33, holdings: [{ symbol: 'ETH', kind: 'native', balance: '0.01', usd: 33, priceUsd: 3300 }] })
    const ethTile = (await rh.build(ethOnly, ADDR, srv('robinhood-free', 'Robinhood Chain (Free)'))) as HoldingsTile
    check('ETH-only wallet → ETH→USDG chip (v3 is liquid there)', ethTile.prompts.some((p) => /ETH for USDG on Robinhood Chain/.test(p.prompt)))
  }

  console.log('finalize — the dedupe honors the manual-pick contract')
  {
    const mkServer = (slug: string, forceShow: boolean): SplashServer =>
      ({ ...srv(slug, slug), forceShow } as SplashServer)
    const portfolioTile = (slug: string) =>
      ({ id: 'portfolio-holdings', mcpSlug: slug, mcpName: slug, render: 'holdings', title: 'Your portfolio', chain: 'Base', totalUsd: 1, holdings: [], prompts: [] }) as unknown as Parameters<typeof finalizeSplashTiles>[0][number]['tiles'][number]

    // Wallet wins the shared id; hand-picked uniswap's identical tile loses the
    // dedupe but still paints its preview face with action chips.
    const results: SourceResult[] = [
      { server: mkServer('yeetful-tool-wallet', false), sourceId: 'wallet', tiles: [portfolioTile('yeetful-tool-wallet')] },
      { server: mkServer('uniswap-free', true), sourceId: 'uniswap', tiles: [portfolioTile('uniswap-free')] },
    ]
    const tiles = finalizeSplashTiles(results)
    check('shared id keeps one portfolio card', tiles.filter((t) => t.id === 'portfolio-holdings').length === 1)
    const fallback = tiles.find((t) => t.id === 'uniswap-free-preview')
    check('hand-picked loser still paints a card', !!fallback && fallback.render === 'empty')
    check('fallback carries the source action chips', !!fallback && fallback.prompts.length >= 2)
    check('fallback copy says the data lives elsewhere', fallback?.render === 'empty' && /already on the portfolio card/i.test(fallback.message))

    // A NON-picked server that loses the dedupe stays gone (the old behavior).
    const auto = finalizeSplashTiles([
      { server: mkServer('yeetful-tool-wallet', false), sourceId: 'wallet', tiles: [portfolioTile('yeetful-tool-wallet')] },
      { server: mkServer('uniswap-free', false), sourceId: 'uniswap', tiles: [portfolioTile('uniswap-free')] },
    ])
    check('auto-scan loser contributes nothing', auto.length === 1)

    // A hand-picked server whose tile SURVIVED gets no extra preview card.
    const survived = finalizeSplashTiles([
      { server: mkServer('uniswap-free', true), sourceId: 'uniswap', tiles: [portfolioTile('uniswap-free')] },
    ])
    check('surviving picked server paints only its live tile', survived.length === 1 && survived[0].id === 'portfolio-holdings')
  }

  // The lido MCP prices in NUMBERS (unlike aave's pre-formatted "$1,204.50"),
  // so this payload mirrors a real `position` response verbatim. Tile values
  // are strings by contract: a leaked number crashed App mode's parseUsd and
  // took /chat down with it (the .match TypeError).
  console.log('splash sources — lido')
  {
    const staked = async () => ({
      hasPosition: true,
      eth: { balance: '0.455627', usd: 856.11 },
      stEth: { balance: '0.116211', usd: 218.36 },
      wstEth: { balance: '0.125939', asStEth: '0.156083', usd: 293.28 },
      totalStaked: { stEth: '0.272294', usd: 511.63 },
      currentAprPct: 2.216142857142857,
      withdrawals: { pendingRequests: 0, claimableRequests: 0, claimableEth: '0' },
    })
    const tile = (await lido.build(staked, ADDR, srv('lido-free', 'Lido (Free)'))) as RowsTile
    check('lido position → rows render', tile.render === 'rows')
    check('headline is a formatted USD STRING, never a raw number', tile.headline?.value === '$511.63')
    check('every row value is a string', tile.rows.every((r) => typeof r.value === 'string'))
    check('stETH row priced in USD', tile.rows.some((r) => r.label === 'stETH' && r.value === '$218.36'))
    check('wstETH row priced in USD', tile.rows.some((r) => r.label === 'wstETH' && r.value === '$293.28'))
    check('APR rounded to 2dp (not 2.216142857142857)', tile.subtitle === 'earning ~2.22% APR')
    check('stake chip sized off the live ETH balance minus gas', tile.prompts.some((p) => /Stake 0\.4536 ETH/.test(p.label)))
    // The exact guard App mode applies — a number here throws, not returns null.
    check('headline survives App mode parseUsd', parseUsd(tile.headline!.value) === 511.63)
  }
  {
    const bare = async () => ({ hasPosition: false })
    check('no lido position contributes no tile', (await lido.build(bare, ADDR, srv('lido-free', 'Lido (Free)'))) === null)
  }
  {
    // Unpriced position (the MCP's price probe fails soft) → fall back to the
    // token balance, still a string, and drop the headline rather than "$NaN".
    const unpriced = async () => ({
      hasPosition: true,
      eth: { balance: '0.001', usd: null },
      stEth: { balance: '0.116211', usd: null },
      totalStaked: { stEth: '0.116211', usd: null },
      currentAprPct: null,
    })
    const tile = (await lido.build(unpriced, ADDR, srv('lido-free', 'Lido (Free)'))) as RowsTile
    check('unpriced position drops the headline', tile.headline === undefined)
    check('unpriced stETH row falls back to the balance', tile.rows.some((r) => r.value === '0.116211 stETH'))
    check('unpriced APR falls back to a static subtitle', tile.subtitle === 'staked with Lido')
  }

  // Defence in depth: the source above is the fix, this is the backstop. Any
  // future MCP that leaks a non-string must render verbatim, not throw.
  console.log('app mode — parseUsd is fail-closed')
  {
    check('formatted USD parses', parseUsd('$1,204.55') === 1204.55)
    check('non-USD string → null (rendered verbatim)', parseUsd('62% filled') === null)
    check('raw number → null, not a TypeError', parseUsd(511.63 as unknown as string) === null)
    check('null/undefined → null, not a TypeError', parseUsd(undefined as unknown as string) === null)
  }

  // ── The cockpit (2026-09-09): every number a card charts + the money map ──
  console.log('splash viz — allocation + holdings facts (pure)')
  {
    const rows = [
      { symbol: 'ETH', valueUsd: 200, chain: 'Base' },
      { symbol: 'ETH', valueUsd: 100, chain: 'Arbitrum' },
      { symbol: 'USDC', valueUsd: 150, chain: 'Base' },
      { symbol: 'DEGEN', valueUsd: 15, chain: 'Base' },
      { symbol: 'AERO', valueUsd: 12, chain: 'Base' },
      { symbol: 'cbBTC', valueUsd: 9, chain: 'Base' },
      { symbol: 'UNI', valueUsd: 4, chain: 'Ethereum' },
      { symbol: 'LINK', valueUsd: 3, chain: 'Ethereum' },
      { symbol: 'stETH', valueUsd: 500, chain: 'Ethereum' },
      { symbol: 'aBasUSDC', valueUsd: 20, chain: 'Base' },
      { symbol: 'SPAM', valueUsd: null, chain: 'Base' },
    ]
    const viz = allocationViz(rows)!
    check('allocation: same symbol across chains is ONE slice (ETH 300)', viz.slices[0].label === 'stETH' && viz.slices[1].label === 'ETH' && viz.slices[1].usd === 300)
    check('allocation: top five named + the rest folded as "N more"', viz.slices.length === 6 && viz.slices[5].label === '4 more' && viz.slices[5].usd === 28 && !viz.slices[5].symbol)
    check('allocation: total is the priced sum only (unpriced never counts)', viz.totalUsd === 1013)
    check('allocation: nothing priced → null, never an empty bar', allocationViz([{ symbol: 'X', valueUsd: null }]) === null)
    const facts = holdingsFacts(rows, 'Base')
    check('facts: ETH + USDC are the scan’s (excluded), receipt tokens are the protocol’s (excluded)', !facts.some((f) => /^(ETH|USDC|stETH|aBasUSDC) /.test(f.label)))
    check('facts: the long tail lands as spot, labeled with its chain', facts.length === 5 && facts.every((f) => f.bucket === 'spot') && facts.some((f) => f.label === 'DEGEN on Base') && facts.some((f) => f.label === 'UNI on Ethereum'))
    check('usdOfString: "$1,204.50" → 1204.5, garbage → null', usdOfString('$1,204.50') === 1204.5 && usdOfString('20.13') === 20.13 && usdOfString('n/a') === null && usdOfString(null) === null)
  }

  console.log('money map — composeMoneyFacts / merge / summarize (pure)')
  {
    const inputs: BriefingInputs = {
      firedRecently: [],
      positions: [
        { coin: 'SYRUP', side: 'long', positionValueUsd: 372.65, unrealizedPnl: 138.62, leverage: 3 },
        { coin: 'ETH', side: 'short', positionValueUsd: 50, unrealizedPnl: -2, leverage: 2 },
        { coin: 'DUST', side: 'long', positionValueUsd: 0, unrealizedPnl: 0, leverage: 1 },
      ],
      protectedCoins: ['syrup'],
      spotProtectedSymbols: [],
      funding: {
        sources: [
          { chainId: 8453, chainWord: 'Base', token: 'USDC', balance: 64.25, usd: 64.25 },
          { chainId: 1, chainWord: 'Ethereum', token: 'USDC', balance: 628.22, usd: 628.22 },
          { chainId: 8453, chainWord: 'Base', token: 'ETH', balance: 0.08, usd: 213.23 },
          { chainId: 42161, chainWord: 'Arbitrum', token: 'ETH', balance: 0.002, usd: 5 },
        ],
        stranded: [{ chainId: 10, chainWord: 'Optimism', token: 'USDC', balance: 185.04, usd: 185.04 }],
        readChains: ['Base', 'Ethereum', 'Arbitrum', 'Optimism'],
        failedChains: [],
      },
      aave: null,
      failed: [],
    }
    const facts = composeMoneyFacts(inputs)
    const by = (b: string) => facts.filter((f) => f.bucket === b)
    check('map: a guarded perp is protected, a naked one is at risk, a zero-value one is nothing', by('protected').length === 1 && by('protected')[0].usd === 372.65 && by('risk').length === 1 && by('risk')[0].usd === 50 && facts.length === 7)
    check('map: USDC on every scan chain is idle', by('idle').length === 2 && by('idle').reduce((n, f) => n + f.usd, 0) === 692.47)
    check('map: ETH without a spot guard is spot (Base + Arbitrum)', by('spot').length === 2 && by('spot').some((f) => f.label === 'ETH on Base'))
    check('map: stranded USDC is stuck, named with its chain', by('stuck').length === 1 && /Optimism \(no gas\)/.test(by('stuck')[0].label))
    const watched = composeMoneyFacts({ ...inputs, spotProtectedSymbols: ['ETH'] })
    check('map: an armed spot guard on Base moves Base ETH to protected — Arbitrum ETH stays spot', watched.filter((f) => f.bucket === 'protected').length === 2 && watched.some((f) => f.bucket === 'spot' && f.label === 'ETH on Arbitrum'))
    const noFunding = composeMoneyMap({ ...inputs, funding: null, failed: ['funding'] })
    check('map: a failed funding scan still maps the perps and names every chain unread', noFunding.facts.length === 2 && noFunding.readChains.length === 0 && noFunding.failedChains[0] === 'every chain')
    const map = composeMoneyMap(inputs)
    const tiles = [
      { id: 'aave-position', mcpSlug: 'aave-free', mcpName: 'Aave', title: 'x', render: 'rows', rows: [], prompts: [], facts: [{ bucket: 'earning', usd: 21.14, label: 'supplied on Aave' }] },
      { id: 'robinhood-portfolio', mcpSlug: 'robinhood-free', mcpName: 'RH', title: 'x', render: 'holdings', chain: 'Robinhood Chain', totalUsd: 30, holdings: [], prompts: [], facts: [{ bucket: 'stocks', usd: 11.89, label: 'AAPL on Robinhood Chain' }, { bucket: 'idle', usd: 0, label: 'USDG on Robinhood Chain' }, { bucket: 'spot', usd: -1, label: 'bad' }] },
    ] as unknown as SplashTile[]
    const merged = mergeMoneyMap(map, tiles)!
    check('merge: card facts fold in; zero and negative facts are dropped', merged.facts.length === 9 && !merged.facts.some((f) => f.usd <= 0))
    check('merge: nothing anywhere → null (an empty wallet paints no bar)', mergeMoneyMap({ facts: [], readChains: [], failedChains: [] }, []) === null && mergeMoneyMap(null, []) === null)
    const sum = summarizeMoneyMap(merged)
    check('summary: total is the plain sum of every fact', Math.abs(sum.totalUsd - (372.65 + 50 + 692.47 + 218.23 + 185.04 + 21.14 + 11.89)) < 0.01)
    check('summary: segments follow the bucket order and skip empty buckets', sum.segments.map((s) => s.bucket).join(',') === 'earning,protected,stocks,spot,idle,risk,stuck')
    check('summary: shares sum to 100', Math.abs(sum.segments.reduce((n, s) => n + s.pct, 0) - 100) < 0.01)
    check('summary: workingPct = (earning + protected) / total', sum.workingPct === Math.round(((21.14 + 372.65) / sum.totalUsd) * 100))
    check('summary: every bucket in the order table has a label + blurb', MONEY_BUCKETS.length === 7 && MONEY_BUCKETS.every((b) => b.label && b.blurb))
  }

  console.log('splash layout — the bento planner (pure)')
  {
    const rowsOf = (spans: number[]) => {
      const rows: number[][] = []
      let cur: number[] = []
      for (const s of spans) {
        cur.push(s)
        if (cur.reduce((n, x) => n + x, 0) >= 12) {
          rows.push(cur)
          cur = []
        }
      }
      if (cur.length) rows.push(cur)
      return rows
    }
    const full = (spans: number[]) => rowsOf(spans).every((r) => r.reduce((n, x) => n + x, 0) === 12)
    check('spans: 2 wide + 3 narrow → [6,6,4,4,4]', planSpans(2, 3).join(',') === '6,6,4,4,4')
    check('spans: the odd wide widens to 8 and takes a narrow', planSpans(1, 1).join(',') === '8,4' && planSpans(3, 4).join(',') === '6,6,8,4,4,4,4')
    check('spans: a lone card fills the row', planSpans(1, 0).join(',') === '12' && planSpans(0, 1).join(',') === '12')
    check('spans: two trailing narrows split the row', planSpans(0, 2).join(',') === '6,6' && planSpans(2, 2).join(',') === '6,6,6,6')
    let everyRowFull = true
    for (let w = 0; w <= 5; w++) for (let n = 0; n <= 7; n++) if (w + n > 0 && !full(planSpans(w, n))) everyRowFull = false
    check('spans: no row ever ends short (0–5 wide × 0–7 narrow)', everyRowFull)
    const t = (id: string, slug: string, extra: Record<string, unknown> = {}) => ({ id, mcpSlug: slug, mcpName: slug, title: id, render: 'rows', rows: [], prompts: [], ...extra }) as unknown as SplashTile
    const tiles = [
      t('briefing', 'yeetful'),
      t('dca-schedules', 'yeetful'),
      t('aave-position', 'aave-free'),
      t('portfolio-holdings', 'yeetful-tool-wallet', { render: 'holdings', holdings: [], chain: 'Base', totalUsd: 1 }),
      t('recent-activity', 'yeetful-tool-wallet', { render: 'activity', rows: [] }),
      t('lido-position', 'lido-free'),
    ]
    const layout = planLayout(tiles)
    check('layout: the briefing is the hero and leaves the grid', layout.hero?.id === 'briefing' && !layout.cards.some((c) => c.group.some((x) => x.id === 'briefing')))
    check('layout: one card per MCP, the wallet’s two tiles grouped', layout.cards.length === 4 && layout.cards.some((c) => c.group.length === 2 && c.group[0].mcpSlug === 'yeetful-tool-wallet'))
    check('layout: wide cards lead, narrows follow, spans planned', layout.cards[0].group[0].render === 'holdings' && layout.cards.map((c) => c.span).join(',') === '8,4,6,6')
    check('layout: hero off → the briefing is a plain card', planLayout(tiles, { hero: false }).hero === null && planLayout(tiles, { hero: false }).cards.length === 4 && planLayout(tiles, { hero: false }).cards[0].group[0].mcpSlug === 'yeetful-tool-wallet')
    check('layout: positions/allocation viz and 5+ rows want wide', wantsWide([t('x', 'y', { viz: { kind: 'positions', accountUsd: null, items: [] } })]) && wantsWide([t('x', 'y', { rows: [{}, {}, {}, {}, {}] })]) && !wantsWide([t('x', 'y', { rows: [{}, {}] })]))
  }

  console.log('splash sources — the numbers every card charts')
  {
    const aaveCall = async () => ({
      positions: [{ netBalanceUsd: '$20.13', netApyPct: 3.07, healthFactor: '1.21' }],
      supplies: [
        { token: { symbol: 'USDC' }, balance: '20.13', balanceUsd: '$20.13', earnedInterestUsd: '$0.13', supplyApyPct: 3.07, isCollateral: true },
        { token: { symbol: 'USDC' }, balance: '1.01', balanceUsd: '$1.01', supplyApyPct: 3.07 },
      ],
      borrows: [{ token: { symbol: 'GHO' }, debt: '5', debtUsd: '$5.00', borrowApyPct: 6.1 }],
    })
    const aaveTile = (await aave.build(aaveCall, ADDR, srv('aave-free', 'Aave (Free)'))) as RowsTile
    const lending = aaveTile.viz as Extract<NonNullable<RowsTile['viz']>, { kind: 'lending' }>
    check('aave: lending viz recovers USD from the payload’s own strings', lending.kind === 'lending' && lending.suppliedUsd === 21.14 && lending.borrowedUsd === 5 && lending.healthFactor === 1.21 && lending.netApyPct === 3.07)
    check('aave: supplied money is an earning fact', aaveTile.facts?.length === 1 && aaveTile.facts[0].bucket === 'earning' && aaveTile.facts[0].usd === 21.14)
    const aaveNoDebt = (await aave.build(async () => ({ positions: [{ netBalanceUsd: '$20.13', netApyPct: 3.07, healthFactor: '99' }], supplies: [{ token: { symbol: 'USDC' }, balance: '20.13', balanceUsd: '$20.13' }], borrows: [] }), ADDR, srv('aave-free', 'Aave (Free)'))) as RowsTile
    check('aave: no debt → no gauge (health factor null), borrowed 0', (aaveNoDebt.viz as { healthFactor: number | null; borrowedUsd: number | null }).healthFactor === null && (aaveNoDebt.viz as { borrowedUsd: number | null }).borrowedUsd === 0)

    const lidoTile = (await lido.build(async () => ({ hasPosition: true, eth: { balance: '0.5', usd: 1200 }, stEth: { balance: '1.2', usd: 2880 }, totalStaked: { stEth: '1.2', usd: 2880 }, currentAprPct: 2.9 }), ADDR, srv('lido-free', 'Lido (Free)'))) as RowsTile
    check('lido: yield viz = staked USD at the live APR', lidoTile.viz?.kind === 'yield' && lidoTile.viz.principalUsd === 2880 && lidoTile.viz.aprPct === 2.9)
    check('lido: staked money is an earning fact', lidoTile.facts?.[0]?.bucket === 'earning' && lidoTile.facts[0].usd === 2880)

    const hlTile = (await hl.build(async () => ({ perp: { accountValueUsd: '500', withdrawableUsd: '100', positions: [
      { coin: 'SYRUP', szi: '1000', entryPx: '0.30', positionValue: '372.65', unrealizedPnl: '138.62', liquidationPx: '0.25', leverage: { value: 3 } },
      { coin: 'ETH', szi: '-0.02', entryPx: '2500', positionValue: '50', unrealizedPnl: '-2', liquidationPx: null, leverage: { value: 2 } },
    ] } }), ADDR, srv('hyperliquid-free', 'Hyperliquid (Free)'))) as RowsTile
    const pos = hlTile.viz as Extract<NonNullable<RowsTile['viz']>, { kind: 'positions' }>
    check('hyperliquid: positions viz carries side, leverage, PnL, value', pos.kind === 'positions' && pos.accountUsd === 500 && pos.items[0].side === 'long' && pos.items[0].leverage === 3 && pos.items[0].pnlUsd === 138.62 && pos.items[1].side === 'short')
    check('hyperliquid: liquidation distance from the venue’s own mark (value/size), null without a liq px', pos.items[0].liqDistancePct === 32.9 && pos.items[1].liqDistancePct === null)
    check('hyperliquid: perps are the briefing’s money, the card claims no facts', !hlTile.facts)

    const rh = SPLASH_SOURCES.find((s) => s.id === 'robinhood')!
    const rhTile = (await rh.build(async () => ({ totalUsd: 60, holdings: [
      { symbol: 'USDG', kind: 'stable', balance: '30.00', usd: 30, priceUsd: 1 },
      { symbol: 'AAPL', kind: 'stock', balance: '0.05', usd: 11.89, priceUsd: 237.8 },
      { symbol: 'ETH', kind: 'native', balance: '0.005', usd: 18.11, priceUsd: 3622 },
    ] }), ADDR, srv('robinhood-free', 'Robinhood Chain (Free)'))) as HoldingsTile
    const rhBy = (b: string) => rhTile.facts!.filter((f) => f.bucket === b)
    check('robinhood: stocks are stocks, USDG is idle, ETH is spot — all on 4663', rhBy('stocks')[0]?.usd === 11.89 && rhBy('idle')[0]?.usd === 30 && rhBy('spot')[0]?.label === 'ETH on Robinhood Chain')
    check('robinhood: allocation bar over every holding', rhTile.viz?.kind === 'allocation' && rhTile.viz.totalUsd === 60 && rhTile.viz.slices[0].label === 'USDG')

    const cowTile = (await cow.build(async () => ({ chains: [{ chain: 'base', openOrders: [{ pair: 'WETH → USDC', kind: 'sell', status: 'open', filledPct: 62.4, validTo: 0 }, { pair: 'USDC → WETH', kind: 'buy', status: 'open', filledPct: null, validTo: 0 }], tradeCount: 3, recentFills: [] }] }), ADDR, srv('cow-free', 'CoW (Free)'))) as RowsTile
    check('cow: an order’s fill rides the row as progressPct (null when unknown)', cowTile.rows[0].progressPct === 62.4 && cowTile.rows[1].progressPct === null)

    const snapTile = (await snap.build(async () => ({ proposals: [{ id: '0x1', title: 'T', choices: ['For', 'Against'], scores: [75, 25], end: 4102444800, space: { id: 's.eth', name: 'S' } }, { id: '0x2', title: 'U', choices: ['A', 'B'], scores: [0, 0], end: 4102444800, space: { id: 's.eth', name: 'S' } }] }), ADDR, srv('snapshot-free', 'Snapshot (Free)'))) as ProposalsTile
    check('snapshot: the leading choice’s share rides the row, null before any vote', snapTile.proposals[0].leadingPct === 75 && snapTile.proposals[1].leadingPct === null)

    const morphoSrc = SPLASH_SOURCES.find((s) => s.id === 'morpho')!
    const mkt = '0x' + 'ab'.repeat(32)
    const morphoLend = (await morphoSrc.build(async () => ({ chain: 'Base', positions: [{ market: 'USDC / cbBTC (lltv 86.0%)', marketId: mkt, supplied: { asset: 'USDC', amount: '2.0', apy: '4.30%' } }] }), ADDR, srv('morpho-free', 'Morpho (Free)'))) as RowsTile
    const morphoDebt = (await morphoSrc.build(async () => ({ chain: 'Base', positions: [{ market: 'USDC / cbBTC (lltv 86.0%)', marketId: mkt, borrowed: { asset: 'USDC', amount: '2.0', apy: '6%' }, collateral: { asset: 'cbBTC', amount: '0.001' }, healthFactor: 1.21 }] }), ADDR, srv('morpho-free', 'Morpho (Free)'))) as RowsTile
    check('morpho: no USD in the payload → no bars, no facts; a debt → the gauge only', morphoLend.viz === undefined && !morphoLend.facts && morphoDebt.viz?.kind === 'lending' && morphoDebt.viz.healthFactor === 1.21 && morphoDebt.viz.suppliedUsd === null)
  }

  console.log('splash sources — matchers')
  {
    check('lido matches the seeded row', lido.match(srv('lido-free', 'Lido (Free)')))
    check('lido does not match uniswap', !lido.match(srv('uniswap-free', 'Uniswap (Free)')))
    check('uniswap matches by name', uni.match(srv('uniswap-free', 'Uniswap (Free)')))
    check('snapshot matches by name', snap.match(srv('snapshot-free', 'Snapshot DAO (Free)')))
    check('uniswap does not match snapshot', !uni.match(srv('snapshot-free', 'Snapshot DAO (Free)')))
    check('aave matches the custom add-MCP row', aave.match(srv('aave-mcp-yeetful', 'Aave MCP · Pantessa')))
    check('aave does not match uniswap', !aave.match(srv('uniswap-free', 'Uniswap (Free)')))
    check('morpho matches the seeded row', morpho.match(srv('morpho-free', 'Morpho (Free)')))
    check('morpho matches a custom add-MCP row', morpho.match(srv('morpho-mcp-yeetful', 'Morpho MCP · Pantessa')))
    // Morpho-on-Robinhood-Chain is a different deployment (the robinhood MCP)
    // — descriptions are never matched, so a passing mention can't claim it.
    check('morpho does not match robinhood', !morpho.match(srv('robinhood-free', 'Robinhood Chain (Free)')))
    check('morpho does not match aave', !morpho.match(srv('aave-free', 'Aave (Free)')))
    const rh = SPLASH_SOURCES.find((s) => s.id === 'robinhood')!
    check('robinhood matches the seeded row', rh.match(srv('robinhood-free', 'Robinhood Chain (Free)')))
    check('robinhood does not match uniswap', !rh.match(srv('uniswap-free', 'Uniswap (Free)')))
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
