// GET /api/tenants/:id/statement?ym=YYYY-MM — the tenant's monthly statement
// (BLOTTER lane, five-million; the math is lib/tenant/statement). SIWE
// owner/admin; 404 otherwise. `ym` defaults to the last closed month.
//
// With the `statement` entitlement (the owner's EFFECTIVE plan): a closed month
// is cut once — one `statement` row on the blotter, and a DRAFT Stripe invoice
// when Stripe is configured and the owner has a customer (never finalized, never
// sent). Without it: the same numbers, `preview: true`, nothing cut or drafted.
import { NextRequest, NextResponse } from 'next/server'
import { getSessionAddress } from '@/lib/auth'
import { getEffectivePlan } from '@/lib/billing'
import { entitlementsFor } from '@/lib/tenant/entitlements'
import { tenantForAdmin } from '@/lib/tenant/blotter'
import { YM_RE, lastClosedMonth, monthlyStatement } from '@/lib/tenant/statement'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const tenant = await tenantForAdmin(id, addr).catch(() => null)
  if (!tenant) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  const ym = req.nextUrl.searchParams.get('ym') ?? lastClosedMonth()
  if (!YM_RE.test(ym)) return NextResponse.json({ error: 'ym must be YYYY-MM' }, { status: 400 })

  const { plan } = await getEffectivePlan(tenant.ownerAddress)
  const entitled = entitlementsFor(plan.id).statement
  try {
    const statement = await monthlyStatement(tenant.id, ym, { cut: entitled })
    if (!statement) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    return NextResponse.json(
      {
        plan: plan.id,
        preview: !entitled,
        ...(entitled ? {} : { entitlement: 'statement', note: `The tenant owner's plan (${plan.id}) does not include the monthly statement: these are the numbers, nothing was cut or invoiced.` }),
        statement,
      },
      { headers: { 'cache-control': 'no-store' } },
    )
  } catch (err) {
    console.error('[statement] failed', tenant.id, ym, (err as Error)?.message ?? err)
    return NextResponse.json({ error: 'The statement could not be computed; try again.' }, { status: 503 })
  }
}
