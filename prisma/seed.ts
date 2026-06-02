import { PrismaClient } from '@prisma/client'
import { CATALOG } from '../lib/mcp-data'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding x402 MCP directory...')

  for (const s of CATALOG) {
    const data = {
      name: s.name,
      slug: s.slug,
      description: s.description,
      iconUrl: s.iconUrl,
      category: s.category,
      websiteUrl: s.websiteUrl,
      color: s.color,
      isDefault: s.isDefault,
      isCustom: s.isCustom,
      configSchema: s.configSchema ?? undefined,
      kind: s.kind ?? null,
      protocol: s.protocol ?? null,
      endpoint: s.endpoint ?? null,
      tool: s.tool ?? null,
      queryParam: s.queryParam ?? null,
      priceUsd: s.priceUsd ?? null,
      network: s.network ?? null,
      callable: s.callable ?? false,
    }
    await prisma.mcpServer.upsert({
      where: { slug: s.slug },
      update: data,
      create: data,
    })
  }

  // Remove any legacy non-x402 defaults from earlier seeds.
  const keep = CATALOG.map((s) => s.slug)
  const removed = await prisma.mcpServer.deleteMany({
    where: { isDefault: true, slug: { notIn: keep } },
  })

  console.log(`✅ Seeded ${CATALOG.length} x402 servers, removed ${removed.count} legacy defaults`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
