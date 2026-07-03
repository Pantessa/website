#!/usr/bin/env tsx
// LIVE end-to-end proof of the free-MCP path, zero spend: DB seed →
// loadPlannableEndpoints (price-0 filter) → buildSmartRequest (tools/call) →
// real fetch against the free MCP → envelope parse. Point the seeded prod
// hosts at local servers via FREE_MCP_URL_OVERRIDES. Run:
//   FREE_MCP_URL_OVERRIDES='{"uniswap-free.yeetful.com":"http://localhost:3261","snapshot-free.yeetful.com":"http://localhost:3262"}' \
//   npx tsx scripts/test-free-mcps-live.ts
import { loadPlannableEndpoints, buildSmartRequest } from '../lib/endpoint-planner'
import prisma from '../lib/db'

function parseEnvelope(raw: string): unknown {
  const line = raw.split('\n').find((l) => l.startsWith('data: '))
  const json = JSON.parse(line ? line.slice(6) : raw) as { result?: { content?: { type: string; text?: string }[]; isError?: boolean } }
  const text = json.result?.content?.filter((c) => c.type === 'text').map((c) => c.text).join('\n') ?? ''
  if (json.result?.isError) throw new Error(text)
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function main() {
  const eps = await loadPlannableEndpoints(['uniswap-free', 'snapshot-free'])
  console.log(`plannable endpoints loaded: ${eps.length} (expect 14 — price-0 filter admits explicit free)`)
  if (eps.length < 14) throw new Error('free endpoints filtered out — check loadPlannableEndpoints')

  const quote = eps.find((e) => e.url.endsWith('#quote'))!
  const built = buildSmartRequest(quote, { sellToken: 'USDC', buyToken: 'WETH', amount: '2' })
  if ('error' in built) throw new Error(built.error)
  console.log(`→ ${built.request.url} tools/call quote (mcp=${built.request.mcp})`)
  const r1 = await fetch(built.request.url, { method: built.request.method, headers: built.request.headers, body: built.request.body })
  if (!r1.ok) throw new Error(`uniswap quote HTTP ${r1.status}`)
  const q = parseEnvelope(await r1.text()) as { buy?: { token: string; amount: string } }
  console.log(`✓ LIVE quote (no 402, no payment): 2 USDC → ${q.buy?.amount} ${q.buy?.token}`)

  const props = eps.find((e) => e.url.endsWith('#list_proposals'))!
  const built2 = buildSmartRequest(props, { first: 2 })
  if ('error' in built2) throw new Error(built2.error)
  const r2 = await fetch(built2.request.url, { method: built2.request.method, headers: built2.request.headers, body: built2.request.body })
  if (!r2.ok) throw new Error(`snapshot HTTP ${r2.status}`)
  const pr = parseEnvelope(await r2.text()) as { proposals?: { title: string; space: { id: string } }[] }
  console.log(`✓ LIVE proposals: ${pr.proposals?.map((p) => `${p.space.id}: ${p.title.slice(0, 40)}`).join(' | ')}`)

  const rows = await prisma.mcpServer.findMany({ where: { gated: false }, select: { slug: true, gated: true, priceUsd: true } })
  console.log(`✓ DB gated flag: ${rows.map((r) => `${r.slug} gated=${r.gated} price=${r.priceUsd}`).join(', ')}`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error('❌', e.message)
  process.exit(1)
})
