import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { CATALOG } from '@/lib/mcp-data'

/**
 * The Postgres-backed server registry is OPTIONAL. By default the app serves
 * the curated in-code x402 catalog (`lib/mcp-data.ts`) and never touches the DB.
 *
 * To use Postgres instead (custom servers, persistence), set `USE_DB=true` in
 * the environment and run the Prisma migrations (`npm run db:push && db:seed`).
 * All the Prisma code below stays intact for that path.
 */
function dbEnabled(): boolean {
  return process.env.USE_DB === 'true' && !!process.env.DATABASE_URL
}

export async function GET() {
  if (!dbEnabled()) {
    // No DB: the curated catalog IS the source of truth.
    return NextResponse.json(CATALOG)
  }
  try {
    const servers = await prisma.mcpServer.findMany({
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    })
    return NextResponse.json(servers)
  } catch (error) {
    // DB configured but unreachable / out of sync → fall back to the catalog.
    console.warn('servers: DB query failed, serving static catalog:', error instanceof Error ? error.message : error)
    return NextResponse.json(CATALOG)
  }
}

export async function POST(req: NextRequest) {
  if (!dbEnabled()) {
    return NextResponse.json(
      { error: 'Custom servers require the database. Set USE_DB=true and run the Prisma migrations.' },
      { status: 503 },
    )
  }
  try {
    const body = await req.json()
    const { name, description, iconUrl, category, websiteUrl, docsUrl, color, configSchema } = body

    if (!name || !description || !category) {
      return NextResponse.json(
        { error: 'name, description, and category are required' },
        { status: 400 }
      )
    }

    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')

    const server = await prisma.mcpServer.create({
      data: {
        name,
        slug: `${slug}-${Date.now()}`,
        description,
        iconUrl: iconUrl || null,
        category,
        websiteUrl: websiteUrl || null,
        docsUrl: docsUrl || null,
        color: color || '#555555',
        isDefault: false,
        isCustom: true,
        configSchema: configSchema || null,
      },
    })

    return NextResponse.json(server, { status: 201 })
  } catch (error) {
    console.error('Failed to create server:', error)
    return NextResponse.json({ error: 'Failed to create server' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  if (!dbEnabled()) {
    return NextResponse.json(
      { error: 'Custom servers require the database. Set USE_DB=true and run the Prisma migrations.' },
      { status: 503 },
    )
  }
  try {
    const { searchParams } = new URL(req.url)
    const id = searchParams.get('id')
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

    await prisma.mcpServer.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete server:', error)
    return NextResponse.json({ error: 'Failed to delete server' }, { status: 500 })
  }
}
