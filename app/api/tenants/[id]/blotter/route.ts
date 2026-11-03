// GET /api/tenants/:id/blotter — a tenant's hash-chained blotter (BLOTTER lane,
// five-million). SIWE: the tenant's owner or one of its admins; anyone else gets
// 404 (a tenant id never confirms itself).
//
//   ?from=YYYY-MM-DD|ISO  ?to=YYYY-MM-DD|ISO (a date-only `to` covers that day)
//   ?kind=signed,settled  ?after=<seq> (page from)  ?limit=1..1000 (csv: ..10000)
//   ?format=json|csv      csv needs the `blotterExport` entitlement of the
//                         owner's EFFECTIVE plan (lib/billing getEffectivePlan)
//
// The CSV is the auditor's copy: every column, prev_hash + hash, and the payload
// as the canonical JSON the hash covers — replayable with lib/tenant/spec
// blotterHash alone. Never cached: the chain grows with every desk event.
import { NextRequest, NextResponse } from 'next/server'
import { getSessionAddress } from '@/lib/auth'
import { getEffectivePlan } from '@/lib/billing'
import { entitlementsFor } from '@/lib/tenant/entitlements'
import { blotterCsv, blotterHead, parseBlotterQuery, readBlotterRows, rowJson, tenantForAdmin } from '@/lib/tenant/blotter'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const tenant = await tenantForAdmin(id, addr).catch(() => null)
  if (!tenant) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  const parsed = parseBlotterQuery(req.nextUrl.searchParams)
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 })
  const q = parsed.query

  if (q.format === 'csv') {
    const { plan } = await getEffectivePlan(tenant.ownerAddress)
    if (!entitlementsFor(plan.id).blotterExport) {
      return NextResponse.json(
        { error: `CSV export needs the blotterExport entitlement; the tenant owner's plan (${plan.id}) does not include it. The JSON read and /blotter/verify stay open.`, entitlement: 'blotterExport', plan: plan.id },
        { status: 403 },
      )
    }
  }

  let rows
  try {
    rows = await readBlotterRows(tenant.id, q)
  } catch (err) {
    console.error('[blotter] read failed', tenant.id, (err as Error)?.message ?? err)
    return NextResponse.json({ error: 'The blotter could not be read; try again.' }, { status: 503 })
  }
  const next = rows.length === q.limit ? rows[rows.length - 1].seq : null

  if (q.format === 'csv') {
    const name = `blotter-${tenant.slug}${q.from ? `-from-${q.from.toISOString().slice(0, 10)}` : ''}${q.to ? `-to-${q.to.toISOString().slice(0, 10)}` : ''}.csv`
    return new NextResponse(blotterCsv(rows), {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${name}"`,
        'cache-control': 'no-store',
        ...(next !== null ? { 'x-blotter-next': String(next) } : {}),
      },
    })
  }
  const head = await blotterHead(tenant.id).catch(() => null)
  return NextResponse.json(
    { tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name }, head, rows: rows.map(rowJson), next },
    { headers: { 'cache-control': 'no-store' } },
  )
}
