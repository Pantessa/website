#!/usr/bin/env tsx
/**
 * Ingest the featured x402 agent directory from agentic.market into Postgres.
 *
 *   npm run db:ingest -- --dry   # parse + preview, NO DB writes
 *   npm run db:ingest            # upsert into the DB (DATABASE_URL)
 *
 * Source: https://agentic.market/api/markdown — the featured listing as
 * category tables (Inference, Data, Search, Media, …). We parse name,
 * description, min price, networks, and category for each, then enrich the
 * three verified/callable services with their real x402 endpoints.
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const MARKDOWN_URL = 'https://agentic.market/api/markdown'

// Simple Icons brand slugs for recognizable services → monochrome glyph.
const ICON_SLUG: Record<string, string> = {
  claude: 'anthropic', 'yeetful-claude': 'anthropic', anthropic: 'anthropic',
  chatgpt: 'openai', openai: 'openai', deepseek: 'deepseek', 'google-gemini': 'googlegemini',
  groq: 'groq', venice: 'venice', hyperbolic: 'nvidia', perplexity: 'perplexity', exa: 'exa',
  tavily: 'tavily', firecrawl: 'firecrawl', tripadvisor: 'tripadvisor', 'wolfram-alpha': 'wolframmathematica',
  coingecko: 'coingecko', coinmarketcap: 'coinmarketcap', messari: 'messari', 'the-graph': 'thegraph',
  nansen: 'nansen', zapper: 'zapper', alchemy: 'alchemy', deepgram: 'deepgram', 'fal-ai': 'fal',
  cloudflare: 'cloudflare', solana: 'solana',
}

const CATEGORY_COLOR: Record<string, string> = {
  Inference: '#D97757', Data: '#34E0A1', Search: '#6AA8FF', Media: '#E84142',
  Social: '#3861FB', Trading: '#8DC63F', Infra: '#F59E0B', Storage: '#0BA5EC',
  Travel: '#34E0A1', Other: '#8B8B8B',
}

// The verified, callable services — enriched with real x402 wiring.
const CALLABLE: Record<string, Partial<ParsedService> & { endpoint: string }> = {
  'yeetful-claude': {
    name: 'Yeetful · Claude', category: 'Inference', kind: 'inference',
    endpoint: 'https://anthropic.yeetful.com/api/mcp/mcp', protocol: 'mcp', tool: 'ask_claude',
    priceUsd: '0.01', iconSlug: 'anthropic', color: '#D97757',
    description: 'Anthropic Claude Haiku 4.5 over MCP Streamable HTTP. Pay-per-call, no API key — the default inference engine.',
    websiteUrl: 'https://agentic.market/services/anthropic-yeetful-com',
  },
  tripadvisor: {
    endpoint: 'https://tripadvisor.x402.paysponge.com/api/v1/location/search', protocol: 'http',
    queryParam: 'searchQuery', priceUsd: '0.01', iconSlug: 'tripadvisor',
  },
  'wolfram-alpha': {
    endpoint: 'https://wolframalpha.x402.paysponge.com/v1/result', protocol: 'http',
    queryParam: 'i', priceUsd: '0.01', iconSlug: 'wolframmathematica',
  },
}

interface ParsedService {
  slug: string
  name: string
  description: string
  category: string
  kind: string
  priceUsd: string | null
  networks: string[]
  callable: boolean
  endpoint: string | null
  protocol: string | null
  tool: string | null
  queryParam: string | null
  iconSlug: string | null
  color: string | null
  websiteUrl: string | null
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

function minPrice(priceStr: string): string | null {
  const nums = [...priceStr.matchAll(/\$([0-9]+(?:\.[0-9]+)?)/g)].map((m) => Number(m[1]))
  return nums.length ? String(Math.min(...nums)) : null
}

// A bare hostname row (e.g. "api.exa.ai") — a provider detail, not a brand. Skip.
function isHostnameRow(name: string): boolean {
  return name === name.toLowerCase() && (name.match(/\./g)?.length ?? 0) >= 2
}

function parse(md: string): ParsedService[] {
  const bySlug = new Map<string, ParsedService>()
  let category: string | null = null
  for (const line of md.split('\n')) {
    const cat = line.match(/^###\s+(.+?)\s*$/)
    if (cat) {
      category = cat[1].trim()
      continue
    }
    if (!category) continue
    const row = line.match(/^\|\s*\*\*(.+?)\*\*\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*(.*?)\s*\|\s*$/)
    if (!row) continue
    const name = row[1].trim()
    if (isHostnameRow(name)) continue
    const slug = slugify(name)
    if (!slug || bySlug.has(slug)) continue

    const description = row[2].trim() || `${name} — x402 agent on agentic.market.`
    const networks = row[4].split(',').map((s) => s.trim()).filter((s) => s && s !== '—')
    const kind = category === 'Inference' ? 'inference' : 'data'

    bySlug.set(slug, {
      slug, name, description, category, kind,
      priceUsd: minPrice(row[3]),
      networks,
      callable: false, endpoint: null, protocol: null, tool: null, queryParam: null,
      iconSlug: ICON_SLUG[slug] ?? null,
      color: CATEGORY_COLOR[category] ?? null,
      websiteUrl: `https://agentic.market/services/${slug}`,
    })
  }

  // Enrich the verified callable services (add yeetful-claude if absent).
  for (const [slug, over] of Object.entries(CALLABLE)) {
    const base = bySlug.get(slug) ?? {
      slug, name: over.name ?? slug, description: over.description ?? '',
      category: over.category ?? 'Data', kind: over.kind ?? 'data',
      priceUsd: null, networks: ['Base'], callable: false, endpoint: null,
      protocol: null, tool: null, queryParam: null, iconSlug: null, color: null, websiteUrl: null,
    }
    bySlug.set(slug, { ...base, ...over, callable: true })
  }

  return [...bySlug.values()]
}

async function main() {
  const dry = process.argv.includes('--dry')
  // load DATABASE_URL from .env.local for live runs
  if (!dry) loadEnv()

  console.log(`Fetching ${MARKDOWN_URL} …`)
  const md = await fetch(MARKDOWN_URL).then((r) => r.text())
  const services = parse(md)

  const callable = services.filter((s) => s.callable)
  const byCat = services.reduce<Record<string, number>>((a, s) => ((a[s.category] = (a[s.category] ?? 0) + 1), a), {})

  console.log(`\nParsed ${services.length} services`)
  console.log('By category:', byCat)
  console.log('Callable (wired):', callable.map((s) => s.name).join(', '))
  console.log('\nSample:')
  for (const s of services.slice(0, 6)) {
    console.log(`  • ${s.name} [${s.category}] $${s.priceUsd ?? '—'} ${s.networks.join('/')}${s.callable ? ' ⚡callable' : ''}`)
  }

  if (dry) {
    console.log('\n(dry run — no DB writes)')
    return
  }

  const prisma = new PrismaClient()
  console.log('\nUpserting into DB…')
  let n = 0
  for (const s of services) {
    await prisma.mcpServer.upsert({
      where: { slug: s.slug },
      update: { ...s, lastSeenAt: new Date() },
      create: s,
    })
    n++
  }
  await prisma.$disconnect()
  console.log(`✅ Upserted ${n} services.`)
}

function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    try {
      for (const line of readFileSync(join(process.cwd(), file), 'utf8').split('\n')) {
        const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/)
        if (m && !line.trimStart().startsWith('#') && !(m[1] in process.env)) {
          process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
        }
      }
    } catch {
      /* no env file */
    }
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
