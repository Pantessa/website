#!/usr/bin/env tsx
/**
 * R1 — capability tagging. LLM-label each MCP service with a controlled domain
 * vocabulary + a few example user queries, so the router matches on MEANING,
 * not just keyword overlap ("transcribe audio" → a service tagged
 * `transcription` with example "transcribe this audio file" → Deepgram).
 *
 * One-time / occasional enrichment (re-run after a big ingest). Uses the
 * Anthropic API directly (ANTHROPIC_API_KEY from .env.local) with Haiku — ~66
 * tiny calls, pennies. Stores into mcp_servers.tags + exampleQueries.
 *
 *   npm run db:tag                 # tag untagged services
 *   npm run db:tag -- --force      # re-tag everything
 *   npm run db:tag -- --limit=5    # first N (testing)
 *   npm run db:tag -- --dry        # preview, no DB write / no API call cost? (still calls API)
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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

const arg = (n: string) => process.argv.find((x) => x.startsWith(`--${n}=`))?.split('=')[1]
const FORCE = process.argv.includes('--force')
const DRY = process.argv.includes('--dry')
const LIMIT = arg('limit') ? Number(arg('limit')) : undefined
const MODEL = 'claude-haiku-4-5-20251001'

// Controlled vocabulary — keep tags consistent so the router can rely on them.
const VOCAB = [
  'crypto-price', 'crypto-market-data', 'onchain-analytics', 'wallet-portfolio', 'defi', 'nft', 'token-research',
  'web-search', 'web-scrape', 'browser-automation', 'news',
  'sports', 'weather', 'flights', 'hotels', 'restaurants', 'travel-planning', 'real-estate', 'maps-location',
  'transcription', 'speech', 'image-generation', 'video', 'media',
  'email', 'sms', 'phone', 'messaging', 'social-media',
  'people-search', 'company-data', 'lead-enrichment',
  'math-compute', 'knowledge-facts', 'governance-dao', 'code-execution', 'captcha', 'storage', 'inference', 'other',
]

interface SvcRow {
  id: string
  slug: string
  name: string
  category: string
  description: string
  endpoints: { url: string; description: string | null }[]
}

async function tag(svc: SvcRow): Promise<{ tags: string[]; examples: string[] } | null> {
  const eps = svc.endpoints
    .slice(0, 16)
    .map((e) => `- ${e.url.replace(/^https?:\/\//, '')}${e.description ? ` — ${e.description}` : ''}`)
    .join('\n')
  const prompt = `You classify an API/MCP service for a routing engine.

Service: ${svc.name}
Category: ${svc.category}
Description: ${svc.description}
Sample endpoints:
${eps || '(none)'}

Choose 1–4 capability tags from THIS controlled vocabulary (exact strings, most-specific first):
${VOCAB.join(', ')}

Then write 3 short, natural user queries this service could answer (the kind a person would type).

Respond with ONLY minified JSON: {"tags":["..."],"examples":["...","...","..."]}`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model: MODEL, max_tokens: 500, messages: [{ role: 'user', content: prompt }] }),
  })
  if (!res.ok) {
    console.warn(`  ${svc.slug}: API ${res.status} ${(await res.text()).slice(0, 120)}`)
    return null
  }
  const data = (await res.json()) as { content?: { text?: string }[] }
  const text = data.content?.[0]?.text ?? ''
  try {
    const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
    const tags = (Array.isArray(json.tags) ? json.tags : []).filter((t: string) => VOCAB.includes(t)).slice(0, 4)
    const examples = (Array.isArray(json.examples) ? json.examples : []).map((s: unknown) => String(s).slice(0, 120)).slice(0, 3)
    return { tags, examples }
  } catch {
    console.warn(`  ${svc.slug}: unparseable → ${text.slice(0, 80)}`)
    return null
  }
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set (.env.local).')
    process.exit(1)
  }
  const prisma = new PrismaClient()
  const where = FORCE ? {} : { tags: { isEmpty: true } }
  const services = await prisma.mcpServer.findMany({
    where,
    take: LIMIT,
    select: { id: true, slug: true, name: true, category: true, description: true, endpoints: { select: { url: true, description: true }, take: 16 } },
  })
  console.log(`Tagging ${services.length} services with ${MODEL}${DRY ? ' (dry — no DB write)' : ''}…\n`)

  let n = 0
  for (const svc of services) {
    const r = await tag(svc as SvcRow)
    if (!r) continue
    console.log(`  ${svc.name.padEnd(20)} → [${r.tags.join(', ')}]  e.g. "${r.examples[0] ?? ''}"`)
    if (!DRY) await prisma.mcpServer.update({ where: { id: svc.id }, data: { tags: r.tags, exampleQueries: r.examples } })
    n++
  }
  console.log(`\n${DRY ? 'Would tag' : 'Tagged'} ${n}/${services.length} services.`)
  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
