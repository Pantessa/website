import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { requireRole } from '@/lib/org'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

// Org detail + members. Any member may read; non-members get 404 (existence
// is not leaked — same convention as cross-wallet grant reads).
export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const gate = await requireRole(id, addr, 'member')
  if (!gate.ok) return NextResponse.json({ error: 'Not found.' }, { status: gate.status })

  const org = await prisma.organization.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      slug: true,
      perDayUsd: true,
      createdAt: true,
      members: {
        orderBy: { createdAt: 'asc' },
        select: { address: true, role: true, addedBy: true, createdAt: true },
      },
    },
  })
  if (!org) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  return NextResponse.json({ ...org, role: gate.role })
}

// Rename and/or set the org daily cap (USD across ALL the org's agent keys —
// the level above per-key budgets; null clears it). Admin+. The cap is
// SDK-enforced via /api/agent/policy — advisory at the rails (F5).
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const gate = await requireRole(id, addr, 'admin')
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.status === 404 ? 'Not found.' : 'Requires the admin role.' },
      { status: gate.status },
    )
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>)
  const data: { name?: string; perDayUsd?: number | null } = {}

  if ('name' in body) {
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 64) : ''
    if (!name) return NextResponse.json({ error: 'name must be non-empty.' }, { status: 400 })
    data.name = name
  }
  if ('perDayUsd' in body) {
    if (body.perDayUsd === null) {
      data.perDayUsd = null
    } else {
      const perDayUsd = Number(body.perDayUsd)
      if (!(perDayUsd > 0) || perDayUsd > 100_000) {
        return NextResponse.json(
          { error: 'perDayUsd must be a positive number (or null to clear).' },
          { status: 400 },
        )
      }
      data.perDayUsd = perDayUsd
    }
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  const org = await prisma.organization.update({
    where: { id },
    data,
    select: { id: true, name: true, slug: true, perDayUsd: true },
  })
  return NextResponse.json({ ...org, role: gate.role })
}

// Delete the org. Owner only. Cascades the org's members, keys, grants (and
// through grants, their ledger) — the danger-zone action, like deleting a
// grant deletes its ledger today.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const gate = await requireRole(id, addr, 'owner')
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.status === 404 ? 'Not found.' : 'Only the owner can delete an organization.' },
      { status: gate.status },
    )
  }

  await prisma.organization.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
