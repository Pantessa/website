import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ slug: string }> }

/**
 * Service detail: a single directory service plus its full x402 endpoint
 * surface (the mcp_endpoints child table), ordered for display. Endpoints live
 * only in the DB, so this route is DB-only — no static catalog fallback.
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { slug } = await params
  try {
    const server = await prisma.mcpServer.findUnique({
      where: { slug },
      include: { endpoints: { orderBy: { position: 'asc' } } },
    })
    if (!server) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    return NextResponse.json(server)
  } catch (error) {
    console.warn('server detail: DB query failed:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Unavailable.' }, { status: 503 })
  }
}
