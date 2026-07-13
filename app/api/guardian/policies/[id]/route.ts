import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// PATCH { status: 'active' | 'paused' } — pause/resume an armed policy.
// DELETE — retire it (status 'done'; the run receipts are append-only and
// survive, so the audit trail never thins).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { status?: string }
  if (body.status !== 'active' && body.status !== 'paused') {
    return NextResponse.json({ error: "status must be 'active' or 'paused'." }, { status: 400 })
  }
  // Only flip between the resting states — never un-trigger a fired policy.
  const updated = await prisma.hlGuardianPolicy.updateMany({
    where: { id, wallet: addr, status: { in: ['active', 'paused', 'error'] } },
    data: { status: body.status },
  })
  if (updated.count === 0) return NextResponse.json({ error: 'Not found (or not in a switchable state).' }, { status: 404 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const { id } = await params
  const updated = await prisma.hlGuardianPolicy.updateMany({
    where: { id, wallet: addr, status: { not: 'triggered' } },
    data: { status: 'done' },
  })
  if (updated.count === 0) return NextResponse.json({ error: 'Not found (or mid-trigger).' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
