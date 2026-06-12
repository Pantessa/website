import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

// Set a connected agent's terms. Owner only, SIWE-gated like minting: an
// agent must not be able to raise its own budget with the key it holds.
// perDayUsd: positive number, or null to remove the budget (grant governs).
export async function PATCH(req: NextRequest, { params }: Params) {
  const { id } = await params
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const key = await prisma.apiKey.findUnique({ where: { id } })
  if (!key || key.ownerAddress !== addr) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }

  const body = await req.json().catch(() => ({}) as Record<string, unknown>)
  const data: { perDayUsd?: number | null; label?: string } = {}

  if ('perDayUsd' in body) {
    if (body.perDayUsd === null) {
      data.perDayUsd = null
    } else {
      const perDayUsd = Number(body.perDayUsd)
      if (!(perDayUsd > 0) || perDayUsd > 10_000) {
        return NextResponse.json({ error: 'perDayUsd must be a positive number (or null to clear).' }, { status: 400 })
      }
      data.perDayUsd = perDayUsd
    }
  }
  if (typeof body.label === 'string' && body.label.trim()) {
    data.label = body.label.trim().slice(0, 80)
  }
  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  const updated = await prisma.apiKey.update({
    where: { id },
    data,
    select: { id: true, label: true, prefix: true, perDayUsd: true, lastUsedAt: true, createdAt: true },
  })
  return NextResponse.json(updated)
}

// Revoke (delete) an API key. Owner only; revocation is immediate since every
// Bearer request re-resolves the hash against this table.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const key = await prisma.apiKey.findUnique({ where: { id } })
  if (!key || key.ownerAddress !== addr) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }
  await prisma.apiKey.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
