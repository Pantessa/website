// GET /api/tenants/:id/blotter/verify — replay the tenant's chain from seq 1
// (BLOTTER lane, five-million): every seq in order, every prev_hash naming the
// row before it, every hash recomputing from its row (lib/tenant/spec
// blotterHash), every typed column matching the hashed ledger. Answers
// `{ ok, rows, brokenAt?, reason?, head }`. SIWE owner/admin; 404 otherwise.
import { NextResponse } from 'next/server'
import { getSessionAddress } from '@/lib/auth'
import { tenantForAdmin, verifyChain } from '@/lib/tenant/blotter'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const tenant = await tenantForAdmin(id, addr).catch(() => null)
  if (!tenant) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  try {
    const v = await verifyChain(tenant.id)
    return NextResponse.json({ tenant: { id: tenant.id, slug: tenant.slug }, ...v }, { headers: { 'cache-control': 'no-store' } })
  } catch (err) {
    console.error('[blotter] verify failed', tenant.id, (err as Error)?.message ?? err)
    return NextResponse.json({ error: 'The blotter could not be read; try again.' }, { status: 503 })
  }
}
