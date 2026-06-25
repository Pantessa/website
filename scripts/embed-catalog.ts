#!/usr/bin/env tsx
/**
 * R2 — embed the MCP catalog for semantic routing. For each endpoint, embed
 * "service (tags). example queries. description path" with OpenAI
 * text-embedding-3-small (1536-dim) and store it in mcp_endpoints.embedding
 * (pgvector). Query-time matching lives in lib/retrieval.ts.
 *
 * Embeddings ≠ inference — this only turns text into vectors for similarity.
 * Chat/answers stay on Claude.
 *
 *   npm run db:embed              # embed endpoints missing a vector
 *   npm run db:embed -- --force   # re-embed everything
 *   npm run db:embed -- --limit=50
 *
 * Needs OPENAI_API_KEY (.env.local). ~pennies for the whole catalog.
 */
import { PrismaClient, Prisma } from '@prisma/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { EMBED_MODEL, embed, endpointText } from '../lib/embeddings'

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

const FORCE = process.argv.includes('--force')
const LIMIT = process.argv.find((x) => x.startsWith('--limit='))?.split('=')[1]

interface Row {
  id: string
  url: string
  description: string | null
  name: string
  tags: string[] | null
  example_queries: string[] | null
  category: string | null
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY not set (.env.local).')
    process.exit(1)
  }
  const prisma = new PrismaClient()
  // Ensure the cosine HNSW index exists (it lives outside the Prisma schema —
  // pgvector ops indexes aren't expressible there — so re-assert it here to
  // self-heal if a `prisma db push` ever drops it).
  await prisma.$executeRawUnsafe(
    'CREATE INDEX IF NOT EXISTS mcp_endpoints_embedding_idx ON mcp_endpoints USING hnsw (embedding vector_cosine_ops)',
  )
  const where = FORCE ? Prisma.empty : Prisma.sql`WHERE e.embedding IS NULL`
  const limit = LIMIT ? Prisma.sql`LIMIT ${Number(LIMIT)}` : Prisma.empty
  const rows = await prisma.$queryRaw<Row[]>`
    SELECT e.id, e.url, e.description, s.name, s.tags, s.example_queries, s.category
    FROM mcp_endpoints e JOIN mcp_servers s ON s.id = e.server_id
    ${where} ORDER BY e.id ${limit}`
  console.log(`Embedding ${rows.length} endpoints with ${EMBED_MODEL}…`)

  const BATCH = 256
  let done = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH)
    const vectors = await embed(batch.map(endpointText))
    // Store each vector (pgvector accepts the '[...]' literal cast to ::vector).
    await Promise.all(
      batch.map((r, j) => {
        const lit = `[${vectors[j].join(',')}]`
        return prisma.$executeRaw`UPDATE mcp_endpoints SET embedding = ${lit}::vector WHERE id = ${r.id}`
      }),
    )
    done += batch.length
    process.stdout.write(`\r  embedded ${done}/${rows.length}…`)
  }
  process.stdout.write('\n')
  console.log(`✅ Embedded ${done} endpoints.`)
  await prisma.$disconnect()
}

// Only run when invoked directly (not when imported by lib/retrieval for embed()).
if (process.argv[1] && process.argv[1].includes('embed-catalog')) {
  main().catch((e) => {
    console.error(e)
    process.exit(1)
  })
}
