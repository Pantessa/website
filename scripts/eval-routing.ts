#!/usr/bin/env tsx
/**
 * R0 — Routing eval harness. The scoreboard for "does the router find the right
 * MCP?". Runs the EXACT retrieval path the engine uses (loadCatalog →
 * loadPlannableEndpoints → shortlistEndpoints) over a fixed set of realistic
 * prompts, each tagged with the service(s) that SHOULD answer, and measures
 * whether the right MCP even makes the shortlist + at what rank.
 *
 * Pure + free: no inference call, no payment. This isolates RETRIEVAL quality
 * (is the right tool surfaced?) from SELECTION (did the LLM pick it?) — so we
 * know whether the fix is semantic retrieval (R2) or rerank/bias (R4).
 *
 *   npm run eval:routing            # summary + miss list
 *   npm run eval:routing -- --json  # machine-readable
 *
 * A "hit" = any acceptable service appears among the shortlisted endpoints.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadCatalog } from '../lib/catalog'
import { loadPlannableEndpoints } from '../lib/endpoint-planner'
import { shortlistEndpoints } from '../lib/router'
import { hybridShortlist } from '../lib/retrieval'

function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    try {
      for (const line of readFileSync(join(process.cwd(), file), 'utf8').split('\n')) {
        const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/)
        if (m && !line.trimStart().startsWith('#') && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
      }
    } catch {
      /* no env */
    }
  }
}
loadEnv()
const JSON_OUT = process.argv.includes('--json')

// query → the service slug(s) that SHOULD be able to answer (any-of = a hit).
interface Case { q: string; expect: string[] }
const CASES: Case[] = [
  { q: 'can I get the running score of the latest MLB game', expect: ['fanfare'] },
  { q: 'what MLB teams are playing today', expect: ['fanfare'] },
  { q: 'current MLB standings', expect: ['fanfare'] },
  { q: 'what is the price of ETH right now', expect: ['coingecko', 'coinmarketcap'] },
  { q: 'price of the VIRTUAL token', expect: ['coingecko', 'coinmarketcap'] },
  { q: 'bitcoin market cap and 24 hour volume', expect: ['messari', 'coinmarketcap', 'coingecko'] },
  { q: 'latest market metrics for solana', expect: ['messari', 'coinmarketcap', 'coingecko'] },
  { q: 'total portfolio value of wallet 0xabc', expect: ['zerion', 'zapper', 'nansen', 'yeetful-nansen'] },
  { q: 'what tokens does wallet 0xabc hold', expect: ['zerion', 'zapper', 'nansen', 'yeetful-nansen'] },
  { q: 'ETH balance of 0xabc on base', expect: ['alchemy', 'zerion'] },
  { q: 'recent transactions for wallet 0xabc', expect: ['zerion', 'alchemy', 'nansen', 'yeetful-nansen'] },
  { q: 'smart money flows for USDC', expect: ['nansen', 'yeetful-nansen'] },
  { q: 'estimated monthly rent for 123 Main St, Austin TX', expect: ['rentcast'] },
  { q: 'home value estimate for an address', expect: ['rentcast'] },
  { q: 'status of United flight UA328', expect: ['flightaware', 'amadeus'] },
  { q: 'is flight DL100 delayed today', expect: ['flightaware', 'amadeus'] },
  { q: 'find cheap flights to Tokyo', expect: ['amadeus', 'fanfare'] },
  { q: 'highly rated restaurants near the Eiffel Tower', expect: ['tripadvisor'] },
  { q: 'best hotels in Barcelona', expect: ['tripadvisor', 'amadeus'] },
  { q: 'integral of x squared from 0 to 5', expect: ['wolfram-alpha'] },
  { q: 'what is the derivative of sin of x', expect: ['wolfram-alpha'] },
  { q: 'population of France', expect: ['wolfram-alpha'] },
  { q: 'search the web for the latest news on the Base network', expect: ['tavily', 'exa', 'perplexity'] },
  { q: 'find recent articles about x402 agent payments', expect: ['exa', 'tavily', 'perplexity'] },
  { q: 'what are the top AI agent frameworks in 2026', expect: ['perplexity', 'tavily', 'exa'] },
  { q: 'scrape example.com and summarize the page', expect: ['firecrawl', 'hyperbrowser', 'browserbase'] },
  { q: 'extract the text from this webpage', expect: ['firecrawl', 'hyperbrowser', 'browserbase'] },
  { q: 'transcribe this audio file to text', expect: ['deepgram'] },
  { q: 'find the email address for someone at acme.com', expect: ['hunter'] },
  { q: 'send an SMS text to a phone number', expect: ['stablephone'] },
]

async function main() {
  const catalog = await loadCatalog()
  const endpoints = await loadPlannableEndpoints(catalog.map((s) => s.slug).filter(Boolean))
  if (!JSON_OUT) console.log(`Catalog: ${catalog.length} services · ${endpoints.length} plannable endpoints · ${CASES.length} eval prompts\n`)

  // --keyword evaluates the lexical-only path (pre-R2); default = hybrid (R2).
  const keywordOnly = process.argv.includes('--keyword')
  const results = []
  for (const c of CASES) {
    const shortlist = keywordOnly ? shortlistEndpoints(c.q, endpoints) : await hybridShortlist(c.q, endpoints)
    const slugs = shortlist.map((e) => e.serverSlug)
    const rank = slugs.findIndex((s) => c.expect.includes(s)) // -1 = not surfaced
    results.push({ ...c, rank, top: slugs.slice(0, 5) })
  }
  if (!JSON_OUT) console.log(`Mode: ${keywordOnly ? 'keyword-only' : 'hybrid (keyword + vector)'}\n`)

  const hit = (r: { rank: number }) => r.rank >= 0
  const recallAtK = results.filter(hit).length / results.length
  const recallAt5 = results.filter((r) => r.rank >= 0 && r.rank < 5).length / results.length
  const recallAt1 = results.filter((r) => r.rank === 0).length / results.length
  const mrr = results.reduce((a, r) => a + (r.rank >= 0 ? 1 / (r.rank + 1) : 0), 0) / results.length

  if (JSON_OUT) {
    console.log(JSON.stringify({ recallAtK, recallAt5, recallAt1, mrr, results }, null, 2))
    return
  }

  for (const r of results) {
    const mark = r.rank === 0 ? '✓' : r.rank > 0 ? '~' : '✗'
    console.log(`${mark} [${r.rank < 0 ? 'miss' : `#${r.rank + 1}`}] ${r.q}`)
    if (r.rank !== 0) console.log(`      expect ${r.expect.join('|')} · shortlisted: ${r.top.join(', ')}`)
  }
  const pct = (n: number) => `${Math.round(n * 100)}%`
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`  recall@shortlist: ${pct(recallAtK)}  ·  recall@5: ${pct(recallAt5)}  ·  rank#1: ${pct(recallAt1)}  ·  MRR: ${mrr.toFixed(2)}`)
  console.log(`  (recall@shortlist = right MCP is in the menu the planner sees;`)
  console.log(`   rank#1 = it's the top candidate. Misses → retrieval gap (R2/R3).)`)
  console.log('─'.repeat(60))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
