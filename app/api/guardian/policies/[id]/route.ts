import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { hlInfo } from '@/lib/hl-guardian-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET — one policy with its LIVE picture: current mark, entry, and how far
// the trigger is, plus the latest run. The chat GuardianPolicyCard polls
// this; owner-only.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const { id } = await params
  const policy = await prisma.hlGuardianPolicy.findUnique({
    where: { id },
    include: { runs: { orderBy: { createdAt: 'desc' }, take: 1 }, delegation: { select: { status: true, expiresAt: true } } },
  })
  if (!policy || policy.wallet !== addr) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  let markPx: number | null = null
  let entryPx: number | null = null
  let triggerPx: number | null = null
  try {
    const info = hlInfo()
    const [mids, state] = await Promise.all([info.allMids(), info.clearinghouseState({ user: policy.wallet as `0x${string}` })])
    markPx = mids[policy.coin] != null ? Number(mids[policy.coin]) : null
    const pos = state.assetPositions.find((ap) => ap.position.coin === policy.coin)
    entryPx = pos ? Number(pos.position.entryPx) : null
    if (entryPx != null) {
      const adverse = policy.kind === 'stop_loss'
      const below = (policy.side === 'long') === adverse
      triggerPx =
        policy.triggerMode === 'price'
          ? policy.triggerValue
          : below
            ? entryPx * (1 - policy.triggerValue / 100)
            : entryPx * (1 + policy.triggerValue / 100)
    }
  } catch {
    /* live picture is best-effort — the card renders without it */
  }

  return NextResponse.json({
    policy: {
      id: policy.id,
      coin: policy.coin,
      side: policy.side,
      kind: policy.kind,
      triggerMode: policy.triggerMode,
      triggerValue: policy.triggerValue,
      status: policy.status,
      lastChecked: policy.lastChecked,
      delegationStatus: policy.delegation.status,
    },
    live: { markPx, entryPx, triggerPx },
    lastRun: policy.runs[0] ?? null,
  })
}

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
