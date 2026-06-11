#!/usr/bin/env tsx
/**
 * Ingest the x402 agent directory from agentic.market into Postgres.
 *
 *   npm run db:ingest -- --dry      # fetch + preview, NO DB writes
 *   npm run db:ingest               # upsert into the DB (DATABASE_URL)
 *   npm run db:ingest -- --prune    # also delete agentic.market rows not seen this run
 *
 * Source: https://api.agentic.market/v1/services — the JSON directory API
 * (paginated, ~1100 services). Each service carries name, description, category,
 * networks, per-endpoint USDC pricing, and provider. The markdown feed used
 * previously had no endpoint/price wiring; this API does.
 *
 * NOTE: a service is only marked `callable: true` (wired into the chat
 * orchestrator) when it appears in CALLABLE below. Each callable needs the one
 * right endpoint + query param (http) or tool name (mcp) chosen by hand — the
 * API lists ~26 endpoints per service (GET/POST/path-params) and doesn't say
 * which param carries a free-text query, so callability can't be auto-derived.
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const API_BASE = 'https://api.agentic.market/v1/services'
const PAGE_SIZE = 50

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

// The verified, callable services — enriched with real x402 wiring. These are
// keyed by slug (slugify(name)); the API's names slugify to the same values
// (Tripadvisor → tripadvisor, Wolfram|Alpha → wolfram-alpha), so the override
// lands on the matching row.
const CALLABLE: Record<string, Partial<ParsedService> & { endpoint: string }> = {
  'yeetful-claude': {
    name: 'Yeetful · Claude', category: 'Inference', kind: 'inference',
    endpoint: 'https://anthropic.yeetful.com/api/mcp/mcp', protocol: 'mcp', tool: 'ask_claude',
    priceUsd: '0.005', iconSlug: 'anthropic', color: '#D97757',
    description: 'Anthropic Claude Haiku 4.5 over MCP Streamable HTTP. Pay-per-call, no API key — the default inference engine.',
    websiteUrl: 'https://agentic.market/services/anthropic-yeetful-com',
  },
  // OpenAI-compatible inference via the BlockRun x402 gateway. `tool` carries
  // the gateway model id; exact-priced $0.001/call at chat-sized prompts
  // (probed 2026-06-10: flat to ~2.4K input tokens, 256-token output cap).
  // NOTE: duplicates the wire-inference-providers hunk (PR #33 to main) so an
  // ingest run from this branch can't unwire the four live providers.
  chatgpt: {
    kind: 'inference', endpoint: 'https://blockrun.ai/api/v1/chat/completions',
    protocol: 'http', tool: 'openai/gpt-4o-mini', priceUsd: '0.001',
  },
  deepseek: {
    kind: 'inference', endpoint: 'https://blockrun.ai/api/v1/chat/completions',
    protocol: 'http', tool: 'deepseek/deepseek-chat', priceUsd: '0.001',
  },
  'google-gemini': {
    kind: 'inference', endpoint: 'https://blockrun.ai/api/v1/chat/completions',
    protocol: 'http', tool: 'google/gemini-2.5-flash-lite', priceUsd: '0.001',
  },
  claude: {
    kind: 'inference', endpoint: 'https://blockrun.ai/api/v1/chat/completions',
    protocol: 'http', tool: 'anthropic/claude-haiku-4.5', priceUsd: '0.001',
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

// One row of the mcp_endpoints child table (the full endpoint surface).
interface ParsedEndpoint {
  method: string
  url: string
  description: string | null
  priceUsd: string | null
  maxPriceUsd: string | null
  scheme: string | null
  network: string | null
  provider: string | null
  position: number
  parameters: ApiParameter[] | null
}

// ── agentic.market JSON API shapes (only the fields we read) ─────────────────
interface ApiParameter {
  group?: string // 'query' | 'path' | 'body'
  name?: string
  type?: string
  description?: string
  example?: unknown
  required?: boolean
  enumValues?: unknown[]
  default?: unknown
}
interface ApiEndpoint {
  url: string
  method: string
  description: string
  providerName?: string
  parameters?: ApiParameter[]
  pricing?: {
    amount?: string
    currency?: string
    network?: string
    scheme?: string
    minAmount?: string
    maxAmount?: string
  }
}
interface ApiService {
  id: string
  name: string
  description: string
  category: string
  networks?: string[]
  endpoints?: ApiEndpoint[]
  enriched?: boolean
  priceSummary?: { minAmount?: string; maxAmount?: string; currency?: string }
}
interface ApiPage {
  services: ApiService[]
  total: number
  limit: number
  offset: number
}

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
}

// A bare provider domain (e.g. "orbisapi.com", "wolframalpha.x402.paysponge.com")
// — lowercase, no spaces, ends in a TLD. agentic.market lists ~1000 of these
// raw endpoints alongside the branded services; we skip the ones it hasn't
// enriched or categorized (see toService), keeping the directory brand-quality.
function looksLikeDomain(name: string): boolean {
  const n = name.trim()
  return n === n.toLowerCase() && !/\s/.test(n) && /^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(n)
}

// Friendly network labels: the API mixes "Base" with chain-id forms
// (eip155:8453, solana:<genesis>). Normalize + dedupe.
function normalizeNetwork(n: string): string {
  if (n === 'eip155:8453') return 'Base'
  if (n.startsWith('solana:')) return 'Solana'
  if (n.startsWith('eip155:')) return n // unknown EVM chain — keep as-is
  return n.charAt(0).toUpperCase() + n.slice(1) // "base" → "Base"
}
function normalizeNetworks(nets: string[] = []): string[] {
  return [...new Set(nets.map(normalizeNetwork).filter(Boolean))]
}

// Cheapest USDC price across a service's endpoints (priceSummary first).
function minPrice(s: ApiService): string | null {
  const summary = s.priceSummary?.minAmount
  if (summary && summary.trim()) return summary.trim()
  const amounts = (s.endpoints ?? [])
    .map((e) => Number(e.pricing?.amount))
    .filter((n) => Number.isFinite(n) && n > 0)
  return amounts.length ? String(Math.min(...amounts)) : null
}

function toService(api: ApiService): ParsedService | null {
  const name = api.name?.trim()
  if (!name) return null
  // Skip unbranded provider domains that agentic.market hasn't enriched or
  // categorized — not directory-quality. Enriched/categorized domain brands
  // (e.g. fal.ai) still pass.
  if (looksLikeDomain(name) && !api.enriched && !(api.category ?? '').trim()) return null
  const slug = slugify(name)
  if (!slug) return null
  const category = api.category?.trim() || 'Other'
  return {
    slug,
    name,
    description: api.description?.trim() || `${name} — x402 agent on agentic.market.`,
    category,
    kind: category === 'Inference' ? 'inference' : 'data',
    priceUsd: minPrice(api),
    networks: normalizeNetworks(api.networks),
    callable: false,
    endpoint: null,
    protocol: null,
    tool: null,
    queryParam: null,
    iconSlug: ICON_SLUG[slug] ?? null,
    color: CATEGORY_COLOR[category] ?? CATEGORY_COLOR.Other,
    // The API `id` is the canonical service-page slug on agentic.market.
    websiteUrl: `https://agentic.market/services/${api.id}`,
  }
}

// Normalize a service's endpoint list, deduped by (method, url) so it satisfies
// the mcp_endpoints unique constraint.
function toEndpoints(api: ApiService): ParsedEndpoint[] {
  const out: ParsedEndpoint[] = []
  const seen = new Set<string>()
  let i = 0
  for (const e of api.endpoints ?? []) {
    const url = e.url?.trim()
    if (!url) continue
    const method = (e.method || '').split(',')[0].trim().toUpperCase() || 'GET'
    const key = `${method} ${url}`
    if (seen.has(key)) continue
    seen.add(key)
    const p = e.pricing ?? {}
    const amount = p.amount?.trim() || p.minAmount?.trim() || null
    out.push({
      method,
      url,
      description: e.description?.trim() || null,
      priceUsd: amount,
      maxPriceUsd: p.maxAmount?.trim() || null,
      scheme: p.scheme?.trim() || null,
      network: p.network ? normalizeNetwork(p.network) : null,
      provider: e.providerName?.trim() || null,
      position: i++,
      parameters: cleanParameters(e.parameters),
    })
  }
  return out
}

// Keep only well-formed params (a name + a group we know how to place).
function cleanParameters(params: ApiParameter[] | undefined): ApiParameter[] | null {
  const ok = (params ?? []).filter(
    (p) => p?.name && ['query', 'path', 'body'].includes(p.group ?? ''),
  )
  return ok.length > 0 ? ok : null
}

async function fetchAll(): Promise<ApiService[]> {
  const out: ApiService[] = []
  let offset = 0
  let total = Infinity
  while (offset < total) {
    const url = `${API_BASE}?limit=${PAGE_SIZE}&offset=${offset}`
    const res = await fetch(url, { headers: { Accept: 'application/json' } })
    if (!res.ok) throw new Error(`agentic.market API ${res.status} at offset ${offset}`)
    const page = (await res.json()) as ApiPage
    const services = page.services ?? []
    out.push(...services)
    total = Number.isFinite(page.total) ? page.total : out.length
    if (services.length === 0) break
    offset += PAGE_SIZE
    process.stdout.write(`\r  fetched ${out.length}/${total}…`)
  }
  process.stdout.write('\n')
  return out
}

function build(apiServices: ApiService[]): {
  services: ParsedService[]
  endpoints: Map<string, ParsedEndpoint[]>
} {
  const bySlug = new Map<string, ParsedService>()
  const endpoints = new Map<string, ParsedEndpoint[]>()
  for (const api of apiServices) {
    const svc = toService(api)
    if (!svc || bySlug.has(svc.slug)) continue
    bySlug.set(svc.slug, svc)
    endpoints.set(svc.slug, toEndpoints(api))
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

  return { services: [...bySlug.values()], endpoints }
}

async function main() {
  const dry = process.argv.includes('--dry')
  const prune = process.argv.includes('--prune')
  if (!dry) loadEnv() // load DATABASE_URL from .env.local for live runs

  console.log(`Fetching ${API_BASE} …`)
  const apiServices = await fetchAll()
  const { services, endpoints } = build(apiServices)

  const callable = services.filter((s) => s.callable)
  const byCat = services.reduce<Record<string, number>>((a, s) => ((a[s.category] = (a[s.category] ?? 0) + 1), a), {})
  const totalEndpoints = [...endpoints.values()].reduce((a, e) => a + e.length, 0)

  console.log(`\nParsed ${services.length} services (from ${apiServices.length} API rows), ${totalEndpoints} endpoints`)
  console.log('By category:', byCat)
  console.log('Callable (wired):', callable.map((s) => s.name).join(', '))
  console.log('\nSample:')
  for (const s of services.slice(0, 6)) {
    const ep = endpoints.get(s.slug)?.length ?? 0
    console.log(`  • ${s.name} [${s.category}] $${s.priceUsd ?? '—'} ${s.networks.join('/')} · ${ep} endpoints${s.callable ? ' ⚡callable' : ''}`)
  }

  if (dry) {
    console.log('\n(dry run — no DB writes)')
    return
  }

  const prisma = new PrismaClient()
  const runStart = new Date()
  console.log('\nUpserting into DB…')
  let n = 0
  let epWritten = 0
  for (const s of services) {
    const saved = await prisma.mcpServer.upsert({
      where: { slug: s.slug },
      update: { ...s, lastSeenAt: new Date() },
      create: s,
    })
    n++
    // Replace this service's endpoint surface (cascade-owned child rows).
    const eps = endpoints.get(s.slug) ?? []
    await prisma.mcpEndpoint.deleteMany({ where: { serverId: saved.id } })
    if (eps.length) {
      await prisma.mcpEndpoint.createMany({
        // Json? fields reject plain null — omit `parameters` for DB NULL.
        data: eps.map(({ parameters, ...e }) => ({
          ...e,
          serverId: saved.id,
          ...(parameters ? { parameters: parameters as object[] } : {}),
        })),
        skipDuplicates: true,
      })
      epWritten += eps.length
    }
  }
  console.log(`✅ Upserted ${n} services, ${epWritten} endpoints.`)

  if (prune) {
    // Drop agentic.market rows not refreshed this run (stale listings).
    const { count } = await prisma.mcpServer.deleteMany({
      where: { source: 'agentic.market', lastSeenAt: { lt: runStart } },
    })
    console.log(`🧹 Pruned ${count} stale services.`)
  }

  await prisma.$disconnect()
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
