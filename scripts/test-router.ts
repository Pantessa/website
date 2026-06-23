#!/usr/bin/env tsx
/**
 * Routing eval harness (B19) — a regression guard for routing QUALITY, pure and
 * offline (no DB, no inference, no spend, no server). Each case asserts that the
 * retrieve→plan shortlist (lib/router shortlistEndpoints) ranks the expected
 * service #1 for a representative question — and that chit-chat routes to
 * nothing. Adding a fixture = adding a row to CASES.
 *
 *   npm run test:router
 */
import { shortlistEndpoints } from '../lib/router'
import type { PlannableEndpoint } from '../lib/endpoint-planner'

let pass = 0
let fail = 0
function check(name: string, ok: boolean, extra = '') {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
  ok ? pass++ : fail++
}

const ep = (id: string, slug: string, name: string, description: string): PlannableEndpoint => ({
  id,
  serverSlug: slug,
  serverName: name,
  method: 'GET',
  url: `https://${slug}.test/x`,
  description,
  priceUsd: '0.01',
  parameters: [{ group: 'query', name: 'q', required: true }],
})

// A representative fixture catalog (keyword-rich descriptions, like the enriched
// directory). Order is intentionally NOT the expected answer.
const CATALOG: PlannableEndpoint[] = [
  ep('cg', 'coingecko', 'CoinGecko', 'Onchain token price by contract address'),
  ep('cmc', 'coinmarketcap', 'CoinMarketCap', 'Crypto spot price & quote by symbol — price of ETH, BTC, SOL'),
  ep('trip', 'tripadvisor', 'TripAdvisor', 'Search hotels, restaurants, attractions and travel reviews'),
  ep('wolf', 'wolfram', 'Wolfram', 'Compute math, equations, science and unit conversions'),
  ep('snap', 'snapshot', 'Snapshot', 'DAO governance — proposals, votes and spaces'),
  ep('exa', 'exa', 'Exa', 'Web search — find pages, articles and news'),
  ep('nansen', 'nansen', 'Nansen', 'Onchain wallet analytics, smart money and token flows'),
]

interface Case {
  q: string
  expect: string | null // expected top serverSlug, or null = should route to nothing
}
const CASES: Case[] = [
  { q: 'what is the current price of ETH', expect: 'coinmarketcap' },
  { q: 'find me hotels in Paris', expect: 'tripadvisor' },
  { q: 'compute a complex math equation', expect: 'wolfram' },
  { q: 'open proposals on aave dao', expect: 'snapshot' },
  { q: 'search the web for x402 news', expect: 'exa' },
  { q: 'smart money wallet flows for USDC', expect: 'nansen' },
  { q: 'write me a haiku about clouds', expect: null },
  { q: 'tell me a joke', expect: null },
]

console.log('\nRouting eval — shortlist quality (pure, no spend)\n')
for (const c of CASES) {
  const top = shortlistEndpoints(c.q, CATALOG, 5)[0]
  if (c.expect === null) {
    check(`"${c.q}" → no route`, top === undefined, top ? `got ${top.serverSlug}` : '')
  } else {
    check(`"${c.q}" → ${c.expect}`, top?.serverSlug === c.expect, top ? `got ${top.serverSlug}` : 'got nothing')
  }
}

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
