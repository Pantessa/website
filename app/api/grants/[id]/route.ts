import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getAuthAddress } from '@/lib/api-key'
import { spentTodayUsd, spentTotalUsd } from '@/lib/grant-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

// Read a grant + recent ledger + spend totals. Owner only.
// Auth: SIWE session cookie OR `Authorization: Bearer yf_…` (headless agents).
export async function GET(req: NextRequest, { params }: Params) {
  const { id } = await params
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const grant = await prisma.spendGrant.findUnique({
    where: { id },
    include: { ledger: { orderBy: { createdAt: 'desc' }, take: 100 } },
  })
  if (!grant || grant.ownerAddress !== addr) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  const [today, total] = await Promise.all([spentTodayUsd(id), spentTotalUsd(id)])
  return NextResponse.json({
    ...grant,
    spentTodayUsd: today,
    spentTotalUsd: total,
    remainingTodayUsd: Math.max(0, grant.perDayUsd - today),
  })
}

// Update a grant — revoke it, or adjust label/caps/allowlist. Owner only.
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const grant = await prisma.spendGrant.findUnique({ where: { id } })
  if (!grant || grant.ownerAddress !== addr) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  const data: Record<string, unknown> = {}
  if (body.status === 'revoked' || body.status === 'active') data.status = body.status
  if (typeof body.label === 'string') data.label = body.label.trim().slice(0, 80)
  if (Number(body.perDayUsd) > 0) data.perDayUsd = Number(body.perDayUsd)
  if (Number(body.perCallUsd) > 0) data.perCallUsd = Number(body.perCallUsd)

  const updated = await prisma.spendGrant.update({ where: { id }, data })
  return NextResponse.json(updated)
}

// Delete a grant (and its ledger via cascade). Owner only.
export async function DELETE(req: NextRequest, { params }: Params) {
  const { id } = await params
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const grant = await prisma.spendGrant.findUnique({ where: { id } })
  if (!grant || grant.ownerAddress !== addr) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }
  await prisma.spendGrant.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
