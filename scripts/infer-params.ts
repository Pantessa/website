#!/usr/bin/env tsx
/**
 * infer-params.ts — recover callability for POST endpoints that agentic.market
 * never published a param schema for, by INFERRING the schema with Claude.
 *
 * agentic.market simply doesn't carry schemas for these, so a re-fetch recovers
 * nothing. Instead we infer {group,name,type,required,example} from the URL +
 * description + service, and write it to mcp_endpoints.parameters IN PLACE
 * (preserving ids → harness_results / spend_ledger / prices all survive).
 * Every touched row is stamped params_source='inferred' so it's auditable and
 * trivially reversible:  UPDATE mcp_endpoints SET parameters=NULL WHERE params_source='inferred'
 *
 * Target set (high confidence — params are the ONLY blocker):
 *   method=POST · parameters IS NULL · exact-priced <= $0.05 · latest harness
 *   probe = alive_402_priced (gateway 402s before param validation = reachable).
 *
 * NO payment. Uses ANTHROPIC_API_KEY (Haiku — pennies).
 *
 * Usage:
 *   npx tsx scripts/infer-params.ts                  # dry preview (no writes)
 *   npx tsx scripts/infer-params.ts --apply          # write inferred schemas
 *   npx tsx scripts/infer-params.ts --service=Heurist --limit=5
 *   npx tsx scripts/infer-params.ts --concurrency=5
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.split('=')[1]
const has = (k: string) => process.argv.includes(`--${k}`)
const APPLY = has('apply')
const LIMIT = arg('limit') ? parseInt(arg('limit')!, 10) : undefined
const SERVICE = arg('service')
// RR20: GET endpoints can be schema-less too (wolfram/rentcast — the planner
// infers keys at runtime, but STORED schemas raise menu quality + the lint
// schema score). Default stays POST-only; opt into GETs with --methods=GET.
const METHODS = (arg('methods') ?? 'POST').split(',').map((m) => m.trim().toUpperCase()).filter((m) => m === 'GET' || m === 'POST')
// Skip the harness-liveness gate for endpoints that have never been probed —
// use ONLY when liveness was just verified another way (e.g. mcp:lint's probe).
const NO_HEALTH = has('no-health')
const CONCURRENCY = arg('concurrency') ? parseInt(arg('concurrency')!, 10) : 5
const MODEL = 'claude-haiku-4-5-20251001'

interface Param {
  name: string
  type: string
  group: string
  default: null
  example: unknown
  required: boolean
  enumValues: unknown[]
  description: string
}

interface Target {
  id: string
  url: string
  method: string
  service: string
  category: string | null
  svcDesc: string | null
  epDesc: string | null
}

const GROUPS = new Set(['body', 'query', 'path'])
const TYPES = new Set(['string', 'number', 'boolean', 'array', 'object'])

const AUTH_PARAM_RE = /^(api[-_]?key|appid|app[-_]?id|token|secret|auth|key)$/i

function normalize(arr: unknown): Param[] {
  if (!Array.isArray(arr)) return []
  const out: Param[] = []
  for (const p of arr as Record<string, unknown>[]) {
    const name = typeof p?.name === 'string' ? p.name.trim() : ''
    if (!name) continue
    // Auth params are the gateway's job (the x402 challenge IS the auth) — an
    // inferred required apikey makes every call unconstructable. Drop them.
    if (AUTH_PARAM_RE.test(name)) continue
    out.push({
      name,
      type: TYPES.has(p?.type as string) ? (p.type as string) : 'string',
      group: GROUPS.has(p?.group as string) ? (p.group as string) : 'body',
      default: null,
      example: p?.example ?? null,
      required: !!p?.required,
      enumValues: [],
      description: typeof p?.description === 'string' ? p.description : '',
    })
    if (out.length >= 8) break
  }
  // At most ONE required param (the primary input): over-strict required flags
  // make natural queries UNconstructable — the request builder refuses on any
  // missing required, so a second "required" param strictly reduces coverage.
  let seenRequired = false
  for (const p of out) {
    if (p.required && seenRequired) p.required = false
    else if (p.required) seenRequired = true
  }
  return out
}

function extractJsonArray(text: string): unknown {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end < start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

async function infer(t: Target, key: string): Promise<Param[]> {
  const prompt = `You infer the request parameter schema for ONE x402 MCP API endpoint, for a routing engine that will fill the params and call it.

Service: ${t.service}${t.category ? ` (${t.category})` : ''}
${t.svcDesc ? `Service purpose: ${t.svcDesc}\n` : ''}Endpoint: ${t.method} ${t.url}
Endpoint description: ${t.epDesc || '(none)'}

Output ONLY a JSON array of the parameters this ${t.method} endpoint accepts. Each item:
{"group":"body"|"query"|"path","name":"<param>","type":"string"|"number"|"boolean"|"array"|"object","required":true|false,"example":<example value>,"description":"<short>"}

Rules:
- Infer from the URL path, the description, and how comparable x402/MCP services work.
- ${t.method === 'GET' ? 'A GET endpoint takes QUERY params (group:"query") — usually ONE primary input (e.g. "i","q","query","address","zipCode","city"). Mark it required:true.' : 'Most MCP/agent endpoints take ONE primary BODY input (e.g. "query","input","prompt","message","address","symbol","url"). Mark that primary input required:true.'}
- Add a path param for any {token} or :token in the URL (group:"path", required:true).
- Prefer fewer, correct params over many guesses. Max 8. Give a realistic "example" for each.
- If you cannot confidently infer ANY parameter, output [].
- Output the JSON array and nothing else.`

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 700, messages: [{ role: 'user', content: prompt }] }),
    })
    if (!res.ok) {
      console.error(`  ! ${t.service} ${t.url} -> HTTP ${res.status}`)
      return []
    }
    const j = (await res.json()) as { content?: { text?: string }[] }
    const text = j?.content?.[0]?.text ?? ''
    return normalize(extractJsonArray(text))
  } catch (e: unknown) {
    console.error(`  ! ${t.service} ${t.url} -> ${(e as Error)?.message}`)
    return []
  }
}

async function main() {
  loadEnv()
  const key = process.env.ANTHROPIC_API_KEY
  if (!process.env.DATABASE_URL || !key) {
    console.error('Need DATABASE_URL and ANTHROPIC_API_KEY in website/.env.local. Aborting.')
    process.exit(1)
  }
  const prisma = new PrismaClient()

  // additive provenance column (idempotent)
  await prisma.$executeRawUnsafe(`ALTER TABLE mcp_endpoints ADD COLUMN IF NOT EXISTS params_source text`)

  const svcFilter = SERVICE ? `AND s.name ILIKE '%${SERVICE.replace(/'/g, "''")}%'` : ''
  const targets = await prisma.$queryRawUnsafe<Target[]>(`
    WITH latest AS (
      SELECT DISTINCT ON (endpoint_id) endpoint_id, status
      FROM harness_results ORDER BY endpoint_id, probed_at DESC
    )
    SELECT e.id, e.url, e.method AS method, s.name AS service, s.category AS category,
           s.description AS "svcDesc", e.description AS "epDesc"
    FROM mcp_endpoints e
    JOIN mcp_servers s ON s.id = e.server_id
    ${NO_HEALTH ? '' : 'JOIN latest l ON l.endpoint_id = e.id'}
    WHERE e.method IN (${METHODS.map((m) => `'${m}'`).join(',')}) AND e.parameters IS NULL
      AND e.scheme IS DISTINCT FROM 'upto'
      AND e.price_usd ~ '^[0-9]+(\\.[0-9]+)?$'
      AND e.price_usd::numeric > 0 AND e.price_usd::numeric <= 0.05
      ${NO_HEALTH ? '' : "AND l.status = 'alive_402_priced'"}
      ${svcFilter}
    ORDER BY s.name, e.url
  `)

  let work = targets
  if (LIMIT) work = work.slice(0, LIMIT)
  console.log(`Inferring params for ${work.length} ${METHODS.join('/')} endpoints · model ${MODEL} · apply=${APPLY}\n`)

  let inferred = 0,
    empty = 0,
    written = 0
  const samples: string[] = []

  let idx = 0
  async function worker() {
    while (idx < work.length) {
      const t = work[idx++]
      const params = await infer(t, key!)
      if (params.length === 0) {
        empty++
        continue
      }
      inferred++
      if (samples.length < 8) {
        samples.push(`  ${t.service}  ${t.url.replace(/^https?:\/\//, '')}\n    -> ${params.map((p) => `${p.name}(${p.group}${p.required ? ',req' : ''})`).join(', ')}`)
      }
      if (APPLY) {
        await prisma.$executeRawUnsafe(
          `UPDATE mcp_endpoints SET parameters = $1::jsonb, params_source = 'inferred' WHERE id = $2`,
          JSON.stringify(params),
          t.id,
        )
        written++
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))

  console.log(`\n=== inference summary ===`)
  console.log(`  schema inferred : ${inferred}`)
  console.log(`  no confident schema : ${empty}`)
  console.log(`  written : ${APPLY ? written : '0 (dry run)'}`)
  console.log(`\nsamples:\n${samples.join('\n')}`)
  if (!APPLY) console.log(`\n(dry run — re-run with --apply to write)`)

  await prisma.$disconnect()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
