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
import { shortlistEndpoints, capabilityOf, dedupeByCapability } from '../lib/router'
import { deriveDescription, type PlannableEndpoint } from '../lib/endpoint-planner'
import { detectGovernanceIntent, mapChoiceToIndex, buildVoteTypedData, extractSpaceQuery } from '../lib/governance'
import { coerceForSigning, describeTypedData } from '../lib/eip712'

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
  // B20 — a thin/empty-description service that must still route via its
  // category + path signal (as loadPlannableEndpoints would synthesize).
  { id: 'wx', serverSlug: 'weatherco', serverName: 'WeatherCo', method: 'GET', url: 'https://weatherco.test/x402/v3/forecast/daily', description: null, priceUsd: '0.01', parameters: [{ group: 'query', name: 'q', required: true }], category: 'Weather' },
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
  { q: 'weather forecast for tomorrow', expect: 'weatherco' }, // routes via category + path
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

// B20 — deriveDescription synthesizes keywords for thin descriptions, passes good ones through.
const synth = deriveDescription(null, 'Weather', 'https://w.test/x402/v3/forecast/daily') ?? ''
check('deriveDescription: thin desc → category + path keywords', /weather/i.test(synth) && /forecast/i.test(synth) && !/x402|v3/i.test(synth))
check('deriveDescription: good description passes through unchanged', deriveDescription('A detailed travel search API for hotels and restaurants', 'Travel', 'https://t.test/search') === 'A detailed travel search API for hotels and restaurants')

// B21 — capability tagging + same-need dedup.
const bySlug = (slug: string) => CATALOG.find((e) => e.serverSlug === slug)!
check('capability: CoinMarketCap → crypto-price', capabilityOf(bySlug('coinmarketcap')) === 'crypto-price')
check('capability: CoinGecko → crypto-price (same as CMC)', capabilityOf(bySlug('coingecko')) === 'crypto-price')
check('capability: TripAdvisor → travel', capabilityOf(bySlug('tripadvisor')) === 'travel')
check('capability: Exa → web-search', capabilityOf(bySlug('exa')) === 'web-search')
const dd = dedupeByCapability([
  { id: 'a', capability: 'crypto-price', rating: 0.9, price: 0.01 },
  { id: 'b', capability: 'crypto-price', rating: 0.4, price: 0.01 },
  { id: 'c', capability: 'travel', rating: 0, price: 0.02 },
  { id: 'd', rating: 0, price: 0.01 }, // untagged → always survives
])
check(
  'dedup: keeps best per capability, untagged survive',
  dd.kept.length === 3 && dd.kept.some((k) => k.id === 'a') && !dd.kept.some((k) => k.id === 'b') && dd.kept.some((k) => k.id === 'd') && dd.dropped.length === 1 && dd.dropped[0].id === 'b',
)

// ── Governance routing + the general EIP-712 signing tool ───────────────────
// Intent detection: list vs vote vs none.
check('gov: "open proposals for Nate DAO" → list', detectGovernanceIntent('Are there any open proposals for Nate DAO?')?.kind === 'list')
check('gov: "vote For on X" → vote', detectGovernanceIntent('Vote For on "Let my agent vote" in Nate DAO')?.kind === 'vote')
check('gov: non-governance chit-chat → null', detectGovernanceIntent('write me a haiku about clouds') === null)
check('gov: agent request detected', detectGovernanceIntent('let my agent vote for on proposal')?.agentRequested === true)
check('gov: extractSpaceQuery picks the DAO', extractSpaceQuery('open proposals for Nate DAO?') === 'Nate DAO')
check('gov: extractSpaceQuery picks an .eth id', extractSpaceQuery('proposals on aave.eth') === 'aave.eth')

// Choice mapping against real labels.
const BASIC = ['For', 'Against', 'Abstain']
check('gov: "for" → choice 1', mapChoiceToIndex('for', BASIC) === 1)
check('gov: "against" → choice 2', mapChoiceToIndex('against', BASIC) === 2)
check('gov: "option 3" → choice 3', mapChoiceToIndex('option 3', BASIC) === 3)
check('gov: unmatched choice → null', mapChoiceToIndex('banana', BASIC) === null)

// EIP-712 builder + the schema-agnostic signer coercion.
const vtd = buildVoteTypedData({ from: '0x' + '1'.repeat(40), space: 'nate.eth', proposalId: '0x' + 'a'.repeat(64), choice: 1, reason: 'r' })
check('eip712: Snapshot Vote schema shape', vtd.primaryType === 'Vote' && vtd.domain.name === 'snapshot' && (vtd.message.choice as number) === 1)
check('eip712: describeTypedData label', describeTypedData(vtd) === 'snapshot · Vote')
const coerced = coerceForSigning(vtd)
check('eip712: coerce uint fields → BigInt', typeof coerced.message.timestamp === 'bigint' && typeof coerced.message.choice === 'bigint')
check('eip712: non-uint fields untouched', coerced.message.from === vtd.message.from && typeof coerced.message.space === 'string')
// Generic over any schema (not just Vote): a Permit-like type coerces its own uints.
const permit = coerceForSigning({ domain: { name: 'X' }, primaryType: 'Permit', types: { Permit: [{ name: 'value', type: 'uint256' }, { name: 'owner', type: 'address' }] }, message: { value: '42', owner: '0x' + '2'.repeat(40) } })
check('eip712: generic coercion on a non-Vote schema', permit.message.value === BigInt(42) && typeof permit.message.owner === 'string')

// Snapshot choice types: basic (uint32) · approval/ranked (uint32[]) · weighted (string JSON).
const choiceType = (td: ReturnType<typeof buildVoteTypedData>) => td.types.Vote.find((f) => f.name === 'choice')!.type
const basicTd = buildVoteTypedData({ from: '0x' + '1'.repeat(40), space: 's.eth', proposalId: '0x' + 'a'.repeat(64), choice: 1 })
check('vote-type: basic → uint32', choiceType(basicTd) === 'uint32' && basicTd.message.choice === 1)
const approvalTd = buildVoteTypedData({ from: '0x' + '1'.repeat(40), space: 's.eth', proposalId: '0x' + 'a'.repeat(64), choice: [1, 3] })
check('vote-type: approval/ranked → uint32[]', choiceType(approvalTd) === 'uint32[]' && Array.isArray(approvalTd.message.choice))
const weightedTd = buildVoteTypedData({ from: '0x' + '1'.repeat(40), space: 's.eth', proposalId: '0x' + 'a'.repeat(64), choice: { '1': 2, '2': 1 } })
check('vote-type: weighted/quadratic → string JSON', choiceType(weightedTd) === 'string' && weightedTd.message.choice === '{"1":2,"2":1}')
// The signer coerces uint32[] elements to BigInt; the weighted string stays a string.
check('vote-type: uint32[] coerces to BigInt[]', Array.isArray(coerceForSigning(approvalTd).message.choice) && (coerceForSigning(approvalTd).message.choice as bigint[])[0] === BigInt(1))
check('vote-type: weighted string not coerced', typeof coerceForSigning(weightedTd).message.choice === 'string')

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail ? 1 : 0)
