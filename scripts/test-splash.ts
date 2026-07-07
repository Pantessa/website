// Pure unit tests for the connected-wallet splash sources — no network, no DB.
// Feeds each source a fake MCP caller returning canned tool payloads and asserts
// the tile shape, prompt derivation, avatar resolution, and empty-state handling.
//
//   npx tsx scripts/test-splash.ts
//
// (Kept out of test:api since it needs neither a server nor Neon.)

import { SPLASH_SOURCES } from '@/lib/splash/sources'
import type { McpServer } from '@/lib/store'
import type { HoldingsTile, ProposalsTile, EmptyTile } from '@/lib/splash/types'

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

  console.log('splash sources — uniswap (empty wallet)')
  {
    const call = async () => ({ chainId: 8453, totalUsd: 0, holdings: [] })
    const tile = (await uni.build(call, ADDR, srv('uniswap-free', 'Uniswap (Free)'))) as EmptyTile
    check('empty wallet → empty render', tile.render === 'empty')
    check('empty tile still offers a prompt', tile.prompts.length >= 1)
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

  console.log('splash sources — snapshot (no follows)')
  {
    const call = async () => ({ proposals: [], note: '0x… follows no spaces on Snapshot — no proposals in scope.' })
    const tile = (await snap.build(call, ADDR, srv('snapshot-free', 'Snapshot DAO (Free)'))) as EmptyTile
    check('no follows → empty render', tile.render === 'empty')
    check('surfaces the MCP note', /follows no spaces/.test(tile.message))
  }

  console.log('splash sources — matchers')
  {
    check('uniswap matches by name', uni.match(srv('uniswap-free', 'Uniswap (Free)')))
    check('snapshot matches by name', snap.match(srv('snapshot-free', 'Snapshot DAO (Free)')))
    check('uniswap does not match snapshot', !uni.match(srv('snapshot-free', 'Snapshot DAO (Free)')))
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed > 0) process.exit(1)
}

run().catch((e) => {
  console.error(e)
  process.exit(1)
})
