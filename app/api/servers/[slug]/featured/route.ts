import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { isAdminAddress } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ slug: string }> }

/**
 * Curate a service's featured ("start here") endpoints. Admin-only (SIWE
 * session in ADMIN_WALLETS/OWNER_WALLETS): the flag steers real routing —
 * the endpoint planner floats featured endpoints to the front of its menu as
 * starting hints, and the connect-time quick view pings them first — so it
 * stays a curated signal, not a public toggle.
 *
 *   PATCH { endpointId, featured: boolean } → { ok, endpointId, featured }
 */
export async function PATCH(req: NextRequest, { params }: Params) {
  const { slug } = await params
  const address = await getSessionAddress()
  if (!isAdminAddress(address)) {
    return NextResponse.json({ error: 'Admin only.' }, { status: address ? 403 : 401 })
  }

  let body: { endpointId?: unknown; featured?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  const endpointId = typeof body.endpointId === 'string' ? body.endpointId : ''
  if (!endpointId || typeof body.featured !== 'boolean') {
    return NextResponse.json({ error: 'endpointId and featured (boolean) required.' }, { status: 400 })
  }

  // Scope the write to this service — an endpoint id from another server 404s
  // instead of silently flagging the wrong row.
  const endpoint = await prisma.mcpEndpoint.findFirst({
    where: { id: endpointId, server: { slug } },
    select: { id: true },
  })
  if (!endpoint) {
    return NextResponse.json({ error: 'Endpoint not found on this service.' }, { status: 404 })
  }

  await prisma.mcpEndpoint.update({ where: { id: endpoint.id }, data: { featured: body.featured } })
  return NextResponse.json({ ok: true, endpointId: endpoint.id, featured: body.featured })
}
