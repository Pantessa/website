// Pure unit tests for the connected-wallet splash sources — no network, no DB.
// Feeds each source a fake MCP caller returning canned tool payloads and asserts
// the tile shape, prompt derivation, avatar resolution, and empty-state handling.
//
//   npx tsx scripts/test-splash.ts
//
// (Kept out of test:api since it needs neither a server nor Neon.)

import { SPLASH_SOURCES } from '@/lib/splash/sources'
import { touchesContracts, UNISWAP_CONTRACTS } from '@/lib/splash/affinity'
import type { McpServer } from '@/lib/store'
import type { HoldingsTile, ProposalsTile, RowsTile } from '@/lib/splash/types'

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
    const tile = (await aave.build(positioned, ADDR, srv('aave-mcp-yeetful', 'Aave MCP · Yeetful'))) as RowsTile
    check('aave position → rows render', tile.render === 'rows')
    check('headline is the net balance', tile.headline?.value === '$1,204.50')
    check('supply row carries earned interest', tile.rows.some((r) => /USDC supplied/.test(r.label) && /12\.40 earned/.test(r.sub ?? '')))
    check('borrow row is negative-toned', tile.rows.some((r) => /WETH borrowed/.test(r.label) && r.tone === 'neg'))
    check('tight health factor flagged', tile.rows.some((r) => r.label === 'Health factor' && r.tone === 'neg'))
    check('repay prompt when borrowing', tile.prompts.some((p) => /repay/i.test(p.prompt)))

    const empty = async () => ({ note: 'No Aave v4 positions for this address.', positions: [], supplies: [], borrows: [] })
    check('no position contributes no tile', (await aave.build(empty, ADDR, srv('aave-mcp-yeetful', 'Aave MCP · Yeetful'))) === null)
  }

  console.log('affinity — uniswap router probe (pure)')
  {
    const ur = UNISWAP_CONTRACTS['base-mainnet'][0]
    check('counterparty in the router set matches', touchesContracts(['0xdeadbeef', ur], UNISWAP_CONTRACTS['base-mainnet']))
    check('no router counterparty → no match', !touchesContracts(['0xdeadbeef'], UNISWAP_CONTRACTS['base-mainnet']))
    check('all probe addresses are lowercase', Object.values(UNISWAP_CONTRACTS).flat().every((a) => a === a.toLowerCase() && /^0x[0-9a-f]{40}$/.test(a)))
  }

  console.log('splash sources — matchers')
  {
    check('uniswap matches by name', uni.match(srv('uniswap-free', 'Uniswap (Free)')))
    check('snapshot matches by name', snap.match(srv('snapshot-free', 'Snapshot DAO (Free)')))
    check('uniswap does not match snapshot', !uni.match(srv('snapshot-free', 'Snapshot DAO (Free)')))
    check('aave matches the custom add-MCP row', aave.match(srv('aave-mcp-yeetful', 'Aave MCP · Yeetful')))
    check('aave does not match uniswap', !aave.match(srv('uniswap-free', 'Uniswap (Free)')))
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
