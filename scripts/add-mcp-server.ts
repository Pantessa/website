/**
 * Add a new MCP server row to the mcp_servers table.
 *
 * Usage (tsx):
 *   pnpm tsx scripts/add-mcp-server.ts ./path/to/server.json
 *   pnpm tsx scripts/add-mcp-server.ts '{"name":"Vercel",...}'
 *
 * The JSON payload uses the same shape as POST /api/servers and prisma/seed.ts.
 * Required: name, description, category.
 * Optional: slug, iconUrl, websiteUrl, docsUrl, color, isDefault, configSchema.
 *
 * Reads DATABASE_URL from .env.local (loaded by Prisma automatically).
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync, existsSync } from 'node:fs'

const prisma = new PrismaClient()

type Input = {
  name: string
  description: string
  category: string
  slug?: string
  iconUrl?: string | null
  websiteUrl?: string | null
  docsUrl?: string | null
  color?: string | null
  isDefault?: boolean
  configSchema?: Record<string, { type: string; label: string; required: boolean }> | null
}

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

async function main() {
  const arg = process.argv[2]
  if (!arg) {
    console.error('usage: pnpm tsx scripts/add-mcp-server.ts <file.json | json-string>')
    process.exit(2)
  }

  const raw = existsSync(arg) ? readFileSync(arg, 'utf8') : arg
  let input: Input
  try {
    input = JSON.parse(raw) as Input
  } catch (err) {
    console.error('invalid JSON:', (err as Error).message)
    process.exit(2)
  }

  if (!input.name || !input.description || !input.category) {
    console.error('name, description, and category are required')
    process.exit(2)
  }

  const slug = input.slug ?? slugify(input.name)

  const server = await prisma.mcpServer.upsert({
    where: { slug },
    update: {
      name: input.name,
      description: input.description,
      category: input.category,
      iconUrl: input.iconUrl ?? null,
      websiteUrl: input.websiteUrl ?? null,
      docsUrl: input.docsUrl ?? null,
      color: input.color ?? null,
      isDefault: input.isDefault ?? false,
      isCustom: !(input.isDefault ?? false),
      configSchema: input.configSchema ?? undefined,
    },
    create: {
      name: input.name,
      slug,
      description: input.description,
      category: input.category,
      iconUrl: input.iconUrl ?? null,
      websiteUrl: input.websiteUrl ?? null,
      docsUrl: input.docsUrl ?? null,
      color: input.color ?? null,
      isDefault: input.isDefault ?? false,
      isCustom: !(input.isDefault ?? false),
      configSchema: input.configSchema ?? undefined,
    },
  })

  console.log('upserted mcp_server:', { id: server.id, slug: server.slug, name: server.name })
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
