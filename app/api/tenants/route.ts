// /api/tenants — create and list governed desks (TENANT lane, five-million).
//
// SIWE only: a tenant is created by a wallet that proved itself in the
// browser, and that wallet OWNS it (admins = tenant.admins ∪ owner). How many
// tenants an owner may run is the owner's EFFECTIVE plan's call
// (lib/tenant/entitlements via lib/billing getEffectivePlan), never a client
// claim; a new tenant starts in the sandbox unless that plan includes mainnet.
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { isInternalRun } from '@/lib/internal-run'
import { TENANT_SLUG_RE } from '@/lib/tenant/spec'
import { capAllows, cheapestPlanForCap, entitlementsJson, ownerPlanId, planName, tenantView } from '@/lib/tenant/store'
import { entitlementsFor } from '@/lib/tenant/entitlements'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** The tenants this wallet owns or administers. */
export async function GET() {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const rows = await prisma.tenant.findMany({
    where: { OR: [{ ownerAddress: addr }, { admins: { array_contains: [addr] } }] },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  const plan = await ownerPlanId(addr)
  const owned = rows.filter((t) => t.ownerAddress.toLowerCase() === addr).length
  const ent = entitlementsFor(plan)
  return NextResponse.json({ tenants: rows.map(tenantView), plan, entitlements: entitlementsJson(ent), owned, canCreate: capAllows(plan, 'tenants', owned) })
}

/** Create a tenant: { slug, name }. */
export async function POST(req: NextRequest) {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>

  const slug = typeof body.slug === 'string' ? body.slug.trim().toLowerCase() : ''
  if (!TENANT_SLUG_RE.test(slug)) {
    return NextResponse.json({ error: 'slug must be 3–32 characters: lowercase letters, digits and dashes, starting and ending with a letter or digit.', field: 'slug' }, { status: 400 })
  }
  const name = typeof body.name === 'string' ? body.name.replace(/\s+/g, ' ').trim().slice(0, 80) : ''
  if (!name) return NextResponse.json({ error: 'name is required (the firm or desk name admins will read).', field: 'name' }, { status: 400 })

  const plan = await ownerPlanId(addr)
  const ent = entitlementsFor(plan)
  const owned = await prisma.tenant.count({ where: { ownerAddress: addr } })
  if (!capAllows(plan, 'tenants', owned)) {
    const upgrade = cheapestPlanForCap('tenants', owned + 1)
    return NextResponse.json(
      {
        error: `Your ${plan} plan includes ${ent.tenants} tenant${ent.tenants === 1 ? '' : 's'}, and you already own ${owned}. ${owned + 1} tenants need ${planName(upgrade)}.`,
        entitlement: 'tenants',
        limit: Number.isFinite(ent.tenants) ? ent.tenants : null,
        plan,
        upgrade,
      },
      { status: 403 },
    )
  }
  if (await prisma.tenant.findUnique({ where: { slug }, select: { id: true } })) {
    return NextResponse.json({ error: `The slug "${slug}" is taken — pick another.`, field: 'slug' }, { status: 409 })
  }
  try {
    const tenant = await prisma.tenant.create({
      data: {
        slug,
        name,
        ownerAddress: addr,
        admins: [],
        plan,
        sandbox: !ent.mainnet,
        isInternal: isInternalRun(req.headers, body),
      },
    })
    return NextResponse.json(
      {
        tenant: tenantView(tenant),
        entitlements: entitlementsJson(ent),
        next: [
          `POST /api/tenants/${tenant.id}/policy with a default-deny policy document (venues × chains × ops × tokens × size, one or more desks).`,
          ent.approvals ? 'A second admin approves it (maker-checker), and it becomes ACTIVE.' : 'Approve it yourself (your plan has no maker-checker), and it becomes ACTIVE.',
          `POST /api/tenants/${tenant.id}/keys { deskId } mints a dk_ desk key an agent presents at /api/broker/mcp.`,
        ],
      },
      { status: 201 },
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (/Unique constraint/i.test(msg)) return NextResponse.json({ error: `The slug "${slug}" is taken — pick another.`, field: 'slug' }, { status: 409 })
    return NextResponse.json({ error: 'Could not create the tenant.' }, { status: 500 })
  }
}
